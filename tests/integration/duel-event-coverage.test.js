"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { createRuntime } = require("../../extension/page/duel-events.js");
const source = fs.readFileSync(require.resolve("../../duelingbook/duel.js"), "utf8");
const dispatchSource = source.slice(source.indexOf("function duelResponse("), source.indexOf("function beginNextDuel("));
const queueSource = dispatchSource.slice(dispatchSource.indexOf("function duelResponse2("));
function cases(text) {
  return [...text.matchAll(/case "([^"]+)":/g)].map(match => match[1]);
}
const queuedPlays = cases(queueSource);
const allPlays = [...new Set(cases(dispatchSource).filter(play => !/^(rps|tp|duel)_start\d*$/.test(play) && play !== "siding"))];
const self = { username: "Local" };
const opponent = { username: "Opponent" };
self.opponent = opponent;
opponent.opponent = self;
const events = [];
const received = [];
const errors = [];
const commands = [];
const page = {
  player1: self, player2: opponent, username: self.username,
  duelist: true, currentLabel: "duel_start", duelId: 1,
  actionsQueue: [], SOFT_PLAYS: [], tag_duel: false,
  console: { warn: (...args) => errors.push(args), error() {}, log() {} },
  updateLifePointsE: amount => commands.push(amount)
};
// Stub only effects/UI. Keep both native dispatchers intact so changes to
// their case lists automatically expand these coverage checks.
for (const match of dispatchSource.matchAll(/\b([A-Za-z_$][\w$]*)\(/g)) {
  const name = match[1];
  if (!["if", "switch", "function", "for", "duelResponse", "duelResponse2"].includes(name) && !(name in page)) {
    page[name] = () => {};
  }
}
page.getPlayer = () => self;
page.performNextAction = () => {};
const ui = new Proxy(function() {}, {
  get(_target, key) { return key === "text" ? () => "" : () => ui; },
  apply() { return ui; }
});
page.$ = () => ui;
vm.createContext(page);
vm.runInContext(dispatchSource, page);
const runtime = createRuntime(page);
runtime.register({ id: "execute", includeNonLive: true, run: event => events.push(event) });
runtime.register({ id: "receive", includeNonLive: true, when: { stage: "receive" }, run: event => received.push(event) });
runtime.install();

for (const play of queuedPlays) {
  for (const player of [self, opponent]) {
    const before = events.length;
    const queue = page.actionsQueue;
    const originalPush = queue.push;
    page.duelResponse2(player, { play, username: player.username });
    assert.equal(events.length, before, play + " waits for queue execution");
    assert.equal(queue.push, originalPush, "restore the native queue push method");
    assert.equal(Object.hasOwn(queue, "push"), false);
    assert.ok(queue.length, "native dispatcher enqueues " + play);
    while (queue.length) queue.shift()();
    assert.equal(events.length, before + 1, play + " emits once");
    assert.equal(events.at(-1).play, play);
    assert.equal(events.at(-1).actor.relation, player === self ? "self" : "opponent");
  }
}

// All immediate, lifecycle, log-only, and queued messages pass through the
// receive feed, even if incomplete test payloads make the native UI reject them.
for (const play of [...allPlays, "Future unknown action"]) {
  for (const player of [self, opponent]) {
    page.actionsQueue = [];
    const before = received.length;
    page.duelResponse({ play, username: player.username, detail: { values: [1, 2] } });
    assert.equal(received.length, before + 1, "receipt coverage: " + play);
    const event = received.at(-1);
    assert.equal(event.actor.relation, player === self ? "self" : "opponent");
    assert.equal(event.data.detail.values[1], 2);
    assert.ok(Object.isFrozen(event.data.detail.values));
  }
}

for (const player of [self, opponent]) {
  for (const play of ["Good", "Stop good", "Thinking", "Typing", "Future unknown action"]) {
    page.actionsQueue = [];
    const before = events.length;
    page.duelResponse({ play, username: player.username, long: true });
    while (page.actionsQueue.length) page.actionsQueue.shift()();
    assert.equal(events.length, before + 1, "signal emits once: " + play);
    assert.equal(events.at(-1).type, play.toLowerCase().replaceAll(" ", "-"));
    assert.equal(events.at(-1).data.long, true);
  }
}

// Replay queues even the normally immediate Thinking message. Receipt remains
// immediate, while execution waits; default live-only rules stay silent.
page.actionsQueue = [];
page.replay = true;
const beforeReplay = events.length;
page.duelResponse({ play: "Thinking", username: opponent.username });
assert.equal(events.length, beforeReplay);
assert.equal(page.actionsQueue.length, 1);
page.actionsQueue.shift()();
assert.equal(events.length, beforeReplay + 1);
assert.equal(events.at(-1).type, "thinking");
assert.equal(events.at(-1).live, false);
page.replay = false;

// A message can enqueue several internal steps but is still one event. Nested
// dispatch while the parent is draining must not attribute a child to its parent.
page.duelResponse2 = function(player, message) {
  if (message.play === "Parent action") {
    page.actionsQueue.push(function firstStep() {
      page.duelResponse2(opponent, { play: "Child action" });
    }, function secondStep() {});
  } else page.actionsQueue.push(() => {});
  while (page.actionsQueue.length) page.actionsQueue.shift()();
};
runtime.install();
page.actionsQueue = [];
const beforeMulti = events.length;
page.duelResponse2(self, { play: "Parent action" });
assert.equal(events.length, beforeMulti + 2);
assert.equal(events.at(-2).play, "Parent action");
assert.equal(events.at(-2).actor.relation, "self");
assert.equal(events.at(-1).play, "Child action");
assert.equal(events.at(-1).actor.relation, "opponent");
assert.equal(Object.hasOwn(page.actionsQueue, "push"), false);
// Use a separate non-recursive dispatcher to exercise multiple queued steps.
page.duelResponse2 = function() { page.actionsQueue.push(() => {}, () => {}); };
runtime.install();
page.actionsQueue = [];
const beforeSteps = events.length;
page.duelResponse2(self, { play: "Multiple steps" });
while (page.actionsQueue.length) page.actionsQueue.shift()();
assert.equal(events.length, beforeSteps + 1);
page.duelResponse2 = function() { throw new Error("native failure"); };
runtime.install();
assert.throws(() => page.duelResponse2(self, { play: "Broken native action" }), /native failure/);
assert.equal(Object.hasOwn(page.actionsQueue, "push"), false, "restore queue after native exceptions");

// Pause/defeat messages must remain observable when their native handler
// changes live status before returning. Their LP helpers still check current status.
page.duelResponse = function(message) { page.paused = message.play === "Pause game"; };
runtime.install();
const transitions = [];
runtime.register({ id: "transitions", run: (event, actions) => transitions.push([event, actions]) });
page.paused = false;
page.duelResponse({ play: "Pause game", username: self.username });
assert.equal(transitions.at(-1)[0].play, "Pause game");
assert.equal(transitions.at(-1)[1].adjustLifePoints(1000), false);
page.duelResponse({ play: "Resume game", username: opponent.username });
assert.equal(transitions.at(-1)[0].play, "Resume game");
assert.equal(errors.length, 0, "framework must not report internal errors");
console.log(`Duel event coverage passed: ${allPlays.length} native plays, ${queuedPlays.length} queued plays, both players, and unknown future messages.`);
