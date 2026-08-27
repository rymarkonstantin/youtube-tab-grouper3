import {
  createDefaultClassifierConfig,
  validateClassifierConfig,
  type ClassifierConfig,
  type ClassifierConfigValidationIssue,
} from "./config";
import type { StorageAreaLike } from "../storage";

export const CLASSIFIER_CONFIG_STORAGE_KEY = "classifierConfigV1";

export class InvalidStoredClassifierConfigError extends Error {
  constructor(public readonly issues: ClassifierConfigValidationIssue[]) {
    super("Stored classifier configuration is invalid.");
    this.name = "InvalidStoredClassifierConfigError";
  }
}

function cloneConfig(config: ClassifierConfig): ClassifierConfig {
  return structuredClone(config);
}

function validateOrThrow(value: unknown): ClassifierConfig {
  const result = validateClassifierConfig(value);
  if (!result.ok) {
    throw new InvalidStoredClassifierConfigError(structuredClone(result.issues));
  }
  return result.value;
}

export async function loadOrInitializeClassifierConfig(
  storage: StorageAreaLike,
): Promise<ClassifierConfig> {
  const stored = await storage.get(CLASSIFIER_CONFIG_STORAGE_KEY);
  if (Object.hasOwn(stored, CLASSIFIER_CONFIG_STORAGE_KEY)) {
    return cloneConfig(validateOrThrow(stored[CLASSIFIER_CONFIG_STORAGE_KEY]));
  }

  const defaults = createDefaultClassifierConfig();
  await storage.set({ [CLASSIFIER_CONFIG_STORAGE_KEY]: cloneConfig(defaults) });
  return cloneConfig(defaults);
}

export async function saveClassifierConfig(
  storage: StorageAreaLike,
  value: unknown,
): Promise<ClassifierConfig> {
  const config = validateOrThrow(value);
  await storage.set({ [CLASSIFIER_CONFIG_STORAGE_KEY]: cloneConfig(config) });
  return cloneConfig(config);
}

export function restoreDefaultClassifierConfig(
  storage: StorageAreaLike,
): Promise<ClassifierConfig> {
  return saveClassifierConfig(storage, createDefaultClassifierConfig());
}

/** Returns the exact Chrome match pattern needed to access a configured remote origin. */
export function remotePermissionOrigin(endpoint: string): string | null {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return null;
  }

  const loopback =
    url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]";
  if (
    url.username !== "" ||
    url.password !== "" ||
    (url.protocol !== "https:" && !(loopback && url.protocol === "http:"))
  )
    return null;
  return `${url.protocol}//${url.host}/*`;
}
