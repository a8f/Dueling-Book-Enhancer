"use strict";

// Chromium loads this file as a worker. Firefox loads the ordered background
// scripts from the manifest in an event page, where importScripts is absent.
if (typeof importScripts === "function") {
  importScripts("bundled-banlists.js", "enhancer-core.js", "settings-store.js");
}

const store = DBEnhancerSettingsStore.create({
  core: DBEnhancerCore,
  read: () => new Promise((resolve, reject) => {
    chrome.storage.local.get("settings", result => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(result.settings);
    });
  }),
  write: settings => new Promise((resolve, reject) => {
    chrome.storage.local.set({ settings }, () => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve();
    });
  })
});

// Open settings directly from the toolbar. Find our own extension context so
// section anchors and settings tabs in other windows are reused as well.
let openingSettings = null;
async function openSettings() {
  const url = chrome.runtime.getURL("options.html");
  if (chrome.runtime.getContexts) {
    const contexts = await chrome.runtime.getContexts({ contextTypes: ["TAB"] });
    const existing = contexts.find(context => context.documentUrl?.split("#")[0] === url && context.tabId >= 0);
    if (existing) {
      await chrome.tabs.update(existing.tabId, { active: true });
      await chrome.windows.update(existing.windowId, { focused: true });
      return;
    }
  }
  // Firefox and first-time opening use the browser's options-page handling.
  await chrome.runtime.openOptionsPage();
}
chrome.action.onClicked.addListener(() => {
  if (openingSettings) return;
  openingSettings = openSettings().catch(error => console.error("Could not open settings:", error)).finally(() => {
    openingSettings = null;
  });
});

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (!message || message.channel !== "dbx-settings" || sender.id !== chrome.runtime.id) return;
  const optionsPage = sender.url?.split("#")[0] === chrome.runtime.getURL("options.html");
  const site = /^https:\/\/(www\.)?duelingbook\.com\//.test(sender.url || "");
  if (!optionsPage && !site) return;
  store.execute(message.command || {}, optionsPage).then(
    settings => respond({ ok: true, settings }),
    error => respond({ ok: false, error: error.message })
  );
  // Keep this message event alive until the queued storage write completes.
  return true;
});
