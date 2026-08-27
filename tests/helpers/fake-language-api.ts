import type {
  AiAvailability,
  AiSessionCreateOptions,
  DetectedLanguage,
  DetectorSessionPort,
  LanguageApiPort,
  LanguageNormalizationOptions,
  TranslatorSessionPort,
} from "../../src/classifier/language";

export interface FakeLanguageApiOptions {
  detectorAvailability?: AiAvailability;
  translationAvailability?: AiAvailability;
  detections?: Map<string, DetectedLanguage[]>;
  translations?: Map<string, string>;
}
export interface FakeLanguageApi extends LanguageApiPort {
  detectorSessions: Array<{ destroyed: boolean }>;
  translatorSessions: Array<{ sourceLanguage: string; targetLanguage: string; destroyed: boolean }>;
}

export function createFakeLanguageApi(options: FakeLanguageApiOptions = {}): FakeLanguageApi {
  const detectorSessions: Array<{ destroyed: boolean }> = [];
  const translatorSessions: Array<{
    sourceLanguage: string;
    targetLanguage: string;
    destroyed: boolean;
  }> = [];
  const detectorAvailability = options.detectorAvailability ?? "available";
  const translationAvailability = options.translationAvailability ?? "available";
  return {
    detectorSessions,
    translatorSessions,
    detectorAvailability: async () => detectorAvailability,
    createDetector: async (
      _createOptions: AiSessionCreateOptions,
    ): Promise<DetectorSessionPort> => {
      const record = { destroyed: false };
      detectorSessions.push(record);
      return {
        detect: async (input) =>
          options.detections?.get(input) ?? [{ detectedLanguage: "en", confidence: 1 }],
        destroy: () => {
          record.destroyed = true;
        },
      };
    },
    translatorAvailability: async () => translationAvailability,
    createTranslator: async (sourceLanguage, targetLanguage): Promise<TranslatorSessionPort> => {
      const record = { sourceLanguage, targetLanguage, destroyed: false };
      translatorSessions.push(record);
      return {
        translate: async (input) =>
          options.translations?.get(`${sourceLanguage}:${targetLanguage}:${input}`) ?? input,
        destroy: () => {
          record.destroyed = true;
        },
      };
    },
  };
}

export function executionOptions(
  options: Pick<LanguageNormalizationOptions, "allowDownloads">,
): LanguageNormalizationOptions {
  return {
    ...options,
    signal: new AbortController().signal,
    onDownloadProgress: () => undefined,
  };
}
