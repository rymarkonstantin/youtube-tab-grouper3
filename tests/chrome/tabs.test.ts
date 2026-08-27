import { expect, it } from "vitest";
import { ChromeTabsAdapter, type ChromeTabsApi } from "../../src/chrome/tabs";
import { chromeTab, fakeChromeTabs } from "../helpers/chrome-fixtures";
it("captures one normal window, skips protected tabs, and tolerates loading videos", async () => {
  const chromeApi = fakeChromeTabs({
    activeTab: chromeTab({ id: 1, windowId: 7, url: "https://github.com/" }),
    window: { id: 7, type: "normal", incognito: false },
    tabs: [
      chromeTab({ id: 2, windowId: 7, url: "https://youtube.com/watch?v=a" }),
      chromeTab({ id: 3, windowId: 7, url: "https://youtube.com/results?q=x" }),
      chromeTab({ id: 4, windowId: 7, url: "https://youtube.com/watch?v=b", discarded: true }),
      chromeTab({ id: 5, windowId: 7, url: "https://youtube.com/watch?v=c", status: "loading" }),
      chromeTab({ id: 6, windowId: 7, url: "https://youtube.com/watch?v=d", pinned: true }),
    ],
  });
  const adapter = new ChromeTabsAdapter(chromeApi as unknown as ChromeTabsApi);
  expect(await adapter.captureCurrentNormalWindow()).toBe(7);
  const metadata = await adapter.collectMetadata(await adapter.queryWindowTabs(7));
  expect(chromeApi.scripting.executeScript).toHaveBeenCalledTimes(2);
  expect(metadata.find(({ tab }) => tab.id === 4)).toBeUndefined();
});
