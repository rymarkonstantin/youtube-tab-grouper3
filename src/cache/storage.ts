import type { StorageAreaLike } from "../storage";

export const CLASSIFICATION_CACHE_STORAGE_KEY = "classificationCacheV1";

export interface ClassificationCacheEntry {
  videoId: string;
  metadataFingerprint: string;
  rulesFingerprint: string;
  ruleId: string;
}
export type ClassificationCacheKey = Omit<ClassificationCacheEntry, "ruleId">;
export interface ClassificationCacheRepositoryPort {
  load(): Promise<ClassificationCacheEntry[]>;
  find(
    key: ClassificationCacheKey,
    validRuleIds: Set<string>,
  ): Promise<ClassificationCacheEntry | null>;
  put(entries: ClassificationCacheEntry[], validRuleIds: Set<string>): Promise<void>;
  clear(): Promise<void>;
}

function isEntry(value: unknown): value is ClassificationCacheEntry {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return ["videoId", "metadataFingerprint", "rulesFingerprint", "ruleId"].every(
    (key) => typeof item[key] === "string",
  );
}

export class ClassificationCacheRepository implements ClassificationCacheRepositoryPort {
  constructor(
    private readonly storage: StorageAreaLike,
    private readonly maxEntries = 500,
  ) {}

  async load(): Promise<ClassificationCacheEntry[]> {
    const stored = await this.storage.get(CLASSIFICATION_CACHE_STORAGE_KEY);
    const value = stored[CLASSIFICATION_CACHE_STORAGE_KEY];
    return Array.isArray(value) ? value.filter(isEntry).slice(0, this.maxEntries) : [];
  }

  async find(
    key: ClassificationCacheKey,
    validRuleIds: Set<string>,
  ): Promise<ClassificationCacheEntry | null> {
    const entries = await this.load();
    const index = entries.findIndex(
      (entry) =>
        entry.videoId === key.videoId &&
        entry.metadataFingerprint === key.metadataFingerprint &&
        entry.rulesFingerprint === key.rulesFingerprint &&
        validRuleIds.has(entry.ruleId),
    );
    if (index < 0) return null;
    const [hit] = entries.splice(index, 1);
    if (!hit) return null;
    entries.unshift(hit);
    await this.storage.set({ [CLASSIFICATION_CACHE_STORAGE_KEY]: entries });
    return structuredClone(hit);
  }

  async put(entries: ClassificationCacheEntry[], validRuleIds: Set<string>): Promise<void> {
    const current = await this.load();
    const accepted = entries.filter((entry) => isEntry(entry) && validRuleIds.has(entry.ruleId));
    const keys = new Set(
      accepted.map(
        (entry) =>
          `${entry.videoId}\u0000${entry.metadataFingerprint}\u0000${entry.rulesFingerprint}`,
      ),
    );
    const retained = current.filter(
      (entry) =>
        !keys.has(
          `${entry.videoId}\u0000${entry.metadataFingerprint}\u0000${entry.rulesFingerprint}`,
        ),
    );
    await this.storage.set({
      [CLASSIFICATION_CACHE_STORAGE_KEY]: [...accepted.reverse(), ...retained].slice(
        0,
        this.maxEntries,
      ),
    });
  }

  clear(): Promise<void> {
    return this.storage.remove(CLASSIFICATION_CACHE_STORAGE_KEY);
  }
}
