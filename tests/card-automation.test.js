"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const core = require("../enhancer-core.js");
const { create } = require("../card-automation.js");
const { createRuntime } = require("../duel-events.js");
const createFeature = require("../features/card-automation.js");
const CARD = "Example Recruiter";
function exampleList() {
  return { schemaVersion: 3, id: "test.example", name: "Example list", version: "1.0.0", enabled: true,
    formats: ["ar", "au"], rules: [{ id: "example-recruit", card: { passcode: "09000001", name: CARD }, label: "Example summon effect",
      requires: { sourceZone: "graveyard", ownTurn: true, phases: ["M1", "M2"] },
      activation: [{ op: "banish", card: "source" }],
      resolution: [{ op: "special-summon", from: "deck", card: { passcode: "09000001", name: CARD }, positions: ["ATK", "DEF"] }] }] };
}

function card(instanceId, cardName = CARD, databaseId = cardName === CARD ? 90000001 : 90000002) {
  const data = { id: instanceId, face_down: false,
    cardfront: { data: key => ({ id: databaseId, serial_number: databaseId - 81000000, name: cardName, card_type: "Monster" })[key] } };
  return { data(key, value) { if (arguments.length > 1) data[key] = value; return data[key]; } };
}
function harness() {
  const source = card(1), target = card(2), other = card(3, "Other monster");
  const self = { username: "Self", grave_arr: [source], banished_arr: [], main_arr: [other, target] };
  const opponent = { username: "Opponent", opponent: self };
  self.opponent = opponent;
  for (const item of [source, target, other]) { item.data("owner", self); item.data("controller", self); }
  const settings = core.createDefaultSettings();
  settings.automationLists = [exampleList()];
  const commands = [];
  let clock = 0, lockAvailable = true, unlocks = 0;
  const page = { username: "Self", player1: self, player2: opponent, duelId: 123, duelist: true,
    duelFormat: "au", currentLabel: "duel_start", currentPhase: "M1", turnCount: 1,
    turn_player: self, actionsQueue: [], stopQueue: false, viewing: "Graveyard", console,
    document: { hidden: false }, websocket: { readyState: 1 },
    navigator: { locks: { request(_key, _options, callback) {
      return Promise.resolve(callback(lockAvailable ? {} : null)).then(() => { unlocks++; });
    } } },
    getDuelCard: instance => [source, target, other].find(item => item.data("id") === instance),
    viewingE(view) { page.viewing = view; },
    exitViewing() { page.Send({ action: "Duel", play: "Stop viewing", viewing: page.viewing }); page.viewing = ""; },
    Send(message) { runtime.outgoing(message); commands.push(message); },
    duelResponse(message) { page.duelResponse2(message.username === self.username ? self : opponent, message); },
    duelResponse2(player, message) {
      page.actionsQueue.push(() => {
        if (message.play === "Banish") { self.grave_arr = []; self.banished_arr.push(source); }
        if (message.play === "To GY" && message.id === target.data("id")) {
          self.main_arr = self.main_arr.filter(item => item !== target);
          self.grave_arr.push(target);
        }
        if (/^SS (ATK|DEF)$/.test(message.play)) {
          self.main_arr = self.main_arr.filter(item => item !== target);
          self.m1 = target;
          target.data(message.play === "SS ATK" ? "inATK" : "inDEF", true);
        }
        page.actionsQueue.shift();
        page.stopQueue = false;
      });
    }
  };
  const runtime = create({ page, getSettings: () => settings, now: () => clock });
  page.DBEnhancerDuelEvents = createRuntime(page);
  page.DBEnhancerDuelEvents.register({ id: "receive", includeNonLive: true, when: { stage: "receive" }, run: runtime.observe });
  page.DBEnhancerDuelEvents.register({ id: "execute", includeNonLive: true, run: runtime.observe });
  page.DBEnhancerDuelEvents.install();
  function flush() {
    while (page.actionsQueue.length) { page.stopQueue = true; page.actionsQueue[0](); }
  }
  function echo(play, extra = {}, defer = false) {
    page.duelResponse({ action: "Duel", play, username: "Self", ...extra });
    if (!defer) flush();
  }
  function prepared(position = "DEF") {
    assert.equal(runtime.prepare(source), true);
    assert.equal(runtime.snapshot().state, "choose");
    runtime.choose(position);
    runtime.activate();
    echo("Declare", { id: 1 });
    runtime.tick();
    echo("Banish", { id: 1 });
    runtime.tick();
    assert.equal(runtime.snapshot().state, "ready");
  }
  function resolveToSummon() {
    runtime.release();
    echo("Stop viewing"); runtime.tick();
    assert.equal(commands.at(-1).play, "View deck");
    echo("View deck", { viewing: "Deck", deck: [{ id: 90000002, serial_number: "09000002", name: "Other monster", card_type: "Monster" }, { id: 90000001, serial_number: 9000001, name: CARD, card_type: "Monster" }] });
    runtime.tick();
  }
  return { runtime, page, settings, source, target, self, opponent, commands, prepared, resolveToSummon, echo, flush,
    advance: ms => { clock += ms; }, lock: value => { lockAvailable = value; }, unlocks: () => unlocks };
}

