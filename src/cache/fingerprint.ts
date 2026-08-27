import type { RuleConfig, VideoMetadata } from "../types";

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function fingerprintMetadata(metadata: VideoMetadata): Promise<string> {
  return sha256(
    JSON.stringify([
      metadata.title,
      metadata.description ?? null,
      metadata.channelName ?? null,
      metadata.hashtags ?? [],
      metadata.playlistTitle ?? null,
    ]),
  );
}

export function fingerprintClassificationRules(config: RuleConfig): Promise<string> {
  return sha256(
    JSON.stringify({
      rules: config.rules
        .filter(({ enabled }) => enabled)
        .map(({ id, name, description }) => ({ id, name, description })),
      fallbackRuleId: config.fallbackRuleId,
    }),
  );
}
