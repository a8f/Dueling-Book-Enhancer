"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { calculate, createCalculator, createEffectTracker } = require("../battle-damage.js");
const createFeature = require("../features/battle-damage.js");
const { createRuntime } = require("../duel-events.js");

test("battle calculation covers attack, defense, direct, ties and unknown stats", () => {
  const battle = (atk, target) => calculate({ attacker: { atk }, target }).damage;
  assert.equal(battle(2400, { atk: 1800, position: "attack" }), 600);
  assert.equal(battle(1800, { atk: 2400, position: "attack" }), 0);
  assert.equal(battle(1800, { atk: 1800, position: "attack" }), 0);
  assert.equal(battle(2400, { def: 1000, position: "defense" }), 0);
  assert.equal(battle(1000, { def: 2400, position: "defense" }), 0);
  assert.equal(battle("2400", null), 2400);
  for (const value of [null, undefined, "?", "", "2400x", -1, NaN]) assert.equal(battle(value, null), null);
  assert.equal(battle(1000, { atk: "?", position: "attack" }), null);
});

test("ordered damage modifiers are removable and can defer calculation", () => {
  const calculator = createCalculator();
  const battle = { attacker: { atk: 2400 }, target: null };
  const remove = calculator.registerModifier("half", (_, result) => ({ ...result, damage: result.damage / 2 }));
  assert.equal(calculator.calculate(battle).damage, 1200);
  remove();
  assert.equal(calculator.calculate(battle).damage, 2400);
  calculator.registerModifier("unresolved", () => ({ damage: null, explanation: "Resolve effect first" }));
  assert.equal(calculator.calculate(battle).damage, null);
});

function harness() {
  const elements = [];
  let shadow;
  function element(tag) {
    const node = { tag, children: [], listeners: {}, hidden: false, isConnected: true,
      appendChild(child) { this.children.push(child); },
      setAttribute() {}, addEventListener(type, fn) { this.listeners[type] = fn; },
      attachShadow() { return shadow = this.shadowRoot = element("shadow"); },
      focus() { shadow.activeElement = this; },
      click() { if (!this.disabled) this.listeners.click(); } };
    elements.push(node);
    return node;
  }
  const self = { username: "Local", lifepoints: 8000 };
  const opponent = { username: "Opponent", lifepoints: 8000, opponent: self };
  self.opponent = opponent;
  const cards = new Map();
  function card(id, owner, atk, def, position = "attack", hidden = false) {
    const data = { controller: owner, name: `Monster ${id}`, new_atk: null, new_def: null, attribute: "LIGHT", inATK: position === "attack",
      inDEF: position === "defense", face_down: hidden,
      cardfront: { data: key => ({ name: data.name, atk, def, attribute: data.attribute })[key] } };
    const node = { data: key => data[key] };
    cards.set(id, node);
    owner.m1 = node;
    return data;
  }
  const attacker = card(1, opponent, "2400", "1000");
  const target = card(2, self, "1800", "1200");
  const commands = [];
  const page = { duelist: true, currentLabel: "duel_start", duelId: 1, currentPhase: "BP", turnCount: 2,
    player1: self, player2: opponent, username: self.username, console,
    getDuelCard: id => cards.get(id), updateLifePointsE: value => commands.push(value),
    attack() {}, attackDirectly() {},
    updateLifePoints(player, message) { if (typeof message.life === "number") player.lifepoints = message.life; },
    duelResponse(message) {
      if (message.play === "Life points") page.updateLifePoints(self, message);
    },
    applyEffect() {}, toGY() {},
    DBEnhancerBattleDamage: createCalculator() };
  page.DBEnhancerDuelEvents = createRuntime(page);
  const document = { createElement: element, body: element("body") };
  const feature = createFeature({ window: page, document });
  feature.initialize();
  page.DBEnhancerDuelEvents.install();
  function attack(direct = false) {
    if (direct) page.attackDirectly(opponent, { play: "Attack directly", id: 1 });
    else page.attack(opponent, { play: "Attack", attacking_id: 1, attacked_id: 2 });
  }
  return { page, self, opponent, feature, attacker, target, commands, attack,
    panel: () => elements.find(e => e.id === "dbx-battle-damage"),
    dialog: () => elements.find(e => e.tag === "section"),
    ok: () => elements.find(e => e.tag === "button" && e.textContent.startsWith("OK")),
    cancel: () => elements.find(e => e.tag === "button" && e.textContent === "Cancel") };
}

