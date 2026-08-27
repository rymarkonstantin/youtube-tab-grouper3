import type { ClassificationItem, ClassificationResult, GroupRule } from "../types";
import type {
  AiDownloadProgress,
  AiAvailability,
  LanguageApiPort,
  LanguageNormalizationOptions,
} from "./language";
import { ActivationRequiredError, AiUnavailableError, ClassifierContextError } from "./errors";
import { normalizeClassifierInputs } from "./language";
import { buildBatchPrompt, buildClassifierSystemPrompt } from "./prompt";
import { createClassificationResponseSchema, parseClassificationResponse } from "./response";

export interface LanguageModelIoExpectation {
  type: "text";
  languages: string[];
}
export interface LanguageModelAvailabilityOptions {
  expectedInputs: LanguageModelIoExpectation[];
  expectedOutputs: LanguageModelIoExpectation[];
}
export interface LanguageModelCreateOptions extends LanguageModelAvailabilityOptions {
  initialPrompts: Array<{ role: "system"; content: string }>;
  signal: AbortSignal;
  onDownloadProgress(loaded: number): void;
}
export interface LanguageModelSessionPort {
  readonly contextUsage: number;
  readonly contextWindow: number;
  measureContextUsage(
    input: string,
    options: { responseConstraint: Record<string, unknown> },
  ): Promise<number>;
  prompt(
    input: string,
    options: { responseConstraint: Record<string, unknown>; signal: AbortSignal },
  ): Promise<string>;
  destroy(): void;
}
export interface LanguageModelPort {
  availability(options: LanguageModelAvailabilityOptions): Promise<AiAvailability>;
  create(options: LanguageModelCreateOptions): Promise<LanguageModelSessionPort>;
}
export interface ClassifierExecutionOptions {
  allowDownloads: boolean;
  signal: AbortSignal;
  onDownloadProgress(progress: AiDownloadProgress): void;
  onPhase(phase: "language" | "classifying"): void;
}

const modelInputs = (languages: string[]): LanguageModelIoExpectation[] => [
  { type: "text", languages },
];

function errorIsTerminal(error: unknown): boolean {
  return (
    error instanceof ActivationRequiredError ||
    error instanceof AiUnavailableError ||
    error instanceof ClassifierContextError ||
    (error instanceof DOMException && error.name === "AbortError")
  );
}

export class ChromeLanguageModelPort implements LanguageModelPort {
  async availability(options: LanguageModelAvailabilityOptions): Promise<AiAvailability> {
    const model = (globalThis as { LanguageModel?: typeof LanguageModel }).LanguageModel;
    if (!model) return "unavailable";
    return (await model.availability(options)) as AiAvailability;
  }
  async create(options: LanguageModelCreateOptions): Promise<LanguageModelSessionPort> {
    const model = (globalThis as { LanguageModel?: typeof LanguageModel }).LanguageModel;
    if (!model) throw new AiUnavailableError("language-model");
    const session = await model.create({
      expectedInputs: options.expectedInputs,
      expectedOutputs: options.expectedOutputs,
      initialPrompts: options.initialPrompts as unknown as LanguageModelMessage[],
      signal: options.signal,
      monitor: (monitor) =>
        monitor.addEventListener("downloadprogress", (event) =>
          options.onDownloadProgress(event.loaded),
        ),
    });
    return {
      contextUsage: session.contextUsage,
      contextWindow: session.contextWindow,
      measureContextUsage: (input, measureOptions) =>
        session.measureContextUsage(input, measureOptions),
      prompt: (input, promptOptions) => session.prompt(input, promptOptions),
      destroy: () => session.destroy(),
    };
  }
}

export class ChromeBuiltInClassifier {
  constructor(
    private readonly languageApi: LanguageApiPort,
    private readonly modelApi: LanguageModelPort,
    private readonly options: ClassifierExecutionOptions,
  ) {}

