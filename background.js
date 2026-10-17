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

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (!message || message.channel !== "dbx-settings" || sender.id !== chrome.runtime.id) return;
  const optionsPage = sender.url === chrome.runtime.getURL("options.html");
  const site = /^https:\/\/(www\.)?duelingbook\.com\//.test(sender.url || "");
  if (!optionsPage && !site) return;
  store.execute(message.command || {}, optionsPage).then(
    settings => respond({ ok: true, settings }),
    error => respond({ ok: false, error: error.message })
  );
  // Keep this message event alive until the queued storage write completes.
  return true;
});
