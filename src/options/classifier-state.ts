import type { ClassifierConfig } from "../classifier/config";

export interface ClassifierSettingsView {
  remoteCanBeUsed: boolean;
  remoteNeedsPermission: boolean;
  remoteMessage: string;
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
  if (config.mode === "local-only") {
    return {
      remoteCanBeUsed: false,
      remoteNeedsPermission: false,
      remoteMessage: "Remote fallback is disabled while Local only is selected.",
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
    };
  }
  if (!hasRemoteCredentials(config)) {
    return {
      remoteCanBeUsed: false,
      remoteNeedsPermission: false,
      remoteMessage: "Enter a remote endpoint, model, and API key before enabling fallback.",
    };
  }
  if (!hasRemotePermission) {
    return {
      remoteCanBeUsed: false,
      remoteNeedsPermission: true,
      remoteMessage: "Allow access to the configured remote endpoint before enabling fallback.",
    };
  }
  return {
    remoteCanBeUsed: true,
    remoteNeedsPermission: false,
    remoteMessage:
      "Remote fallback is configured and can receive video metadata if local Ollama fails.",
  };
}