  async classify(
    items: ClassificationItem[],
    rules: GroupRule[],
    fallbackRuleId: string,
  ): Promise<ClassificationResult[]> {
    this.options.onPhase("language");
    const languageOptions: LanguageNormalizationOptions = {
      allowDownloads: this.options.allowDownloads,
      signal: this.options.signal,
      onDownloadProgress: this.options.onDownloadProgress,
    };
    const normalized = await normalizeClassifierInputs(
      items,
      rules,
      this.languageApi,
      languageOptions,
    );
    if (normalized.items.length === 0) return [];
    this.options.onPhase("classifying");
    const enabledRules = normalized.rules.filter(({ enabled }) => enabled);
    const languages = [...new Set(["en", ...normalized.inputLanguages])];
    const expectedInputs = modelInputs(languages);
    const expectedOutputs = modelInputs(["en"]);
    const systemPrompt = buildClassifierSystemPrompt(enabledRules, fallbackRuleId);
    const availabilityOptions = { expectedInputs, expectedOutputs };
    const availability = await this.modelApi.availability(availabilityOptions);
    if (availability === "unavailable") throw new AiUnavailableError("language-model");
    if (
      (availability === "downloadable" || availability === "downloading") &&
      !this.options.allowDownloads
    ) {
      throw new ActivationRequiredError("language-model", async (activation) => {
        const session = await this.modelApi.create({
          ...availabilityOptions,
          initialPrompts: [{ role: "system", content: systemPrompt }],
          signal: activation.signal,
          onDownloadProgress: activation.onDownloadProgress,
        });
        session.destroy();
      });
    }
    const results: ClassificationResult[] = [];
    let offset = 0;
    while (offset < normalized.items.length) {
      let size = Math.min(8, normalized.items.length - offset);
      let session: LanguageModelSessionPort | undefined;
      let promptItems: ClassificationItem[] = [];
      let userPrompt = "";
      let schema: Record<string, unknown> = {};
      while (size > 0) {
        promptItems = normalized.items.slice(offset, offset + size);
        userPrompt = buildBatchPrompt(promptItems);
        schema = createClassificationResponseSchema(
          promptItems.map(({ itemId }) => itemId),
          enabledRules.map(({ id }) => id),
        );
        session = await this.modelApi.create({
          ...availabilityOptions,
          initialPrompts: [{ role: "system", content: systemPrompt }],
          signal: this.options.signal,
          onDownloadProgress: (loaded) =>
            this.options.onDownloadProgress({ capability: "language-model", loaded }),
        });
        let measured: number;
        try {
          measured = await session.measureContextUsage(userPrompt, {
            responseConstraint: schema,
          });
        } catch (error) {
          session.destroy();
          session = undefined;
          throw error;
        }
        if (session.contextUsage + measured <= session.contextWindow) break;
        session.destroy();
        session = undefined;
        size = Math.floor(size / 2);
      }
      if (!session || size === 0) throw new ClassifierContextError();
      try {
        const raw = await session.prompt(userPrompt, {
          responseConstraint: schema,
          signal: this.options.signal,
        });
        results.push(
          ...parseClassificationResponse(
            raw,
            promptItems.map(({ itemId }) => itemId),
            new Set(enabledRules.map(({ id }) => id)),
          ),
        );
        offset += size;
      } catch (error: unknown) {
        if (this.options.signal.aborted) {
          throw new DOMException("The classification was aborted.", "AbortError");
        }
        if (errorIsTerminal(error)) {
          throw error;
        }
        session.destroy();
        const unresolved = normalized.items.slice(offset, offset + size);
        for (const item of unresolved) {
          let retry: LanguageModelSessionPort | undefined;
          try {
            retry = await this.modelApi.create({
              ...availabilityOptions,
              initialPrompts: [{ role: "system", content: systemPrompt }],
              signal: this.options.signal,
              onDownloadProgress: (loaded) =>
                this.options.onDownloadProgress({ capability: "language-model", loaded }),
            });
            const onePrompt = buildBatchPrompt([item]);
            const retrySchema = createClassificationResponseSchema(
              [item.itemId],
              enabledRules.map(({ id }) => id),
            );
            const raw = await retry.prompt(onePrompt, {
              responseConstraint: retrySchema,
              signal: this.options.signal,
            });
            results.push(
              ...parseClassificationResponse(
                raw,
                [item.itemId],
                new Set(enabledRules.map(({ id }) => id)),
              ),
            );
          } catch (error: unknown) {
            if (this.options.signal.aborted) {
              throw new DOMException("The classification was aborted.", "AbortError");
            }
            if (errorIsTerminal(error)) {
              throw error;
            }
            // A repeated item failure remains unclassified for this run.
          } finally {
            retry?.destroy();
          }
        }
        offset += size;
      } finally {
        if (session) session.destroy();
      }
    }
    return items
      .map(({ itemId }) => results.find((result) => result.itemId === itemId))
      .filter((result): result is ClassificationResult => result !== undefined);
  }
}
