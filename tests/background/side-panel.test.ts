import { expect, it, vi } from "vitest";
import { configureActionSidePanel } from "../../src/background/side-panel";

it("opens the side panel when the extension action is clicked", async () => {
  const setPanelBehavior = vi.fn().mockResolvedValue(undefined);

  await configureActionSidePanel({ setPanelBehavior });

  expect(setPanelBehavior).toHaveBeenCalledWith({ openPanelOnActionClick: true });
});
