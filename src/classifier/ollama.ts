import type { ClassificationResult, GroupRule } from "../types";
import type { LocalClassifierConfig } from "./config";
import { MalformedClassificationResponseError } from "./errors";
import { buildBatchPrompt, buildClassifierSystemPrompt } from "./prompt";
import type { ClassifierInput, ProviderHealth, SemanticClassifierProvider } from "./providers";
import {
  createClassificationResponseSchema,
  parseClassificationResponse,
  parsePartialClassificationResponse,
} from "./response";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_BATCH_ITEMS = 4;

export type OllamaProviderErrorCode =
  | "unavailable"
  | "timeout"
  | "model-missing"
  | "malformed-response"
  | "request-failed";

export class OllamaProviderError extends Error {
  constructor(public readonly code: OllamaProviderErrorCode) {
    super(
      {
        unavailable: "Ollama is not running or cannot be reached.",
        timeout: "Ollama did not respond before the request timed out.",
        "model-missing": "The configured Ollama model is not available.",
        "malformed-response": "Ollama returned an invalid response.",
        "request-failed": "Ollama could not complete the classification request.",
      }[code],
    );
    this.name = "OllamaProviderError";
  }
}

export interface OllamaClassifierProviderOptions extends LocalClassifierConfig {
  timeoutMs?: number;
  fetcher?: typeof fetch;
}

