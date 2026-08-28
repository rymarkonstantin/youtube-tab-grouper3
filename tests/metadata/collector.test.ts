import { describe, expect, it, vi } from "vitest";
import { collectTabMetadata } from "../../src/metadata/collector";
import { tab } from "../helpers/grouping-fixtures";

const options = () => ({
  signal: new AbortController().signal,
  onProgress: vi.fn(),
});

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
});
