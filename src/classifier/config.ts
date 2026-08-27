export const CLASSIFIER_CONFIG_VERSION = 1 as const;

export type ClassifierMode = "local-only" | "automatic" | "remote-only";

export interface LocalClassifierConfig {
  endpoint: string;
  model: string;
}

export interface RemoteClassifierConfig {
  enabled: boolean;
  endpoint: string;
  model: string;
  apiKey: string;
}

export interface ClassifierConfig {
  schemaVersion: typeof CLASSIFIER_CONFIG_VERSION;
  mode: ClassifierMode;
  local: LocalClassifierConfig;
  remote: RemoteClassifierConfig;
  diagnosticsEnabled: boolean;
  turboMode: boolean;
  concurrency: number;
}

export interface ClassifierConfigValidationIssue {
  path: string;
  message: string;
}

export type ClassifierConfigValidation =
  | { ok: true; value: ClassifierConfig }
  | { ok: false; issues: ClassifierConfigValidationIssue[] };

export const DEFAULT_CLASSIFIER_CONFIG: ClassifierConfig = {
  schemaVersion: CLASSIFIER_CONFIG_VERSION,
  mode: "automatic",
  local: { endpoint: "http://127.0.0.1:11434", model: "qwen2.5:3b-instruct" },
  remote: { enabled: false, endpoint: "", model: "", apiKey: "" },
  diagnosticsEnabled: false,
  turboMode: false,
  concurrency: 1,
};

export function createDefaultClassifierConfig(): ClassifierConfig {
  return structuredClone(DEFAULT_CLASSIFIER_CONFIG);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}

function parseUrl(value: unknown): URL | undefined {
  if (typeof value !== "string") return undefined;
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

function isLoopbackUrl(value: unknown): boolean {
  const url = parseUrl(value);
  return (
    url !== undefined &&
    (url.protocol === "http:" || url.protocol === "https:") &&
    (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]") &&
    url.username === "" &&
    url.password === ""
  );
}

function isRemoteUrl(value: unknown): boolean {
  const url = parseUrl(value);
  if (url === undefined || url.username !== "" || url.password !== "") return false;
  if (url.protocol === "https:") return true;
  return isLoopbackUrl(value);
}

export function validateClassifierConfig(value: unknown): ClassifierConfigValidation {
  const issues: ClassifierConfigValidationIssue[] = [];
  if (!isRecord(value))
    return { ok: false, issues: [{ path: "", message: "Configuration must be an object." }] };
  if (value.schemaVersion !== CLASSIFIER_CONFIG_VERSION)
    issues.push({ path: "schemaVersion", message: "Schema version must be 1." });
  if (value.mode !== "local-only" && value.mode !== "automatic" && value.mode !== "remote-only")
    issues.push({ path: "mode", message: "Mode is not supported." });
  if (!isRecord(value.local))
    issues.push({ path: "local", message: "Local configuration must be an object." });
  if (!isRecord(value.remote))
    issues.push({ path: "remote", message: "Remote configuration must be an object." });
  const local = isRecord(value.local) ? value.local : {};
  const remote = isRecord(value.remote) ? value.remote : {};
  if (
    !isLoopbackUrl(local.endpoint) ||
    (typeof local.endpoint === "string" && local.endpoint.length > 300)
  )
    issues.push({
      path: "local.endpoint",
      message: "Local endpoint must be a loopback HTTP(S) URL of at most 300 characters.",
    });
  if (!nonEmptyString(local.model, 120))
    issues.push({ path: "local.model", message: "Local model must be 1–120 characters." });
  if (typeof remote.enabled !== "boolean")
    issues.push({ path: "remote.enabled", message: "Remote enabled value must be boolean." });
  if (
    remote.endpoint !== "" &&
    (!isRemoteUrl(remote.endpoint) ||
      (typeof remote.endpoint === "string" && remote.endpoint.length > 500))
  )
    issues.push({
      path: "remote.endpoint",
      message: "Remote endpoint must be HTTPS (or loopback HTTP) and at most 500 characters.",
    });
  if (remote.model !== "" && !nonEmptyString(remote.model, 120))
    issues.push({
      path: "remote.model",
      message: "Remote model must be at most 120 non-empty characters.",
    });
  if (typeof remote.apiKey !== "string" || remote.apiKey.length > 500)
    issues.push({
      path: "remote.apiKey",
      message: "Remote API key must be at most 500 characters.",
    });
  if (typeof value.diagnosticsEnabled !== "boolean")
    issues.push({
      path: "diagnosticsEnabled",
      message: "Diagnostics enabled value must be boolean.",
    });
  if (typeof value.turboMode !== "boolean")
    issues.push({ path: "turboMode", message: "Turbo mode value must be boolean." });
  if (
    typeof value.concurrency !== "number" ||
    !Number.isInteger(value.concurrency) ||
    value.concurrency < 1 ||
    value.concurrency > 8
  )
    issues.push({ path: "concurrency", message: "Concurrency must be an integer from 1 to 8." });
  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    value: {
      schemaVersion: CLASSIFIER_CONFIG_VERSION,
      mode: value.mode as ClassifierMode,
      local: {
        endpoint: local.endpoint as string,
        model: local.model as string,
      },
      remote: {
        enabled: remote.enabled as boolean,
        endpoint: remote.endpoint as string,
        model: remote.model as string,
        apiKey: remote.apiKey as string,
      },
      diagnosticsEnabled: value.diagnosticsEnabled as boolean,
      turboMode: value.turboMode as boolean,
      concurrency: value.concurrency as number,
    },
  };
}

export function selectProviderChain(config: ClassifierConfig): Array<"ollama" | "remote"> {
  const local = config.mode !== "remote-only" ? (["ollama"] as const) : ([] as const);
  const remote =
    config.remote.enabled && config.mode !== "local-only" ? (["remote"] as const) : ([] as const);
  return [...local, ...remote];
}

export function canFallbackToRemote(config: ClassifierConfig): boolean {
  return config.mode === "automatic" && config.remote.enabled;
}

export function redactClassifierConfig(config: ClassifierConfig): ClassifierConfig {
  return {
    ...structuredClone(config),
    remote: { ...config.remote, apiKey: config.remote.apiKey ? "[redacted]" : "" },
  };
}
