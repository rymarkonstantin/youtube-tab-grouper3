import type { ClassificationItem, GroupRule } from "../types";
import { ActivationRequiredError, AiUnavailableError } from "./errors";

export type AiAvailability = "unavailable" | "downloadable" | "downloading" | "available";
export interface DetectedLanguage {
  detectedLanguage: string;
  confidence: number;
}
export interface DetectorSessionPort {
  detect(input: string, options: { signal: AbortSignal }): Promise<DetectedLanguage[]>;
  destroy(): void;
}
export interface TranslatorSessionPort {
  translate(input: string, options: { signal: AbortSignal }): Promise<string>;
  destroy(): void;
}
export interface AiSessionCreateOptions {
  signal: AbortSignal;
  onDownloadProgress(loaded: number): void;
}
export interface AiDownloadProgress {
  capability: string;
  loaded: number;
}
export interface LanguageApiPort {
  detectorAvailability(): Promise<AiAvailability>;
  createDetector(options: AiSessionCreateOptions): Promise<DetectorSessionPort>;
  translatorAvailability(sourceLanguage: string, targetLanguage: string): Promise<AiAvailability>;
  createTranslator(
    sourceLanguage: string,
    targetLanguage: string,
    options: AiSessionCreateOptions,
  ): Promise<TranslatorSessionPort>;
}
export interface LanguageNormalizationOptions {
  allowDownloads: boolean;
  signal: AbortSignal;
  onDownloadProgress(progress: AiDownloadProgress): void;
}
export interface NormalizedClassifierInputs {
  items: ClassificationItem[];
  rules: GroupRule[];
  inputLanguages: string[];
  failedItemIds: string[];
}

const PROMPT_LANGUAGES = new Set(["en", "ja", "es", "de", "fr"]);

function baseLanguage(value: string | undefined): string {
  if (!value) return "en";
  try {
    return new Intl.Locale(value).language.toLowerCase() || "en";
  } catch {
    return "en";
  }
}

function availabilityNeedsActivation(
  availability: AiAvailability,
  allowDownloads: boolean,
): boolean {
  return !allowDownloads && (availability === "downloadable" || availability === "downloading");
}

async function requireDetector(
  api: LanguageApiPort,
  options: LanguageNormalizationOptions,
): Promise<DetectorSessionPort> {
  const availability = await api.detectorAvailability();
  if (availability === "unavailable") throw new AiUnavailableError("language-detector");
  if (availabilityNeedsActivation(availability, options.allowDownloads)) {
    throw new ActivationRequiredError("language-detector", async (activation) => {
      const session = await api.createDetector({
        signal: activation.signal,
        onDownloadProgress: activation.onDownloadProgress,
      });
      session.destroy();
    });
  }
  return api.createDetector({
    signal: options.signal,
    onDownloadProgress: (loaded) =>
      options.onDownloadProgress({ capability: "language-detector", loaded }),
  });
}

async function translateValue(
  value: string,
  sourceLanguage: string,
  api: LanguageApiPort,
  options: LanguageNormalizationOptions,
  sessions: Map<string, TranslatorSessionPort>,
  item: boolean,
): Promise<string> {
  let session = sessions.get(sourceLanguage);
  if (!session) {
    const availability = await api.translatorAvailability(sourceLanguage, "en");
    const capability = `translator:${sourceLanguage}-en`;
    if (availability === "unavailable") {
      if (item) throw new Error(capability);
      throw new AiUnavailableError(capability);
    }
    if (availabilityNeedsActivation(availability, options.allowDownloads)) {
      throw new ActivationRequiredError(
        "translator",
        async (activation) => {
          const created = await api.createTranslator(sourceLanguage, "en", {
            signal: activation.signal,
            onDownloadProgress: activation.onDownloadProgress,
          });
          created.destroy();
        },
        sourceLanguage,
      );
    }
    session = await api.createTranslator(sourceLanguage, "en", {
      signal: options.signal,
      onDownloadProgress: (loaded) => options.onDownloadProgress({ capability, loaded }),
    });
    sessions.set(sourceLanguage, session);
  }
  return session.translate(value, { signal: options.signal });
}

