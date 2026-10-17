"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const core = require("../enhancer-core.js");

const postedMessages = [];
const windowListeners = {};
const documentListeners = {};
const relayedEvents = [];
let storageChangeListener;
let storedSettings = core.createDefaultSettings();
storedSettings.hostDefaults.preserveLastUsed = true;

const fakeWindow = {
  addEventListener: function addEventListener(type, listener) {
    windowListeners[type] = listener;
  },
  postMessage: function postMessage(message) {
    postedMessages.push(message);
  }
};

const fakeDocument = {
  addEventListener: function addEventListener(type, listener) {
    documentListeners[type] = listener;
  },
  dispatchEvent: function dispatchEvent(event) {
    relayedEvents.push(event);
  }
};

function FakeCustomEvent(type, options) {
  this.type = type;
  this.detail = options.detail;
}

const fakeChrome = {
  storage: {
    local: {
      get: function get(_key, callback) {
        callback({ settings: storedSettings });
      },
      set: function set(value) {
        storedSettings = value.settings;
      }
    },
    onChanged: {
      addListener: function addListener(listener) {
        storageChangeListener = listener;
      }
    }
  }
};

vm.runInNewContext(
  fs.readFileSync(require.resolve("../bridge.js"), "utf8"),
  {
    chrome: fakeChrome,
    console: console,
    CustomEvent: FakeCustomEvent,
    document: fakeDocument,
    window: fakeWindow
  }
);

assert.equal(typeof windowListeners.message, "function");
assert.equal(typeof documentListeners["dueling-book-enhancer-v1-command"], "function");
assert.equal(typeof storageChangeListener, "function");
assert.equal(postedMessages[0].type, "settings");
assert.equal(postedMessages[0].settings.hostDefaults.format, "au");
assert.equal(relayedEvents[0].type, "dueling-book-enhancer-v1-settings");

const requestCommand = {
  channel: "dueling-book-enhancer-v1",
  source: "page-main",
  type: "request-settings",
  requestId: "same-command-on-both-transports"
};
const publicationsBeforeRequest = postedMessages.length;
windowListeners.message({ data: requestCommand });
documentListeners["dueling-book-enhancer-v1-command"]({
  detail: JSON.stringify(requestCommand)
});
assert.equal(
  postedMessages.length,
  publicationsBeforeRequest + 1,
  "A command delivered on both transports must only be handled once"
);

windowListeners.message({
  source: null,
  data: {
    channel: "dueling-book-enhancer-v1",
    source: "page-main",
    type: "save-host-defaults",
    hostDefaults: {
      format: "eu",
      type: "m",
      rules: "TCG",
      duelNote: "Edison streak",
      watching: false
    }
  }
});

assert.equal(storedSettings.hostDefaults.format, "eu");
assert.equal(storedSettings.hostDefaults.type, "m");
assert.equal(storedSettings.hostDefaults.rules, "TCG");
assert.equal(storedSettings.hostDefaults.duelNote, "Edison streak");
assert.equal(storedSettings.hostDefaults.watching, false);
assert.equal(
  storedSettings.hostDefaults.preserveLastUsed,
  true,
  "Preserve Last Used must not turn itself off while saving a host session"
);

windowListeners.message({
  data: {
    channel: "dueling-book-enhancer-v1",
    source: "page-main",
    type: "save-deck-cardpool",
    deckId: "42",
    cardpool: { kind: "custom", id: "dbx-redu" }
  }
});
assert.equal(storedSettings.deckCardpools["42"].kind, "custom");
assert.equal(storedSettings.deckCardpools["42"].id, "dbx-redu");

storageChangeListener(
  { settings: { newValue: storedSettings } },
  "local"
);
assert.equal(postedMessages.at(-1).reason, "storage-change");
assert.equal(postedMessages.at(-1).settings.hostDefaults.format, "eu");

assert.equal(core.createDefaultSettings().autoPickRps, false);
assert.equal(core.createDefaultSettings().rpsEnhancements, true);
assert.equal(core.createDefaultSettings().autoStartRps, false);
assert.equal(core.sanitizeSettings({ rpsEnhancements: false, autoStartRps: true }).rpsEnhancements, false);
assert.equal(core.sanitizeSettings({ autoStartRps: true }).autoStartRps, true);
assert.equal(core.sanitizeSettings({ autoStartRps: "true" }).autoStartRps, false);
assert.equal(core.sanitizeSettings({}).rpsEnhancements, true, "existing installs keep RPS enhancements");
assert.equal(core.sanitizeSettings({ autoPickRps: true }).autoPickRps, true);
assert.equal(core.sanitizeSettings({ autoPickRps: "false" }).autoPickRps, false);
storedSettings.autoStartRps = true;
storedSettings.rpsEnhancements = false;
for (const enabled of [true, false]) {
  windowListeners.message({ data: {
    channel: "dueling-book-enhancer-v1", source: "page-main",
    type: "save-auto-pick-rps", enabled
  } });
  assert.equal(storedSettings.autoPickRps, enabled);
  assert.equal(storedSettings.hostDefaults.format, "eu", "preserve other preferences");
  // A reload requests stored settings through the bridge again.
  windowListeners.message({ data: {
    channel: "dueling-book-enhancer-v1", source: "page-main", type: "request-settings"
  } });
  assert.equal(postedMessages.at(-1).settings.autoPickRps, enabled);
  assert.equal(postedMessages.at(-1).settings.autoStartRps, true);
  assert.equal(postedMessages.at(-1).settings.rpsEnhancements, false);
}

for (const enabled of [true, false]) {
  windowListeners.message({ data: {
    channel: "dueling-book-enhancer-v1", source: "page-main",
    type: "save-auto-start-rps", enabled
  } });
  assert.equal(storedSettings.autoStartRps, enabled);
  assert.equal(storedSettings.autoPickRps, false, "saving auto first pick preserves repeat ties");
  assert.equal(storedSettings.rpsEnhancements, false, "saving auto first pick preserves the master switch");
}

for (const [mode, first, repeat] of [["manual", false, false], ["repeat", false, true], ["automatic", true, true]]) {
  windowListeners.message({ data: {
    channel: "dueling-book-enhancer-v1", source: "page-main", type: "save-rps-mode", mode
  } });
  assert.equal(storedSettings.autoStartRps, first);
  assert.equal(storedSettings.autoPickRps, repeat);
  assert.equal(storedSettings.rpsEnhancements, false);
  const restored = core.sanitizeSettings(storedSettings);
  assert.equal(restored.autoStartRps, first);
  assert.equal(restored.autoPickRps, repeat);
}
windowListeners.message({ data: {
  channel: "dueling-book-enhancer-v1", source: "page-main", type: "save-rps-mode", mode: "invalid"
} });
assert.equal(storedSettings.autoStartRps, true, "ignore invalid modes");
assert.equal(storedSettings.autoPickRps, true);

console.log("Storage bridge test passed.");