function discard(h, name, id = 10, actor = h.opponent) {
  h.page.toGY(actor, { play: "To GY", id, card: { name },
    log: { public_log: `Sent "${name}" from hand (1/1) to GY` } });
}

function acknowledge(h, amount, life) {
  const message = { play: "Life points", username: h.self.username, amount, life };
  h.page.duelResponse(message);
  h.feature.tick();
}

function useNativeQueue(h) {
  const source = fs.readFileSync(require.resolve("../duelingbook/duel.js"), "utf8");
  Object.assign(h.page, { actionsQueue: [], performNextAction() {}, duel_logs: [],
    asArray: value => Array.isArray(value) ? value : [value], updateDuelLog() {} });
  vm.createContext(h.page);
  vm.runInContext(source.slice(source.indexOf("function duelResponse2("), source.indexOf("function beginNextDuel(")), h.page);
  h.page.duelResponse = message => h.page.duelResponse2(
    message.username === h.self.username ? h.self : h.opponent, message);
  h.page.DBEnhancerDuelEvents.install();
}

test("captured To GY hand discard shape passes through the native queued dispatcher for both cards", () => {
  const har = JSON.parse(fs.readFileSync(require.resolve("../duelingbook/network-captures/first_real_game.har"), "utf8"));
  const captured = har.log.entries.flatMap(entry => entry._webSocketMessages || [])
    .filter(frame => frame.type === "receive").map(frame => { try { return JSON.parse(frame.data); } catch { return {}; } })
    .find(message => message.play === "To GY" && /from hand/.test(message.log && message.log.public_log));
  assert.ok(captured);
  for (const name of ["Honest", "Blackwing - Kalut the Moon Shadow"]) {
    const h = harness();
    h.attacker.name = "Blackwing - Shura the Blue Flame";
    useNativeQueue(h);
    h.attack();
    const message = { ...captured, username: h.opponent.username, card: { ...captured.card, name },
      log: { ...captured.log, public_log: `Sent "${name}" from hand (1/1) to GY` } };
    h.page.duelResponse2(h.opponent, message);
    assert.equal(h.ok().textContent, "OK — take 600", "wait for native queue execution");
    h.page.actionsQueue.shift()();
    assert.equal(h.ok().textContent, name === "Honest" ? "OK — take 2,400" : "OK — take 2,000");
  }
});

test("queued LP echoes and a following discard preserve the battle across receive and execute stages", () => {
  const h = harness();
  h.attacker.name = "Blackwing - Shura the Blue Flame";
  useNativeQueue(h);
  h.attack();
  h.ok().click();
  h.page.duelResponse({ play: "Life points", username: h.self.username, amount: -600, life: 7400 });
  h.page.duelResponse({ play: "To GY", username: h.opponent.username, id: 10,
    card: { name: "Blackwing - Kalut the Moon Shadow" },
    log: { public_log: 'Sent "Blackwing - Kalut the Moon Shadow" from hand (1/1) to GY' } });
  h.feature.tick();
  assert.equal(h.panel().hidden, true);
  h.page.actionsQueue.shift()();
  h.feature.tick();
  assert.equal(h.self.lifepoints, 7400);
  h.page.actionsQueue.shift()();
  assert.equal(h.panel().hidden, false);
  assert.equal(h.ok().textContent, "OK — take 1,400");
  h.ok().click();
  assert.deepEqual(h.commands, [-600, -1400]);
});

test("generic To GY also detects native hand ids represented as strings without a public log", () => {
  const h = harness();
  h.opponent.hand_arr = [{ data: key => key === "id" ? "10" : null }];
  h.attack();
  h.page.toGY(h.opponent, { play: "To GY", id: 10, card: { name: "Honest" } });
  assert.equal(h.ok().textContent, "OK — take 2,400");
});

