import { afterEach, expect, it, vi } from "vitest";
import { ChromeTabsAdapter, type ChromeTabsApi } from "../../src/chrome/tabs";
import { chromeTab, fakeChromeTabs } from "../helpers/chrome-fixtures";

const metadataOptions = () => ({
  signal: new AbortController().signal,
  onProgress: vi.fn(),
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("captures one normal window, skips protected tabs, and tolerates loading videos", async () => {
  const chromeApi = fakeChromeTabs({
    activeTab: chromeTab({ id: 1, windowId: 7, url: "https://github.com/" }),
    window: { id: 7, type: "normal", incognito: false },
    tabs: [
      chromeTab({ id: 2, windowId: 7, url: "https://youtube.com/watch?v=a" }),
      chromeTab({ id: 3, windowId: 7, url: "https://youtube.com/results?q=x" }),
      chromeTab({ id: 4, windowId: 7, url: "https://youtube.com/watch?v=b", discarded: true }),
      chromeTab({ id: 5, windowId: 7, url: "https://youtube.com/watch?v=c", status: "loading" }),
      chromeTab({ id: 6, windowId: 7, url: "https://youtube.com/watch?v=d", pinned: true }),
    ],
  });
  const adapter = new ChromeTabsAdapter(chromeApi as unknown as ChromeTabsApi);
  expect(await adapter.captureCurrentNormalWindow()).toBe(7);
  const metadata = await adapter.collectMetadata(
    await adapter.queryWindowTabs(7),
    metadataOptions(),
  );
  expect(chromeApi.scripting.executeScript).toHaveBeenCalledTimes(2);
  expect(metadata.find(({ tab }) => tab.id === 4)).toMatchObject({
    ok: true,
    source: "tab-title",
    issue: "discarded",
  });
  expect(chromeApi.scripting.executeScript).toHaveBeenCalledWith(
    expect.objectContaining({ target: { tabId: 5 }, injectImmediately: true }),
  );
  for (const [injection] of chromeApi.scripting.executeScript.mock.calls)
    expect(injection).toMatchObject({ injectImmediately: true });
});

it("limits concurrent metadata injections for large tab sets", async () => {
  const tabs = Array.from({ length: 20 }, (_, index) =>
    chromeTab({ id: index + 1, windowId: 7, url: `https://youtube.com/watch?v=${index}` }),
  );
  const chromeApi = fakeChromeTabs({
    activeTab: chromeTab({ id: 99, windowId: 7, url: "https://github.com/" }),
    window: { id: 7, type: "normal", incognito: false },
    tabs,
  });
  let active = 0;
  let maximum = 0;
  chromeApi.scripting.executeScript.mockImplementation(async ({ target }) => {
    active++;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 0));
    active--;
    return [
      {
        frameId: 0,
        result: { title: `Video ${target.tabId}`, canonicalUrl: tabs[target.tabId - 1]?.url },
      },
    ];
  });
  const adapter = new ChromeTabsAdapter(chromeApi as unknown as ChromeTabsApi);
  const progress = vi.fn();
  await adapter.collectMetadata(await adapter.queryWindowTabs(7), {
    signal: new AbortController().signal,
    onProgress: progress,
  });
  expect(maximum).toBeLessThanOrEqual(8);
  expect(
    Math.max(...progress.mock.calls.map(([value]) => value.active as number)),
  ).toBeLessThanOrEqual(8);
  expect(chromeApi.scripting.executeScript).toHaveBeenCalledTimes(20);
});

it("falls back to the tab title when page metadata injection is rejected", async () => {
  const tab = chromeTab({
    id: 2,
    windowId: 7,
    url: "https://youtube.com/watch?v=a",
    title: "Fallback title",
  });
  const chromeApi = fakeChromeTabs({
    activeTab: chromeTab({ id: 99, windowId: 7, url: "https://github.com/" }),
    window: { id: 7, type: "normal", incognito: false },
    tabs: [tab],
  });
  chromeApi.scripting.executeScript.mockRejectedValue(new Error("Cannot access contents"));
  const adapter = new ChromeTabsAdapter(chromeApi as unknown as ChromeTabsApi);
  const [result] = await adapter.collectMetadata(
    await adapter.queryWindowTabs(7),
    metadataOptions(),
  );
  expect(result?.ok).toBe(true);
  if (result?.ok) expect(result.metadata.title).toBe("Fallback title");
  expect(result).toMatchObject({ source: "tab-title", issue: "injection-error" });
});

