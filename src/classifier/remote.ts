import type { ClassificationResult } from "../types";
import type { RemoteClassifierConfig } from "./config";
import { MalformedClassificationResponseError } from "./errors";
import { buildBatchPrompt, buildClassifierSystemPrompt } from "./prompt";
import type { ClassifierInput, ProviderHealth, SemanticClassifierProvider } from "./providers";
import { createClassificationResponseSchema, parseClassificationResponse } from "./response";

const DEFAULT_TIMEOUT_MS = 30_000;

export type RemoteProviderErrorCode = "unavailable" | "timeout" | "request-failed";

export class RemoteProviderError extends Error {
  constructor(public readonly code: RemoteProviderErrorCode) {
    super(
      {
        unavailable: "The remote classifier cannot be reached.",
        timeout: "The remote classifier did not respond before the request timed out.",
        "request-failed": "The remote classifier could not complete the classification request.",
      }[code],
    );
    this.name = "RemoteProviderError";
  }
}

export interface RemoteClassifierProviderOptions extends Omit<RemoteClassifierConfig, "enabled"> {
  timeoutMs?: number;
  fetcher?: typeof fetch;
}

export class RemoteClassifierProvider implements SemanticClassifierProvider {
  readonly id = "remote" as const;
  private readonly endpoint: string;
  private readonly model: string;
  private readonly apiKey: string;
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: RemoteClassifierProviderOptions) {
    this.endpoint = normalizeChatCompletionsEndpoint(options.endpoint);
    this.model = options.model;
    this.apiKey = options.apiKey;
    this.fetcher = options.fetcher ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async health(signal: AbortSignal): Promise<ProviderHealth> {
    if (signal.aborted) throw abortError(signal);
    return this.apiKey && this.model && this.endpoint
      ? { available: true }
      : { available: false, reason: "not-configured" };
  }

  async classify(input: ClassifierInput, signal: AbortSignal): Promise<ClassificationResult[]> {
    const enabledRules = input.rules.filter(({ enabled }) => enabled);
    const itemIds = input.items.map(({ itemId }) => itemId);
    const enabledRuleIds = enabledRules.map(({ id }) => id);
    const content = await this.request(
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            {
              role: "system",
              content: buildClassifierSystemPrompt(enabledRules, input.fallbackRuleId),
            },
            { role: "user", content: buildBatchPrompt(input.items) },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "youtube_tab_categories",
              strict: true,
              schema: createClassificationResponseSchema(itemIds, enabledRuleIds),
            },
          },
        }),
      },
      signal,
    );
    return parseClassificationResponse(content, itemIds, new Set(enabledRuleIds));
  }

  private async request(init: RequestInit, signal: AbortSignal): Promise<string> {
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
      const response = await this.fetcher(this.endpoint, { ...init, signal: controller.signal });
      if (!response.ok) throw new RemoteProviderError("request-failed");
      return await readChoiceContent(response);
    } catch (error) {
      if (signal.aborted) throw abortError(signal);
      if (timedOut) throw new RemoteProviderError("timeout");
      if (
        error instanceof RemoteProviderError ||
        error instanceof MalformedClassificationResponseError
      )
        throw error;
      throw new RemoteProviderError("unavailable");
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
    }
  }
}

function normalizeChatCompletionsEndpoint(endpoint: string): string {
  const url = new URL(endpoint);
  url.pathname = url.pathname.replace(/\/+$/, "");
  if (!url.pathname.endsWith("/chat/completions")) url.pathname += "/chat/completions";
  return url.toString();
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("The operation was aborted.", "AbortError");
}

async function readChoiceContent(response: Response): Promise<string> {
  let payload: unknown;
  try {
    payload = (await response.json()) as unknown;
  } catch {
    throw new MalformedClassificationResponseError("Remote provider returned invalid JSON.");
  }
  if (!isRecord(payload) || !Array.isArray(payload.choices))
    throw new MalformedClassificationResponseError("Remote provider response is missing choices.");
  const firstChoice = payload.choices[0];
  if (
    !isRecord(firstChoice) ||
    !isRecord(firstChoice.message) ||
    typeof firstChoice.message.content !== "string"
  )
    throw new MalformedClassificationResponseError(
      "Remote provider response is missing message content.",
    );
  return firstChoice.message.content;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
