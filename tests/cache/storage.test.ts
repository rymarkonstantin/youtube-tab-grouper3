import { expect, it } from "vitest";
import { ClassificationCacheRepository } from "../../src/cache/storage";
import { MemoryStorage } from "../helpers/memory-storage";

it("promotes hits, rejects deleted rules, caps entries, and stores no raw metadata", async () => {
  const storage = new MemoryStorage();
  const cache = new ClassificationCacheRepository(storage, 2);
  await cache.put(
    [
      { videoId: "a", metadataFingerprint: "ma", rulesFingerprint: "r", ruleId: "fishing" },
      { videoId: "b", metadataFingerprint: "mb", rulesFingerprint: "r", ruleId: "history" },
      { videoId: "c", metadataFingerprint: "mc", rulesFingerprint: "r", ruleId: "music" },
    ],
    new Set(["fishing", "history", "music"]),
  );
  expect((await cache.load()).map((entry) => entry.videoId)).toEqual(["c", "b"]);
  expect(
    await cache.find(
      { videoId: "b", metadataFingerprint: "mb", rulesFingerprint: "r" },
      new Set(["history"]),
    ),
  ).toMatchObject({ ruleId: "history" });
  expect((await cache.load()).map((entry) => entry.videoId)).toEqual(["b", "c"]);
  expect(
    await cache.find(
      { videoId: "b", metadataFingerprint: "mb", rulesFingerprint: "r" },
      new Set(["music"]),
    ),
  ).toBeNull();
  expect(JSON.stringify(storage.setCalls)).not.toContain("title");
});

it("deduplicates incoming keys with the last entry winning", async () => {
  const storage = new MemoryStorage();
  const cache = new ClassificationCacheRepository(storage);
  await cache.put(
    [
      { videoId: "a", metadataFingerprint: "m", rulesFingerprint: "r", ruleId: "history" },
      { videoId: "a", metadataFingerprint: "m", rulesFingerprint: "r", ruleId: "fishing" },
    ],
    new Set(["history", "fishing"]),
  );
  expect(await cache.load()).toEqual([
    { videoId: "a", metadataFingerprint: "m", rulesFingerprint: "r", ruleId: "fishing" },
  ]);
});
