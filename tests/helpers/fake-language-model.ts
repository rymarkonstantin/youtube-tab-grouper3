import type { ClassificationItem, GroupRule } from "../../src/types";
import type { AiAvailability } from "../../src/classifier/language";
import type {
  LanguageModelAvailabilityOptions,
  LanguageModelCreateOptions,
  LanguageModelPort,
  LanguageModelSessionPort,
} from "../../src/classifier/chrome-built-in";
import { ChromeBuiltInClassifier } from "../../src/classifier/chrome-built-in";

export interface FakeModelOptions {
  availability?: AiAvailability;
  contextUsage?: number;
  contextWindow?: number;
  measuredUsage?: number[];
  responses?: Array<string | Error>;
}
export interface FakeModelPort extends LanguageModelPort {
  availabilityCalls: LanguageModelAvailabilityOptions[];
  createCalls: LanguageModelCreateOptions[];
  sessions: Array<LanguageModelSessionPort & { measuredItemCounts: number[]; destroyed: boolean }>;
}
export const rules: GroupRule[] = [
  {
    id: "programming",
    name: "Programming",
    description: "Software development.",
    color: "green",
    enabled: true,
  },
  {
    id: "uncategorized",
    name: "Uncategorized",
    description: "No suitable topic.",
    color: "grey",
    enabled: true,
  },
];
export const programmingItem: ClassificationItem = {
  itemId: "item-0",
  metadata: { videoId: "v0", pageType: "watch", title: "Building with Aspire" },
};
export const validProgrammingResponse = responseFor(["item-0"]);
export function item(index: number): ClassificationItem {
  return {
    itemId: `item-${index}`,
    metadata: { videoId: `v${index}`, pageType: "watch", title: `Video ${index}` },
  };
}
export function responseFor(itemIds: string[], ruleId = "programming"): string {
  return JSON.stringify({
    results: itemIds.map((itemId) => ({ itemId, ruleId, reason: "Primary topic" })),
  });
}
export function createFakeModelPort(options: FakeModelOptions = {}): FakeModelPort {
  let responseIndex = 0;
  let measurementIndex = 0;
  const port: FakeModelPort = {
    availabilityCalls: [],
    createCalls: [],
    sessions: [],
    availability: async (value) => {
      port.availabilityCalls.push(value);
      return options.availability ?? "available";
    },
    create: async (value) => {
      port.createCalls.push(value);
      const session = {
        contextUsage: options.contextUsage ?? 0,
        contextWindow: options.contextWindow ?? 16_384,
        measuredItemCounts: [] as number[],
        destroyed: false as boolean,
        measureContextUsage: async (input: string) => {
          const parsed = JSON.parse(input) as { items: unknown[] };
          session.measuredItemCounts.push(parsed.items.length);
          return options.measuredUsage?.[measurementIndex++] ?? 1;
        },
        prompt: async (input: string) => {
          const response = options.responses?.[responseIndex++];
          if (response instanceof Error) throw response;
          if (response) return response;
          const parsed = JSON.parse(input) as { items: Array<{ itemId: string }> };
          return responseFor(parsed.items.map(({ itemId }) => itemId));
        },
        destroy: () => {
          session.destroyed = true;
        },
      } satisfies LanguageModelSessionPort & { measuredItemCounts: number[]; destroyed: boolean };
      port.sessions.push(session);
      return session;
    },
  };
  return port;
}
export function createClassifier(options: {
  model: LanguageModelPort;
  allowDownloads: boolean;
}): ChromeBuiltInClassifier {
  const language = {
    detectorAvailability: async () => "available" as const,
    createDetector: async () => ({
      detect: async () => [{ detectedLanguage: "en", confidence: 1 }],
      destroy: () => undefined,
    }),
    translatorAvailability: async () => "available" as const,
    createTranslator: async () => ({
      translate: async (input: string) => input,
      destroy: () => undefined,
    }),
  };
  return new ChromeBuiltInClassifier(language, options.model, {
    allowDownloads: options.allowDownloads,
    signal: new AbortController().signal,
    onDownloadProgress: () => undefined,
    onPhase: () => undefined,
  });
}
