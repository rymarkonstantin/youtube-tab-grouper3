import { afterEach, describe, expect, it, vi } from "vitest";
import { collectTabMetadata, type MetadataCollectionProgress } from "../../src/metadata/collector";
import { tab } from "../helpers/grouping-fixtures";

const options = () => ({
  signal: new AbortController().signal,
  onProgress: vi.fn(),
});

afterEach(() => vi.useRealTimers());

describe("collectTabMetadata", () => {
  it("returns candidates in snapshot order and excludes pinned or unsupported tabs", async () => {
    const tabs = [
      tab(1, 1, { url: "https://youtube.com/watch?v=first", title: "First - YouTube" }),
      tab(2, 1, { url: "https://github.com/", title: "GitHub" }),
      tab(3, 1, {
        url: "https://youtube.com/watch?v=pinned",
        title: "Pinned - YouTube",
        pinned: true,
      }),
      tab(4, 1, { url: "https://youtube.com/shorts/second", title: "Second - YouTube" }),
    ];
    const reader = {
      readPage: vi.fn(async (snapshot: (typeof tabs)[number]) => ({
        canonicalUrl: snapshot.url,
        title: snapshot.title,
        description: undefined,
        channelName: undefined,
        hashtags: [],
        playlistTitle: undefined,
      })),
    };

    const results = await collectTabMetadata(tabs, reader, options());

    expect(results.map(({ tab: snapshot }) => snapshot.id)).toEqual([1, 4]);
    expect(reader.readPage).toHaveBeenCalledTimes(2);
  });

  it("uses a discarded tab title without reading or waking the page", async () => {
    const snapshot = tab(5, 1, {
      url: "https://youtube.com/watch?v=discarded",
      title: "Saved fishing title - YouTube",
      discarded: true,
    });
    const reader = { readPage: vi.fn() };

    const [result] = await collectTabMetadata([snapshot], reader, options());

    expect(result).toMatchObject({
      ok: true,
      source: "tab-title",
      issue: "discarded",
      metadata: { videoId: "discarded", title: "Saved fishing title" },
    });
    expect(reader.readPage).not.toHaveBeenCalled();
  });

  it("marks a fulfilled page result as enriched only when it contributes metadata", async () => {
    const snapshot = tab(6, 1, {
      url: "https://youtube.com/watch?v=enriched",
      title: "Camera review - YouTube",
    });
    const reader = {
      readPage: vi.fn(async () => ({
        canonicalUrl: snapshot.url,
        title: "Camera review",
        description: "A detailed full-frame camera review.",
        channelName: "Photo channel",
        hashtags: ["#photography"],
        playlistTitle: undefined,
      })),
    };

    const [result] = await collectTabMetadata([snapshot], reader, options());

    expect(result).toMatchObject({ ok: true, source: "page" });
    if (result?.ok) expect(result.metadata.description).toContain("full-frame");
  });

  it("preserves snapshot order when page readers complete out of order", async () => {
    const tabs = [
      tab(10, 1, { url: "https://youtube.com/watch?v=first", title: "First - YouTube" }),
      tab(20, 1, { url: "https://youtube.com/watch?v=second", title: "Second - YouTube" }),
    ];
    const resolvers = new Map<number, (value: { canonicalUrl: string; title: string }) => void>();
    const resultPromise = collectTabMetadata(
      tabs,
      {
        readPage: vi.fn(
          (snapshot) =>
            new Promise<{ canonicalUrl: string; title: string }>((resolve) => {
              resolvers.set(snapshot.id, resolve);
            }),
        ),
      },
      options(),
    );

    resolvers.get(20)?.({ canonicalUrl: tabs[1]?.url ?? "", title: "Second page title" });
    await Promise.resolve();
    resolvers.get(10)?.({ canonicalUrl: tabs[0]?.url ?? "", title: "First page title" });

    const results = await resultPromise;
    expect(results.map(({ tab: snapshot }) => snapshot.id)).toEqual([10, 20]);
    expect(results.map((result) => (result.ok ? result.metadata.title : null))).toEqual([
      "First page title",
      "Second page title",
    ]);
  });

  it("uses the title baseline after the three-second soft deadline", async () => {
    vi.useFakeTimers();
    const snapshot = tab(10, 1, {
      url: "https://youtube.com/watch?v=slow",
      title: "Slow history video - YouTube",
    });
    const progress = vi.fn();
    const resultPromise = collectTabMetadata(
      [snapshot],
      { readPage: vi.fn(() => new Promise<never>(() => undefined)) },
      { signal: new AbortController().signal, onProgress: progress },
    );

    await vi.advanceTimersByTimeAsync(3_000);
    await expect(resultPromise).resolves.toMatchObject([
      { ok: true, source: "tab-title", issue: "timeout" },
    ]);
    expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({ timedOut: 1, active: 0 }));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("handles a reader rejection that arrives after its timeout", async () => {
    vi.useFakeTimers();
    let rejectPage!: (reason: unknown) => void;
    const resultPromise = collectTabMetadata(
      [tab(10, 1, { url: "https://youtube.com/watch?v=late-error", title: "Saved - YouTube" })],
      {
        readPage: vi.fn(
          () =>
            new Promise<never>((_resolve, reject) => {
              rejectPage = reject;
            }),
        ),
      },
      options(),
    );

    await vi.advanceTimersByTimeAsync(3_000);
    await expect(resultPromise).resolves.toMatchObject([
      { ok: true, source: "tab-title", issue: "timeout" },
    ]);
    rejectPage(new Error("Late private rejection"));
    await Promise.resolve();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("fails a timed-out tab without a usable saved title", async () => {
    vi.useFakeTimers();
    const resultPromise = collectTabMetadata(
      [tab(10, 1, { url: "https://youtube.com/watch?v=slow", title: "   " })],
      { readPage: vi.fn(() => new Promise<never>(() => undefined)) },
      options(),
    );

    await vi.advanceTimersByTimeAsync(3_000);

    await expect(resultPromise).resolves.toMatchObject([
      { ok: false, reason: "no-usable-title", issue: "timeout" },
    ]);
  });

  it("uses the title baseline after an immediate reader rejection", async () => {
    const snapshot = tab(10, 1, {
      url: "https://youtube.com/watch?v=rejected",
      title: "Saved rejection title - YouTube",
    });

    await expect(
      collectTabMetadata(
        [snapshot],
        { readPage: vi.fn(async () => Promise.reject(new Error("Private page error"))) },
        options(),
      ),
    ).resolves.toMatchObject([{ ok: true, source: "tab-title", issue: "injection-error" }]);
  });

  it("uses the title baseline when the page canonical URL is stale", async () => {
    const snapshot = tab(10, 1, {
      url: "https://youtube.com/watch?v=current",
      title: "Current saved title - YouTube",
    });

    await expect(
      collectTabMetadata(
        [snapshot],
        {
          readPage: vi.fn(async () => ({
            canonicalUrl: "https://youtube.com/watch?v=stale",
            title: "Stale private title",
          })),
        },
        options(),
      ),
    ).resolves.toMatchObject([{ ok: true, source: "tab-title", issue: "stale-page" }]);
  });

  it("keeps duplicate video tabs as separate ordered results", async () => {
    const tabs = [
      tab(10, 1, { url: "https://youtube.com/watch?v=same", title: "First copy - YouTube" }),
      tab(20, 1, { url: "https://youtube.com/watch?v=same", title: "Second copy - YouTube" }),
    ];

    const results = await collectTabMetadata(
      tabs,
      {
        readPage: vi.fn(async (snapshot) => ({
          canonicalUrl: snapshot.url,
          title: snapshot.title,
          description: `description-${snapshot.id}`,
        })),
      },
      options(),
    );

    expect(results.map(({ tab: snapshot }) => snapshot.id)).toEqual([10, 20]);
    expect(results).toHaveLength(2);
  });

  it("settles queued and active work at the global budget and logs it once", async () => {
    vi.useFakeTimers();
    const tabs = Array.from({ length: 20 }, (_, index) =>
      tab(index + 1, 1, {
        url: `https://youtube.com/watch?v=video-${index}`,
        title: `Video ${index} - YouTube`,
      }),
    );
    const onLog = vi.fn();
    const progress = vi.fn();
    const pageResolvers: Array<(value: { canonicalUrl: string; title: string }) => void> = [];
    const resultPromise = collectTabMetadata(
      tabs,
      {
        readPage: vi.fn(
          () =>
            new Promise<{ canonicalUrl: string; title: string }>((resolve) => {
              pageResolvers.push(resolve);
            }),
        ),
      },
      {
        signal: new AbortController().signal,
        onProgress: progress,
        onLog,
        policy: {
          concurrency: 8,
          perTabDeadlineMs: 120_000,
          phaseBudgetMs: 60_000,
          heartbeatMs: 5_000,
        },
      },
    );

    await vi.advanceTimersByTimeAsync(60_000);
    const results = await resultPromise;
    expect(results).toHaveLength(20);
    expect(results.every((result) => result.ok && result.source === "tab-title")).toBe(true);
    expect(
      onLog.mock.calls.filter(([event]) => event === "metadata:budget-exhausted"),
    ).toHaveLength(1);
    const progressCallsAtBudget = progress.mock.calls.length;
    for (const resolve of pageResolvers)
      resolve({ canonicalUrl: "https://youtube.com/watch?v=late", title: "Late private title" });
    await Promise.resolve();
    expect(progress).toHaveBeenCalledTimes(progressCallsAtBudget);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("caps an injected concurrency policy at eight logical workers", async () => {
    vi.useFakeTimers();
    const tabs = Array.from({ length: 20 }, (_, index) =>
      tab(index + 1, 1, {
        url: `https://youtube.com/watch?v=over-limit-${index}`,
        title: `Over limit ${index} - YouTube`,
      }),
    );
    const readPage = vi.fn(() => new Promise<never>(() => undefined));
    let maximumLogicalActive = 0;
    const resultPromise = collectTabMetadata(
      tabs,
      { readPage },
      {
        signal: new AbortController().signal,
        onProgress: (progress) => {
          maximumLogicalActive = Math.max(maximumLogicalActive, progress.active);
        },
        policy: {
          concurrency: 50,
          perTabDeadlineMs: 1,
          phaseBudgetMs: 100,
          heartbeatMs: 5,
        },
      },
    );
    const initiallyIssued = readPage.mock.calls.length;

    await vi.advanceTimersByTimeAsync(100);
    await resultPromise;

    expect(initiallyIssued).toBe(8);
    expect(maximumLogicalActive).toBeLessThanOrEqual(8);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses the default logical worker count for a non-finite concurrency policy", async () => {
    vi.useFakeTimers();
    const tabs = Array.from({ length: 20 }, (_, index) =>
      tab(index + 1, 1, {
        url: `https://youtube.com/watch?v=nan-${index}`,
        title: `NaN ${index} - YouTube`,
      }),
    );
    const readPage = vi.fn(() => new Promise<never>(() => undefined));
    const resultPromise = collectTabMetadata(
      tabs,
      { readPage },
      {
        signal: new AbortController().signal,
        onProgress: vi.fn(),
        policy: {
          concurrency: Number.NaN,
          perTabDeadlineMs: 1,
          phaseBudgetMs: 100,
          heartbeatMs: 5,
        },
      },
    );

    expect(readPage).toHaveBeenCalledTimes(8);
    await vi.advanceTimersByTimeAsync(100);
    await expect(resultPromise).resolves.toHaveLength(20);
  });

  it("anchors the phase budget before slow synchronous observers", async () => {
    vi.useFakeTimers();
    let firstProgress = true;
    let settled = false;
    const resultPromise = collectTabMetadata(
      [tab(1, 1, { url: "https://youtube.com/watch?v=observer", title: "Saved - YouTube" })],
      { readPage: vi.fn(() => new Promise<never>(() => undefined)) },
      {
        signal: new AbortController().signal,
        onProgress: () => {
          if (firstProgress) {
            firstProgress = false;
            vi.advanceTimersByTime(10_000);
          }
        },
        policy: {
          concurrency: 8,
          perTabDeadlineMs: 120_000,
          phaseBudgetMs: 60_000,
          heartbeatMs: 5_000,
        },
      },
    );
    void resultPromise.then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(50_000);
    const settledAtBudget = settled;
    await vi.advanceTimersByTimeAsync(10_000);
    await resultPromise;

    expect(settledAtBudget).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not issue a reader after an active-progress observer exhausts the phase budget", async () => {
    vi.useFakeTimers();
    const readPage = vi.fn(() => new Promise<never>(() => undefined));
    const resultPromise = collectTabMetadata(
      [tab(1, 1, { url: "https://youtube.com/watch?v=late-budget", title: "Saved - YouTube" })],
      { readPage },
      {
        signal: new AbortController().signal,
        onProgress: (progress) => {
          if (progress.active === 1) vi.advanceTimersByTime(60_001);
        },
        policy: {
          concurrency: 8,
          perTabDeadlineMs: 120_000,
          phaseBudgetMs: 60_000,
          heartbeatMs: 5_000,
        },
      },
    );

    await expect(resultPromise).resolves.toMatchObject([
      { ok: true, source: "tab-title", issue: "budget-exhausted" },
    ]);
    expect(readPage).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects on cancellation, logs once, and ignores a late page result", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    let resolvePage!: (value: { canonicalUrl: string; title: string }) => void;
    const readPage = vi.fn(
      () =>
        new Promise<{ canonicalUrl: string; title: string }>((resolve) => {
          resolvePage = resolve;
        }),
    );
    const progress = vi.fn();
    const onLog = vi.fn();
    const resultPromise = collectTabMetadata(
      [tab(1, 1, { url: "https://youtube.com/watch?v=cancel", title: "Saved - YouTube" })],
      { readPage },
      { signal: controller.signal, onProgress: progress, onLog },
    );

    controller.abort();
    await expect(resultPromise).rejects.toMatchObject({ name: "AbortError" });
    const callsAfterAbort = progress.mock.calls.length;
    resolvePage({
      canonicalUrl: "https://youtube.com/watch?v=cancel",
      title: "Late private title",
    });
    await Promise.resolve();
    expect(progress).toHaveBeenCalledTimes(callsAfterAbort);
    expect(onLog.mock.calls.filter(([event]) => event === "metadata:cancelled")).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not publish a settled page result when cancellation wins the next microtask", async () => {
    const controller = new AbortController();
    let resolvePage!: (value: { canonicalUrl: string; title: string }) => void;
    const progress: MetadataCollectionProgress[] = [];
    const onLog = vi.fn();
    const resultPromise = collectTabMetadata(
      [tab(1, 1, { url: "https://youtube.com/watch?v=microtask", title: "Saved - YouTube" })],
      {
        readPage: vi.fn(
          () =>
            new Promise<{ canonicalUrl: string; title: string }>((resolve) => {
              resolvePage = resolve;
            }),
        ),
      },
      { signal: controller.signal, onProgress: (value) => progress.push(value), onLog },
    );

    resolvePage({
      canonicalUrl: "https://youtube.com/watch?v=microtask",
      title: "Resolved page title",
    });
    queueMicrotask(() => controller.abort("Private microtask cancellation reason"));

    await expect(resultPromise).rejects.toMatchObject({ name: "AbortError" });
    expect(progress.some((value) => value.completed > 0)).toBe(false);
    expect(onLog.mock.calls.some(([event]) => event === "metadata:complete")).toBe(false);
  });

  it("normalizes a custom cancellation reason to a sanitized AbortError", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const resultPromise = collectTabMetadata(
      [tab(1, 1, { url: "https://youtube.com/watch?v=cancel", title: "Saved - YouTube" })],
      { readPage: vi.fn(() => new Promise<never>(() => undefined)) },
      { signal: controller.signal, onProgress: vi.fn() },
    );
    const outcome = resultPromise.catch((error: unknown) => error);

    controller.abort("Private custom cancellation reason");
    const error = await outcome;

    expect(error).toBeInstanceOf(DOMException);
    expect(error).toMatchObject({ name: "AbortError" });
    expect((error as DOMException).message).not.toContain("Private custom cancellation reason");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("normalizes a pre-aborted signal without starting collection work", async () => {
    const controller = new AbortController();
    controller.abort(new Error("Private pre-abort reason"));
    const readPage = vi.fn();
    const progress = vi.fn();
    const onLog = vi.fn();

    const error = await collectTabMetadata(
      [tab(1, 1, { url: "https://youtube.com/watch?v=pre-abort", title: "Saved - YouTube" })],
      { readPage },
      { signal: controller.signal, onProgress: progress, onLog },
    ).catch((value: unknown) => value);

    expect(error).toBeInstanceOf(DOMException);
    expect(error).toMatchObject({ name: "AbortError" });
    expect((error as DOMException).message).not.toContain("Private pre-abort reason");
    expect(readPage).not.toHaveBeenCalled();
    expect(progress).not.toHaveBeenCalled();
    expect(onLog).not.toHaveBeenCalled();
  });

  it("stops publication when the initial progress observer cancels with a custom reason", async () => {
    const controller = new AbortController();
    const readPage = vi.fn();
    const onLog = vi.fn();

    const error = await collectTabMetadata(
      [tab(1, 1, { url: "https://youtube.com/watch?v=observer-abort", title: "Saved - YouTube" })],
      { readPage },
      {
        signal: controller.signal,
        onProgress: () => controller.abort("Private observer cancellation reason"),
        onLog,
      },
    ).catch((value: unknown) => value);

    expect(error).toBeInstanceOf(DOMException);
    expect(error).toMatchObject({ name: "AbortError" });
    expect((error as DOMException).message).not.toContain("Private observer cancellation reason");
    expect(readPage).not.toHaveBeenCalled();
    expect(onLog).not.toHaveBeenCalled();
  });

  it("emits five-second sanitized heartbeat payloads while readers are pending", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const onLog = vi.fn();
    const resultPromise = collectTabMetadata(
      [
        tab(1, 1, {
          url: "https://youtube.com/watch?v=private-video-id",
          title: "Private fishing title - YouTube",
        }),
      ],
      { readPage: vi.fn(() => new Promise<never>(() => undefined)) },
      {
        signal: controller.signal,
        onProgress: vi.fn(),
        onLog,
        policy: {
          concurrency: 8,
          perTabDeadlineMs: 20_000,
          phaseBudgetMs: 60_000,
          heartbeatMs: 5_000,
        },
      },
    );
    const rejection = resultPromise.catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(5_000);

    const waiting = onLog.mock.calls.find(([event]) => event === "metadata:waiting");
    expect(waiting?.[1]).toEqual(
      expect.objectContaining({ completed: 0, total: 1, active: 1, elapsedMs: 5_000 }),
    );
    const serialized = JSON.stringify(onLog.mock.calls);
    expect(serialized).not.toContain("Private fishing title");
    expect(serialized).not.toContain("private-video-id");
    expect(serialized).not.toContain("youtube.com");

    controller.abort();
    await rejection;
  });

  it("excludes discarded baselines from ETA and clamps ETA to the remaining budget", async () => {
    vi.useFakeTimers();
    const tabs = [
      tab(1, 1, {
        url: "https://youtube.com/watch?v=discarded",
        title: "Saved discarded title - YouTube",
        discarded: true,
      }),
      tab(2, 1, { url: "https://youtube.com/watch?v=first", title: "First - YouTube" }),
      tab(3, 1, { url: "https://youtube.com/watch?v=second", title: "Second - YouTube" }),
    ];
    const resolvers = new Map<number, (value: { canonicalUrl: string; title: string }) => void>();
    const progress: MetadataCollectionProgress[] = [];
    const resultPromise = collectTabMetadata(
      tabs,
      {
        readPage: vi.fn(
          (snapshot) =>
            new Promise<{ canonicalUrl: string; title: string }>((resolve) => {
              resolvers.set(snapshot.id, resolve);
            }),
        ),
      },
      {
        signal: new AbortController().signal,
        onProgress: (value) => progress.push(value),
        policy: {
          concurrency: 2,
          perTabDeadlineMs: 20_000,
          phaseBudgetMs: 6_000,
          heartbeatMs: 5_000,
        },
      },
    );

    expect(progress.find((value) => value.completed === 1)?.etaMs).toBeNull();
    await vi.advanceTimersByTimeAsync(5_000);
    resolvers.get(2)?.({ canonicalUrl: tabs[1]?.url ?? "", title: "First page title" });
    await vi.advanceTimersByTimeAsync(0);

    expect(progress.find((value) => value.enriched === 1)?.etaMs).toBe(1_000);
    await vi.advanceTimersByTimeAsync(1_000);
    await resultPromise;
  });

  it("keeps a second collection unaffected by a late completion from the first", async () => {
    vi.useFakeTimers();
    const firstProgress = vi.fn();
    let resolveFirst!: (value: { canonicalUrl: string; title: string }) => void;
    const firstPromise = collectTabMetadata(
      [tab(1, 1, { url: "https://youtube.com/watch?v=first", title: "First saved - YouTube" })],
      {
        readPage: vi.fn(
          () =>
            new Promise<{ canonicalUrl: string; title: string }>((resolve) => {
              resolveFirst = resolve;
            }),
        ),
      },
      { signal: new AbortController().signal, onProgress: firstProgress },
    );
    await vi.advanceTimersByTimeAsync(3_000);
    await firstPromise;
    const firstCallsAfterTimeout = firstProgress.mock.calls.length;

    const secondProgress = vi.fn();
    const secondResult = await collectTabMetadata(
      [tab(2, 1, { url: "https://youtube.com/watch?v=second", title: "Second saved - YouTube" })],
      {
        readPage: vi.fn(async () => ({
          canonicalUrl: "https://youtube.com/watch?v=second",
          title: "Second rich title",
          description: "Second rich description",
        })),
      },
      { signal: new AbortController().signal, onProgress: secondProgress },
    );
    const secondCallsAtCompletion = secondProgress.mock.calls.length;

    resolveFirst({
      canonicalUrl: "https://youtube.com/watch?v=first",
      title: "Late private title",
    });
    await Promise.resolve();

    expect(secondResult).toMatchObject([{ ok: true, source: "page" }]);
    expect(firstProgress).toHaveBeenCalledTimes(firstCallsAfterTimeout);
    expect(secondProgress).toHaveBeenCalledTimes(secondCallsAtCompletion);
  });

  it("completes 145 never-settling tabs within the simulated phase budget", async () => {
    vi.useFakeTimers();
    const tabs = Array.from({ length: 145 }, (_, index) =>
      tab(index + 1, 1, {
        url: `https://youtube.com/watch?v=large-${index}`,
        title: `Large ${index} - YouTube`,
      }),
    );
    let maximumLogicalActive = 0;
    const resultPromise = collectTabMetadata(
      tabs,
      { readPage: vi.fn(() => new Promise<never>(() => undefined)) },
      {
        signal: new AbortController().signal,
        onProgress: (value) => {
          maximumLogicalActive = Math.max(maximumLogicalActive, value.active);
        },
      },
    );

    await vi.advanceTimersByTimeAsync(60_000);
    await expect(resultPromise).resolves.toHaveLength(145);
    expect(maximumLogicalActive).toBeLessThanOrEqual(8);
  });
});
