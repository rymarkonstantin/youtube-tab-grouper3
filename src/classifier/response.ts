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
          required: ["itemId", "ruleId"],
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
  const response = parsed as Record<string, unknown>;
  if (!hasOnlyKeys(response, ["results"])) throw new MalformedClassificationResponseError();
  const results = response.results;
  if (!Array.isArray(results) || results.length !== expectedItemIds.length)
    throw new MalformedClassificationResponseError();
  const expected = new Set(expectedItemIds);
  const seen = new Set<string>();
  const normalized: ClassificationResult[] = [];
  for (const value of results) {
    if (typeof value !== "object" || value === null || Array.isArray(value))
      throw new MalformedClassificationResponseError();
    const item = value as Record<string, unknown>;
    if (!hasOnlyKeys(item, ["itemId", "ruleId", "reason"]))
      throw new MalformedClassificationResponseError();
    const normalizedItem = normalizeItem(item, expected, enabledRuleIds, true);
    if (!normalizedItem || seen.has(normalizedItem.itemId))
      throw new MalformedClassificationResponseError();
    seen.add(normalizedItem.itemId);
    normalized.push(normalizedItem);
  }
  if (seen.size !== expected.size) throw new MalformedClassificationResponseError();
  return expectedItemIds.map(
    (id) => normalized.find((result) => result.itemId === id) as ClassificationResult,
  );
}

export function parsePartialClassificationResponse(
  raw: string,
  expectedItemIds: string[],
  enabledRuleIds: Set<string>,
): ClassificationResult[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return [];
  const response = parsed as Record<string, unknown>;
  if (!hasOnlyKeys(response, ["results"])) return [];
  const results = response.results;
  if (!Array.isArray(results)) return [];
  const expected = new Set(expectedItemIds);
  const seen = new Set<string>();
  const normalized: ClassificationResult[] = [];
  for (const value of results) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) continue;
    const item = value as Record<string, unknown>;
    if (!hasOnlyKeys(item, ["itemId", "ruleId", "reason"])) continue;
    const normalizedItem = normalizeItem(item, expected, enabledRuleIds, false);
    if (!normalizedItem || seen.has(normalizedItem.itemId)) continue;
    seen.add(normalizedItem.itemId);
    normalized.push(normalizedItem);
  }
  return expectedItemIds.flatMap((id) => {
    const result = normalized.find((item) => item.itemId === id);
    return result ? [result] : [];
  });
}

function normalizeItem(
  item: Record<string, unknown>,
  expectedItemIds: Set<string>,
  enabledRuleIds: Set<string>,
  strict: boolean,
): ClassificationResult | undefined {
  if (
    typeof item.itemId !== "string" ||
    typeof item.ruleId !== "string" ||
    !expectedItemIds.has(item.itemId) ||
    !enabledRuleIds.has(item.ruleId)
  ) {
    if (strict) throw new MalformedClassificationResponseError();
    return undefined;
  }
  if (!Object.hasOwn(item, "reason")) return { itemId: item.itemId, ruleId: item.ruleId };
  if (typeof item.reason !== "string") {
    if (strict) throw new MalformedClassificationResponseError();
    return undefined;
  }
  const reason = item.reason.trim();
  if (!reason || reason.length > 500) {
    if (strict) throw new MalformedClassificationResponseError();
    return undefined;
  }
  return { itemId: item.itemId, ruleId: item.ruleId, reason };
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: string[]): boolean {
  const allowedKeys = new Set(allowed);
  return Object.keys(value).every((key) => allowedKeys.has(key));
}
