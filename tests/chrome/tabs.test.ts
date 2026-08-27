import { expect, it } from "vitest";
import { ChromeTabsAdapter, type ChromeTabsApi } from "../../src/chrome/tabs";
import { chromeTab, fakeChromeTabs } from "../helpers/chrome-fixtures";
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
  const metadata = await adapter.collectMetadata(await adapter.queryWindowTabs(7));
  expect(chromeApi.scripting.executeScript).toHaveBeenCalledTimes(2);
  expect(metadata.find(({ tab }) => tab.id === 4)).toBeUndefined();
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
  await adapter.collectMetadata(await adapter.queryWindowTabs(7));
  expect(maximum).toBeLessThanOrEqual(8);
  expect(chromeApi.scripting.executeScript).toHaveBeenCalledTimes(20);
});
