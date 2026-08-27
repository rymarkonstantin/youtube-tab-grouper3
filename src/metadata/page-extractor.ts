import type { RawPageMetadata } from "./normalize";

export function extractYouTubePageMetadata(): RawPageMetadata {
  const content = (selector: string): string | undefined => {
    const element = document.querySelector<HTMLElement>(selector);
    return element?.getAttribute("content") || element?.getAttribute("title") || undefined;
  };
  return {
    canonicalUrl: document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href,
    title: content('meta[property="og:title"]') ?? content('meta[name="title"]') ?? document.title,
    description: content('meta[property="og:description"]') ?? content('meta[name="description"]'),
    channelName:
      content('meta[itemprop="author"]') ?? content('[itemprop="author"] [itemprop="name"]'),
    hashtags: Array.from(
      document.querySelectorAll<HTMLMetaElement>('meta[property="og:video:tag"]'),
    )
      .map((tag) => tag.content)
      .filter(Boolean),
    playlistTitle: content('meta[itemprop="playlistTitle"]'),
  };
}
