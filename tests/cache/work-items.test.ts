import { expect, it } from "vitest";
import { createClassificationWorkItems } from "../../src/cache/work-items";

it("collapses identical video metadata and fans the result to every tab", async () => {
  const metadata = { videoId: "v1", pageType: "watch" as const, title: "Same video" };
  const work = await createClassificationWorkItems(
    [
      { tabId: 10, metadata },
      { tabId: 20, metadata: structuredClone(metadata) },
    ],
    "rules-hash",
  );
  expect(work.items).toHaveLength(1);
  const item = work.items[0];
  expect(item?.tabIds).toEqual([10, 20]);
  expect(item?.item.itemId).toBe("item-0");
});
