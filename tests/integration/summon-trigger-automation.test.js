"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
test("native toHand implementation reveals Deck cards, and field menus restrict opponent movement", () => {
  const native = fs.readFileSync(require.resolve("../../duelingbook/duel.js"), "utf8");
  assert.match(native.slice(native.indexOf("function toHand("), native.indexOf("function toHandFromField(")), /removeFromDeck[\s\S]*revealAndToHand/);
  assert.match(native.slice(native.indexOf("function cardMenuE()"), native.indexOf("function cardMenuE2(")), /You don't control this card/);
});

test("native Target menu sends a card instance and Target card response queues the shared marker", () => {
  const main = fs.readFileSync(require.resolve("../../duelingbook/main.js"), "utf8");
  const menu = main.slice(main.indexOf("function cardMenuClicked("), main.indexOf("function fiberEvent("));
  const commands = [];
  const page = { Send: message => commands.push(message), menuAction: "Target", cardElement: { data: () => 123 },
    paused: true, resetDuelFocus() {}, setTimeout() {} };
  vm.createContext(page);
  vm.runInContext(menu.slice(menu.lastIndexOf("  Send({"), menu.lastIndexOf("}")), page);
  assert.deepEqual(JSON.parse(JSON.stringify(commands)), [{ action: "Duel", play: "Target", card: 123 }]);
  const native = fs.readFileSync(require.resolve("../../duelingbook/duel.js"), "utf8");
  const start = native.indexOf('case "Target card":');
  page.actionsQueue = [];
  page.player = { username: "Self" }; page.duelMessage = { play: "Target card", id: 123 };
  let marker;
  page.targetCardResponse = (player, message) => { marker = { player, message }; };
  vm.runInContext(native.slice(start + 'case "Target card":'.length, native.indexOf("break;", start)), page);
  assert.equal(marker, undefined);
  page.actionsQueue.shift()();
  assert.equal(marker.player, page.player); assert.equal(marker.message.id, 123);
});
