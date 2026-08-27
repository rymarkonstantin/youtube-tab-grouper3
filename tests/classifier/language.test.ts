import { describe, expect, it } from "vitest";
import { ActivationRequiredError, AiUnavailableError } from "../../src/classifier/errors";
import { normalizeClassifierInputs } from "../../src/classifier/language";
import { createFakeLanguageApi, executionOptions } from "../helpers/fake-language-api";

describe("normalizeClassifierInputs", () => {
  it("keeps Prompt-supported text and translates Russian locally", async () => {
    const api = createFakeLanguageApi({
      detections: new Map([
        ["Building with Aspire", [{ detectedLanguage: "en", confidence: 0.99 }]],
        ["Осенняя рыбалка", [{ detectedLanguage: "ru", confidence: 0.98 }]],
      ]),
      translations: new Map([["ru:en:Осенняя рыбалка", "Autumn fishing"]]),
    });
    const output = await normalizeClassifierInputs(
      [
        {
          itemId: "item-0",
          metadata: { videoId: "a", pageType: "watch", title: "Building with Aspire" },
        },
        {
          itemId: "item-1",
          metadata: { videoId: "b", pageType: "watch", title: "Осенняя рыбалка" },
        },
      ],
      [
        {
          id: "fishing",
          name: "Fishing",
          description: "Fishing subjects.",
          color: "blue",
          enabled: true,
        },
      ],
      api,
      executionOptions({ allowDownloads: true }),
    );
    expect(output.items[0]?.metadata.title).toBe("Building with Aspire");
    expect(output.items[1]?.metadata.title).toBe("Autumn fishing");
    expect(output.inputLanguages).toEqual(["en"]);
    expect(output.failedItemIds).toEqual([]);
    expect(api.detectorSessions.every(({ destroyed }) => destroyed)).toBe(true);
    expect(api.translatorSessions.every(({ destroyed }) => destroyed)).toBe(true);
  });

  it("requires activation before creating a downloadable detector", async () => {
    const api = createFakeLanguageApi({ detectorAvailability: "downloadable" });
    const error = await normalizeClassifierInputs(
      [{ itemId: "item-0", metadata: { videoId: "a", pageType: "watch", title: "Video" } }],
      [
        {
          id: "fishing",
          name: "Fishing",
          description: "Fishing subjects.",
          color: "blue",
          enabled: true,
        },
      ],
      api,
      executionOptions({ allowDownloads: false }),
    ).then(
      () => null,
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(ActivationRequiredError);
    expect(api.detectorSessions).toHaveLength(0);
  });

  it("marks an unavailable item translation as failed without dropping rules", async () => {
    const api = createFakeLanguageApi({
      detections: new Map([["Русское видео", [{ detectedLanguage: "ru", confidence: 0.95 }]]]),
      translationAvailability: "unavailable",
    });
    const output = await normalizeClassifierInputs(
      [{ itemId: "item-0", metadata: { videoId: "a", pageType: "watch", title: "Русское видео" } }],
      [],
      api,
      executionOptions({ allowDownloads: true }),
    );
    expect(output.items).toEqual([]);
    expect(output.failedItemIds).toEqual(["item-0"]);
  });

  it("fails the run when the detector API is unavailable", async () => {
    const api = createFakeLanguageApi({ detectorAvailability: "unavailable" });
    await expect(
      normalizeClassifierInputs(
        [{ itemId: "item-0", metadata: { videoId: "a", pageType: "watch", title: "Video" } }],
        [],
        api,
        executionOptions({ allowDownloads: true }),
      ),
    ).rejects.toBeInstanceOf(AiUnavailableError);
  });
});
