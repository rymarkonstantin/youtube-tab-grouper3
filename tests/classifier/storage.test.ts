import { describe, expect, it } from "vitest";
import { createDefaultClassifierConfig } from "../../src/classifier/config";
import {
  InvalidStoredClassifierConfigError,
  loadOrInitializeClassifierConfig,
  remotePermissionOrigin,
  restoreDefaultClassifierConfig,
} from "../../src/classifier/storage";
import { MemoryStorage } from "../helpers/memory-storage";

describe("classifier configuration storage", () => {
  it("persists defaults only when classifier settings are absent", async () => {
    const storage = new MemoryStorage();

    await expect(loadOrInitializeClassifierConfig(storage)).resolves.toEqual(
      createDefaultClassifierConfig(),
    );
    expect(storage.setCalls).toHaveLength(1);
  });

  it("preserves valid customized settings", async () => {
    const custom = createDefaultClassifierConfig();
    custom.local.model = "llama3.2:3b";
    custom.diagnosticsEnabled = true;
    const storage = new MemoryStorage({ classifierConfigV1: custom });

    await expect(loadOrInitializeClassifierConfig(storage)).resolves.toEqual(custom);
    expect(storage.setCalls).toHaveLength(0);
  });

  it("loads legacy settings with new performance defaults", async () => {
    const legacy = createDefaultClassifierConfig() as unknown as Record<string, unknown>;
    delete legacy.turboMode;
    delete legacy.concurrency;
    const storage = new MemoryStorage({ classifierConfigV1: legacy });

    await expect(loadOrInitializeClassifierConfig(storage)).resolves.toMatchObject({
      turboMode: false,
      concurrency: 1,
    });
    expect(storage.setCalls).toHaveLength(0);
  });

  it("rejects explicitly malformed new settings without overwriting storage", async () => {
    const malformed = { ...createDefaultClassifierConfig(), concurrency: 0 };
    const storage = new MemoryStorage({ classifierConfigV1: malformed });

    await expect(loadOrInitializeClassifierConfig(storage)).rejects.toBeInstanceOf(
      InvalidStoredClassifierConfigError,
    );
    expect(storage.setCalls).toHaveLength(0);
  });

  it("does not overwrite invalid settings and recovers only through an explicit restore", async () => {
    const storage = new MemoryStorage({ classifierConfigV1: { schemaVersion: 99 } });

    await expect(loadOrInitializeClassifierConfig(storage)).rejects.toBeInstanceOf(
      InvalidStoredClassifierConfigError,
    );
    expect(storage.setCalls).toHaveLength(0);
    await expect(restoreDefaultClassifierConfig(storage)).resolves.toEqual(
      createDefaultClassifierConfig(),
    );
  });

  it("extracts the narrowly scoped optional host permission for a remote endpoint", () => {
    expect(remotePermissionOrigin("https://api.example.test/v1/chat/completions")).toBe(
      "https://api.example.test/*",
    );
    expect(remotePermissionOrigin("https://api.example.test:8443/v1")).toBe(
      "https://api.example.test:8443/*",
    );
    expect(remotePermissionOrigin("not a URL")).toBeNull();
  });
});
