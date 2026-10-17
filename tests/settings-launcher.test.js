"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { test } = require("node:test");

function harness(contexts, tabs = []) {
  let receive;
  const calls = [];
  const runtime = {
    id: "test", getURL: path => "chrome-extension://test/" + path,
    onMessage: { addListener(listener) { receive = listener; } },
    async openOptionsPage() { calls.push("open"); }
  };
  if (contexts) runtime.getContexts = async () => contexts;
  vm.runInNewContext(fs.readFileSync(require.resolve("../extension/background/background.js"), "utf8"), {
    console,
    DBEnhancerCore: {}, DBEnhancerSettingsStore: { create() { return {}; } },
    chrome: {
      runtime,
      action: { onClicked: { addListener() {} } },
      tabs: {
        async query() { return tabs; },
        async create(options) { calls.push({ create: options.url }); },
        async update(id, options) { calls.push({ tab: id, ...options }); }
      },
      windows: { async update(id, options) { calls.push({ window: id, focused: options.focused }); } }
    }
  });
  return { calls, open(section, url = "chrome-extension://test/popup/popup.html") {
    return new Promise(resolve => {
      const handled = receive({ channel: "dbx-settings", command: { type: "open-settings", section } }, { id: "test", url }, resolve);
      if (!handled) resolve(undefined);
    });
  } };
}

test("toolbar uses a popup; All settings preserves the existing section and focuses its window", async () => {
  const h = harness([{ documentUrl: "chrome-extension://test/options/options.html#sort-heading", tabId: 7, windowId: 2 }]);
  assert.equal((await h.open()).ok, true);
  assert.deepEqual(h.calls, [{ tab: 7, active: true }, { window: 2, focused: true }]);
  assert.equal(require("../extension/manifest.json").action.default_popup, "popup/popup.html");
});

test("section shortcuts navigate existing settings instead of opening duplicates", async () => {
  const h = harness([{ documentUrl: "chrome-extension://test/options/options.html#sort-heading", tabId: 7, windowId: 2 }]);
  await h.open("automation-heading");
  assert.deepEqual(h.calls, [{ tab: 7, active: true, url: "chrome-extension://test/options/options.html#automation-heading" }, { window: 2, focused: true }]);
});

test("first opening and Firefox use options API, and rapid opens coalesce", async () => {
  for (const contexts of [[], undefined]) {
    const h = harness(contexts);
    await Promise.all([h.open(), h.open()]);
    assert.deepEqual(h.calls, ["open"]);
  }
});

test("first section opening uses an anchored URL; Firefox reuses its own options tab", async () => {
  const h = harness([]);
  await h.open("host-heading");
  assert.deepEqual(h.calls, [{ create: "chrome-extension://test/options/options.html#host-heading" }]);
  const firefox = harness(undefined, [{ id: 4, windowId: 3, url: "chrome-extension://test/options/options.html#sort-heading" }]);
  await firefox.open();
  assert.deepEqual(firefox.calls, [{ tab: 4, active: true }, { window: 3, focused: true }]);
});

test("invalid shortcuts and site-origin launch requests cannot open arbitrary pages", async () => {
  const h = harness([]);
  assert.equal((await h.open("https://example.com")).ok, false);
  assert.equal(await h.open("host-heading", "https://duelingbook.com/"), undefined);
  assert.deepEqual(h.calls, []);
});