export class OllamaClassifierProvider implements SemanticClassifierProvider {
  readonly id = "ollama" as const;
  private readonly endpoint: string;
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: OllamaClassifierProviderOptions) {
    this.endpoint = options.endpoint.replace(/\/+$/, "");
    this.model = options.model;
    this.fetcher = options.fetcher ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  private readonly model: string;

  async health(signal: AbortSignal): Promise<ProviderHealth> {
    console.debug("[youtube-tab-grouper3] ollama:health:start", {
      endpointOrigin: new URL(this.endpoint).origin,
      model: this.model,
    });
    try {
      const response = await this.request(
        "/api/show",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: this.model }),
        },
        signal,
      );
      await validateShowResponse(response);
      console.info("[youtube-tab-grouper3] ollama:health:available", { status: response.status });
      return { available: true };
    } catch (error) {
      if (signal.aborted) throw abortError(signal);
      if (error instanceof OllamaProviderError) {
        console.warn("[youtube-tab-grouper3] ollama:health:unavailable", {
          reason: error.code,
        });
        return { available: false, reason: error.code };
      }
      console.warn("[youtube-tab-grouper3] ollama:health:unavailable", {
        reason: "unexpected-error",
        errorType: error instanceof Error ? error.name : typeof error,
      });
      return { available: false, reason: "request-failed" };
    }
  }

  async classify(input: ClassifierInput, signal: AbortSignal): Promise<ClassificationResult[]> {
    const results: ClassificationResult[] = [];
    for (let index = 0; index < input.items.length; index += MAX_BATCH_ITEMS) {
      const batch = input.items.slice(index, index + MAX_BATCH_ITEMS);
      results.push(...(await this.classifyBatch({ ...input, items: batch }, signal)));
    }
    const byId = new Map(results.map((result) => [result.itemId, result]));
    return input.items.flatMap(({ itemId }) => {
      const result = byId.get(itemId);
      return result ? [result] : [];
    });
  }

  private async classifyBatch(
    input: ClassifierInput,
    signal: AbortSignal,
  ): Promise<ClassificationResult[]> {
    const enabledRules = input.rules.filter(({ enabled }) => enabled);
    const itemIds = input.items.map(({ itemId }) => itemId);
    const enabledRuleIds = enabledRules.map(({ id }) => id);
    const enabledRuleIdSet = new Set(enabledRuleIds);
    const content = await this.requestClassificationContent(input, enabledRules, itemIds, signal);
    try {
      return parseClassificationResponse(content, itemIds, enabledRuleIdSet);
    } catch (error) {
      if (!(error instanceof MalformedClassificationResponseError) || itemIds.length <= 1)
        throw error;
      const partial = parsePartialClassificationResponse(content, itemIds, enabledRuleIdSet);
      const recovered = [...partial];
      const recoveredIds = new Set(partial.map(({ itemId }) => itemId));
      for (const item of input.items) {
        if (recoveredIds.has(item.itemId)) continue;
        try {
          const retryContent = await this.requestClassificationContent(
            { ...input, items: [item] },
            enabledRules,
            [item.itemId],
            signal,
          );
          recovered.push(
            ...parseClassificationResponse(retryContent, [item.itemId], enabledRuleIdSet),
          );
        } catch (retryError) {
          if (signal.aborted) throw abortError(signal);
          console.warn("[youtube-tab-grouper3] ollama:classification:item-failed", {
            itemId: item.itemId,
            errorType: retryError instanceof Error ? retryError.name : typeof retryError,
          });
        }
      }
      return itemIds.flatMap((itemId) => {
        const result = recovered.find((item) => item.itemId === itemId);
        return result ? [result] : [];
      });
    }
  }

  private async requestClassificationContent(
    input: ClassifierInput,
    enabledRules: GroupRule[],
    itemIds: string[],
    signal: AbortSignal,
  ): Promise<string> {
    const body = {
      model: this.model,
      stream: false,
      format: createClassificationResponseSchema(
        itemIds,
        enabledRules.map(({ id }) => id),
      ),
      messages: [
        {
          role: "system",
          content: buildClassifierSystemPrompt(enabledRules, input.fallbackRuleId),
        },
        { role: "user", content: buildBatchPrompt(input.items) },
      ],
    };
    const response = await this.request(
      "/api/chat",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
      signal,
    );
    let payload: unknown;
    try {
      payload = (await response.json()) as unknown;
    } catch {
      throw new MalformedClassificationResponseError("Ollama returned invalid JSON.");
    }
    const content =
      typeof payload === "object" &&
      payload !== null &&
      !Array.isArray(payload) &&
      typeof (payload as { message?: unknown }).message === "object" &&
      (payload as { message?: unknown }).message !== null &&
      typeof (payload as { message: { content?: unknown } }).message.content === "string"
        ? (payload as { message: { content: string } }).message.content
        : undefined;
    if (content === undefined)
      throw new MalformedClassificationResponseError("Ollama response is missing message content.");
    return content;
  }

  private async request(path: string, init: RequestInit, signal: AbortSignal): Promise<Response> {
    if (signal.aborted) throw abortError(signal);
    const controller = new AbortController();
    let timedOut = false;
    const onAbort = () => controller.abort();
    signal.addEventListener("abort", onAbort, { once: true });
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);
    try {
      const response = await this.fetcher.call(globalThis, `${this.endpoint}${path}`, {
        ...init,
        signal: controller.signal,
      });
      if (!response.ok) {
        if (response.status === 404) throw new OllamaProviderError("model-missing");
        if (response.status === 408 || response.status === 504)
          throw new OllamaProviderError("timeout");
        throw new OllamaProviderError("request-failed");
      }
      return response;
    } catch (error) {
      if (signal.aborted) throw abortError(signal);
      if (timedOut) throw new OllamaProviderError("timeout");
      if (error instanceof OllamaProviderError) throw error;
      console.warn("[youtube-tab-grouper3] ollama:request:error", {
        path,
        errorType: error instanceof Error ? error.name : typeof error,
        errorMessage: error instanceof Error ? error.message : undefined,
      });
      throw new OllamaProviderError("unavailable");
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
    }
  }
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("The operation was aborted.", "AbortError");
}

async function validateShowResponse(response: Response): Promise<void> {
  let payload: unknown;
  try {
    payload = (await response.json()) as unknown;
  } catch {
    throw new OllamaProviderError("malformed-response");
  }
  if (!isRecord(payload) || !isRecord(payload.details))
    throw new OllamaProviderError("malformed-response");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
