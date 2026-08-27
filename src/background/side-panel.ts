export async function configureActionSidePanel(
  api: Pick<typeof chrome.sidePanel, "setPanelBehavior">,
): Promise<void> {
  await api.setPanelBehavior({ openPanelOnActionClick: true });
}
