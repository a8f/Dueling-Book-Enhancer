"use strict";
const assert = require("node:assert/strict");
const { test } = require("node:test");
const createDebug = require("../features/debugging.js");
const createShuffle = require("../features/hand-shuffle.js");
const { createRuntime } = require("../duel-events.js");

function setup() {
  const listeners = {}, timers = [], downloads = [], elements = [];
  const document = {
    body: { appendChild: element => elements.push(element) }, hidden: false,
    hasFocus: () => true, getElementById: () => null,
    addEventListener(type, handler) { listeners[type] = handler; },
    createElement(tagName) {
      return { tagName, appendChild() {}, setAttribute() {}, addEventListener(type, handler) { this[type] = handler; },
        attachShadow() { return { appendChild() {} }; }, click() { downloads.push(this.download); }, remove() {} };
    }
  };
  const page = { console: { warn() {} }, navigator: { onLine: true },
    addEventListener(type, handler) { listeners[type] = handler; },
    setTimeout(callback) { timers.push(callback); }, Blob,
    URL: { createObjectURL(blob) { page.blob = blob; return "blob:test"; }, revokeObjectURL() {} },
    Send(message) { return message.action; }, actionsQueue: [],
    username: "secret-name", player1: { username: "secret-name", hand_arr: [{ name: "secret-card" }], lifepoints: 8000 }
  };
  const context = { window: page, document, getSettings: () => ({ autoShuffleHand: false, hostPassword: "secret-password" }) };
  const feature = createDebug(context);
  return { page, document, context, feature, listeners, timers, downloads, elements };
}

test("debug hooks coexist with shuffle recovery, preserve calls, and recover after replacement without wrapper growth", () => {
  const h = setup();
  h.feature.tick();
  const shuffle = createShuffle(h.context);
  shuffle.tick();
  const wrapper = h.page.Send;
  for (let i = 0; i < 100; i++) { h.feature.tick(); shuffle.tick(); }
  assert.equal(h.page.Send, wrapper);
  assert.equal(h.page.Send({ action: "Duel", play: "End turn", password: "secret" }), "Duel");
  assert.equal(h.page.DBEnhancerDebug.snapshot().history.filter(item => item.type === "command").length, 1);
  h.page.Send = function () { assert.equal(this, h.page); return 17; };
  h.feature.tick(); shuffle.tick(); h.feature.tick(); shuffle.tick();
  assert.equal(h.page.Send(), 17);
  const failure = new Error("native failure");
  h.page.Send = () => { throw failure; };
  h.feature.tick();
  assert.throws(() => h.page.Send(), error => error === failure);
  assert.equal(h.page.DBEnhancerDebug.snapshot().history.at(-1).type, "native-error");
});

test("reports bound history and exclude raw payloads, identities, cards and hosting settings", () => {
  const h = setup();
  h.feature.tick();
  h.page.Send({ action: "Login", password: "secret-password", username: "secret-name" });
  for (let i = 0; i < 400; i++) h.page.DBEnhancerDebug.record("test", { i });
  const report = h.page.DBEnhancerDebug.snapshot();
  assert.equal(report.history.length, 300);
  assert.equal(report.game.players[0].handCount, 1);
  const text = JSON.stringify(report);
  for (const secret of ["secret-password", "secret-name", "secret-card"]) assert.equal(text.includes(secret), false);
});

test("shortcut downloads valid reports without adding page controls and page errors are captured", async () => {
  const h = setup();
  h.feature.initialize();
  assert.equal(h.elements.length, 0);
  h.listeners.error({ error: new Error("animation failed") });
  h.listeners.unhandledrejection({ reason: new Error("rule failed") });
  h.listeners.keydown({ ctrlKey: true, altKey: true, shiftKey: true, code: "KeyD" });
  assert.match(h.downloads[0], /^duelingbook-debug-.*\.json$/);
  const report = JSON.parse(await h.page.blob.text());
  assert.equal(report.schemaVersion, 1);
  assert.ok(report.history.some(item => item.type === "page-error"));
  assert.ok(report.history.some(item => item.type === "unhandled-error"));
  assert.equal(h.elements.length, 1, "only the temporary download link is created");
});

test("clicks suppressed by native clickedRecently are recorded without replaying the action", () => {
  const h = setup();
  h.feature.initialize();
  h.page.clickedRecently = true;
  h.listeners.click({ target: { closest: () => ({ id: "end_turn" }) } });
  h.timers.shift()();
  const history = h.page.DBEnhancerDebug.snapshot().history;
  assert.equal(history.at(-1).type, "control-no-command");
  assert.equal(history.at(-1).details.clickedRecently, true);
  assert.equal(history.some(item => item.type === "command"), false);
});

test("read-only queue push cannot prevent native duel dispatch", () => {
  const queue = [];
  Object.defineProperty(queue, "push", { value: Array.prototype.push, writable: false });
  let calls = 0;
  const page = { actionsQueue: queue, console: { warn() {} },
    duelResponse2(player, message) { calls++; assert.equal(this, page); queue.push(() => message); return "native"; } };
  createRuntime(page).install();
  const message = { play: "End turn" };
  assert.equal(page.duelResponse2({}, message), "native");
  assert.equal(calls, 1);
  assert.equal(queue[0](), message);
});