test("extension bundles no lists; imported definitions persist scope without exporting enablement", () => {
  const defaults = core.createDefaultSettings();
  assert.deepEqual(defaults.automationLists, []);
  const fixture = exampleList();
  const exported = core.exportAutomationList(fixture);
  assert.deepEqual(JSON.parse(exported).rules, fixture.rules);
  assert.equal(JSON.parse(exported).enabled, undefined);
  const imported = core.importAutomationList(exported);
  assert.equal(imported.enabled, false);
  assert.deepEqual(core.sanitizeSettings({ automationLists: [imported] }).automationLists, [imported]);
  assert.deepEqual(core.sanitizeSettings({ automationLists: [] }).automationLists, []);
  for (const patch of [{ formats: ["unknown"] }, { rules: [{ id: "evil", procedure: "eval" }] },
    { rules: [{ ...fixture.rules[0], script: "anything" }] }, { schemaVersion: 1 }]) {
    assert.throws(() => core.importAutomationList(JSON.stringify({ ...fixture, ...patch })));
  }
  assert.throws(() => core.importAutomationList(" ".repeat(65537)));
  assert.throws(() => core.importAutomationList('{"__proto__":{},"schemaVersion":1}'));
});

test("only a matching local graveyard card in selected formats and a free zone is eligible", () => {
  const h = harness();
  for (const format of ["ar", "au"]) { h.page.duelFormat = format; assert.equal(h.runtime.eligible(h.source), true); }
  for (const format of ["eu", "gu", "so"]) { h.page.duelFormat = format; assert.equal(h.runtime.eligible(h.source), false); }
  h.page.duelFormat = "au";
  assert.equal(h.runtime.eligible(h.target), false);
  h.settings.automationLists.push({ ...exampleList(), id: "other" });
  assert.equal(h.runtime.eligible(h.source), false, "overlapping lists never execute twice");
  h.settings.automationLists.pop();
  for (let index = 1; index <= 5; index++) h.self["m" + index] = card(10 + index);
  assert.equal(h.runtime.eligible(h.source), false);
  h.self.m1 = null;
  h.page.turn_player = h.opponent;
  assert.equal(h.runtime.eligible(h.source), false);
});

function historicalRule(h) {
  const rule = h.settings.automationLists[0].rules[0];
  rule.requires.absentFaceUpCards = [{ passcode: "09000004", name: "Example Prohibition" }];
  rule.resolution[0].onNoMonsterZone = "destroy-to-graveyard";
  return rule;
}

test("optional historical fields validate strictly and roundtrip with prerequisite selectors", () => {
  const h = harness(); historicalRule(h);
  const fixture = h.settings.automationLists[0];
  assert.deepEqual(core.importAutomationList(core.exportAutomationList(fixture)).rules, fixture.rules);
  for (const invalid of [[], "anything", [{ name: "No identifier" }], Array(11).fill({ passcode: "09000004", name: "Example Prohibition" })]) {
    const copy = structuredClone(fixture); copy.rules[0].requires.absentFaceUpCards = invalid;
    assert.throws(() => core.validateAutomationList(copy));
  }
  for (const invalid of [null, "send-to-graveyard", { script: "anything" }]) {
    const copy = structuredClone(fixture); copy.rules[0].resolution[0].onNoMonsterZone = invalid;
    assert.throws(() => core.validateAutomationList(copy));
  }
});

