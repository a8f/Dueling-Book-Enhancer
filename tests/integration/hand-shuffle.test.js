"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { test } = require("node:test");
const core = require("../../extension/shared/enhancer-core.js");
const { createRuntime } = require("../../extension/page/duel-events.js");
const createFeature = require("../../extension/page/features/hand-shuffle.js");

function harness(enabled = true) {
  const self = { username: "Local", hand_arr: [1, 2, 3, 4, 5] };
  const opponent = { username: "Opponent", hand_arr: [1, 2] };
  self.opponent = opponent;
  opponent.opponent = self;
  const commands = [];
  const settings = core.sanitizeSettings({ autoShuffleHand: enabled, handShuffleAggressiveness: 0 });
  let time = 0;
  const listeners = {};
  const document = {
    hidden: false, hasFocus: () => true,
    addEventListener(type, handler) { listeners[type] = handler; },
    getElementById: () => null
  };
  self.main_arr = [{ 0: { getBoundingClientRect: () =>
    ({ left: 700, right: 760, top: 500, bottom: 590, width: 60, height: 90 }) } }];
  const page = {
    player1: self, player2: opponent, username: self.username, duelist: true,
    currentLabel: "duel_start", currentPhase: "DP", turnCount: 2, turn_player: self,
    duelId: 1, actionsQueue: [], console,
    drawCard(player, message) { player.hand_arr.push(message.id); },
    resetGame() {}, initUserDuelStart() {},
    performNextAction() {},
    addEventListener(type, handler) { listeners[type] = handler; },
    Send(message) { commands.push({ ...message, handSize: self.hand_arr.length }); }
  };
  // Exercise the native shuffle command and queued draw dispatcher.
  vm.createContext(page);
  const main = fs.readFileSync(require.resolve("../../duelingbook/main.js"), "utf8");
  vm.runInContext(main.slice(main.indexOf("function shuffleHandE("), main.indexOf("function enterDPE(")), page);
  const duel = fs.readFileSync(require.resolve("../../duelingbook/duel.js"), "utf8");
  vm.runInContext(duel.slice(duel.indexOf("function duelResponse2("), duel.indexOf("function beginNextDuel(")), page);
  page.DBEnhancerDuelEvents = createRuntime(page);
  const feature = createFeature({ window: page, document, core, now: () => time, getSettings: () => settings });
  feature.initialize();
  feature.initialize();
  page.DBEnhancerDuelEvents.install();
  return { page, document, self, opponent, commands, settings, feature,
    advance(ms) { time += ms; feature.tick(); },
    pointer(x, y) { listeners.pointermove({ clientX: x, clientY: y }); },
    fire(type, event = {}) { listeners[type](event); },
    draw(player = self, id = 6) { page.drawCard(player, { play: "Draw card", id, username: player.username }); }
  };
}

test("turn draw shuffles only after native draw execution, once per turn", async () => {
  const h = harness();
  h.page.duelResponse2(h.self, { play: "Draw card", username: h.self.username, id: 6 });
  await Promise.resolve();
  assert.deepEqual(h.commands, [], "receipt does not shuffle");
  h.page.actionsQueue.shift()();
  assert.deepEqual(h.commands, [], "wait for the native draw handler");
  await Promise.resolve();
  assert.deepEqual(h.commands, [{ action: "Duel", play: "Shuffle hand", handSize: 6 }]);
  h.draw();
  await Promise.resolve();
  assert.equal(h.commands.length, 1);
  h.page.turnCount += 2;
  h.draw();
  await Promise.resolve();
  assert.equal(h.commands.length, 2);
});

test("only enabled, live, own Draw Phase draws trigger shuffling", async () => {
  for (const change of [
    h => { h.settings.autoShuffleHand = false; },
    h => { h.page.currentPhase = "M1"; },
    h => { h.page.turn_player = h.opponent; },
    h => { h.page.duelist = false; },
    h => { h.page.replay = true; },
    h => { h.page.resetting = true; },
    h => { h.page.automatic = true; },
    h => { h.page.paused = true; },
    h => { h.page.currentLabel = "siding"; },
    h => { h.self.hand_arr = []; }
  ]) {
    const h = harness();
    change(h);
    h.draw();
    await Promise.resolve();
    assert.deepEqual(h.commands, []);
  }
  const h = harness();
  h.draw(h.opponent);
  await Promise.resolve();
  assert.deepEqual(h.commands, []);
});

test("deferred shuffle is invalidated by settings or game changes", async () => {
  for (const change of [
    h => { h.settings.autoShuffleHand = false; },
    h => { h.page.duelId++; },
    h => { h.page.turnCount++; },
    h => { h.page.username = "Other"; },
    h => { h.page.player1 = { ...h.self }; },
    h => { h.page.initUserDuelStart(); },
    h => { h.page.resetGame(h.self, { play: "Reset game" }); },
    h => { h.page.paused = true; },
    h => { h.page.shuffleHandE = undefined; }
  ]) {
    const h = harness();
    h.draw();
    change(h);
    await Promise.resolve();
    assert.deepEqual(h.commands, []);
  }
});

