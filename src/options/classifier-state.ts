import type { ClassifierConfig } from "../classifier/config";

export interface ClassifierSettingsView {
  remoteCanBeUsed: boolean;
  remoteNeedsPermission: boolean;
  remoteMessage: string;
  concurrencyMessage: string;
}

export interface ClassifierSettingsCacheImpact {
  clearClassificationCache: boolean;
}

/** Determines whether a settings save changes semantic classifier input or provider identity. */
export function classifierSettingsCacheImpact(
  before: ClassifierConfig,
  after: ClassifierConfig,
): ClassifierSettingsCacheImpact {
  return {
    clearClassificationCache:
      before.mode !== after.mode ||
      before.turboMode !== after.turboMode ||
      before.local.endpoint !== after.local.endpoint ||
      before.local.model !== after.local.model ||
      before.remote.enabled !== after.remote.enabled ||
      before.remote.endpoint !== after.remote.endpoint ||
      before.remote.model !== after.remote.model,
  };
}

function hasRemoteCredentials(config: ClassifierConfig): boolean {
  return Boolean(
    config.remote.endpoint.trim() && config.remote.model.trim() && config.remote.apiKey.trim(),
  );
}

/** Derives safe, credential-free remote fallback guidance for the settings page. */
export function classifierSettingsView(
  config: ClassifierConfig,
  hasRemotePermission: boolean,
): ClassifierSettingsView {
  const concurrencyMessage = classifierConcurrencyMessage(config.mode, config.concurrency);
  if (config.mode === "local-only") {
    return {
      remoteCanBeUsed: false,
      remoteNeedsPermission: false,
      remoteMessage: "Remote fallback is disabled while Local only is selected.",
      concurrencyMessage,
    };
  }
  if (!config.remote.enabled) {
    return {
      remoteCanBeUsed: false,
      remoteNeedsPermission: false,
      remoteMessage:
        config.mode === "remote-only"
          ? "Enable remote classification before using Remote only."
          : "Remote fallback is disabled. No metadata will be sent remotely.",
      concurrencyMessage,
    };
  }
  if (!hasRemoteCredentials(config)) {
    return {
      remoteCanBeUsed: false,
      remoteNeedsPermission: false,
      remoteMessage: "Enter a remote endpoint, model, and API key before enabling fallback.",
      concurrencyMessage,
    };
  }
  if (!hasRemotePermission) {
    return {
      remoteCanBeUsed: false,
      remoteNeedsPermission: true,
      remoteMessage: "Allow access to the configured remote endpoint before enabling fallback.",
      concurrencyMessage,
    };
  }
  return {
    remoteCanBeUsed: true,
    remoteNeedsPermission: false,
    remoteMessage:
      "Remote fallback is configured and can receive video metadata if local Ollama fails.",
    concurrencyMessage,
  };
}

/** Explains the effective worker limit without implying that local Ollama can parallelize. */
export function classifierConcurrencyMessage(
  mode: ClassifierConfig["mode"],
  configuredConcurrency: number,
): string {
  if (mode === "local-only")
    return "Local Ollama uses one adaptive worker; the setting is kept for remote mode only.";
  if (mode === "automatic")
    return `Local Ollama uses one adaptive worker; if remote fallback is used, it may run up to ${configuredConcurrency} concurrent batches.`;
  return `Remote classification may run up to ${configuredConcurrency} concurrent batches.`;
}
