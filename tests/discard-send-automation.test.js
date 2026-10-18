"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const core = require("../extension/shared/enhancer-core.js");
const { create } = require("../extension/shared/card-automation.js");
const { createRuntime } = require("../extension/page/duel-events.js");

function definition() {
  return { schemaVersion: 4, id: "test.discard", name: "Example list", version: "1.0.0", formats: ["eu", "so"], enabled: true,
    rules: [{ id: "discard-send", card: { passcode: "09000001", name: "Example Sender" }, label: "Discard and send",
      action: core.discardSendAction({ attribute: "DARK" }) }] };
}
function harness() {
  const self = { username: "Self", main_arr: [], hand_arr: [], grave_arr: [], banished_arr: [] };
  const opponent = { username: "Opponent" }, cards = [];
  self.opponent = opponent; opponent.opponent = self;
  function card(instance, name, attribute = "DARK", type = "Monster") {
    const front = { id: 90000000 + instance, serial_number: "0900000" + instance, name, attribute, card_type: type };
    const values = { id: instance, cardfront: { data: key => front[key] }, owner: self, controller: self, face_down: false };
    const item = { front, data(key, value) { if (arguments.length === 2) values[key] = value; return values[key]; } };
    cards.push(item); return item;
  }
  const source = self.m1 = card(1, "Example Sender"), cost = card(2, "Example Cost"), target = card(3, "Example Target");
  const wrong = card(4, "Example LIGHT", "LIGHT"), spell = card(5, "Example DARK Spell", "DARK", "Spell");
  self.hand_arr = [cost, wrong, spell]; self.main_arr = [wrong, target];
  const settings = { automationLists: [definition()], automationConfirmSelections: false }, commands = [];
  let clock = 0, lock = true;
  const page = { username: "Self", player1: self, player2: opponent, duelId: 9, duelist: true, duelFormat: "eu",
    currentLabel: "duel_start", currentPhase: "M1", turnCount: 1, turn_player: self, actionsQueue: [], stopQueue: false,
    viewing: "", document: { hidden: false }, websocket: { readyState: 1 }, console,
    navigator: { locks: { request(_key, _options, callback) { return Promise.resolve(callback(lock ? {} : null)); } } },
    viewingE(value) { page.viewing = value; }, exitViewing() { page.Send({ action: "Duel", play: "Stop viewing", viewing: page.viewing }); page.viewing = ""; },
    Send(message) { runtime.outgoing(message); commands.push(message); },
    duelResponse(message) { page.duelResponse2(message.username === "Self" ? self : opponent, message); },
    duelResponse2(_player, message) { page.actionsQueue.push(() => {
      const item = cards.find(item => item.data("id") === message.id);
      if (item && (message.play === "To GY" || message.play.startsWith("To grave from") || /^Banish(?: from (hand|deck))?$/.test(message.play))) {
        self.hand_arr = self.hand_arr.filter(card => card !== item); self.main_arr = self.main_arr.filter(card => card !== item);
        for (let i = 1; i <= 5; i++) if (self["m" + i] === item) self["m" + i] = null;
        self[message.play.startsWith("Banish") ? "banished_arr" : "grave_arr"].push(item);
      }
      if (message.play === "View deck") page.viewing = "Deck";
      page.actionsQueue.shift(); page.stopQueue = false;
    }); }
  };
  const runtime = create({ page, getSettings: () => settings, now: () => clock });
  const events = createRuntime(page);
  events.register({ id: "receive", includeNonLive: true, when: { stage: "receive" }, run: runtime.observe });
  events.register({ id: "execute", includeNonLive: true, run: runtime.observe }); events.install();
  function flush() { while (page.actionsQueue.length) { page.stopQueue = true; page.actionsQueue[0](); } }
  function echo(play, extra = {}, defer = false) { page.duelResponse({ action: "Duel", play, username: "Self", ...extra }); if (!defer) flush(); }
  function ack(defer = false) { const command = commands.at(-1); echo(command.play, { id: command.card,
    ...(command.play === "View deck" ? { deck: self.main_arr.map(item => item.front) } : {}) }, defer); }
  function activate(mode = "wait") {
    assert.equal(runtime.prepare(source, { mode }), true); runtime.begin("activate");
    runtime.selectCard("2"); runtime.confirmCards(); ack(); runtime.tick(); ack(); runtime.tick();
  }
  function openDeck() { runtime.release(); ack(); runtime.tick(); assert.equal(runtime.snapshot().state, "select-send"); }
  return { runtime, page, self, opponent, source, cost, target, wrong, spell, settings, commands, echo, ack, flush, card, activate, openDeck,
    advance(ms) { clock += ms; }, denyLock() { lock = false; } };
}

