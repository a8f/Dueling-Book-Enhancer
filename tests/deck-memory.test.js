"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const core = require("../enhancer-core.js");
const createCardPools = require("../features/card-pools.js");
const { create: createLifecycle } = require("../lifecycle.js");

function setup() {
  const settings = core.createDefaultSettings();
  settings.deckCardpools[42] = { kind: "native", value: "goat" };
  const events = [];
  const listeners = {};
  const pool = { selectedIndex: 0, options: [],
    querySelectorAll: () => [],
    dispatchEvent(event) { events.push(event.type); }
  };
  pool.options = ["tcg", "goat"].map((value, index) => ({
    value, textContent: value, dataset: {}, disabled: false,
    set selected(selected) { if (selected) pool.selectedIndex = index; }
  }));
  const constructor = { style: { display: "block" } };
  const window = {
    currentDeckId: 42,
    setTimeout() {},
    MutationObserver: class { observe() {} disconnect() {} },
    loadDeckResponse(value) { events.push("native:" + value); return this.result; }
  };
  let currentPool = pool;
  const document = {
    getElementById: id => id === "deck_constructor" ? constructor : null,
    querySelector: selector => selector === "#search .custom_cb" ? currentPool : null,
    addEventListener(type, handler) { (listeners[type] ||= []).push(handler); }
  };
  const feature = createCardPools({
    window, document, core, getSettings: () => settings,
    lifecycle: createLifecycle(window), isStarted: () => true,
    isVisible: element => Boolean(element && element.style.display !== "none"),
    postToBridge() {}
  });
  return { feature, window, pool, events, settings, document, setPool: value => { currentPool = value; } };
}

test("deck restoration runs after native loading and preserves native arguments, this and return", () => {
  const h = setup();
  h.feature.initialize();
  const firstWrapper = h.window.loadDeckResponse;
  h.feature.tick();
  assert.equal(h.window.loadDeckResponse, firstWrapper, "health check does not stack wrappers");
  assert.equal(h.window.loadDeckResponse.call({ result: 123 }, "deck"), 123);
  assert.deepEqual(h.events, ["native:deck", "change"]);
  assert.equal(h.pool.selectedIndex, 1);
  // Native functions can be replaced during the site's lifecycle.
  h.window.loadDeckResponse = function(value) { h.events.push("replacement:" + value); return 456; };
  h.feature.tick();
  assert.equal(h.window.loadDeckResponse("deck2"), 456);
  assert.equal(h.events.at(-2), "replacement:deck2");
  assert.equal(h.events.at(-1), "change");
});

test("a deleted remembered pool falls back to an enabled native pool", () => {
  const h = setup();
  h.settings.deckCardpools[42] = { kind: "custom", id: "dbx-deleted" };
  h.pool.options[0].disabled = true;
  h.feature.initialize();
  h.window.loadDeckResponse("deck");
  assert.equal(h.pool.selectedIndex, 1);
  assert.equal(h.events.at(-1), "change");
});

test("decks without remembered pools are left alone", () => {
  const h = setup();
  delete h.settings.deckCardpools[42];
  h.feature.initialize();
  h.window.loadDeckResponse("deck");
  assert.deepEqual(h.events, ["native:deck"]);
});

test("enhancer failures cannot interrupt the native deck-loading return", () => {
  const h = setup();
  h.feature.initialize();
  h.setPool({ get options() { throw new Error("native controls changed"); } });
  const original = console.error;
  const errors = [];
  console.error = (...args) => errors.push(args);
  try {
    assert.equal(h.window.loadDeckResponse.call({ result: 789 }, "deck"), 789);
    assert.equal(errors.length, 1);
  } finally { console.error = original; }
});
