(function startStorageBridge() {
  "use strict";

  const CHANNEL = "dueling-book-enhancer-v1";
  const SETTINGS_KEY = "settings";
  const COMMAND_EVENT = "dueling-book-enhancer-v1-command";
  const SETTINGS_EVENT = "dueling-book-enhancer-v1-settings";
  const seenCommands = new Set();
  let settingsSequence = 0;

  if (
    typeof chrome === "undefined" ||
    !chrome.storage ||
    !chrome.storage.local
  ) {
    console.error("[Dueling Book Enhancer] Storage bridge could not start.");
    return;
  }

  function dispatchRelay(eventName, payload) {
    try {
      document.dispatchEvent(
        new CustomEvent(eventName, {
          detail: JSON.stringify(payload)
        })
      );
    } catch (error) {
      console.debug(
        "[Dueling Book Enhancer] DOM settings relay was unavailable.",
        error
      );
    }
  }

  function publishSettings(settings, reason) {
    const message = {
      channel: CHANNEL,
      source: "extension-bridge",
      type: "settings",
      reason: reason || "load",
      deliveryId: "settings-" + Date.now() + "-" + ++settingsSequence,
      settings: settings && typeof settings === "object" ? settings : null
    };

    window.postMessage(message, "*");
    dispatchRelay(SETTINGS_EVENT, message);
  }

  const client = window.DBEnhancerSettingsClient;
  function report(error) {
    console.error("[Dueling Book Enhancer] Settings command failed.", error);
  }
  function readAndPublish(reason) {
    return client.execute({ type: "get-settings" }).then(settings => publishSettings(settings, reason)).catch(report);
  }
  const commands = new Set([
    "save-host-defaults", "save-deck-cardpool", "save-rps-mode",
    "save-auto-pick-rps", "save-auto-start-rps", "save-auto-go-first"
  ]);
  function receivePageCommand(message) {
    if (!message || message.channel !== CHANNEL || message.source !== "page-main") return;
    if (message.requestId) {
      if (seenCommands.has(message.requestId)) return;
      if (seenCommands.size > 200) seenCommands.clear();
      seenCommands.add(message.requestId);
    }
    if (message.type === "request-settings") readAndPublish("request");
    else if (commands.has(message.type)) client.execute(message).catch(report);
  }

  window.addEventListener("message", function receivePageMessage(event) {
    if (event.source === window) receivePageCommand(event.data);
  });

  document.addEventListener(COMMAND_EVENT, function receiveRelayedCommand(event) {
    try {
      receivePageCommand(JSON.parse(event.detail));
    } catch (error) {
      console.debug(
        "[Dueling Book Enhancer] Ignored an invalid DOM bridge command.",
        error
      );
    }
  });

  chrome.storage.onChanged.addListener(function storageChanged(changes, areaName) {
    if (areaName !== "local" || !changes[SETTINGS_KEY]) return;
    publishSettings(changes[SETTINGS_KEY].newValue, "storage-change");
  });

  readAndPublish("startup");
})();