test("discard/send operations validate their operands, per-copy coverage and stage separation", () => {
  const value = definition(); assert.deepEqual(core.importAutomationList(core.exportAutomationList(value)).rules, value.rules);
  for (const mutate of [action => action.filters.monsters.attribute = "unknown", action => action.activation.costs[0].reason = "effect",
    action => action.resolution[0].from = "hand",
    action => action.activation.targets.push({ card: "source" }), action => action.coverage.manual.splice(action.coverage.manual.indexOf("once-per-turn"), 1)]) {
    const action = core.discardSendAction({ attribute: "DARK" }); mutate(action); assert.throws(() => core.validateAutomationAction(action));
  }
});

test("activation enforces own Main Phase, face-up control, hand attribute/type and nonempty Deck", () => {
  for (const mutate of [h => h.page.turn_player = h.opponent, h => h.page.currentPhase = "BP", h => h.source.data("face_down", true),
    h => h.source.data("controller", h.opponent), h => h.self.hand_arr = [h.wrong, h.spell], h => h.self.main_arr = [],
    h => h.settings.automationLists[0].enabled = false, h => h.page.duelFormat = "au", h => h.page.automatic = true]) {
    const h = harness(); mutate(h); assert.equal(h.runtime.eligible(h.source), false); assert.equal(h.commands.length, 0);
  }
  const h = harness(); for (let i = 2; i <= 5; i++) h.self["m" + i] = h.card(i + 10, "Occupied");
  assert.equal(h.runtime.eligible(h.source), true, "sending requires no free monster zone");
  h.runtime.prepare(h.source); h.runtime.begin("activate");
  assert.deepEqual(h.runtime.snapshot().choices.map(choice => choice.label), ["Example Cost"]);
  h.runtime.selectCard("2"); assert.equal(h.commands.length, 0, "costs always require explicit confirmation");
  h.self.hand_arr = []; h.runtime.confirmCards(); assert.equal(h.commands.length, 0);
});

test("discard receipt and execution precede response wait; Deck selection happens only at resolution", () => {
  const h = harness(); h.runtime.prepare(h.source); h.runtime.begin("activate"); h.runtime.selectCard("2"); h.runtime.confirmCards();
  assert.deepEqual(h.commands, [{ action: "Duel", play: "Declare", card: 1 }]);
  h.ack(true); h.runtime.tick(); assert.equal(h.commands.length, 1);
  h.flush(); h.runtime.tick(); assert.deepEqual(h.commands.at(-1), { action: "Duel", play: "To GY", card: 2 });
  h.ack(true); h.runtime.tick(); assert.equal(h.runtime.snapshot().costPaid, false);
  h.flush(); h.runtime.tick(); assert.equal(h.runtime.snapshot().state, "waiting"); assert.equal(h.runtime.snapshot().costPaid, true);
  assert.equal(h.commands.some(message => message.play === "View deck"), false);
  h.openDeck(); assert.deepEqual(h.runtime.snapshot().choices.map(choice => choice.label), ["Example Target"]);
  h.runtime.selectCard("1"); h.runtime.confirmCards(); assert.deepEqual(h.commands.at(-1), { action: "Duel", play: "To GY", card: 3 });
  h.echo("To grave from deck", { id: 3 }, true); h.runtime.tick(); assert.equal(h.commands.at(-1).play, "To GY");
  h.flush(); h.runtime.tick(); assert.equal(h.commands.at(-1).play, "Stop viewing");
  h.ack(); h.runtime.tick(); assert.equal(h.runtime.snapshot().finished, undefined);
  h.echo("Shuffle deck"); h.runtime.tick(); assert.equal(h.runtime.snapshot().state, "completed");
  assert.equal(h.commands.some(message => ["Target", "Shuffle deck", "SS ATK", "SS DEF", "Duel message"].includes(message.play)), false);
});

