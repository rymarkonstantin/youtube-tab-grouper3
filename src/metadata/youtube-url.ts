import type { VideoPageType } from "../types";

export interface VideoIdentity {
  videoId: string;
  pageType: VideoPageType;
}

function isYouTubeHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "youtube.com" || host.endsWith(".youtube.com") || host === "youtu.be";
}

export function parseYouTubeVideoUrl(value: string): VideoIdentity | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !isYouTubeHost(url.hostname)) return null;
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split("/").filter(Boolean);
  let videoId: string | undefined;
  let pageType: VideoPageType = "watch";
  if (host === "youtu.be") {
    videoId = parts[0];
  } else if (parts.length === 1 && parts[0] === "watch") {
    videoId = url.searchParams.get("v") ?? undefined;
  } else if (parts[0] === "shorts" || parts[0] === "live") {
    pageType = parts[0] === "shorts" ? "short" : "live";
    videoId = parts[1];
  }
  if (!videoId) return null;
  try {
    videoId = decodeURIComponent(videoId).trim();
  } catch {
    return null;
  }
  return videoId ? { videoId, pageType } : null;
}
