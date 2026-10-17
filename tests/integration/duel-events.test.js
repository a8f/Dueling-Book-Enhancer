"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { createRuntime } = require("../../extension/page/duel-events.js");

const self = { username: "Local" };
const opponent = { username: "Opponent" };
self.opponent = opponent;
opponent.opponent = self;
const commands = [];
const warnings = [];
const cards = new Map();
const nativeCalls = [];
const page = {
  console: { warn: (...args) => warnings.push(args) },
  duelist: true, replay: false, resetting: false, automatic: false,
  paused: false, awaiting_defeat: false, currentLabel: "duel_start",
  duelId: 123, username: self.username, player1: self, player2: opponent,
  currentPhase: "M1", turnCount: 1,
  actionsQueue: [], stopQueue: true,
  normalSummon(player, message) { nativeCalls.push(message); return "native-result"; },
  specialSummon(player, message) { nativeCalls.push(message); },
  olSummon(player, message) { page.specialSummon(player, message); },
  activateST(player, message) { nativeCalls.push(message); },
  attack(player, message) { nativeCalls.push(message); },
  attackDirectly(player, message) { nativeCalls.push(message); },
  targetCardResponse(player, message) { nativeCalls.push(message); },
  initUserDuelStart() {},
  updateLifePointsE(amount) { commands.push(amount); },
  getDuelCard: id => cards.get(id),
  performNextAction() {
    if (!page.stopQueue && page.actionsQueue.length) {
      page.stopQueue = true;
      page.actionsQueue[0]();
    }
  }
};
const runtime = createRuntime(page);
runtime.install();
const installed = page.normalSummon;
runtime.install();
assert.equal(page.normalSummon, installed, "health checks never double-wrap");
const events = [];
runtime.register({ id: "observe", run: event => events.push(event) });

// Exercise the site's real dispatcher to verify events follow execution, not
// network receipt, and resolve identities after preceding queued actions.
const native = fs.readFileSync(require.resolve("../../duelingbook/duel.js"), "utf8");
vm.createContext(page);
vm.runInContext(native.slice(native.indexOf("function duelResponse2("), native.indexOf("function beginNextDuel(")), page);
function capture(file, play) {
  const har = JSON.parse(fs.readFileSync(require.resolve("../../duelingbook/network-captures/" + file), "utf8"));
  for (const entry of har.log.entries) {
    for (const frame of entry._webSocketMessages || []) {
      if (frame.type !== "receive") continue;
      let message;
      try { message = JSON.parse(frame.data); } catch (_) { continue; }
      if (message.play === play) {
        // Exclude log/UI fields; keep the action's actual captured identifiers.
        return Object.fromEntries(["play", "id", "card", "attacking_id", "attacked_id"].filter(key => key in message).map(key => [key, message[key]]));
      }
    }
  }
  throw new Error("Missing captured action: " + play);
}
const summon = capture("lots_of_actions.har", "Normal Summon");
page.duelResponse2(opponent, summon);
assert.equal(events.length, 0, "queued actions do not emit early");
page.stopQueue = false;
page.performNextAction();
assert.equal(events[0].type, "summon");
assert.equal(events[0].card.name, "Elemental HERO Stratos");
assert.equal(events[0].actor.relation, "opponent");
assert.equal(events[0].card.id, summon.card.id);
assert.equal(events[0].card.instanceId, summon.id);
const activation = capture("lots_of_actions.har", "Activate ST");
page.activateST(opponent, activation);
assert.equal(events.at(-1).card.name, "E - Emergency Call");
page.actionsQueue = [];
page.stopQueue = true;

function fieldCard(id, name, controller = opponent, hidden = false) {
  return { data(key) {
    return { cardfront: { data: k => ({ id, name, card_type: "Monster" })[k] },
      face_down: hidden, controller }[key];
  } };
}
const attack = capture("first_real_game.har", "Attack");
page.duelResponse2(opponent, attack);
cards.set(attack.attacking_id, fieldCard(101, "Attacker"));
cards.set(attack.attacked_id, fieldCard(102, "Defender", self));
let matchedAttack = 0;
runtime.register({ id: "battle", when: { type: "attack", actor: "opponent", attacker: 101, target: "Defender" }, run() { matchedAttack++; } });
page.stopQueue = false;
page.performNextAction();
assert.equal(matchedAttack, 1);
assert.equal(events.at(-1).attacker.name, "Attacker");
assert.equal(events.at(-1).target.name, "Defender");
cards.set(attack.attacked_id, fieldCard(102, "Secret", opponent, true));
page.attack(opponent, attack);
assert.equal(events.at(-1).target.name, null, "hidden identities stay unknown");
page.attackDirectly(opponent, { id: attack.attacking_id, play: "Attack directly" });
assert.equal(events.at(-1).attacker.id, 101);
assert.equal(events.at(-1).target, null);