test("discard/send has no replacement prompt without a public redirect effect", () => {
  const h = harness(); h.runtime.prepare(h.source); h.runtime.begin("activate");
  assert.equal(h.runtime.snapshot().options.some(option => option.key === "banished"), false);
  h.runtime.selectCard("2"); h.runtime.confirmCards(); h.ack(); h.runtime.tick();
  assert.equal(h.commands.at(-1).play, "To GY");
  h.ack(); h.runtime.tick(); h.openDeck();
  assert.equal(h.runtime.snapshot().options.some(option => option.key === "banished"), false);
  h.runtime.selectCard("1"); h.runtime.confirmCards();
  assert.equal(h.commands.at(-1).play, "To GY");
});

test("a public graveyard redirect prompts separately for the cost and Deck movement", () => {
  const h = harness(); h.opponent.s1 = h.card(10, "Macro Cosmos", "", "Trap");
  h.runtime.prepare(h.source); h.runtime.begin("activate"); h.runtime.selectCard("2"); h.runtime.confirmCards();
  assert.equal(h.runtime.snapshot().state, "replacement-choice");
  assert.deepEqual(h.runtime.snapshot().replacementEffects, ["Macro Cosmos"]);
  assert.equal(h.commands.length, 0);
  h.runtime.begin("banished"); assert.equal(h.commands.at(-1).play, "Declare"); h.ack(); h.runtime.tick();
  assert.equal(h.commands.at(-1).play, "Banish"); h.ack(); h.runtime.tick(); h.openDeck();
  h.runtime.selectCard("1"); h.runtime.confirmCards();
  assert.equal(h.runtime.snapshot().state, "replacement-choice");
  h.runtime.begin("graveyard"); assert.equal(h.commands.at(-1).play, "To GY");
});

test("the public redirect registry covers Fissure and Banisher effects but ignores face-down cards", () => {
  for (const redirect of ["Dimensional Fissure", "Banisher of the Light", "Banisher of the Radiance"]) {
    const h = harness(); h.opponent.s1 = h.card(10, redirect, "", redirect.startsWith("Banisher") ? "Monster" : "Spell");
    h.runtime.prepare(h.source); h.runtime.begin("activate"); h.runtime.selectCard("2"); h.runtime.confirmCards();
    assert.equal(h.runtime.snapshot().state, "replacement-choice", redirect);
    h.runtime.cancel();
  }
  const h = harness(); h.opponent.s1 = h.card(10, "Macro Cosmos", "", "Trap"); h.opponent.s1.data("face_down", true);
  h.runtime.prepare(h.source); h.runtime.begin("activate"); h.runtime.selectCard("2"); h.runtime.confirmCards();
  assert.equal(h.runtime.snapshot().state, "declaring");
});

test("a public banish prohibition suppresses an otherwise applicable redirect prompt", () => {
  const h = harness(); h.opponent.s1 = h.card(10, "Macro Cosmos", "", "Trap");
  h.self.s1 = h.card(11, "Imperial Iron Wall", "", "Trap");
  h.runtime.prepare(h.source); h.runtime.begin("activate"); h.runtime.selectCard("2"); h.runtime.confirmCards();
  assert.equal(h.runtime.snapshot().state, "declaring");
});

