import { expect, it } from "vitest";
import { normalizeVideoMetadata } from "../../src/metadata/normalize";

it("uses semantic page metadata, normalizes whitespace, and enforces bounds", () => {
  const result = normalizeVideoMetadata(
    { videoId: "abc_123-XYZ", pageType: "watch" },
    {
      title: "  Building   cloud-native apps  ",
      description: `  A detailed talk ${"x".repeat(2_000)} #dotnet #architecture  `,
      channelName: "  Dev Channel  ",
      hashtags: ["#dotnet", "#architecture", ...Array(12).fill("#extra")],
    },
    "Fallback title - YouTube",
  );

  expect(result?.title).toBe("Building cloud-native apps");
  expect(result?.description?.length).toBeLessThanOrEqual(1_500);
  expect(result?.channelName).toBe("Dev Channel");
  expect(result?.hashtags).toHaveLength(10);
});

it("uses a cleaned tab title when page metadata is absent", () => {
  expect(
    normalizeVideoMetadata(
      { videoId: "abc_123-XYZ", pageType: "short" },
      undefined,
      "Autumn perch on tiny crankbaits - YouTube",
    )?.title,
  ).toBe("Autumn perch on tiny crankbaits");
});

it("returns null when no usable title exists", () => {
  expect(
    normalizeVideoMetadata({ videoId: "abc_123-XYZ", pageType: "watch" }, { title: "   " }, ""),
  ).toBeNull();
});

it("ignores stale page metadata after a YouTube SPA navigation", () => {
  expect(
    normalizeVideoMetadata(
      { videoId: "current", pageType: "watch" },
      { canonicalUrl: "https://youtube.com/watch?v=old", title: "Old video" },
      "Current video - YouTube",
    )?.title,
  ).toBe("Current video");
});
