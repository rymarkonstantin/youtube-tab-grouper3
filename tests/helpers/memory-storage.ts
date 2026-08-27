import type { StorageAreaLike } from "../../src/storage";

export class MemoryStorage implements StorageAreaLike {
  readonly setCalls: Record<string, unknown>[] = [];
  readonly removeCalls: (string | string[])[] = [];
  private readonly values: Record<string, unknown>;

  constructor(initial: Record<string, unknown> = {}) {
    this.values = structuredClone(initial);
  }

  async get(): Promise<Record<string, unknown>> {
    return structuredClone(this.values);
  }

  async set(items: Record<string, unknown>): Promise<void> {
    this.setCalls.push(structuredClone(items));
    Object.assign(this.values, structuredClone(items));
  }

  async remove(keys: string | string[]): Promise<void> {
    this.removeCalls.push(keys);
    for (const key of typeof keys === "string" ? [keys] : keys) {
      delete this.values[key];
    }
  }
}
