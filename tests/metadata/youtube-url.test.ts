import { describe, expect, it } from "vitest";
import { parseYouTubeVideoUrl } from "../../src/metadata/youtube-url";

describe("parseYouTubeVideoUrl", () => {
  it.each([
    [
      "https://www.youtube.com/watch?v=abc_123-XYZ&list=PL1",
      { videoId: "abc_123-XYZ", pageType: "watch" },
    ],
    [
      "https://m.youtube.com/shorts/abc_123-XYZ?feature=share",
      { videoId: "abc_123-XYZ", pageType: "short" },
    ],
    ["https://youtube.com/live/abc_123-XYZ", { videoId: "abc_123-XYZ", pageType: "live" }],
    ["https://youtu.be/abc_123-XYZ?t=5", { videoId: "abc_123-XYZ", pageType: "watch" }],
  ])("recognizes %s", (url, expected) => {
    expect(parseYouTubeVideoUrl(url)).toEqual(expected);
  });

  it.each([
    "https://www.youtube.com/",
    "https://www.youtube.com/results?search_query=camera",
    "https://www.youtube.com/playlist?list=PL1",
    "https://www.youtube.com/@channel",
    "https://notyoutube.com/watch?v=abc_123-XYZ",
    "https://youtube.com.evil.test/watch?v=abc_123-XYZ",
    "http://www.youtube.com/watch?v=abc_123-XYZ",
    "https://www.youtube.com/watch",
    "chrome://extensions/",
  ])("rejects %s", (url) => {
    expect(parseYouTubeVideoUrl(url)).toBeNull();
  });
});
