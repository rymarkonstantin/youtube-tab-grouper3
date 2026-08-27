import type { ClassificationItem, VideoMetadata } from "../types";
import { fingerprintMetadata } from "./fingerprint";

export interface ClassificationCandidate {
  tabId: number;
  metadata: VideoMetadata;
}
export interface ClassificationWorkItem {
  item: ClassificationItem;
  tabIds: number[];
  metadataFingerprint: string;
  rulesFingerprint: string;
}
export interface ClassificationWorkSet {
  items: ClassificationWorkItem[];
}

export async function createClassificationWorkItems(
  candidates: ClassificationCandidate[],
  rulesFingerprint: string,
): Promise<ClassificationWorkSet> {
  const grouped = new Map<string, ClassificationWorkItem>();
  for (const candidate of candidates) {
    const metadataFingerprint = await fingerprintMetadata(candidate.metadata);
    const key = `${candidate.metadata.videoId}\u0000${metadataFingerprint}\u0000${rulesFingerprint}`;
    const existing = grouped.get(key);
    if (existing) existing.tabIds.push(candidate.tabId);
    else {
      const itemId = `item-${grouped.size}`;
      grouped.set(key, {
        item: { itemId, metadata: structuredClone(candidate.metadata) },
        tabIds: [candidate.tabId],
        metadataFingerprint,
        rulesFingerprint,
      });
    }
  }
  return { items: [...grouped.values()] };
}
