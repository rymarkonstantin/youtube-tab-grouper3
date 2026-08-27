import { describe, expect, it } from "vitest";
import { ActivationRequiredError, AiUnavailableError } from "../../src/classifier/errors";
import {
  createClassifier,
  item,
  programmingItem,
  responseFor,
  rules,
  validProgrammingResponse,
  createFakeModelPort,
} from "../helpers/fake-language-model";

describe("ChromeBuiltInClassifier", () => {
  it("does not create a downloadable model without user activation", async () => {
    const model = createFakeModelPort({ availability: "downloadable" });
    const classifier = createClassifier({ model, allowDownloads: false });
    const error = await classifier.classify([programmingItem], rules, "uncategorized").then(
      () => null,
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(ActivationRequiredError);
    expect(model.createCalls).toHaveLength(0);
    if (!(error instanceof ActivationRequiredError)) throw new Error("Expected activation error");
    await error.prepare({
      signal: new AbortController().signal,
      onDownloadProgress: () => undefined,
    });
    expect(model.createCalls).toHaveLength(1);
    expect(model.sessions[0]?.destroyed).toBe(true);
  });

  it("reports an unavailable model without prompting", async () => {
    const model = createFakeModelPort({ availability: "unavailable" });
    await expect(
      createClassifier({ model, allowDownloads: true }).classify(
        [programmingItem],
        rules,
        "uncategorized",
      ),
    ).rejects.toBeInstanceOf(AiUnavailableError);
  });

  it("uses current Prompt API options without deprecated sampling parameters", async () => {
    const model = createFakeModelPort({ responses: [validProgrammingResponse] });
    await createClassifier({ model, allowDownloads: true }).classify(
      [programmingItem],
      rules,
      "uncategorized",
    );
    expect(model.createCalls[0]).not.toHaveProperty("temperature");
    expect(model.createCalls[0]).not.toHaveProperty("topK");
    const created = model.createCalls[0];
    expect(model.availabilityCalls[0]).toEqual({
      expectedInputs: created?.expectedInputs,
      expectedOutputs: created?.expectedOutputs,
    });
  });

  it("reduces a batch until measured context fits", async () => {
    const model = createFakeModelPort({
      contextWindow: 100,
      measuredUsage: [120, 80, 80],
      responses: [responseFor(["item-0", "item-1"]), responseFor(["item-2", "item-3"])],
    });
    const results = await createClassifier({ model, allowDownloads: true }).classify(
      [item(0), item(1), item(2), item(3)],
      rules,
      "uncategorized",
    );
    expect(model.sessions.map((session) => session.measuredItemCounts)).toEqual([[4], [2], [2]]);
    expect(results).toHaveLength(4);
  });

  it("never puts more than eight items in an initial batch", async () => {
    const model = createFakeModelPort();
    const results = await createClassifier({ model, allowDownloads: true }).classify(
      Array.from({ length: 9 }, (_, index) => item(index)),
      rules,
      "uncategorized",
    );
    expect(model.sessions.map((session) => session.measuredItemCounts)).toEqual([[8], [1]]);
    expect(results).toHaveLength(9);
  });

  it("retries unresolved items individually once and omits a repeated failure", async () => {
    const model = createFakeModelPort({
      responses: [new Error("batch failed"), responseFor(["item-0"]), new Error("single failed")],
    });
    const results = await createClassifier({ model, allowDownloads: true }).classify(
      [item(0), item(1)],
      rules,
      "uncategorized",
    );
    expect(results.map(({ itemId }) => itemId)).toEqual(["item-0"]);
    expect(model.createCalls).toHaveLength(3);
  });
});
