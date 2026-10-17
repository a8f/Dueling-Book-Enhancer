"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { calculate, createCalculator } = require("../battle-damage.js");
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
    const data = { controller: owner, new_atk: null, new_def: null, inATK: position === "attack",
      inDEF: position === "defense", face_down: hidden,
      cardfront: { data: key => ({ name: `Monster ${id}`, atk, def })[key] } };
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
    attack() {}, attackDirectly() {}, updateLifePoints() {}, duelResponse() {},
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
  h.ok().click();
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
  assert.equal(h.ok().disabled, false);
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

test("only live opponent attacks against the local player open a popup", () => {
  for (const setup of [h => h.page.duelist = false, h => h.page.replay = true,
    h => h.page.automatic = true, h => h.target.controller = h.opponent]) {
    const h = harness();
    setup(h);
    h.attack();
    assert.equal(h.panel(), undefined);
  }
  const h = harness();
  h.page.attack(h.self, { play: "Attack", attacking_id: 2, attacked_id: 1 });
  assert.equal(h.panel(), undefined);
  h.attack();
  h.attack(true);
  h.ok().click();
  assert.deepEqual(h.commands, [-2400], "the latest attack replaces the previous suggestion");
});
