"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const core = require("../enhancer-core.js");
const { create, changes, applyChanges } = require("../settings-store.js");

test("preference patches preserve disjoint nested edits, removals and runtime mappings", async () => {
  let stored = core.createDefaultSettings();
  stored.customColors = { main: { color: "red", opacity: 0.5 } };
  const baseline = structuredClone(stored);
  const candidate = structuredClone(baseline);
  delete candidate.customColors.main.opacity;
  candidate.deckCardpools[42] = { kind: "native", value: "stale" };
  const updates = changes(baseline, candidate);
  assert.deepEqual(updates, [{ path: ["customColors", "main", "opacity"], remove: true }]);
  stored.customColors.main.color = "blue";
  stored.deckCardpools[43] = { kind: "native", value: "new" };
  const merged = applyChanges(stored, updates);
  assert.equal(merged.customColors.main.color, "blue");
  assert.equal(merged.customColors.main.opacity, undefined);
  assert.equal(merged.deckCardpools[43].value, "new");
});

test("editing RPS mode replaces both flags even when one matches the old snapshot", async () => {
  let stored = core.createDefaultSettings();
  const snapshot = structuredClone(stored);
  const edited = structuredClone(snapshot);
  edited.autoPickRps = true;
  const store = create({ core, read: async () => stored, write: async value => { stored = value; } });
  await store.execute({ type: "save-rps-mode", mode: "automatic" });
  await store.execute({ type: "update-preferences", changes: changes(snapshot, edited) }, true);
  assert.equal(stored.autoStartRps, false);
  assert.equal(stored.autoPickRps, true);
});

test("adding a nested preference preserves concurrently added sibling fields", () => {
  const baseline = core.createDefaultSettings();
  const edited = structuredClone(baseline);
  edited.customColors.main = { color: "red" };
  const latest = structuredClone(baseline);
  latest.customColors.main = { opacity: 0.5 };
  assert.deepEqual(applyChanges(latest, changes(baseline, edited)).customColors.main, { opacity: 0.5, color: "red" });
});

test("a storage failure is reported and the queue recovers for subsequent commands", async () => {
  let stored;
  let fail = true;
  const store = create({ core, read: async () => stored, write: async value => {
    if (fail) { fail = false; throw new Error("Storage quota exceeded"); }
    stored = value;
  } });
  const first = store.execute({ type: "save-rps-mode", mode: "automatic" });
  const second = store.execute({ type: "save-rps-mode", mode: "repeat" });
  await assert.rejects(first, /quota/);
  await second;
  assert.equal(stored.autoStartRps, false);
  assert.equal(stored.autoPickRps, true);
});

test("patches cannot write runtime state, unknown roots or prototype paths", () => {
  const settings = core.createDefaultSettings();
  for (const path of [["deckCardpools"], ["schemaVersion"], ["unknown"], ["hostDefaults", "__proto__", "injected"]]) {
    assert.throws(() => applyChanges(settings, [{ path, value: true }]), /Invalid settings path/);
  }
  assert.equal({}.injected, undefined);
});

test("ordinary options saves preserve deck memory; explicit reset clears it", async () => {
  let stored = core.createDefaultSettings();
  stored.deckCardpools[42] = { kind: "native", value: "goat" };
  const store = create({ core, read: async () => stored, write: async value => { stored = value; } });
  await store.execute({ type: "update-preferences", changes: [] }, true);
  assert.equal(stored.deckCardpools[42].value, "goat");
  await store.execute({ type: "update-preferences", changes: [], resetDeckMemory: true }, true);
  assert.deepEqual(stored.deckCardpools, {});
});
