"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const card = id => ({ data: key => key === "id" ? id : undefined });
test("captured Deck search protocol uses instance IDs, generic SS DEF and a server shuffle on close", () => {
  const har = JSON.parse(fs.readFileSync(require.resolve("../../duelingbook/network-captures/first_real_game.har"), "utf8"));
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
  const native = fs.readFileSync(require.resolve("../../duelingbook/duel.js"), "utf8");
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
  const har = JSON.parse(fs.readFileSync(require.resolve("../../duelingbook/network-captures/first_real_game.har"), "utf8"));
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
