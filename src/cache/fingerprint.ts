import type { ClassifierConfig } from "../classifier/config";
import type { ClassifierProviderId } from "../classifier/providers";
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

function classifierFingerprintContext(
  config: ClassifierConfig,
  providerId: ClassifierProviderId,
): {
  schemaVersion: number;
  providerId: ClassifierProviderId;
  endpointOrigin: string;
  model: string;
} {
  const provider = providerId === "ollama" ? config.local : config.remote;
  return {
    schemaVersion: config.schemaVersion,
    providerId,
    endpointOrigin: endpointOrigin(provider.endpoint),
    model: provider.model,
  };
}

function endpointOrigin(endpoint: string): string {
  try {
    return new URL(endpoint).origin;
  } catch {
    return "";
  }
}

export function fingerprintClassificationRules(
  config: RuleConfig,
  classifierConfig?: ClassifierConfig,
  activeProviderId?: ClassifierProviderId,
): Promise<string> {
  return sha256(
    JSON.stringify({
      rules: config.rules
        .filter(({ enabled }) => enabled)
        .map(({ id, name, description }) => ({ id, name, description })),
      fallbackRuleId: config.fallbackRuleId,
      classifier:
        classifierConfig !== undefined && activeProviderId !== undefined
          ? classifierFingerprintContext(classifierConfig, activeProviderId)
          : null,
    }),
  );
}
