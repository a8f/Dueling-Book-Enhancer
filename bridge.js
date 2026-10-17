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

  function readAndPublish(reason) {
    chrome.storage.local.get(SETTINGS_KEY, function settingsLoaded(result) {
      publishSettings(result[SETTINGS_KEY], reason);
    });
  }

  function saveHostDefaults(candidateHostDefaults) {
    chrome.storage.local.get(SETTINGS_KEY, function currentSettingsLoaded(result) {
      const stored =
        result[SETTINGS_KEY] && typeof result[SETTINGS_KEY] === "object"
          ? result[SETTINGS_KEY]
          : {};
      const currentHost =
        stored.hostDefaults && typeof stored.hostDefaults === "object"
          ? stored.hostDefaults
          : {};
      const incoming =
        candidateHostDefaults && typeof candidateHostDefaults === "object"
          ? candidateHostDefaults
          : {};
      const candidate = Object.assign({}, stored, {
        hostDefaults: Object.assign({}, currentHost, incoming, {
          preserveLastUsed: Boolean(currentHost.preserveLastUsed)
        })
      });

      chrome.storage.local.set({ settings: candidate });
    });
  }

  function saveDeckCardpool(deckId, candidateCardpool) {
    const id = String(deckId || "");
    if (!/^\d+$/.test(id) || !candidateCardpool || typeof candidateCardpool !== "object") {
      return;
    }
    const descriptor =
      candidateCardpool.kind === "custom" && /^dbx-[a-zA-Z0-9._:-]+$/.test(String(candidateCardpool.id || ""))
        ? { kind: "custom", id: String(candidateCardpool.id) }
        : candidateCardpool.kind === "native" && String(candidateCardpool.value || "")
          ? { kind: "native", value: String(candidateCardpool.value).slice(0, 20) }
          : null;
    if (!descriptor) return;

    chrome.storage.local.get(SETTINGS_KEY, function currentSettingsLoaded(result) {
      const stored =
        result[SETTINGS_KEY] && typeof result[SETTINGS_KEY] === "object"
          ? result[SETTINGS_KEY]
          : {};
      if (stored.rememberCardList === false) return;
      const mappings =
        stored.deckCardpools && typeof stored.deckCardpools === "object"
          ? Object.assign({}, stored.deckCardpools)
          : {};
      mappings[id] = descriptor;
      chrome.storage.local.set({
        settings: Object.assign({}, stored, { deckCardpools: mappings })
      });
    });
  }

  function receivePageCommand(message) {
    if (
      !message ||
      message.channel !== CHANNEL ||
      message.source !== "page-main"
    ) {
      return;
    }

    if (message.requestId) {
      if (seenCommands.has(message.requestId)) return;
      if (seenCommands.size > 200) seenCommands.clear();
      seenCommands.add(message.requestId);
    }

    if (message.type === "request-settings") {
      readAndPublish("request");
    } else if (message.type === "save-host-defaults") {
      saveHostDefaults(message.hostDefaults);
    } else if (message.type === "save-deck-cardpool") {
      saveDeckCardpool(message.deckId, message.cardpool);
    } else if (message.type === "save-rps-mode" && ["manual", "repeat", "automatic"].includes(message.mode)) {
      chrome.storage.local.get(SETTINGS_KEY, function currentSettingsLoaded(result) {
        chrome.storage.local.set({ settings: Object.assign({}, result[SETTINGS_KEY] || {}, {
          autoStartRps: message.mode === "automatic",
          autoPickRps: message.mode !== "manual"
        }) });
      });
    } else if (
      (message.type === "save-auto-pick-rps" || message.type === "save-auto-start-rps") &&
      typeof message.enabled === "boolean"
    ) {
      const preference = message.type === "save-auto-start-rps" ? "autoStartRps" : "autoPickRps";
      chrome.storage.local.get(SETTINGS_KEY, function currentSettingsLoaded(result) {
        chrome.storage.local.set({
          settings: Object.assign({}, result[SETTINGS_KEY] || {}, { [preference]: message.enabled })
        });
      });
    }
  }

  window.addEventListener("message", function receivePageMessage(event) {
    receivePageCommand(event.data);
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
