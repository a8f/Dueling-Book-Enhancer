"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const costs = require("../extension/shared/activation-costs.js");
const createFeature = require("../extension/page/features/activation-costs.js");
const { createRuntime } = require("../extension/page/duel-events.js");
const core = require("../extension/shared/enhancer-core.js");

const detect = (effect, cardType = "Spell", type = "Normal") => costs.detect({ effect, cardType, type });

test("recognizes clear Edison-style fixed, half, targeting and explicit activation payments", () => {
  for (const text of [
    "Pay 1000 LP; Special Summon 1 Fusion Monster.",
    "Pay 1000 Life Points. Special Summon 1 Fusion Monster.",
    "Pay 1000 Life Points to Special Summon 1 Fusion Monster.",
    "When a Trap Card is activated: Pay 1000 LP; negate the activation.",
    "Pay 1,000 LP, then target 1 monster; destroy it.",
    "Activate this card by paying 1000 LP. Negate the effects of face-up monsters."
  ]) assert.deepEqual(detect(text), { kind: "fixed", amount: 1000 }, text);
  for (const text of [
    "When a monster would be Summoned, OR a Spell/Trap Card is activated: Pay half your LP; negate the Summon or activation.",
    "Pay half of your Life Points. Negate the activation of a Spell Card."
  ]) assert.deepEqual(detect(text, "Trap"), { kind: "half" });
  assert.deepEqual(detect("Activate this card by paying 1000 LP. Negate all face-up monster effects.", "Trap", "Continuous"),
    { kind: "fixed", amount: 1000 });
  assert.deepEqual(costs.detect({ name: "Skill Drain", cardType: "Trap", type: "Continuous",
    effect: "Pay 1000 Life Points. The effects of all face-up monsters on the field are negated." }),
  { kind: "fixed", amount: 1000 });
  assert.deepEqual(detect("Pay 1000 Life Points to activate this card.", "Spell", "Continuous"),
    { kind: "fixed", amount: 1000 });
});

test("skips effect payments, upkeep, choices, multiple activations and unsupported costs", () => {
  for (const text of [
    "Gain 1000 LP.",
    "Draw 1 card, then pay 1000 LP.",
    "You can pay 1000 LP; draw 1 card.",
    "During your Standby Phase: Pay 1000 LP; draw 1 card.",
    "If this card is in your GY: Pay 1000 LP; add it to your hand.",
    "Pay 1000 LP; draw 1 card. If this card is sent to the GY: draw 1 card.",
    "Pay 1000 LP; draw 1 card. You can pay 500 LP; gain 1000 LP.",
    "Choose 1 of these effects. ● Pay 1000 LP; draw 1 card.",
    "Pay 1000 LP; select one of these effects to apply.",
    "Pay 1000 Life Points during each of your Standby Phases.",
    "Each player must pay 500 Life Points to play cards.",
    "Pay any multiple of 1000 LP; draw cards.",
    "Pay 0 LP; draw 1 card.",
    "Pay 1000 LP and discard 1 card; draw 2 cards.",
    "Pay 1000 LP; draw 1 card. Once per turn, gain 100 LP."
  ]) assert.equal(detect(text), null, text);
  assert.equal(detect("Pay 1000 LP; draw 1 card.", "Monster"), null);
  assert.equal(detect("Pay 1000 LP; draw 1 card.", "Spell", "Continuous"), null);
  assert.equal(detect("Pay 1000 LP; draw 1 card.", "Spell", "Field"), null);
  assert.equal(detect("Pay 1000 Life Points to draw 1 card.", "Spell", "Continuous"), null);
});

test("payment calculation leaves positive LP and handles odd half payments", () => {
  assert.equal(costs.amount({ kind: "fixed", amount: 1000 }, 1000), null);
  assert.equal(costs.amount({ kind: "fixed", amount: 1000 }, 999), null);
  assert.equal(costs.amount({ kind: "fixed", amount: 1000 }, 1001), 1000);
  assert.equal(costs.amount({ kind: "half" }, 8000), 4000);
  assert.equal(costs.amount({ kind: "half" }, 1001), 500);
  assert.equal(costs.amount({ kind: "half" }, 1), 0);
  for (const life of [undefined, NaN, "8000", -1, 0, 0.5]) assert.equal(costs.amount({ kind: "half" }, life), null);
});