test("late discard after confirmed and acknowledged damage reopens only for the difference", () => {
  for (const name of ["Honest", "Blackwing - Kalut the Moon Shadow"]) {
    const h = harness();
    h.attacker.name = "Blackwing - Shura the Blue Flame";
    h.attack();
    h.ok().click();
    assert.deepEqual(h.commands, [-600]);
    acknowledge(h, -600, 7400);
    assert.equal(h.panel().hidden, true);
    discard(h, name);
    assert.equal(h.panel().hidden, false);
    const difference = name === "Honest" ? 1800 : 1400;
    assert.equal(h.ok().textContent, `OK — take ${difference.toLocaleString()}`);
    h.ok().click();
    assert.deepEqual(h.commands, [-600, -difference]);
    acknowledge(h, -difference, 7400 - difference);
    discard(h, name);
    assert.equal(h.panel().hidden, true, "duplicate signals do not charge again");
  }
});

test("late boosts before LP acknowledgement support consecutive corrections and ordered server echoes", () => {
  const h = harness();
  h.attacker.name = "Blackwing - Shura the Blue Flame";
  h.attack();
  h.ok().click();
  discard(h, "Blackwing - Kalut the Moon Shadow");
  h.ok().click();
  assert.deepEqual(h.commands, [-600, -1400]);
  acknowledge(h, -600, 7400);
  acknowledge(h, -1400, 6000);
  discard(h, "Blackwing - Kalut the Moon Shadow", 11);
  assert.equal(h.ok().textContent, "OK — take 1,400");
  h.ok().click();
  assert.deepEqual(h.commands, [-600, -1400, -1400]);
});

test("a late local Honest can refund overpaid damage, and zero-damage battles stay tracked without a popup", () => {
  const h = harness();
  h.attack();
  h.ok().click();
  acknowledge(h, -600, 7400);
  discard(h, "Honest", 10, h.self);
  assert.equal(h.ok().textContent, "OK — restore 600");
  h.ok().click();
  assert.deepEqual(h.commands, [-600, 600]);
  acknowledge(h, 600, 8000);
  const zero = harness();
  zero.attacker.name = "Blackwing - Shura the Blue Flame";
  zero.target.new_atk = 2400;
  zero.attack();
  assert.equal(zero.panel().hidden, true);
  discard(zero, "Blackwing - Kalut the Moon Shadow");
  assert.equal(zero.ok().textContent, "OK — take 1,400");
});

test("cancel, unrelated LP changes and battle transitions prevent reopening an old confirmation", () => {
  for (const expire of [h => h.cancel().click(), h => h.page.currentPhase = "M2",
    h => h.self.m1 = null, h => acknowledge(h, -500, 7500)]) {
    const h = harness();
    h.attack();
    h.ok().click();
    expire(h);
    discard(h, "Honest");
    assert.equal(h.panel().hidden, true);
    assert.deepEqual(h.commands, [-600]);
  }
});

function boostEvent(name, id = 10, actor = "Opponent", type = "effect") {
  return { type, actor: { username: actor }, card: { name, instanceId: id } };
}
function boostBattle() {
  return { attacker: { instanceId: 1, controller: "Opponent", name: "Blackwing - Shura the Blue Flame",
    atk: 1800, attribute: "LIGHT", position: "attack" },
  target: { instanceId: 2, controller: "Local", name: "Blackwing - Bora the Spear",
    atk: 1700, def: 800, attribute: "LIGHT", position: "attack" } };
}

test("Honest and Kalut boost the correct side, stack copies, and deduplicate activation plus discard", () => {
  const tracker = createEffectTracker();
  const battle = boostBattle();
  assert.equal(tracker.observe(boostEvent("Honest"), battle), true);
  assert.equal(calculate(tracker.apply(battle)).damage, 1800);
  assert.equal(tracker.observe(boostEvent("Honest", 10, "Opponent", "to-grave"), battle), false);
  assert.equal(calculate(tracker.apply(battle)).damage, 1800);
  assert.equal(tracker.observe(boostEvent("Honest", 11), battle), true);
  assert.equal(calculate(tracker.apply(battle)).damage, 3500);
  const kalut = createEffectTracker();
  kalut.observe(boostEvent("Blackwing - Kalut the Moon Shadow"), battle);
  assert.equal(calculate(kalut.apply(battle)).damage, 1500);
  kalut.observe(boostEvent("Blackwing - Kalut the Moon Shadow", 11), battle);
  assert.equal(calculate(kalut.apply(battle)).damage, 2900);
  const defensive = createEffectTracker();
  defensive.observe(boostEvent("Honest", 12, "Local"), battle);
  assert.equal(calculate(defensive.apply(battle)).damage, 0);
});

