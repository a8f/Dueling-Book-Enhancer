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
