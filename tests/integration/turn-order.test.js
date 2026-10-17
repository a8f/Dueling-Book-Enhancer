"use strict";
const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const vm = require("node:vm");
const core = require("../../extension/shared/enhancer-core.js");
const store = require("../../extension/shared/settings-store.js");
const createFeature = require("../../extension/page/features/turn-order.js");

test("go-first preference is opt-in, sanitized, and persists through preference updates", () => {
  const defaults = core.createDefaultSettings();
  assert.equal(defaults.autoGoFirst, false);
  assert.equal(core.sanitizeSettings({ autoGoFirst: "true" }).autoGoFirst, false);
  const updated = store.applyChanges(defaults, store.changes(defaults, { ...defaults, autoGoFirst: true }));
  assert.equal(core.sanitizeSettings(updated).autoGoFirst, true);
});

test("native First selection runs once per eligible prompt and honors manual choices", () => {
  const settings = core.createDefaultSettings();
  let visiblePanel = "tp_start";
  let choices = [];
  let capture;
  const saved = [];
  function element() {
    return {
      children: [],
      appendChild(child) { this.children.push(child); },
      attachShadow() { return this.shadowRoot = element(); },
      addEventListener(type, handler) { this[type] = handler; }
    };
  }
  const panels = Object.fromEntries(["tp_start", "tp_start2"].map(id => [id, { ...element(), id }]));
  const sent = [];
  const page = { Send: message => sent.push(message), duelist: true };
  vm.createContext(page);
  const native = fs.readFileSync(require.resolve("../../duelingbook/main.js"), "utf8");
  vm.runInContext(native.slice(native.indexOf("function pickFirst("), native.indexOf("function menuRollOutE(")), page);
  const feature = createFeature({
    window: { getComputedStyle: element => element },
    document: {
      getElementById: id => panels[id],
      createElement: element,
      querySelectorAll: () => choices
    },
    lifecycle: { listen(key, target, type, handler, useCapture) { assert.equal(useCapture, true); capture = handler; } },
    isVisible: element => element.id ? element.id === visiblePanel : !element.hidden,
    getSettings: () => settings,
    postToBridge: (type, payload) => saved.push({ type, ...payload })
  });
  function prompt() {
    choices = [0, 1].map(() => {
      const card = { hidden: false };
      const content = {
        pointerEvents: "auto", closest: () => card,
        click() { capture({ target: content }); page.pickFirst.call(content); }
      };
      card.querySelector = () => content;
      return card;
    });
    page.first = { find: () => [choices[0].querySelector()] };
  }
  const poll = () => { for (let i = 0; i < 10; i++) feature.tick(); };
  feature.initialize();
  prompt();
  poll();
  assert.equal(sent.length, 0, "disabled by default");
  const toggle = panels.tp_start.children[0].input;
  assert.equal(toggle.checked, false, "toggle is visible even when automation is off");
  assert.equal(panels.tp_start.children[0].hidden, false);
  toggle.checked = true;
  toggle.change();
  assert.deepEqual(saved, [{ type: "save-auto-go-first", enabled: true }]);
  poll();
  assert.equal(sent.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(sent[0])), { action: "Duel", play: "Pick first", choice: "First" });
  settings.autoGoFirst = false;
  feature.settingsChanged();
  assert.equal(toggle.checked, false, "settings changes update the screen toggle");
  settings.autoGoFirst = true;
  poll();
  assert.equal(sent.length, 1, "toggling settings cannot resubmit the same prompt");
  prompt();
  visiblePanel = "tp_start2";
  poll();
  assert.equal(sent.length, 2, "another format or sided game gets a new selection");
  assert.equal(panels.tp_start.children[0].hidden, true);
  assert.equal(panels.tp_start2.children[0].input.checked, true);
  prompt();
  choices[1].querySelector().click();
  poll();
  assert.equal(sent.length, 3, "a manual choice is not followed by an automatic choice");
  assert.equal(sent.at(-1).choice, "Second");
  prompt();
  visiblePanel = null;
  poll();
  assert.equal(sent.length, 3, "hidden turn-order screens do not submit");
  visiblePanel = "tp_start";
  choices[0].querySelector().pointerEvents = "none";
  poll();
  assert.equal(sent.length, 3, "disabled card content is skipped");
  choices = [];
  poll();
  assert.equal(sent.length, 3, "spectators and opponents choosing have no selectable tp_card elements");
  assert.equal(panels.tp_start.children[0].hidden, true);
});

test("screen toggle command validates and saves the preference", async () => {
  let settings = core.createDefaultSettings();
  const service = store.create({ core, read: async () => settings, write: async value => { settings = value; } });
  await service.execute({ type: "save-auto-go-first", enabled: true });
  assert.equal(settings.autoGoFirst, true);
  await assert.rejects(service.execute({ type: "save-auto-go-first", enabled: "false" }), /Invalid turn-order/);
  assert.equal(settings.autoGoFirst, true);
  await service.execute({ type: "save-auto-go-first", enabled: false });
  assert.equal(settings.autoGoFirst, false);
});