it("logs only aggregate progress when Chrome exposes private metadata and errors", async () => {
  const privateTitle = "Private fishing title";
  const privateVideoId = "private-video-id";
  const privateError = "Private Chrome injection failure";
  const privateTab = chromeTab({
    id: 2,
    windowId: 7,
    url: `https://youtube.com/watch?v=${privateVideoId}`,
    title: `${privateTitle} - YouTube`,
  });
  const chromeApi = fakeChromeTabs({
    activeTab: chromeTab({ id: 99, windowId: 7, url: "https://github.com/" }),
    window: { id: 7, type: "normal", incognito: false },
    tabs: [privateTab],
  });
  chromeApi.scripting.executeScript.mockRejectedValue(new Error(privateError));
  const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
  const debug = vi.spyOn(console, "debug").mockImplementation(() => undefined);
  const adapter = new ChromeTabsAdapter(chromeApi as unknown as ChromeTabsApi);

  await adapter.collectMetadata(await adapter.queryWindowTabs(7), metadataOptions());

  const serialized = JSON.stringify([...info.mock.calls, ...debug.mock.calls]);
  expect(serialized).not.toContain(privateTitle);
  expect(serialized).not.toContain(privateVideoId);
  expect(serialized).not.toContain(privateError);
  expect(serialized).not.toContain("youtube.com");
});

it("immediately cleans up eight pending readers when a newer collection supersedes them", async () => {
  vi.useFakeTimers();
  const oldTabs = Array.from({ length: 8 }, (_, index) =>
    chromeTab({
      id: index + 1,
      windowId: 7,
      url: `https://youtube.com/watch?v=old-${index}`,
      title: `Old ${index} - YouTube`,
    }),
  );
  const secondTab = chromeTab({
    id: 20,
    windowId: 7,
    url: "https://youtube.com/watch?v=second",
    title: "Second saved - YouTube",
  });
  const chromeApi = fakeChromeTabs({
    activeTab: chromeTab({ id: 99, windowId: 7, url: "https://github.com/" }),
    window: { id: 7, type: "normal", incognito: false },
    tabs: [...oldTabs, secondTab],
  });
  const oldResolvers: Array<(value: unknown) => void> = [];
  chromeApi.scripting.executeScript.mockImplementation(({ target }) => {
    if (target.tabId !== 20)
      return new Promise((resolve) => {
        oldResolvers.push(resolve);
      });
    return Promise.resolve([
      {
        frameId: 0,
        result: {
          canonicalUrl: secondTab.url,
          title: "Second rich title",
          description: "Second rich description",
        },
      },
    ]);
  });
  const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
  const debug = vi.spyOn(console, "debug").mockImplementation(() => undefined);
  const addListener = vi.spyOn(AbortSignal.prototype, "addEventListener");
  const removeListener = vi.spyOn(AbortSignal.prototype, "removeEventListener");
  const adapter = new ChromeTabsAdapter(chromeApi as unknown as ChromeTabsApi);
  const snapshots = await adapter.queryWindowTabs(7);
  const firstSnapshots = snapshots.filter(({ id }) => id < 20);
  const actualSecondSnapshot = snapshots.find(({ id }) => id === 20);
  if (firstSnapshots.length !== 8 || !actualSecondSnapshot)
    throw new Error("Missing tab snapshot fixture.");
  const firstProgress = vi.fn();
  const firstOutcome = adapter
    .collectMetadata(firstSnapshots, {
      signal: new AbortController().signal,
      onProgress: firstProgress,
    })
    .catch((error: unknown) => error);
  expect(chromeApi.scripting.executeScript).toHaveBeenCalledTimes(8);

  const secondResultPromise = adapter.collectMetadata([actualSecondSnapshot], metadataOptions());
  const error = await firstOutcome;
  const timersAfterSupersession = vi.getTimerCount();
  const secondResults = await secondResultPromise;
  const listenersAfterSupersession = {
    added: addListener.mock.calls.length,
    removed: removeListener.mock.calls.length,
  };
  const progressCallsAfterClose = firstProgress.mock.calls.length;
  const logCallsAfterClose = info.mock.calls.length + debug.mock.calls.length;

  for (const resolve of oldResolvers)
    resolve([
      {
        frameId: 0,
        result: { canonicalUrl: "https://youtube.com/watch?v=old", title: "Late private title" },
      },
    ]);
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(60_000);

  expect(timersAfterSupersession).toBe(0);
  expect(listenersAfterSupersession.removed).toBe(listenersAfterSupersession.added);
  expect(error).toBeInstanceOf(DOMException);
  expect(error).toMatchObject({ name: "AbortError" });
  expect(secondResults).toMatchObject([{ ok: true, source: "page" }]);
  expect(firstProgress).toHaveBeenCalledTimes(progressCallsAfterClose);
  expect(info.mock.calls.length + debug.mock.calls.length).toBe(logCallsAfterClose);
});