test("generic face-up card prerequisite checks either player's field before declaration and cost", () => {
  for (const opponent of [false, true]) {
    const h = harness(); historicalRule(h);
    const prohibition = card(8, "Example Prohibition", 90000004);
    const player = opponent ? h.opponent : h.self;
    player.fieldSpell = prohibition;
    assert.equal(h.runtime.eligible(h.source), false);
    assert.equal(h.runtime.prepare(h.source), false);
    assert.match(h.runtime.snapshot().message, /Example Prohibition/);
    assert.deepEqual(h.commands, []);
    prohibition.data("face_down", true);
    assert.equal(h.runtime.eligible(h.source), true, "set cards do not apply the prohibition");
  }
  const h = harness(); historicalRule(h);
  h.runtime.prepare(h.source); h.runtime.choose("ATK"); h.runtime.activate();
  h.opponent.fieldSpell = card(8, "Example Prohibition", 90000004);
  h.echo("Declare", { id: 1 }); h.runtime.tick();
  assert.equal(h.runtime.snapshot().state, "stopped");
  assert.equal(h.commands.some(command => command.play === "Banish"), false, "recheck before cost");
});

test("historical overflow destroys a fresh Deck match, acknowledges To GY, then closes and shuffles", () => {
  const h = harness(); historicalRule(h); h.prepared();
  for (let i = 1; i <= 5; i++) h.self["m" + i] = card(20 + i);
  h.runtime.release(); h.echo("Stop viewing"); h.runtime.tick();
  assert.equal(h.commands.at(-1).play, "View deck");
  h.echo("View deck", { deck: [
    { serial_number: "09000002", name: "Other monster", card_type: "Monster" },
    { serial_number: "09000001", name: CARD, card_type: "Monster" }
  ] }); h.runtime.tick();
  assert.deepEqual(h.commands.at(-1), { action: "Duel", play: "To GY", card: 2 });
  h.runtime.tick();
  assert.equal(h.commands.at(-1).play, "To GY", "no early close or repeated movement");
  h.echo("To GY", { id: 2 }, true); h.runtime.tick();
  assert.equal(h.commands.at(-1).play, "To GY", "wait for native execution");
  h.flush(); h.runtime.tick();
  assert.equal(h.commands.at(-1).play, "Stop viewing");
  h.echo("Stop viewing"); h.runtime.tick();
  assert.equal(h.runtime.snapshot().state, "close-deck");
  h.echo("Shuffle deck"); h.runtime.tick();
  assert.equal(h.runtime.snapshot().state, "completed");
  assert.match(h.runtime.snapshot().message, /destroyed/);
  assert.ok(h.runtime.snapshot().journal.some(entry => /Destroyed.*Deck/.test(entry)));
  assert.equal(h.commands.some(command => command.play.startsWith("SS ")), false);
  assert.equal(h.commands.filter(command => command.play === "To GY").length, 1);
});

test("overflow policy cannot make activation legal with full zones or bypass a missing Deck match", () => {
  const h = harness(); historicalRule(h);
  for (let i = 1; i <= 5; i++) h.self["m" + i] = card(20 + i);
  assert.equal(h.runtime.eligible(h.source), false);
  assert.equal(h.runtime.prepare(h.source), false);
  assert.deepEqual(h.commands, []);
  const other = harness(); historicalRule(other); other.prepared();
  for (let i = 1; i <= 5; i++) other.self["m" + i] = card(20 + i);
  other.runtime.release(); other.echo("Stop viewing"); other.runtime.tick();
  other.echo("View deck", { deck: [{ name: "Wrong" }, { serial_number: "09000002", name: CARD, card_type: "Monster" }] });
  other.runtime.tick();
  assert.equal(other.runtime.snapshot().state, "stopped");
  assert.equal(other.commands.some(command => command.play === "To GY"), false);
});

test("historical policy still summons normally when a zone is free; legacy rules stop on overflow", () => {
  const h = harness(); historicalRule(h); h.prepared(); h.resolveToSummon();
  assert.equal(h.commands.at(-1).play, "SS DEF");
  const legacy = harness(); legacy.prepared();
  for (let i = 1; i <= 5; i++) legacy.self["m" + i] = card(20 + i);
  legacy.runtime.release();
  assert.equal(legacy.runtime.snapshot().state, "stopped");
  assert.equal(legacy.commands.some(command => command.play === "View deck"), false);
});