function harness() {
  const settings = { autoPayActivationCosts: true };
  const self = { username: "Local", lifepoints: 8000 };
  const other = { username: "Other", lifepoints: 8000, opponent: self };
  self.opponent = other;
  const fronts = new Map();
  const commands = [];
  const page = { username: self.username, player1: self, player2: other, duelId: 123,
    duelist: true, currentLabel: "duel_start", console,
    DBEnhancerActivationCosts: costs,
    getDuelCard: id => fronts.has(id) ? { data: key => key === "cardfront" ? { data: name => fronts.get(id)[name] } : null } : null,
    updateLifePointsE: amount => commands.push(amount),
    activateST() {}, activateFieldSpell() {}, applyEffect() {}, resetGame() {},
    updateLifePoints(player, message) { player.lifepoints = message.life; }
  };
  page.DBEnhancerDuelEvents = createRuntime(page);
  const feature = createFeature({ window: page, getSettings: () => settings });
  feature.initialize();
  feature.initialize();
  page.DBEnhancerDuelEvents.install();
  const card = (id, effect = "Pay 1000 LP; draw 1 card.", card_type = "Spell") => {
    fronts.set(id, { id: 100 + id, name: "Card " + id, card_type, type: "Normal", effect });
  };
  card(1);
  const activate = (id = 1, player = self, extra = {}) => page.activateST(player, { play: "Activate ST", id, ...extra });
  const echo = () => page.updateLifePoints(self, { play: "Life points", amount: commands.at(-1), life: self.lifepoints + commands.at(-1) });
  return { settings, self, other, fronts, commands, page, feature, card, activate, echo };
}

test("own spell/trap activation uses native LP once; Apply effect, opponents and monsters are ignored", () => {
  const h = harness();
  h.activate();
  h.page.applyEffect(h.self, { play: "Apply effect", id: 1 });
  h.activate(); // A rapid second action cannot spend against stale LP.
  assert.deepEqual(h.commands, [-1000]);
  h.echo();
  h.activate(1, h.other);
  h.card(2, "Pay 1000 LP; draw 1 card.", "Monster");
  h.activate(2);
  assert.deepEqual(h.commands, [-1000]);
  h.card(3, "When a Spell Card is activated: Pay half your LP; negate the activation.", "Trap");
  h.activate(3);
  assert.deepEqual(h.commands, [-1000, -3500]);
});

test("reads freshly supplied card text and rejects non-live, disabled and insufficient-LP payments", () => {
  const h = harness();
  h.activate(1, h.self, { card: { card_type: "Spell", effect: "Draw 1 card." } });
  h.settings.autoPayActivationCosts = false;
  h.activate();
  h.settings.autoPayActivationCosts = true;
  for (const flag of ["replay", "automatic", "paused", "resetting", "awaiting_defeat"]) {
    h.page[flag] = true;
    h.activate();
    h.page[flag] = false;
  }
  h.self.lifepoints = 1000;
  h.activate();
  assert.deepEqual(h.commands, []);
  h.self.lifepoints = 1001;
  h.activate();
  assert.deepEqual(h.commands, [-1000]);
});

test("game reset clears reservations, native command failures recover, and Spell Economics defers spells", () => {
  const h = harness();
  h.activate();
  h.page.resetGame(h.self, { play: "Reset game" });
  h.activate();
  assert.deepEqual(h.commands, [-1000, -1000]);
  h.echo();
  h.self.s1 = { data: key => key === "cardfront" ? { data: () => "Spell Economics" } : false };
  h.activate();
  assert.equal(h.commands.length, 2);
  h.self.s1 = null;
  const send = h.page.updateLifePointsE;
  h.page.updateLifePointsE = null;
  h.activate();
  h.page.updateLifePointsE = send;
  h.activate();
  assert.equal(h.commands.length, 3);
});

test("automation settings preserve existing battle behavior and opt in to cost payment", () => {
  const defaults = core.createDefaultSettings();
  assert.equal(defaults.autoPayActivationCosts, false);
  assert.equal(defaults.battleDamageConfirmation, true);
  assert.equal(core.sanitizeSettings({ autoPayActivationCosts: "true" }).autoPayActivationCosts, false);
  const settings = core.sanitizeSettings({ autoPayActivationCosts: true, battleDamageConfirmation: false });
  assert.equal(settings.autoPayActivationCosts, true);
  assert.equal(settings.battleDamageConfirmation, false);
});

test("queued native activation is charged at execution, once, using supplied public text", () => {
  const h = harness();
  const queue = h.page.actionsQueue = [];
  h.page.duelResponse2 = (player, message) => {
    queue.push(() => h.page.activateST(player, message));
  };
  h.page.DBEnhancerDuelEvents.install();
  h.page.duelResponse2(h.self, { play: "Activate Spell from hand", id: 99,
    card: { id: 7, name: "Public Spell", card_type: "Spell", type: "Normal", effect: "Pay 800 LP; take control of 1 monster." } });
  assert.deepEqual(h.commands, []);
  queue.shift()();
  assert.deepEqual(h.commands, [-800]);
  h.page.applyEffect(h.self, { play: "Apply effect", id: 99 });
  assert.deepEqual(h.commands, [-800]);
});
