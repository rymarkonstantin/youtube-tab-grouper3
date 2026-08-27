import { configureActionSidePanel } from "./background/side-panel";

function configureSidePanelWithLogging(): void {
  void configureActionSidePanel(chrome.sidePanel).catch((error: unknown) => {
    console.error("Unable to configure the YouTube Tab Grouper side panel.", error);
  });
}

chrome.runtime.onInstalled.addListener(configureSidePanelWithLogging);
chrome.runtime.onStartup.addListener(configureSidePanelWithLogging);