test("reset allows the same turn number to shuffle in the next game", async () => {
  const h = harness();
  h.draw();
  await Promise.resolve();
  h.page.resetGame(h.self, { play: "Reset game" });
  h.draw();
  await Promise.resolve();
  assert.equal(h.commands.length, 2);
});

test("hand shuffle preference defaults off and requires a boolean", () => {
  assert.equal(core.createDefaultSettings().autoShuffleHand, false);
  assert.equal(core.sanitizeSettings({ autoShuffleHand: "true" }).autoShuffleHand, false);
  assert.equal(core.sanitizeSettings({ autoShuffleHand: true }).autoShuffleHand, true);
  assert.equal(core.createDefaultSettings().autoShuffleAfterDraw, false);
  assert.equal(core.sanitizeSettings({ autoShuffleAfterDraw: "true" }).autoShuffleAfterDraw, false);
  assert.equal(core.sanitizeSettings({ autoShuffleAfterDraw: true }).autoShuffleAfterDraw, true);
});

test("delayed option batches draws and takes priority over immediate turn shuffling", async () => {
  const h = harness();
  h.settings.autoShuffleAfterDraw = true;
  h.pointer(300, 300);
  h.draw();
  await Promise.resolve();
  h.advance(2500);
  assert.equal(h.commands.length, 0);
  h.draw();
  await Promise.resolve();
  h.advance(2500);
  assert.equal(h.commands.length, 0, "each draw restarts the full delay");
  h.advance(500);
  assert.equal(h.commands.length, 1);
  assert.equal(h.commands[0].handSize, 7);
  h.advance(5000);
  assert.equal(h.commands.length, 1, "one shuffle per batch");
});

test("proximity and pointer buttons block delayed shuffles until a full second away", async () => {
  const h = harness(false);
  h.settings.autoShuffleAfterDraw = true;
  h.pointer(780, 550);
  h.draw();
  await Promise.resolve();
  h.advance(5000);
  assert.equal(h.commands.length, 0, "no time-only fallback near the deck");
  h.pointer(300, 300);
  h.advance(500);
  h.pointer(780, 550);
  h.pointer(300, 300);
  h.advance(500);
  assert.equal(h.commands.length, 0, "returning to the deck restarts the away interval");
  h.fire("pointerdown");
  h.advance(1000);
  assert.equal(h.commands.length, 0);
  h.fire("pointerup");
  h.advance(999);
  assert.equal(h.commands.length, 0);
  h.advance(1);
  assert.equal(h.commands.length, 1);
});

test("delayed draws work on either turn and wait for the site's action queue", async () => {
  const h = harness(false);
  h.settings.autoShuffleAfterDraw = true;
  h.page.turn_player = h.opponent;
  h.page.currentPhase = "M1";
  h.pointer(300, 300);
  h.draw();
  await Promise.resolve();
  h.page.stopQueue = true;
  h.advance(3000);
  assert.equal(h.commands.length, 0);
  h.page.stopQueue = false;
  h.page.actionsQueue.push(() => {});
  h.advance(500);
  assert.equal(h.commands.length, 0);
  h.page.actionsQueue = [];
  h.advance(500);
  assert.equal(h.commands.length, 1);
});

test("delayed shuffles require known deck geometry and pointer position", async () => {
  for (const change of [
    () => {},
    h => { h.pointer(300, 300); h.self.main_arr = []; }
  ]) {
    const h = harness(false);
    h.settings.autoShuffleAfterDraw = true;
    change(h);
    h.draw();
    await Promise.resolve();
    h.advance(10000);
    assert.equal(h.commands.length, 0);
  }
});

test("draw menu bounds remain protected after it closes", async () => {
  const h = harness(false);
  h.settings.autoShuffleAfterDraw = true;
  h.document.getElementById = () => ({ getBoundingClientRect: () =>
    ({ left: 400, right: 550, top: 200, bottom: 400, width: 150, height: 200 }) });
  h.pointer(450, 300);
  h.draw();
  await Promise.resolve();
  h.document.getElementById = () => null;
  h.advance(4000);
  assert.equal(h.commands.length, 0);
  h.pointer(100, 100);
  h.advance(1000);
  assert.equal(h.commands.length, 1);
});

