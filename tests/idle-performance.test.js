"use strict";
const assert = require("node:assert/strict");
const { test } = require("node:test");
const core = require("../enhancer-core.js");
const createSorting = require("../features/sorting.js");
const createRooms = require("../features/rooms.js");
const createCardPools = require("../features/card-pools.js");

function select(values) {
  return {
    options: values.map(value => ({ value, textContent: value, dataset: {}, hidden: false, disabled: false })),
    value: values[0], selectedIndex: 0, dataset: {}, moves: 0,
    appendChild(option) {
      this.moves++;
      this.options = this.options.filter(item => item !== option).concat(option);
    },
    querySelectorAll() { return []; }, addEventListener() {}, dispatchEvent() {}
  };
}

test("non-default custom sorting counts copies and completes without falling back to native sorting", () => {
  const settings = core.createDefaultSettings();
  settings.customSort.groups.reverse();
  let button, initialized = 0, unsaved = 0, fallback = 0;
  const rail = { querySelectorAll: () => [], appendChild(element) { element.parentElement = rail; } };
  const sort = { parentElement: rail, style: {} };
  const deck = { querySelector: selector => selector.includes("sort_btn") ? sort : null,
    querySelectorAll: () => [], contains: () => true };
  const page = { deck_filled_arr: [{ name: " Alpha ", card_type: "Monster" }, { name: "alpha", card_type: "Monster" }],
    side_filled_arr: [], extra_filled_arr: [], sortCards2: () => 0,
    initializeDeckCards() { initialized++; }, setUnsavedChanges() { unsaved++; }, sortDeck() { fallback++; },
    getComputedStyle: () => ({ top: "10px", height: "27px" }) };
  const feature = createSorting({ window: page, core, getSettings: () => settings, isVisible: () => true,
    document: { getElementById: id => id === "deck_constructor" ? deck : null,
      querySelector: () => null, querySelectorAll: () => [],
      createElement() { return button = { style: {}, setAttribute() {}, addEventListener(type, handler) { this[type] = handler; } }; } } });
  feature.initialize();
  button.click({ preventDefault() {}, stopPropagation() {} });
  assert.equal(fallback, 0);
  assert.equal(initialized, 1);
  assert.equal(unsaved, 1);
  assert.deepEqual(page.deck_filled_arr.map(card => card.dbx_copy_count), [2, 2]);
});

test("idle room checks do not move host options and still repair native reordering", () => {
  const settings = core.createDefaultSettings();
  const formats = select(settings.roomOrder.filter(id => id !== "ar").reverse().concat("so"));
  const room = {};
  const feature = createRooms({
    window: {}, core, getSettings: () => settings,
    document: {
      getElementById: id => id === "duel_room" ? room : null,
      querySelector: selector => selector === "#host .format_cb" ? formats : null
    },
    lifecycle: { observe() {}, listen() {} }, isVisible: element => element === room
  });
  feature.tick();
  assert.ok(formats.moves > 0);
  const initialMoves = formats.moves;
  for (let i = 0; i < 20; i++) feature.tick();
  assert.equal(formats.moves, initialMoves);
  const expected = formats.options.slice();
  formats.options.reverse();
  feature.tick();
  assert.deepEqual(formats.options, expected);
});

test("sort recovery skips hidden decks and avoids repeated layout reads, but repairs replaced controls", () => {
  let visible = false;
  let reads = 0;
  const rail = { querySelectorAll: () => [] };
  const button = { style: {}, parentElement: rail };
  let nativeSort = { style: { cssText: "top: 10px" }, parentElement: rail };
  const deck = {
    querySelector: selector => selector.includes("sort_btn") ? nativeSort : null,
    querySelectorAll: () => [], contains: element => element === button
  };
  const feature = createSorting({
    window: { getComputedStyle() { reads++; return { top: "10px", height: "27px", width: "30px", left: "0px" }; } },
    document: {
      getElementById: id => id === "deck_constructor" ? deck : id === "dbx-custom-sort-button" ? button : null,
      querySelectorAll: () => []
    }, isVisible: () => visible
  });
  feature.initialize();
  feature.tick();
  assert.equal(reads, 0);
  visible = true;
  feature.tick();
  const initialReads = reads;
  assert.ok(initialReads > 0);
  for (let i = 0; i < 20; i++) feature.tick();
  assert.equal(reads, initialReads);
  nativeSort = { ...nativeSort };
  feature.tick();
  assert.ok(reads > initialReads);
  const replacementReads = reads;
  nativeSort.style.cssText = "top: 20px";
  feature.tick();
  assert.ok(reads > replacementReads);
});

test("deck style mutations do not reindex cards; replaced controls and appended card data recover", () => {
  const settings = core.createDefaultSettings();
  settings.customBanlists = [];
  let indexed = 0;
  const card = { id: 1, get name() { indexed++; return "Card"; } };
  const page = { Cards: [card], Banlists: [], loadDeckResponse() {} };
  const deck = {};
  let pools = select(["0"]);
  const banlists = select(["native"]);
  let observer;
  const feature = createCardPools({
    window: page, core, getSettings: () => settings, isStarted: () => true,
    isVisible: element => element === deck,
    lifecycle: { observe(key, element, callback) { observer = callback; return false; } },
    document: {
      addEventListener() {}, getElementById: id => id === "deck_constructor" ? deck : null,
      querySelector: selector => selector === "#search .custom_cb" ? pools
        : selector === "#deck_constructor #banlists" ? banlists : null
    }
  });
  feature.initialize();
  assert.equal(indexed, 1);
  for (let i = 0; i < 20; i++) { observer(); feature.tick(); }
  assert.equal(indexed, 1);
  pools = select(["0"]);
  observer();
  assert.equal(indexed, 2);
  page.Cards.push({ id: 2, name: "New card" });
  feature.tick();
  assert.equal(indexed, 3);
});
