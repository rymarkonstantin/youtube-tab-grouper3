import { expect, it, vi } from "vitest";
import { ChromeGroupsAdapter } from "../../src/chrome/groups";

it("does not pass windowId to tabs.group", async () => {
  const group = vi.fn(async () => 50);
  const adapter = new ChromeGroupsAdapter({
    tabs: { query: vi.fn(), group },
    tabGroups: { query: vi.fn(), get: vi.fn(), update: vi.fn(), move: vi.fn() },
  });

  await adapter.groupTabs({ tabIds: [10], windowId: 1 });

  expect(group).toHaveBeenCalledWith({ tabIds: [10] });
});