// An opt-in feature can use a guarded native LP command. Nothing is installed
// by default, and two genuine activations of the same card remain distinct.
const upstart = { play: "Activate ST", id: 50, card: { id: 999, name: "Upstart Goblin" } };
let pendingAction;
const removeUpstart = runtime.register({
  id: "example-upstart", when: { type: "activate", actor: "opponent", card: "Upstart Goblin" },
  run(event, actions) {
    pendingAction = actions;
    assert.equal(actions.adjustLifePoints(1000), true);
    assert.equal(actions.adjustLifePoints(1000), false);
  }
});
page.activateST(opponent, upstart);
page.activateST(opponent, { ...upstart });
assert.deepEqual(commands, [1000, 1000]);
page.activateST(self, upstart);
assert.equal(commands.length, 2);
assert.throws(() => runtime.register({ id: "example-upstart", run() {} }), /Duplicate/);
removeUpstart();
assert.equal(pendingAction.adjustLifePoints(1000), false);
page.activateST(opponent, upstart);
assert.equal(commands.length, 2);

let deferred;
runtime.register({ id: "deferred", when: { type: "activate" }, run: (_event, actions) => { deferred = actions; } });
for (const [flag, value] of [["replay", true], ["resetting", true], ["duelist", false], ["automatic", true], ["paused", true]]) {
  const previous = page[flag];
  page[flag] = value;
  const before = events.length;
  page.activateST(opponent, upstart);
  assert.equal(events.length, before, flag + " does not trigger live rules");
  page[flag] = previous;
}
let nonLiveActions;
runtime.register({ id: "replay-observer", includeNonLive: true, run: (_event, actions) => { nonLiveActions = actions; } });
page.replay = true;
page.activateST(opponent, upstart);
page.replay = false;
assert.equal(nonLiveActions.adjustLifePoints(1000), false);
page.activateST(opponent, upstart);
page.duelId++;
assert.equal(deferred.adjustLifePoints(1000), false, "a new duel invalidates deferred commands");
page.activateST(opponent, upstart);
page.initUserDuelStart();
assert.equal(deferred.adjustLifePoints(1000), false, "a new game in the same match invalidates commands");
page.activateST(opponent, upstart);
assert.equal(deferred.adjustLifePoints(NaN), false);
assert.equal(deferred.adjustLifePoints(1.5), false);
assert.equal(deferred.adjustLifePoints(0), false);

// Tag teammates must never count as opponents.
self.partner = { username: "Partner" };
page.activateST(self.partner, upstart);
assert.equal(events.at(-1).actor.relation, "partner");
delete self.partner;

let afterFailure = 0;
runtime.register({ id: "broken", test() { throw new Error("bad predicate"); }, run() {} });
runtime.register({ id: "healthy", run() { afterFailure++; } });
const count = nativeCalls.length;
assert.equal(page.normalSummon(self, summon), "native-result");
assert.equal(nativeCalls.length, count + 1, "native action survives a broken rule");
assert.equal(afterFailure, 1);
assert.ok(warnings.length);
const beforeNested = events.length;
page.olSummon(self, { play: "OL ATK", start_id: 10, card: { id: 20, name: "Xyz" } });
assert.equal(events.length, beforeNested + 1, "nested native calls emit once");

// Synchronously advancing the native queue must not suppress a different action.
page.normalSummon = function() { page.activateST(opponent, upstart); };
runtime.install();
const beforeChain = events.length;
page.normalSummon(self, summon);
assert.equal(events.length, beforeChain + 2);
const replacement = page.normalSummon;
runtime.install();
assert.equal(page.normalSummon, replacement);
assert.ok(runtime.diagnostics().installed.includes("attack"));
assert.ok(runtime.diagnostics().missing.includes("drawCard"));
assert.equal(Object.isFrozen(events[0]), true);
assert.equal(Object.isFrozen(events[0].card), true);

const mutableRule = { id: "mutable", run() {} };
const removeMutable = runtime.register(mutableRule);
mutableRule.id = "changed";
removeMutable();
assert.equal(runtime.diagnostics().rules.includes("mutable"), false);
runtime.register({ id: "throws", run() { throw new Error("callback failed"); } });
runtime.register({ id: "rejects", async run() { throw new Error("async callback failed"); } });
page.activateST(opponent, upstart);
assert.ok(warnings.some(args => args[1].message === "callback failed"));
Promise.resolve().then(() => {
  assert.ok(warnings.some(args => args[1].message === "async callback failed"));
});

const browser = {};
vm.runInNewContext(fs.readFileSync(require.resolve("../../extension/page/duel-events.js"), "utf8"), { window: browser });
assert.equal(typeof browser.DBEnhancerDuelEvents.register, "function");

// Manifest guarantees the runtime exists before content initialization.
const manifest = JSON.parse(fs.readFileSync(require.resolve("../../extension/manifest.json"), "utf8"));
const scripts = manifest.content_scripts.find(script => script.world === "MAIN").js;
assert.ok(scripts.indexOf("page/duel-events.js") < scripts.indexOf("page/content.js"));
console.log("Duel event framework tests passed.");
