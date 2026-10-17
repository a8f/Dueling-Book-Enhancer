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

// Reuse our settings tab and window when opening from the quick-settings popup.
let openingSettings = null;
async function openSettings(section) {
  const url = chrome.runtime.getURL("options.html");
  let existing;
  if (chrome.runtime.getContexts) {
    const contexts = await chrome.runtime.getContexts({ contextTypes: ["TAB"] });
    existing = contexts.find(context => context.documentUrl?.split("#")[0] === url && context.tabId >= 0);
  } else {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find(tab => tab.url?.split("#")[0] === url);
    if (tab) existing = { tabId: tab.id, windowId: tab.windowId };
  }
  if (existing) {
    await chrome.tabs.update(existing.tabId, { active: true, ...(section ? { url: url + "#" + section } : {}) });
    await chrome.windows.update(existing.windowId, { focused: true });
    return;
  }
  // Firefox and first-time opening use the browser's options-page handling.
  if (section) await chrome.tabs.create({ url: url + "#" + section });
  else await chrome.runtime.openOptionsPage();
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (!message || message.channel !== "dbx-settings" || sender.id !== chrome.runtime.id) return;
  const optionsPage = sender.url?.split("#")[0] === chrome.runtime.getURL("options.html");
  const popup = sender.url === chrome.runtime.getURL("popup.html");
  const site = /^https:\/\/(www\.)?duelingbook\.com\//.test(sender.url || "");
  if (!optionsPage && !popup && !site) return;
  if (message.command?.type === "open-settings") {
    if (!popup) return;
    const section = message.command.section;
    if (section && !["rooms-heading", "host-heading", "deck-heading", "automation-heading", "card-pools-heading", "sort-heading", "colors-heading"].includes(section)) {
      respond({ ok: false, error: "Unknown settings section." });
      return;
    }
    if (!openingSettings) openingSettings = openSettings(section).finally(() => { openingSettings = null; });
    openingSettings.then(() => respond({ ok: true }), error => respond({ ok: false, error: error.message }));
    return true;
  }
  store.execute(message.command || {}, optionsPage || popup).then(
    settings => respond({ ok: true, settings }),
    error => respond({ ok: false, error: error.message })
  );
  // Keep this message event alive until the queued storage write completes.
  return true;
});
