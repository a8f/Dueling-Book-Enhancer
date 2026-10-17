"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { test } = require("node:test");

// Actual worker and clients in separate worlds, with asynchronous storage.
function harness(environment = "worker") {
  let stored;
  let receive;
  const storageListeners = [];
  const runtime = {
    id: "extension-test", getURL: path => "chrome-extension://extension-test/" + path,
    onMessage: { addListener: callback => { receive = callback; } }
  };
  const chrome = { runtime, storage: {
    local: {
      get(_key, callback) { setImmediate(() => callback({ settings: structuredClone(stored) })); },
      set(value, callback) {
        setImmediate(() => {
          stored = structuredClone(value.settings);
          storageListeners.forEach(listener => listener({ settings: { newValue: stored } }, "local"));
          callback();
        });
      }
    },
    onChanged: { addListener: callback => storageListeners.push(callback) }
  } };
  const worker = vm.createContext({ chrome, console });
  const load = path => vm.runInContext(fs.readFileSync(require.resolve("../" + path), "utf8"), worker);
  const background = require("../manifest.json").background;
  if (environment === "event-page") {
    // Firefox's background page has window and no worker importScripts API.
    worker.window = worker;
    background.scripts.forEach(load);
  } else {
    worker.importScripts = (...paths) => paths.forEach(load);
    load(background.service_worker);
  }
  function client(url) {
    const clientChrome = { ...chrome, runtime: { ...runtime,
      sendMessage(message, respond) { receive(message, { id: runtime.id, url }, respond); }
    } };
    const page = vm.createContext({ window: {}, chrome: clientChrome });
    vm.runInContext(fs.readFileSync(require.resolve("../settings-client.js"), "utf8"), page);
    return { api: page.window.DBEnhancerSettingsClient, chrome: clientChrome };
  }
  return { client, read: () => structuredClone(stored) };
}

test("worker serializes commands from multiple tabs and merges stale options changes", async () => {
  const h = harness();
  const site = h.client("https://www.duelingbook.com/").api;
  const options = h.client("chrome-extension://extension-test/options.html").api;
  const snapshot = await options.execute({ type: "get-settings" });
  const edited = structuredClone(snapshot);
  edited.showGridLines = false;
  const { changes } = require("../settings-store.js");
  await Promise.all([
    site.execute({ type: "save-rps-mode", mode: "automatic" }),
    site.execute({ type: "save-deck-cardpool", deckId: 42, cardpool: { kind: "native", value: "tcg" } }),
    site.execute({ type: "save-deck-cardpool", deckId: 43, cardpool: { kind: "custom", id: "dbx-custom-test" } }),
    options.execute({ type: "update-preferences", changes: changes(snapshot, edited) })
  ]);
  const stored = h.read();
  assert.equal(stored.autoStartRps, true);
  assert.equal(stored.autoPickRps, true);
  assert.equal(stored.showGridLines, false);
  assert.equal(stored.deckCardpools[42].value, "tcg");
  assert.equal(stored.deckCardpools[43].id, "dbx-custom-test");
  assert.ok(stored.customBanlists.length > 0, "worker loads bundled defaults without window");
});

test("Firefox event-page manifest starts the settings writer without importScripts", async () => {
  const h = harness("event-page");
  const options = h.client("chrome-extension://extension-test/options.html").api;
  const site = h.client("https://duelingbook.com/").api;
  const snapshot = await options.execute({ type: "get-settings" });
  assert.ok(snapshot.customBanlists.length > 0, "event page loads bundled defaults");
  const edited = structuredClone(snapshot);
  edited.showGridLines = false;
  await Promise.all([
    site.execute({ type: "save-rps-mode", mode: "automatic" }),
    site.execute({ type: "save-deck-cardpool", deckId: 42, cardpool: { kind: "native", value: "tcg" } }),
    options.execute({ type: "update-preferences", changes: require("../settings-store.js").changes(snapshot, edited) })
  ]);
  assert.equal(h.read().autoStartRps, true);
  assert.equal(h.read().showGridLines, false);
  assert.equal(h.read().deckCardpools[42].value, "tcg");
});

test("host updates honor preserve-last-used and stale options preserve newer host fields", async () => {
  const h = harness();
  const site = h.client("https://duelingbook.com/").api;
  const options = h.client("chrome-extension://extension-test/options.html").api;
  await site.execute({ type: "save-host-defaults", hostDefaults: { format: "eu" } });
  assert.equal(h.read().hostDefaults.format, "au");
  await options.execute({ type: "update-preferences", changes: [{ path: ["hostDefaults", "preserveLastUsed"], value: true }] });
  const snapshot = await options.execute({ type: "get-settings" });
  const edited = structuredClone(snapshot);
  edited.hostDefaults.watching = false;
  await site.execute({ type: "save-host-defaults", hostDefaults: { format: "eu", preserveLastUsed: false } });
  await options.execute({ type: "update-preferences", changes: require("../settings-store.js").changes(snapshot, edited) });
  assert.equal(h.read().hostDefaults.format, "eu");
  assert.equal(h.read().hostDefaults.watching, false);
  assert.equal(h.read().hostDefaults.preserveLastUsed, true);
});

test("invalid commands do not block later writes; page cannot send options patches", async () => {
  const h = harness();
  const site = h.client("https://duelingbook.com/").api;
  await assert.rejects(site.execute({ type: "save-rps-mode", mode: "invalid" }), /Invalid RPS/);
  await assert.rejects(site.execute({ type: "update-preferences", changes: [] }), /extension settings page/);
  const settings = await site.execute({ type: "save-rps-mode", mode: "repeat" });
  assert.equal(settings.autoPickRps, true);
  assert.equal(settings.autoStartRps, false);
});

test("bridge relays settings and deduplicates its two transports", async () => {
  const h = harness();
  const client = h.client("https://duelingbook.com/");
  const windowListeners = {};
  const documentListeners = {};
  const posted = [];
  const relayed = [];
  const window = {
    DBEnhancerSettingsClient: client.api,
    addEventListener(type, callback) { windowListeners[type] = callback; },
    postMessage(message) { posted.push(message); }
  };
  vm.runInNewContext(fs.readFileSync(require.resolve("../bridge.js"), "utf8"), {
    chrome: client.chrome, console, window,
    document: {
      addEventListener(type, callback) { documentListeners[type] = callback; },
      dispatchEvent(event) { relayed.push(event); }
    },
    CustomEvent: function(type, options) { this.type = type; this.detail = options.detail; }
  });
  await client.api.execute({ type: "get-settings" });
  assert.equal(posted[0].type, "settings");
  assert.equal(relayed[0].type, "dueling-book-enhancer-v1-settings");
  const command = { channel: "dueling-book-enhancer-v1", source: "page-main", type: "request-settings", requestId: "one" };
  windowListeners.message({ source: window, data: command });
  documentListeners["dueling-book-enhancer-v1-command"]({ detail: JSON.stringify(command) });
  await client.api.execute({ type: "get-settings" });
  assert.equal(posted.length, 2);
  windowListeners.message({ source: {}, data: { ...command, requestId: "other-window" } });
  await client.api.execute({ type: "get-settings" });
  assert.equal(posted.length, 2);
  windowListeners.message({ source: window, data: { ...command, requestId: "save", type: "save-rps-mode", mode: "automatic" } });
  await client.api.execute({ type: "get-settings" });
  assert.equal(posted.at(-1).reason, "storage-change");
  assert.equal(posted.at(-1).settings.autoStartRps, true);
});
