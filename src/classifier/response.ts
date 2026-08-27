import type { ClassificationResult } from "../types";
import { MalformedClassificationResponseError } from "./errors";

export function createClassificationResponseSchema(
  itemIds: string[],
  ruleIds: string[],
): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["results"],
    properties: {
      results: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["itemId", "ruleId", "reason"],
          properties: {
            itemId: { type: "string", enum: itemIds },
            ruleId: { type: "string", enum: ruleIds },
            reason: { type: "string" },
          },
        },
      },
    },
  };
}

export function parseClassificationResponse(
  raw: string,
  expectedItemIds: string[],
  enabledRuleIds: Set<string>,
): ClassificationResult[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new MalformedClassificationResponseError("Invalid JSON.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    throw new MalformedClassificationResponseError();
  const results = (parsed as Record<string, unknown>).results;
  if (!Array.isArray(results) || results.length !== expectedItemIds.length)
    throw new MalformedClassificationResponseError();
  const expected = new Set(expectedItemIds);
  const seen = new Set<string>();
  const normalized: ClassificationResult[] = [];
  for (const value of results) {
    if (typeof value !== "object" || value === null || Array.isArray(value))
      throw new MalformedClassificationResponseError();
    const item = value as Record<string, unknown>;
    if (
      typeof item.itemId !== "string" ||
      typeof item.ruleId !== "string" ||
      typeof item.reason !== "string"
    )
      throw new MalformedClassificationResponseError();
    if (!expected.has(item.itemId) || seen.has(item.itemId) || !enabledRuleIds.has(item.ruleId))
      throw new MalformedClassificationResponseError();
    const reason = item.reason.trim();
    if (!reason || reason.length > 500) throw new MalformedClassificationResponseError();
    seen.add(item.itemId);
    normalized.push({ itemId: item.itemId, ruleId: item.ruleId, reason });
  }
  if (seen.size !== expected.size) throw new MalformedClassificationResponseError();
  return expectedItemIds.map(
    (id) => normalized.find((result) => result.itemId === id) as ClassificationResult,
  );
}
