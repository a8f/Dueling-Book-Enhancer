"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const core = require("../extension/shared/enhancer-core.js");
const { cardPage, create } = require("../extension/options/rule-list-table.js");
function fixture(count = 23) {
  return { schemaVersion: 4, id: "test.table", name: "Example list", version: "1.0.0", enabled: true,
    formats: ["au"], rules: Array.from({ length: count }, (_, i) => ({ id: "card-" + i,
      card: { passcode: String(9000001 + i).padStart(8, "0"), name: "Card " + String(i + 1).padStart(2, "0") }, label: "Effect " + (i + 1),
      action: { schemaVersion: 1, requires: { sourceZone: "graveyard", ownTurn: true, phases: ["M1", "M2"] },
      activation: [{ op: "banish", card: "source" }],
      resolution: [{ op: "special-summon", from: "deck", card: { id: 90000101, name: "Result" }, positions: ["ATK", "DEF"] }] } })) };
}
function harness() {
  const nodes = [];
  function element(tag) {
    const node = { tag, children: [], attrs: {}, listeners: {}, hidden: false,
      setAttribute(key, value) { this.attrs[key] = value; },
      appendChild(child) { this.children.push(child); },
      append(...children) { this.children.push(...children); },
      replaceChildren(...children) { this.children = children; },
      addEventListener(type, callback) { this.listeners[type] = callback; },
      click() { if (!this.disabled) this.listeners.click(); },
      change() { if (!this.disabled) this.listeners.change(); } };
    nodes.push(node);
    return node;
  }
  const container = element("div");
  const exported = [];
  let changes = 0;
  const table = create({ document: { createElement: element }, container, core,
    onChange: () => { changes++; }, onExport: id => exported.push(id) });
  const liveNodes = () => {
    const found = [];
    const visit = node => { found.push(node); node.children.forEach(visit); };
    visit(container);
    return found;
  };
  return { table, container, nodes: liveNodes, exported, changes: () => changes };
}

test("pagination groups unique cards, filters names/effects, sorts, and clamps stale pages", () => {
  const list = fixture();
  list.rules.push({ ...list.rules[0], id: "second-effect", label: "Another ability" });
  const first = cardPage(list.rules);
  assert.equal(first.all, 23);
  assert.equal(first.cards.length, 10);
  assert.equal(first.cards[0].rules.length, 2);
  const last = cardPage(list.rules, { page: 99 });
  assert.equal(last.page, 2); assert.equal(last.cards.length, 3);
  assert.equal(cardPage(list.rules, { search: "another" }).cards[0].name, "Card 01");
  assert.equal(cardPage(list.rules, { search: "09000023" }).cards[0].name, "Card 23");
  const sameName = { ...list.rules[0], card: { id: 90000201, name: list.rules[0].card.name } };
  assert.equal(cardPage([...list.rules, sameName]).all, 24);
  assert.equal(cardPage(list.rules, { pageSize: 25 }).cards.length, 23);
  const empty = cardPage(list.rules, { search: "no match", page: 4 });
  assert.equal(empty.page, 0); assert.equal(empty.start, 0); assert.equal(empty.pages, 1);
});

test("rule sets expand into paginated card tables without changing settings", () => {
  const h = harness(); h.table.render([fixture()]);
  const toggle = h.nodes().find(node => node.attrs["aria-controls"]);
  assert.equal(toggle.attrs["aria-expanded"], "false");
  toggle.click();
  assert.ok(h.nodes().some(node => node.textContent === "Card 01 (Passcode: 09000001)"));
  assert.equal(toggle.attrs["aria-expanded"], "true");
  const next = h.nodes().find(node => node.attrs["aria-label"] === "Next card page for Example list");
  next.click();
  assert.ok(h.nodes().some(node => node.textContent === "11–20 of 23 cards · Page 2 of 3"));
  h.table.render([fixture()]);
  assert.equal(h.nodes().find(node => node.attrs["aria-controls"]).attrs["aria-expanded"], "true");
  assert.ok(h.nodes().some(node => node.textContent === "11–20 of 23 cards · Page 2 of 3"));
  const search = h.nodes().find(node => node.type === "search");
  search.value = "Card 23"; search.listeners.input();
  assert.ok(h.nodes().some(node => node.textContent === "1–1 of 1 cards · Page 1 of 1"));
  assert.equal(h.changes(), 0);
});

test("format checkbox dropdown preserves at least one format and roundtrips with enabled changes", () => {
  const h = harness(), list = fixture(1); h.table.render([list]);
  const formats = h.nodes().filter(node => node.type === "checkbox" && node.value);
  const current = formats.find(node => node.value === "au"), solo = formats.find(node => node.value === "so");
  assert.equal(current.disabled, true);
  solo.checked = true; solo.change();
  assert.equal(current.disabled, false);
  current.checked = false; current.change();
  assert.equal(solo.disabled, true);
  const enabled = h.nodes().find(node => node.attrs.role === "switch");
  enabled.checked = false; enabled.change();
  assert.deepEqual(h.table.read([list])[0].formats, ["so"]);
  assert.equal(h.table.read([list])[0].enabled, false);
  assert.deepEqual(list.formats, ["au"], "render does not mutate the saved baseline");
  h.nodes().find(node => node.textContent === "Export").click();
  assert.deepEqual(h.exported, [list.id]);
  assert.equal(h.changes(), 3);
});
