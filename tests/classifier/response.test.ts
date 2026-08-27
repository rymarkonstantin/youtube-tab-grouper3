import { describe, expect, it } from "vitest";
import { MalformedClassificationResponseError } from "../../src/classifier/errors";
import {
  createClassificationResponseSchema,
  parseClassificationResponse,
} from "../../src/classifier/response";

describe("classification response contract", () => {
  it("restricts item and rule IDs in JSON Schema", () => {
    const schema = createClassificationResponseSchema(["item-0"], ["fishing", "uncategorized"]);
    expect(JSON.stringify(schema)).toContain('"enum":["item-0"]');
    expect(JSON.stringify(schema)).toContain('"enum":["fishing","uncategorized"]');
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
});