test("boosts are fixed and matching board updates do not double count them", () => {
  const tracker = createEffectTracker();
  const battle = boostBattle();
  tracker.observe(boostEvent("Honest"), battle);
  battle.target.atk = 2000;
  assert.equal(tracker.apply(battle).attacker.atk, 3500, "Honest uses ATK at detection rather than every refresh");
  battle.attacker.atk = 3500;
  assert.equal(tracker.apply(battle).attacker.atk, 3500);
  assert.equal(tracker.apply(battle).attacker.atk, 3500);
  const kalut = createEffectTracker();
  const multiple = boostBattle();
  kalut.observe(boostEvent("Blackwing - Kalut the Moon Shadow"), multiple);
  kalut.observe(boostEvent("Blackwing - Kalut the Moon Shadow", 11), multiple);
  multiple.attacker.atk += 1400;
  assert.equal(kalut.apply(multiple).attacker.atk, 4600, "partial board update leaves the second boost");
  multiple.attacker.atk += 1400;
  assert.equal(kalut.apply(multiple).attacker.atk, 4600);
});

test("hand boosts reject invalid beneficiaries and unknown stats; Honest requires an opposing monster", () => {
  for (const [name, change] of [["Honest", b => b.attacker.attribute = "DARK"],
    ["Honest", b => b.attacker.faceDown = true],
    ["Honest", b => b.target = null], ["Honest", b => b.target.atk = "?"],
    ["Blackwing - Kalut the Moon Shadow", b => b.attacker.name = "Blue-Eyes White Dragon"]]) {
    const tracker = createEffectTracker();
    const battle = boostBattle();
    change(battle);
    assert.equal(tracker.observe(boostEvent(name), battle), false);
  }
  const tracker = createEffectTracker();
  assert.equal(tracker.observe(boostEvent(null), boostBattle()), false);
  assert.equal(tracker.observe(boostEvent("Honest", 10, "Watcher"), boostBattle()), false);
});

test("Gale direct attack updates from 1300 to 2700 when Kalut is discarded", () => {
  const h = harness();
  h.attacker.name = "Blackwing - Gale the Whirlwind";
  h.attacker.attribute = "DARK";
  h.attacker.new_atk = 1300;
  useNativeQueue(h);
  h.attack(true);
  assert.equal(h.ok().textContent, "OK — take 1,300");
  h.page.duelResponse({ play: "To GY", username: h.opponent.username, id: 10,
    card: { name: "Blackwing - Kalut the Moon Shadow" },
    log: { public_log: 'Sent "Blackwing - Kalut the Moon Shadow" from hand (1/1) to GY' } });
  h.page.actionsQueue.shift()();
  assert.equal(h.ok().textContent, "OK — take 2,700");
  h.ok().click();
  assert.deepEqual(h.commands, [-2700]);
});

test("Gale direct attack paid before Kalut reopens for only the extra 1400", () => {
  const h = harness();
  h.attacker.name = "Blackwing - Gale the Whirlwind";
  h.attacker.attribute = "DARK";
  h.attacker.new_atk = 1300;
  useNativeQueue(h);
  h.attack(true);
  h.ok().click();
  assert.deepEqual(h.commands, [-1300]);
  h.page.duelResponse({ play: "Life points", username: h.self.username, amount: -1300, life: 6700 });
  h.page.actionsQueue.shift()();
  h.feature.tick();
  h.page.duelResponse({ play: "To GY", username: h.opponent.username, id: 10,
    card: { name: "Blackwing - Kalut the Moon Shadow" },
    log: { public_log: 'Sent "Blackwing - Kalut the Moon Shadow" from hand (1/1) to GY' } });
  h.page.actionsQueue.shift()();
  assert.equal(h.panel().hidden, false);
  assert.equal(h.ok().textContent, "OK — take 1,400");
  h.ok().click();
  assert.deepEqual(h.commands, [-1300, -1400]);
});