test("stale batches cancel on hand edits, lifecycle changes, inactivity or leaving the tab", async () => {
  for (const change of [
    h => { h.settings.autoShuffleAfterDraw = false; },
    h => { h.self.hand_arr.reverse(); },
    h => { h.self.hand_arr.pop(); },
    h => { h.page.turnCount++; },
    h => { h.page.currentPhase = "SP"; },
    h => { h.page.duelId++; },
    h => { h.page.viewing = "Deck"; },
    h => { h.page.paused = true; },
    h => { h.page.replay = true; },
    h => { h.page.duelist = false; },
    h => { h.page.resetGame(h.self, { play: "Reset game" }); },
    h => { h.page.initUserDuelStart(); },
    h => { h.document.hidden = true; h.fire("visibilitychange"); },
    h => { h.fire("blur"); },
    h => { h.fire("pointerout", { relatedTarget: null }); },
    h => { h.feature.settingsChanged(); },
    h => { h.advance(20001); }
  ]) {
    const h = harness(false);
    h.settings.autoShuffleAfterDraw = true;
    h.pointer(300, 300);
    h.draw();
    await Promise.resolve();
    change(h);
    h.advance(4000);
    assert.equal(h.commands.length, 0);
  }
});

test("receipt of another draw cancels the old batch before queued execution", async () => {
  const h = harness(false);
  h.settings.autoShuffleAfterDraw = true;
  h.pointer(300, 300);
  h.draw();
  await Promise.resolve();
  // A draw acknowledgement may wait behind an earlier animation. Its receipt
  // must stop the old timer even before drawCard runs and resets the delay.
  h.page.duelResponse = message => h.page.duelResponse2(h.self, message);
  h.page.DBEnhancerDuelEvents.install();
  h.page.duelResponse({ play: "Draw card", username: h.self.username });
  h.advance(4000);
  assert.equal(h.commands.length, 0);
});

test("aggressiveness controls delay and pointer clearance, with a faster default", async () => {
  assert.equal(core.createDefaultSettings().handShuffleAggressiveness, 80);
  assert.deepEqual(core.handShuffleTiming(80), { idleMs: 1000, awayMs: 320, distance: 44 });
  assert.equal(core.sanitizeSettings({ handShuffleAggressiveness: -5 }).handShuffleAggressiveness, 0);
  assert.equal(core.sanitizeSettings({ handShuffleAggressiveness: 105 }).handShuffleAggressiveness, 100);
  assert.equal(core.sanitizeSettings({ handShuffleAggressiveness: "100" }).handShuffleAggressiveness, 80);
  for (const [level, delay, clearance] of [[0, 3000, 100], [80, 1000, 44], [100, 500, 30]]) {
    const h = harness(false);
    h.settings.autoShuffleAfterDraw = true;
    h.settings.handShuffleAggressiveness = level;
    h.pointer(760 + clearance, 550);
    h.draw();
    await Promise.resolve();
    h.advance(delay - 1);
    assert.equal(h.commands.length, 0);
    h.advance(1);
    assert.equal(h.commands.length, 1, `level ${level} honors its delay and clearance`);
  }
});

test("manual native shuffle cancels delayed shuffle immediately without a server echo", async () => {
  const h = harness(false);
  h.settings.autoShuffleAfterDraw = true;
  // This native handler was defined before the outgoing hook, like the site's
  // button binding; the cancellation must still observe its outgoing command.
  const boundNativeHandler = h.page.shuffleHandE;
  h.pointer(300, 300);
  h.draw();
  await Promise.resolve();
  h.advance(2500);
  const hand = h.self.hand_arr.slice();
  boundNativeHandler();
  assert.equal(h.commands.length, 1);
  assert.deepEqual(h.self.hand_arr, hand, "do not rely on an observed hand reorder");
  h.advance(5000);
  assert.equal(h.commands.length, 1, "no second shuffle after the manual command");
  h.draw();
  await Promise.resolve();
  h.advance(3000);
  assert.equal(h.commands.length, 2, "a later draw may start a fresh batch");
});

test("manual shuffle cancels a draw whose native handler has not returned yet", async () => {
  for (const delayed of [false, true]) {
    const h = harness();
    h.settings.autoShuffleAfterDraw = delayed;
    h.pointer(300, 300);
    h.draw();
    h.page.shuffleHandE();
    await Promise.resolve();
    h.advance(5000);
    assert.equal(h.commands.length, 1, "only the manual shuffle is sent");
  }
});

test("outgoing shuffle hook recovers after native Send replacement and preserves calls", async () => {
  const h = harness(false);
  h.settings.autoShuffleAfterDraw = true;
  const receiver = {};
  let call;
  h.page.Send = function(...args) { call = { receiver: this, args }; return 42; };
  h.feature.tick();
  const hook = h.page.Send;
  h.feature.tick();
  assert.equal(h.page.Send, hook, "health checks do not stack wrappers");
  const message = { action: "Duel", play: "Thinking" };
  assert.equal(h.page.Send.call(receiver, message, "extra"), 42);
  assert.equal(call.receiver, receiver);
  assert.deepEqual(call.args, [message, "extra"]);
  h.pointer(300, 300);
  h.draw();
  await Promise.resolve();
  h.page.shuffleHandE();
  const manualCall = call;
  h.advance(5000);
  assert.equal(call, manualCall, "manual shuffle still cancels after Send replacement");
});
