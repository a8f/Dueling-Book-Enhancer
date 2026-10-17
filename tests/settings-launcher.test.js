"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { test } = require("node:test");

function harness(contexts) {
  let clicked;
  const calls = [];
  const runtime = {
    getURL: path => "chrome-extension://test/" + path,
    onMessage: { addListener() {} },
    async openOptionsPage() { calls.push("open"); }
  };
  if (contexts) runtime.getContexts = async () => contexts;
  vm.runInNewContext(fs.readFileSync(require.resolve("../background.js"), "utf8"), {
    console,
    DBEnhancerCore: {}, DBEnhancerSettingsStore: { create() { return {}; } },
    chrome: {
      runtime,
      action: { onClicked: { addListener(listener) { clicked = listener; } } },
      tabs: { async update(id, options) { calls.push({ tab: id, active: options.active }); } },
      windows: { async update(id, options) { calls.push({ window: id, focused: options.focused }); } }
    }
  });
  return { calls, click: () => clicked() };
}

test("toolbar focuses existing settings tab and window while preserving its section", async () => {
  const h = harness([{ documentUrl: "chrome-extension://test/options.html#sort-heading", tabId: 7, windowId: 2 }]);
  h.click();
  await new Promise(setImmediate);
  assert.deepEqual(h.calls, [{ tab: 7, active: true }, { window: 2, focused: true }]);
  assert.equal(require("../manifest.json").action.default_popup, undefined);
});

test("first opening and Firefox use options API, and rapid toolbar clicks coalesce", async () => {
  for (const contexts of [[], undefined]) {
    const h = harness(contexts);
    h.click();
    h.click();
    await new Promise(setImmediate);
    assert.deepEqual(h.calls, ["open"]);
  }
});