test("public hand effect and discard events refresh the open popup immediately", () => {
  const h = harness();
  const honest = { data: key => key === "id" ? 10 : null };
  h.opponent.hand_arr = [honest];
  h.attack();
  const message = { play: "Apply effect", id: 10, card: { name: "Honest" } };
  h.page.applyEffect(h.opponent, message);
  assert.equal(h.ok().textContent, "OK — take 2,400");
  h.page.toGY(h.opponent, { ...message, play: "To grave from hand" });
  assert.equal(h.ok().textContent, "OK — take 2,400");
  h.attacker.new_atk = 4200;
  h.feature.tick();
  assert.equal(h.ok().textContent, "OK — take 2,400");
  h.ok().click();
  assert.deepEqual(h.commands, [-2400]);
  h.attack();
  assert.equal(h.ok().textContent, "OK — take 2,400", "new popup starts with board stats and no carried boost");
});

test("discard-only Honest is detected, but milling or applying Honest on the field is ignored", () => {
  const h = harness();
  h.attack();
  h.page.toGY(h.opponent, { play: "To grave from deck", id: 10, card: { name: "Honest" } });
  h.page.applyEffect(h.opponent, { play: "Apply effect", id: 1, card: { name: "Honest" } });
  assert.equal(h.ok().textContent, "OK — take 600");
  h.page.toGY(h.opponent, { play: "To grave from hand", id: 10, card: { name: "Honest" } });
  assert.equal(h.ok().textContent, "OK — take 2,400");
});

test("confirmation sends native damage once, honors edits, and cancel sends nothing", () => {
  const h = harness();
  h.attack();
  assert.deepEqual(h.commands, []);
  assert.equal(h.ok().textContent, "OK — take 600");
  h.attacker.new_atk = "3000";
  h.ok().click();
  assert.deepEqual(h.commands, [], "a changed amount must be reviewed");
  assert.equal(h.ok().textContent, "OK — take 1,200");
  h.ok().click();
  h.ok().click();
  assert.deepEqual(h.commands, [-1200]);
  assert.equal(h.panel().hidden, true);
  h.attack(true);
  h.cancel().click();
  assert.deepEqual(h.commands, [-1200]);
});

test("dialog focuses OK, supports Tab/Shift+Tab, Enter and Escape without repeated confirmation", () => {
  const h = harness();
  const key = (key, extra = {}) => {
    let prevented = false, stopped = false;
    h.dialog().listeners.keydown({ key, preventDefault() { prevented = true; },
      stopPropagation() { stopped = true; }, ...extra });
    assert.equal(prevented, true);
    assert.equal(stopped, true);
  };
  h.attack();
  assert.equal(h.panel().shadowRoot.activeElement, h.ok());
  key("Tab");
  assert.equal(h.panel().shadowRoot.activeElement, h.cancel());
  key("Tab", { shiftKey: true });
  assert.equal(h.panel().shadowRoot.activeElement, h.ok());
  key("Enter", { repeat: true });
  assert.deepEqual(h.commands, []);
  key("Enter");
  assert.deepEqual(h.commands, [-600]);
  h.attack();
  key("Tab");
  key("Enter");
  assert.equal(h.panel().hidden, true);
  assert.deepEqual(h.commands, [-600], "Enter on Cancel dismisses without damage");
  h.attack();
  key("Escape");
  assert.equal(h.panel().hidden, true);
  h.attacker.new_atk = "?";
  h.attack();
  assert.equal(h.panel().shadowRoot.activeElement, h.cancel());
  key("Tab");
  assert.equal(h.panel().shadowRoot.activeElement, h.cancel());
});

test("defense and direct attacks, unknown stats, and extra monster zones", () => {
  const h = harness();
  h.target.inATK = false;
  h.target.inDEF = true;
  h.attack();
  assert.equal(h.panel().hidden, true);
  assert.deepEqual(h.commands, []);
  h.attack(true);
  h.ok().click();
  assert.deepEqual(h.commands, [-2400]);
  h.attacker.new_atk = "?";
  h.attack();
  assert.equal(h.ok().disabled, true);
  h.attacker.new_atk = 2500;
  h.page.linkLeft = h.opponent.m1;
  h.opponent.m1 = null;
  h.feature.tick();
  assert.equal(h.panel().hidden, true, "known zero damage stays hidden");
});