test("opponent responses suspend paid effects; fresh received and executed approval permits resolution", () => {
  const h = harness(); h.activate();
  h.echo("Declare", { username: "Opponent", id: 20 }); assert.equal(h.runtime.snapshot().state, "suspended");
  h.echo("Good", { username: "Opponent", seconds: 1 }); h.runtime.tick(); assert.equal(h.commands.length, 2);
  h.runtime.release(true); h.echo("Good", { username: "Opponent", seconds: 2 }, true); h.runtime.tick();
  assert.equal(h.commands.length, 2); h.flush(); h.runtime.tick(); assert.equal(h.commands.at(-1).play, "View deck");
});

test("opponent Thinking during declaration pauses quick resolution after cost payment", () => {
  const h = harness(); h.runtime.prepare(h.source, { mode: "resolve" }); h.runtime.begin("activate"); h.runtime.selectCard("2"); h.runtime.confirmCards();
  h.echo("Thinking", { username: "Opponent" }); h.ack(); h.runtime.tick(); h.ack(); h.runtime.tick();
  assert.equal(h.runtime.snapshot().state, "suspended"); assert.equal(h.runtime.snapshot().costPaid, true);
  assert.equal(h.commands.some(command => command.play === "View deck"), false);
});

test("source departure after paying does not cancel resolution; source departure before paying stops", () => {
  const h = harness(); h.activate(); h.echo("To grave from field", { id: 1 }); h.runtime.release(); h.ack(); h.runtime.tick();
  assert.equal(h.runtime.snapshot().state, "select-send");
  const early = harness(); early.runtime.prepare(early.source); early.runtime.begin("activate"); early.runtime.selectCard("2"); early.runtime.confirmCards();
  early.ack(); early.self.m1 = null; early.runtime.tick(); assert.equal(early.commands.length, 1); assert.equal(early.runtime.snapshot().finished, true);
});

test("per-copy usage prevents repeat activation, leaves other copies available and resets next turn", () => {
  const h = harness(); h.activate(); h.runtime.cancel();
  assert.equal(h.runtime.eligible(h.source), false); assert.ok(h.self.grave_arr.includes(h.cost));
  h.self.hand_arr.push(h.card(6, "Another cost"));
  const second = h.self.m2 = h.card(7, "Example Sender"); second.front.serial_number = "09000001";
  assert.equal(h.runtime.eligible(second), true);
  h.page.turnCount++; assert.equal(h.runtime.eligible(h.source), true);
});

test("changed Deck and empty matches never send a cached or unrelated monster", () => {
  const h = harness(); h.activate(); h.openDeck(); h.self.main_arr.reverse(); h.runtime.selectCard("1"); h.runtime.confirmCards();
  assert.equal(h.runtime.snapshot().finished, true); assert.equal(h.commands.filter(command => command.play === "To GY").length, 1);
  const none = harness(); none.activate(); none.target.front.attribute = "LIGHT"; none.runtime.release(); none.ack(); none.runtime.tick();
  assert.equal(none.commands.at(-1).play, "Stop viewing"); none.ack(); none.echo("Shuffle deck"); none.runtime.tick();
  assert.equal(none.runtime.snapshot().state, "completed"); assert.match(none.runtime.snapshot().message, /No matching/);
});

test("locks, hidden tabs, timeout, manual commands and list edits stop without retries", () => {
  const locked = harness(); locked.denyLock(); locked.runtime.prepare(locked.source); assert.equal(locked.runtime.snapshot().finished, true);
  for (const change of [h => h.page.document.hidden = true, h => h.advance(15001), h => h.settings.automationLists[0].version = "1.0.1",
    h => h.page.Send({ action: "Duel", play: "To GY", card: 4 })]) {
    const h = harness(); h.activate(); h.openDeck(); h.runtime.selectCard("1"); h.runtime.confirmCards(); change(h);
    h.runtime.tick(); assert.equal(h.runtime.snapshot().finished, true); const count = h.commands.length;
    h.runtime.tick(); assert.equal(h.commands.length, count);
  }
});