function itemText(item: ClassificationItem): string {
  const { metadata } = item;
  return [
    metadata.title,
    metadata.description,
    metadata.channelName,
    ...(metadata.hashtags ?? []),
    metadata.playlistTitle,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ");
}

export async function normalizeClassifierInputs(
  items: ClassificationItem[],
  rules: GroupRule[],
  api: LanguageApiPort,
  options: LanguageNormalizationOptions,
): Promise<NormalizedClassifierInputs> {
  const detector = await requireDetector(api, options);
  const failedItemIds: string[] = [];
  const inputLanguages = new Set<string>();
  const translatedRules: GroupRule[] = [];
  const activeRules = rules.filter(({ enabled }) => enabled);
  try {
    const detect = async (text: string): Promise<string> => {
      if (!text.trim()) return "en";
      const result = (await detector.detect(text, { signal: options.signal }))[0];
      return result && result.confidence >= 0.5 ? baseLanguage(result.detectedLanguage) : "en";
    };
    const ruleLanguages = new Map<string, string>();
    for (const rule of activeRules)
      ruleLanguages.set(rule.id, await detect(`${rule.name} ${rule.description}`));
    for (const rule of activeRules) {
      const language = ruleLanguages.get(rule.id) ?? "en";
      if (PROMPT_LANGUAGES.has(language)) translatedRules.push(structuredClone(rule));
      else {
        const names = new Map<string, TranslatorSessionPort>();
        try {
          translatedRules.push({
            ...rule,
            name: await translateValue(rule.name, language, api, options, names, false),
            description: await translateValue(
              rule.description,
              language,
              api,
              options,
              names,
              false,
            ),
          });
        } finally {
          for (const session of names.values()) session.destroy();
        }
      }
    }
    const normalizedItems: ClassificationItem[] = [];
    for (const item of items) {
      const language = await detect(itemText(item));
      if (PROMPT_LANGUAGES.has(language)) {
        inputLanguages.add(language);
        normalizedItems.push(structuredClone(item));
        continue;
      }
      const sessions = new Map<string, TranslatorSessionPort>();
      try {
        const metadata = structuredClone(item.metadata);
        metadata.title = await translateValue(
          metadata.title,
          language,
          api,
          options,
          sessions,
          true,
        );
        for (const key of ["description", "channelName", "playlistTitle"] as const) {
          const value = metadata[key];
          if (value)
            metadata[key] = await translateValue(value, language, api, options, sessions, true);
        }
        if (metadata.hashtags) {
          metadata.hashtags = await Promise.all(
            metadata.hashtags.map((tag) =>
              translateValue(tag, language, api, options, sessions, true),
            ),
          );
        }
        inputLanguages.add("en");
        normalizedItems.push({ itemId: item.itemId, metadata });
      } catch (error) {
        if (error instanceof ActivationRequiredError) throw error;
        failedItemIds.push(item.itemId);
      } finally {
        for (const session of sessions.values()) session.destroy();
      }
    }
    return {
      items: normalizedItems,
      rules: translatedRules,
      inputLanguages: [...inputLanguages],
      failedItemIds,
    };
  } finally {
    detector.destroy();
  }
}

export class ChromeLanguageApi implements LanguageApiPort {
  async detectorAvailability(): Promise<AiAvailability> {
    const detector = (globalThis as { LanguageDetector?: typeof LanguageDetector })
      .LanguageDetector;
    if (!detector) return "unavailable";
    return (await detector.availability()) as AiAvailability;
  }

  async createDetector(options: AiSessionCreateOptions): Promise<DetectorSessionPort> {
    const detector = (globalThis as { LanguageDetector?: typeof LanguageDetector })
      .LanguageDetector;
    if (!detector) throw new AiUnavailableError("language-detector");
    const session = await detector.create({
      signal: options.signal,
      monitor: (monitor) => {
        monitor.addEventListener("downloadprogress", (event) =>
          options.onDownloadProgress(event.loaded),
        );
      },
    });
    return {
      detect: async (input, detectOptions) =>
        (await session.detect(input, detectOptions))
          .filter(
            (result): result is { detectedLanguage: string; confidence: number } =>
              typeof result.detectedLanguage === "string" && typeof result.confidence === "number",
          )
          .map(({ detectedLanguage, confidence }) => ({ detectedLanguage, confidence })),
      destroy: () => session.destroy(),
    };
  }

  async translatorAvailability(
    sourceLanguage: string,
    targetLanguage: string,
  ): Promise<AiAvailability> {
    const translator = (globalThis as { Translator?: typeof Translator }).Translator;
    if (!translator) return "unavailable";
    return (await translator.availability({ sourceLanguage, targetLanguage })) as AiAvailability;
  }

  async createTranslator(
    sourceLanguage: string,
    targetLanguage: string,
    options: AiSessionCreateOptions,
  ): Promise<TranslatorSessionPort> {
    const translator = (globalThis as { Translator?: typeof Translator }).Translator;
    if (!translator) throw new AiUnavailableError(`translator:${sourceLanguage}-${targetLanguage}`);
    const session = await translator.create({
      sourceLanguage,
      targetLanguage,
      signal: options.signal,
      monitor: (monitor) => {
        monitor.addEventListener("downloadprogress", (event) =>
          options.onDownloadProgress(event.loaded),
        );
      },
    });
    return {
      translate: (input, translateOptions) => session.translate(input, translateOptions),
      destroy: () => session.destroy(),
    };
  }
}
