(function attach(root) {
  "use strict";
  root.DBEnhancerSettingsClient = {
    execute(command) {
      return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ channel: "dbx-settings", command }, result => {
          const error = chrome.runtime.lastError;
          if (error) reject(new Error(error.message));
          else if (!result || !result.ok) reject(new Error(result?.error || "Settings service unavailable."));
          else resolve(result.settings);
        });
      });
    }
  };
})(typeof window !== "undefined" ? window : globalThis);