test("stale prompts cannot change LP after manual LP, leaving field, phase, duel or live status changes", () => {
  for (const change of [h => h.page.updateLifePoints(h.self, { play: "Life points", amount: -600 }),
    h => h.self.lifepoints -= 600, h => h.self.m1 = null, h => h.page.currentPhase = "M2",
    h => h.page.duelId++, h => h.page.paused = true, h => h.page.replay = true,
    h => h.target.controller = h.opponent]) {
    const h = harness();
    h.attack();
    change(h);
    h.ok().click();
    assert.deepEqual(h.commands, []);
    assert.equal(h.panel().hidden, true);
  }
});

test("LP invalidation happens on receipt before native queued LP execution", () => {
  const h = harness();
  h.attack();
  h.page.duelResponse({ play: "Life points", username: h.self.username, amount: -600 });
  assert.equal(h.panel().hidden, true);
  h.ok().click();
  assert.deepEqual(h.commands, []);
});

test("non-live attacks and invalid targets do not open a popup; own losing attacks do", () => {
  for (const setup of [h => h.page.duelist = false, h => h.page.replay = true,
    h => h.page.automatic = true, h => h.target.controller = h.opponent]) {
    const h = harness();
    setup(h);
    h.attack();
    assert.equal(h.panel(), undefined);
  }
  const h = harness();
  h.page.attack(h.self, { play: "Attack", attacking_id: 2, attacked_id: 1 });
  assert.equal(h.panel().hidden, false);
  assert.equal(h.ok().textContent, "OK — take 600");
  h.attack();
  h.attack(true);
  h.ok().click();
  assert.deepEqual(h.commands, [-2400], "the latest attack replaces the previous suggestion");
});

test("own attacks calculate local damage against attack and defense positions, with no prompts for wins or direct attacks", () => {
  const h = harness();
  const attack = () => h.page.attack(h.self, { play: "Attack", attacking_id: 2, attacked_id: 1 });
  attack();
  h.ok().click();
  assert.deepEqual(h.commands, [-600]);
  acknowledge(h, -600, 7400);
  h.attacker.inATK = false;
  h.attacker.inDEF = true;
  h.attacker.new_def = 2500;
  attack();
  assert.equal(h.ok().textContent, "OK — take 700");
  h.ok().click();
  assert.deepEqual(h.commands, [-600, -700]);
  acknowledge(h, -700, 6700);
  h.target.new_atk = 3000;
  attack();
  assert.equal(h.panel().hidden, true);
  h.page.attackDirectly(h.self, { play: "Attack directly", id: 2 });
  assert.equal(h.panel().hidden, true);
  assert.deepEqual(h.commands, [-600, -700]);
});

test("own zero-damage attack becomes a prompt after the defender discards Kalut", () => {
  const h = harness();
  h.target.name = "Blackwing - Gale the Whirlwind";
  h.target.new_atk = 1300;
  h.attacker.name = "Blackwing - Shura the Blue Flame";
  h.attacker.new_atk = 1000;
  h.page.attack(h.self, { play: "Attack", attacking_id: 2, attacked_id: 1 });
  assert.equal(h.panel().hidden, true);
  discard(h, "Blackwing - Kalut the Moon Shadow");
  assert.equal(h.panel().hidden, false);
  assert.equal(h.ok().textContent, "OK — take 1,100");
  h.ok().click();
  assert.deepEqual(h.commands, [-1100]);
});

test("a boost that removes unpaid damage hides the popup but can reopen for a later opposing boost", () => {
  const h = harness();
  h.target.name = "Blackwing - Gale the Whirlwind";
  h.attacker.name = "Blackwing - Shura the Blue Flame";
  h.page.attack(h.self, { play: "Attack", attacking_id: 2, attacked_id: 1 });
  assert.equal(h.ok().textContent, "OK — take 600");
  discard(h, "Blackwing - Kalut the Moon Shadow", 10, h.self);
  assert.equal(h.panel().hidden, true);
  discard(h, "Blackwing - Kalut the Moon Shadow", 11);
  assert.equal(h.panel().hidden, false);
  assert.equal(h.ok().textContent, "OK — take 600");
});
