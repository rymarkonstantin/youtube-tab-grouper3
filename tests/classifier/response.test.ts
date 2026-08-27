import { describe, expect, it } from "vitest";
import { MalformedClassificationResponseError } from "../../src/classifier/errors";
import {
  createClassificationResponseSchema,
  parseClassificationResponse,
  parsePartialClassificationResponse,
} from "../../src/classifier/response";

describe("classification response contract", () => {
  it("restricts item and rule IDs in JSON Schema", () => {
    const schema = createClassificationResponseSchema(["item-0"], ["fishing", "uncategorized"]);
    expect(JSON.stringify(schema)).toContain('"enum":["item-0"]');
    expect(JSON.stringify(schema)).toContain('"enum":["fishing","uncategorized"]');
    const resultSchema = (schema.properties as { results: { items: { required: string[] } } })
      .results.items;
    expect(resultSchema.required).toEqual(["itemId", "ruleId"]);
  });

  it("accepts a missing reason and does not synthesize one", () => {
    expect(
      parseClassificationResponse(
        JSON.stringify({ results: [{ itemId: "item-0", ruleId: "fishing" }] }),
        ["item-0"],
        new Set(["fishing"]),
      ),
    ).toEqual([{ itemId: "item-0", ruleId: "fishing" }]);
  });

  it("trims a supplied reason", () => {
    expect(
      parseClassificationResponse(
        JSON.stringify({ results: [{ itemId: "item-0", ruleId: "fishing", reason: "  topic  " }] }),
        ["item-0"],
        new Set(["fishing"]),
      ),
    ).toEqual([{ itemId: "item-0", ruleId: "fishing", reason: "topic" }]);
  });

  it("accepts exactly one complete result per expected item", () => {
    expect(
      parseClassificationResponse(
        JSON.stringify({
          results: [{ itemId: "item-0", ruleId: "fishing", reason: "Primary topic is fishing." }],
        }),
        ["item-0"],
        new Set(["fishing", "uncategorized"]),
      ),
    ).toEqual([{ itemId: "item-0", ruleId: "fishing", reason: "Primary topic is fishing." }]);
  });

  it.each([
    "not-json",
    JSON.stringify({ results: [] }),
    JSON.stringify({ results: [{ itemId: "item-0", ruleId: "unknown", reason: "x" }] }),
    JSON.stringify({ results: [{ itemId: "item-1", ruleId: "fishing", reason: "extra" }] }),
    JSON.stringify({ results: [{ itemId: "item-0", ruleId: "fishing", reason: "   " }] }),
    JSON.stringify({ results: [{ itemId: "item-0", ruleId: "fishing", extra: "nope" }] }),
    JSON.stringify({
      results: [{ itemId: "item-0", ruleId: "fishing", reason: "x", extra: "nope" }],
    }),
    JSON.stringify({
      results: [{ itemId: "item-0", ruleId: "fishing", reason: "x" }],
      extra: true,
    }),
    JSON.stringify({
      results: [{ itemId: "item-0", ruleId: "fishing", reason: "x".repeat(501) }],
    }),
    JSON.stringify({
      results: [
        { itemId: "item-0", ruleId: "fishing", reason: "x" },
        { itemId: "item-0", ruleId: "fishing", reason: "x" },
      ],
    }),
  ])("rejects malformed or incomplete response %s", (raw) => {
    expect(() => parseClassificationResponse(raw, ["item-0"], new Set(["fishing"]))).toThrow(
      MalformedClassificationResponseError,
    );
  });

  it("preserves valid partial items and omits malformed or missing items", () => {
    expect(
      parsePartialClassificationResponse(
        JSON.stringify({
          results: [
            { itemId: "item-2", ruleId: "fishing", reason: " valid " },
            { itemId: "item-0", ruleId: "fishing", reason: "   " },
            { itemId: "unknown", ruleId: "fishing" },
            { itemId: "item-2", ruleId: "fishing", reason: "duplicate" },
            { itemId: "item-1", ruleId: "unknown", reason: "invalid rule" },
          ],
        }),
        ["item-0", "item-1", "item-2", "item-3"],
        new Set(["fishing"]),
      ),
    ).toEqual([{ itemId: "item-2", ruleId: "fishing", reason: "valid" }]);
  });

  it("omits a missing reason from valid partial items", () => {
    expect(
      parsePartialClassificationResponse(
        JSON.stringify({ results: [{ itemId: "item-0", ruleId: "fishing" }] }),
        ["item-0"],
        new Set(["fishing"]),
      ),
    ).toEqual([{ itemId: "item-0", ruleId: "fishing" }]);
  });
});