test("selectors require passcodes or database IDs, reject legacy rules and inconsistent names", () => {
  for (const id of [undefined, 0, -1, "90000001", 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    const list = exampleList(); list.rules[0].card = { id, name: CARD };
    assert.throws(() => core.validateAutomationList(list), /eight-digit passcode/);
  }
  const legacy = exampleList(); legacy.schemaVersion = 2;
  assert.throws(() => core.validateAutomationList(legacy), /schema 3/);
  assert.deepEqual(core.sanitizeSettings({ automationLists: [legacy] }).automationLists, []);
  const conflicting = exampleList(); conflicting.rules[0].resolution[0].card.name = "Wrong name";
  assert.throws(() => core.validateAutomationList(conflicting), /belongs to/);
});

test("passcodes preserve leading zeros and reject numeric, malformed or ambiguous selectors", () => {
  for (const passcode of [undefined, null, 9000001, "9000001", "009000001", "00000000", "09abc001", " 09000001"]) {
    const list = exampleList(); list.rules[0].card.passcode = passcode;
    assert.throws(() => core.validateAutomationList(list), /eight-digit passcode/);
  }
  const ambiguous = exampleList(); ambiguous.rules[0].card.id = 90000001;
  assert.throws(() => core.validateAutomationList(ambiguous));
  assert.equal(core.importAutomationList(core.exportAutomationList(exampleList())).rules[0].card.passcode, "09000001");
});

test("passcode matching tolerates numeric native data and different database IDs; commands keep instance IDs", () => {
  const h = harness();
  h.source.data("cardfront", { data: key => ({ id: 111, passcode: 9000001, name: CARD })[key] });
  h.target.data("cardfront", { data: key => ({ id: 222, serial_number: "09000001", name: CARD, card_type: "Monster" })[key] });
  h.prepared(); h.resolveToSummon();
  assert.deepEqual(h.commands.at(-1), { action: "Duel", play: "SS DEF", card: 2, zone: "M-1" });
  h.echo("SS DEF", { id: 2 }); h.runtime.tick();
  assert.equal(h.commands.at(-1).play, "Stop viewing");
});

test("database ID selectors remain available for cards without passcodes", () => {
  const h = harness();
  h.settings.automationLists[0].rules[0].card = { id: 90000001, name: CARD };
  h.settings.automationLists[0].rules[0].resolution[0].card = { id: 90000001, name: CARD };
  for (const card of [h.source, h.target]) card.data("cardfront", { data: key => ({ id: 90000001, name: CARD })[key] });
  h.prepared(); h.resolveToSummon();
  assert.deepEqual(h.commands.at(-1), { action: "Duel", play: "SS DEF", card: 2, zone: "M-1" });
});

test("same name with a different passcode cannot activate automation", () => {
  const h = harness();
  h.source.data("cardfront", { data: key => ({ id: 90000002, serial_number: "09000002", name: CARD })[key] });
  assert.equal(h.runtime.available(h.source), false);
  assert.equal(h.runtime.prepare(h.source), false);
  assert.deepEqual(h.commands, []);
});

test("known source and catalog name mismatches block activation before paying cost", () => {
  const h = harness();
  h.settings.automationLists[0].rules[0].card.name = "Wrong name";
  assert.equal(h.runtime.available(h.source), true);
  assert.equal(h.runtime.eligible(h.source), false);
  assert.equal(h.runtime.prepare(h.source), false);
  assert.match(h.runtime.snapshot().message, /identifier and name/);
  assert.deepEqual(h.commands, []);

  const other = harness();
  other.page.getCardByPasscode = id => ({ id, name: "Official name" });
  assert.equal(other.runtime.prepare(other.source), false);
  assert.match(other.runtime.snapshot().message, /Official name/);
  assert.deepEqual(other.commands, []);
});

test("Deck resolution rejects same-name wrong passcodes and mismatched names for the selected passcode", () => {
  for (const target of [
    { id: 90000002, serial_number: "09000002", name: CARD, card_type: "Monster" },
    { name: CARD, card_type: "Monster" },
    { id: 90000001, serial_number: 9000001, name: "Wrong name", card_type: "Monster" }
  ]) {
    const h = harness(); h.prepared(); h.runtime.release();
    h.echo("Stop viewing"); h.runtime.tick();
    h.echo("View deck", { deck: [{ id: 90000002, serial_number: "09000002", name: "Other", card_type: "Monster" }, target] });
    h.runtime.tick();
    assert.equal(h.runtime.snapshot().state, "stopped");
    assert.equal(h.commands.some(command => command.play.startsWith("SS ")), false);
  }
});

for (const position of ["ATK", "DEF"]) test(`source card pays cost, waits for release, summons in ${position} and uses the native search shuffle`, () => {
  const h = harness();
  h.prepared(position);
  assert.deepEqual(h.commands.map(item => item.play), ["Declare", "Banish"]);
  for (let index = 0; index < 5; index++) h.runtime.tick();
  assert.equal(h.commands.length, 2, "an activation never releases itself");
  h.resolveToSummon();
  assert.deepEqual(h.commands.at(-1), { action: "Duel", play: "SS " + position, card: 2, zone: "M-1" });
  h.echo("SS " + position, { id: 2 }); h.runtime.tick();
  assert.equal(h.commands.at(-1).play, "Stop viewing");
  h.echo("Stop viewing"); h.runtime.tick();
  assert.equal(h.runtime.snapshot().state, "close-deck");
  h.echo("Shuffle deck"); h.runtime.tick();
  assert.equal(h.runtime.snapshot().state, "completed");
  assert.equal(h.commands.filter(item => item.play === "Shuffle deck").length, 0);
  assert.equal(h.commands.filter(item => item.play.startsWith("SS ")).length, 1);
});

test("queued commands need receipt, execution and an idle native queue before the next send", () => {
  const h = harness();
  h.runtime.prepare(h.source); h.runtime.choose("DEF"); h.runtime.activate(); h.runtime.activate();
  h.echo("Declare", { id: 1 }, true);
  h.runtime.tick();
  assert.equal(h.commands.length, 1);
  h.flush(); h.runtime.tick();
  assert.equal(h.commands.at(-1).play, "Banish");
  h.runtime.tick();
  assert.equal(h.commands.length, 2);
});

test("old queued thumbs-up, own thumbs-up and held state cannot release a waiting procedure", () => {
  const h = harness(); h.prepared();
  h.opponent.still_good = true;
  h.echo("Good", { username: "Opponent", long: true, seconds: 1 }, true);
  h.runtime.release(true);
  h.flush(); h.runtime.tick();
  assert.equal(h.runtime.snapshot().state, "waiting");
  h.echo("Good"); h.runtime.tick();
  assert.equal(h.runtime.snapshot().state, "waiting");
  h.echo("Good", { username: "Opponent", seconds: 2 }, true); h.runtime.tick();
  assert.equal(h.runtime.snapshot().state, "approved");
  h.flush(); h.runtime.tick();
  assert.equal(h.commands.at(-1).play, "Stop viewing");
});

test("Thinking and response actions suspend approval; cancel keeps source card banished", () => {
  for (const play of ["Thinking", "Stop good", "Activate ST"]) {
    const h = harness(); h.prepared(); h.runtime.release(true);
    h.echo(play, { username: "Opponent" }); h.runtime.tick();
    assert.equal(h.runtime.snapshot().state, "suspended", play);
    h.echo("Good", { username: "Opponent" }); h.runtime.tick();
    assert.equal(h.commands.length, 2);
    h.runtime.cancel();
    assert.equal(h.runtime.snapshot().costPaid, true);
    assert.ok(h.self.banished_arr.includes(h.source));
    assert.equal(h.commands.some(command => command.play === "To GY"), false);
  }
});

test("missing deck copy stops after cost without summoning a cached identity", () => {
  const h = harness(); h.prepared(); h.runtime.release();
  h.echo("Stop viewing"); h.runtime.tick();
  h.echo("View deck", { deck: [{ name: "Other" }, { name: "Other" }] }); h.runtime.tick();
  assert.equal(h.runtime.snapshot().state, "stopped");
  assert.equal(h.commands.some(command => command.play.startsWith("SS ")), false);
  assert.equal(h.runtime.snapshot().costPaid, true);
});

test("card names, phase requirements and summon positions are supplied by the imported rule", () => {
  const h = harness();
  const rule = h.settings.automationLists[0].rules[0];
  rule.requires.phases = ["SP"];
  rule.resolution[0].card = { passcode: "09000003", name: "Example Result" };
  rule.resolution[0].positions = ["DEF"];
  h.target.data("cardfront", { data: key => ({ id: 90000003, serial_number: "09000003", name: "Example Result", card_type: "Monster" })[key] });
  assert.equal(h.runtime.eligible(h.source), false);
  h.page.currentPhase = "SP";
  assert.equal(h.runtime.eligible(h.source), true);
  h.runtime.prepare(h.source);
  h.runtime.choose("ATK");
  assert.equal(h.runtime.snapshot().position, null, "a rule cannot accept a disallowed choice");
  h.runtime.choose("DEF"); h.runtime.activate();
  h.echo("Declare", { id: 1 }); h.runtime.tick();
  h.echo("Banish", { id: 1 }); h.runtime.tick();
  h.runtime.release(); h.echo("Stop viewing"); h.runtime.tick();
  h.echo("View deck", { deck: [{ id: 90000001, serial_number: 9000001, name: CARD, card_type: "Monster" }, { id: 90000003, serial_number: "09000003", name: "Example Result", card_type: "Monster" }] });
  h.runtime.tick();
  assert.deepEqual(h.commands.at(-1), { action: "Duel", play: "SS DEF", card: 2, zone: "M-1" });
});

test("manual interference, timeout, game/account/socket/format/settings changes stop further commands", () => {
  const changes = [h => { h.page.turnCount++; }, h => { h.page.player1 = { ...h.self }; },
    h => { h.page.username = "Other"; }, h => { h.page.websocket = { readyState: 1 }; },
    h => { h.page.duelFormat = "eu"; }, h => { h.settings.automationLists[0].enabled = false; },
    h => { h.page.document.hidden = true; }, h => { h.advance(120001); },
    h => { h.page.Send({ action: "Duel", play: "To GY", card: 3 }); }];
  for (const change of changes) {
    const h = harness(); h.prepared(); change(h); h.runtime.tick();
    const count = h.commands.length;
    h.runtime.release(); h.runtime.tick();
    assert.equal(h.runtime.snapshot().finished, true);
    assert.equal(h.commands.length, count);
  }
});

test("a denied tab lock or unavailable lock API cannot send commands", () => {
  for (const unavailable of [false, true]) {
    const h = harness();
    if (unavailable) delete h.page.navigator.locks;
    else h.lock(false);
    h.runtime.prepare(h.source); h.runtime.choose("ATK"); h.runtime.activate();
    assert.equal(h.commands.length, 0);
    assert.equal(h.runtime.snapshot().finished, true);
  }
});

test("feature adds a native card-menu item beside Declare and preserves ordinary actions", () => {
  const h = harness();
  const seen = [], clicks = [];
  h.page.DBEnhancerCardAutomation = { create: () => h.runtime };
  h.page.showMenu = (card, items) => { seen.push({ card, items }); return "native"; };
  h.page.cardMenuClicked = (...args) => clicks.push(args);
  const feature = createFeature({ window: h.page, getSettings: () => h.settings, document: { addEventListener() {} } });
  feature.tick();
  const original = [{ label: "Declare", data: "Declare" }, { label: "Banish", data: "Banish" }];
  assert.equal(h.page.showMenu(h.source, original), "native");
  assert.equal(seen[0].items[1].data, "DBX:card-automation");
  assert.equal(original.length, 2);
  h.page.cardMenuClicked(h.source, "Declare", {});
  assert.equal(clicks.length, 1);
  h.page.duelFormat = "eu";
  h.page.showMenu(h.source, original);
  assert.equal(seen[1].items[1].data, "DBX:card-automation", "discovery remains visible outside the enabled format");
  const wrapped = h.page.showMenu;
  feature.tick(); assert.equal(h.page.showMenu, wrapped);
});

test("Draw Phase keeps the menu discoverable and explains why activation is blocked", () => {
  const h = harness();
  h.page.currentPhase = "DP";
  assert.equal(h.runtime.available(h.source), true);
  assert.equal(h.runtime.eligible(h.source), false);
  assert.equal(h.runtime.prepare(h.source), false);
  assert.equal(h.runtime.snapshot().state, "unavailable");
  assert.match(h.runtime.snapshot().message, /phase M1 or M2/);
  h.runtime.choose("DEF"); h.runtime.activate();
  assert.equal(h.commands.length, 0);
  h.page.currentPhase = "M1";
  assert.equal(h.runtime.prepare(h.source), true);
  assert.equal(h.runtime.snapshot().state, "choose");
});

test("Solo and disabled-list discovery explains scope without enabling the list or sending commands", () => {
  const h = harness();
  h.page.solo = true;
  h.page.duelFormat = "so";
  assert.equal(h.runtime.available(h.source), true);
  assert.equal(h.runtime.prepare(h.source), false);
  assert.match(h.runtime.snapshot().message, /Solo Mode/);
  assert.deepEqual(h.settings.automationLists[0].formats, ["ar", "au"]);
  assert.equal(h.commands.length, 0);
  h.settings.automationLists[0].formats.push("so");
  h.settings.automationLists[0].enabled = false;
  h.runtime.prepare(h.source);
  assert.match(h.runtime.snapshot().message, /No enabled matching rules list/);
  h.settings.automationLists[0].enabled = true;
  assert.equal(h.runtime.prepare(h.source), true);
});

test("centered card panel starts from its position buttons and arms waiting without another confirmation", () => {
  const h = harness();
  const nodes = [];
  let shadow;
  function element(tag) {
    const node = { tag, dataset: {}, children: [], listeners: {}, attrs: {}, hidden: false, isConnected: true,
      appendChild(child) { this.children.push(child); },
      replaceChildren(...children) { this.children = children; },
      setAttribute(key, value) { this.attrs[key] = value; },
      get firstElementChild() { return this.children[0]; },
      attachShadow() { return shadow = this.shadowRoot = element("shadow"); },
      addEventListener(type, handler) { this.listeners[type] = handler; },
      focus() { shadow.activeElement = this; },
      click() { if (!this.disabled && !this.hidden) this.listeners.click(); } };
    nodes.push(node);
    return node;
  }
  const document = { createElement: element, documentElement: element("html"), addEventListener() {},
    activeElement: { isConnected: true, focus() {} } };
  h.page.performance = { now: () => 0 };
  h.page.DBEnhancerCardAutomation = require("../card-automation.js");
  h.page.showMenu = () => {};
  h.page.cardMenuClicked = () => { throw new Error("Custom action reached native sender"); };
  const feature = createFeature({ window: h.page, document, getSettings: () => h.settings });
  feature.initialize();
  h.page.DBEnhancerDuelEvents.install();
  h.page.cardMenuClicked(h.source, "DBX:card-automation", {});
  const click = text => nodes.find(node => node.tag === "button" && node.textContent === text).click();
  const get = text => nodes.find(node => node.tag === "button" && node.textContent === text);
  assert.equal(get("Activate & resolve").attrs["aria-pressed"], "true");
  assert.equal(shadow.activeElement.textContent, "Summon in ATK");
  click("Wait for opponent");
  click("Summon in DEF"); click("Summon in DEF");
  assert.equal(h.commands.length, 1);
  h.echo("Declare", { id: 1 }); feature.tick();
  h.echo("Banish", { id: 1 }); feature.tick();
  assert.equal(get("Resolve now").hidden, false);
  assert.equal(feature.diagnostics.cardAutomation().state, "waiting");
  assert.equal(feature.diagnostics.cardAutomation().position, "DEF");
  click("Cancel");
  assert.equal(feature.diagnostics.cardAutomation().state, "canceled");
  assert.equal(h.commands.length, 2);
  click("Close");
  assert.equal(nodes.find(node => node.id === "dbx-card-automation").hidden, true);
  assert.match(nodes.find(node => node.tag === "style").textContent, /left:50%; top:46%/);
});

for (const position of ["ATK", "DEF"]) test(`one ${position} choice activates and completes immediate resolution without another release`, () => {
  const h = harness(); h.runtime.prepare(h.source);
  h.runtime.begin(position); h.runtime.begin(position);
  assert.equal(h.commands.length, 1);
  h.echo("Declare", { id: 1 }); h.runtime.tick();
  h.echo("Banish", { id: 1 }); h.runtime.tick();
  assert.equal(h.commands.at(-1).play, "Stop viewing");
  h.echo("Stop viewing"); h.runtime.tick();
  h.echo("View deck", { deck: [{ id: 90000002, serial_number: "09000002", name: "Other", card_type: "Monster" }, { id: 90000001, serial_number: 9000001, name: CARD, card_type: "Monster" }] }); h.runtime.tick();
  assert.equal(h.commands.at(-1).play, "SS " + position);
  h.echo("SS " + position, { id: 2 }); h.runtime.tick();
  h.echo("Stop viewing"); h.echo("Shuffle deck"); h.runtime.tick();
  assert.equal(h.runtime.snapshot().state, "completed");
  assert.equal(h.commands.filter(command => command.play === "Banish").length, 1);
});

test("one position choice in wait mode arms a fresh thumbs-up gate after paying cost", () => {
  const h = harness(); h.runtime.prepare(h.source); h.runtime.selectMode("wait");
  h.runtime.begin("DEF");
  h.echo("Declare", { id: 1 }); h.runtime.tick();
  h.echo("Good", { username: "Opponent" });
  h.echo("Banish", { id: 1 }); h.runtime.tick();
  assert.equal(h.runtime.snapshot().state, "waiting");
  assert.equal(h.commands.length, 2, "an early signal cannot release the new wait");
  h.echo("Good", { username: "Opponent", seconds: 2 }); h.runtime.tick();
  assert.equal(h.commands.at(-1).play, "Stop viewing");
});

test("opponent Thinking during activation suspends an immediate flow after the cost", () => {
  const h = harness(); h.runtime.prepare(h.source); h.runtime.begin("ATK");
  h.echo("Declare", { id: 1 }); h.runtime.tick();
  h.echo("Thinking", { username: "Opponent" });
  h.echo("Banish", { id: 1 }); h.runtime.tick();
  assert.equal(h.runtime.snapshot().state, "suspended");
  assert.equal(h.runtime.snapshot().costPaid, true);
  assert.equal(h.commands.length, 2);
});

test("captured Deck search protocol uses instance IDs, generic SS DEF and a server shuffle on close", () => {
  const har = JSON.parse(fs.readFileSync(require.resolve("../duelingbook/network-captures/first_real_game.har"), "utf8"));
  const messages = har.log.entries.flatMap(entry => (entry._webSocketMessages || []).flatMap(frame => {
    try { return [{ direction: frame.type, ...JSON.parse(frame.data) }]; } catch (_) { return []; }
  })).filter(message => message.action === "Duel");
  const index = messages.findIndex((message, index) => message.direction === "send" && message.play === "View deck" &&
    messages[index + 2]?.direction === "send" && messages[index + 2]?.play === "SS DEF");
  assert.ok(index >= 0);
  const sequence = messages.slice(index, index + 7);
  assert.equal(typeof sequence[0].card, "number");
  assert.equal(sequence[1].viewing, "Deck");
  assert.equal(typeof sequence[1].deck[0].name, "string");
  assert.match(sequence[1].deck[0].serial_number, /^\d{8}$/);
  assert.equal(typeof sequence[2].card, "number");
  assert.equal(sequence[4].play, "Stop viewing");
  assert.equal(sequence[6].play, "Shuffle deck");
  assert.equal(sequence[6].direction, "receive");
});

test("summon zone commands match the inspected native chooseZone payload", () => {
  const native = fs.readFileSync(require.resolve("../duelingbook/duel.js"), "utf8");
  const begin = native.indexOf("function chooseZone()");
  const end = native.indexOf("function getCardByZone", begin);
  const element = {};
  const commands = [];
  const page = { $: selector => ({ 0: selector === "#m1_select" ? element : {} }),
    getCardByZone: () => null, player1: { temp_arr: [] },
    hideSelectZones() {}, removeCardMenu() {}, removeMenuData() {},
    next_callback: "", viewing: "Deck", automatic: false,
    summoning_play: "SS DEF", summoning_card: card(2), Send: message => commands.push(message) };
  vm.createContext(page); vm.runInContext(native.slice(begin, end), page);
  page.chooseZone.call(element);
  assert.deepEqual(JSON.parse(JSON.stringify(commands)), [{ action: "Duel", play: "SS DEF", card: 2, zone: "M-1" }]);
});

test("captured Deck-to-Graveyard movement confirms To GY acknowledgment and native shuffle", () => {
  const har = JSON.parse(fs.readFileSync(require.resolve("../duelingbook/network-captures/first_real_game.har"), "utf8"));
  const messages = har.log.entries.flatMap(entry => (entry._webSocketMessages || []).flatMap(frame => {
    try { return [{ direction: frame.type, ...JSON.parse(frame.data) }]; } catch (_) { return []; }
  })).filter(message => message.action === "Duel");
  const index = messages.findIndex((message, i) => message.direction === "send" && message.play === "View deck" &&
    messages[i + 2]?.direction === "send" && messages[i + 2]?.play === "To GY");
  assert.ok(index >= 0);
  const steps = messages.slice(index, index + 7);
  assert.equal(steps[1].viewing, "Deck");
  assert.equal(typeof steps[2].card, "number");
  assert.equal(steps[3].direction, "receive");
  assert.equal(steps[3].play, "To GY");
  assert.equal(steps[3].id, steps[2].card);
  assert.equal(steps[4].play, "Stop viewing");
  assert.equal(steps[4].viewing, "Deck");
  assert.equal(steps[6].direction, "receive");
  assert.equal(steps[6].play, "Shuffle deck");
  assert.equal(steps[6].deck.length, steps[1].deck.length - 1);
});
