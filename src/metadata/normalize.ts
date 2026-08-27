import type { VideoMetadata } from "../types";
import { parseYouTubeVideoUrl, type VideoIdentity } from "./youtube-url";

export interface RawPageMetadata {
  canonicalUrl: string | undefined;
  title: string | undefined;
  description: string | undefined;
  channelName: string | undefined;
  hashtags: string[];
  playlistTitle: string | undefined;
}

const normalizeText = (value: string | undefined, max: number): string | undefined => {
  if (!value) return undefined;
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized ? normalized.slice(0, max) : undefined;
};

export function normalizeVideoMetadata(
  identity: VideoIdentity,
  raw: Partial<RawPageMetadata> | undefined,
  tabTitle: string | undefined,
): VideoMetadata | null {
  const canonical = raw?.canonicalUrl ? parseYouTubeVideoUrl(raw.canonicalUrl) : null;
  const source = canonical && canonical.videoId !== identity.videoId ? undefined : raw;
  let title = normalizeText(source?.title, 300) ?? normalizeText(tabTitle, 300);
  if (title?.endsWith(" - YouTube")) title = title.slice(0, -10).trim();
  if (!title) return null;
  const description = normalizeText(source?.description, 1500);
  const channelName = normalizeText(source?.channelName, 200);
  const playlistTitle = normalizeText(source?.playlistTitle, 300);
  const hashtags = (source?.hashtags ?? [])
    .map((tag) => normalizeText(tag, 100))
    .filter((tag): tag is string => tag !== undefined)
    .slice(0, 10);
  return {
    videoId: identity.videoId,
    pageType: identity.pageType,
    title,
    ...(description ? { description } : {}),
    ...(channelName ? { channelName } : {}),
    ...(hashtags.length > 0 ? { hashtags } : {}),
    ...(playlistTitle ? { playlistTitle } : {}),
  };
}
