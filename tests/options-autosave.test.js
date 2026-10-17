"use strict";
const assert = require("node:assert/strict");
const { test } = require("node:test");
const core = require("../enhancer-core.js");
const store = require("../settings-store.js");
const { create } = require("../options-autosave.js");

function harness() {
  let form = core.createDefaultSettings();
  let stored = structuredClone(form);
  let invalid = false;
  let failure = false;
  let release;
  let blocked = null;
  const writes = [];
  const statuses = [];
  const autosave = create({
    baseline: structuredClone(form), store,
    read() {
      if (invalid) throw new Error("Invalid color");
      return structuredClone(form);
    },
    async write(command) {
      writes.push(command);
      if (blocked) await blocked;
      if (failure) throw new Error("Storage unavailable");
      stored = store.applyChanges(stored, command.changes);
      if (command.resetDeckMemory) stored.deckCardpools = {};
      return structuredClone(stored);
    },
    status: (message, state) => statuses.push({ message, state })
  });
  return {
    autosave, writes, statuses,
    get form() { return form; }, set form(value) { form = value; },
    get stored() { return stored; },
    invalid(value) { invalid = value; }, fail(value) { failure = value; },
    block() { blocked = new Promise(resolve => { release = resolve; }); },
    release() { blocked = null; release(); }
  };
}

test("autosave persists text without blur or submit and skips unchanged values", async () => {
  const h = harness();
  h.form.hostDefaults.duelNote = "My duel";
  await h.autosave.save();
  assert.equal(h.stored.hostDefaults.duelNote, "My duel");
  await h.autosave.save();
  assert.equal(h.writes.length, 1);
  assert.equal(h.statuses.at(-1).state, "saved");
});

test("typing while a write is pending is saved next without reverting concurrent site preferences", async () => {
  const h = harness();
  h.block();
  h.form.hostDefaults.duelNote = "First";
  const saving = h.autosave.save();
  await Promise.resolve();
  h.stored.hostDefaults.watchNote = "Newer site default";
  h.form.hostDefaults.duelNote = "Latest";
  h.autosave.save();
  h.form.showGridLines = false;
  h.autosave.save();
  h.release();
  await saving;
  assert.equal(h.writes.length, 2);
  assert.equal(h.stored.hostDefaults.duelNote, "Latest");
  assert.equal(h.stored.hostDefaults.watchNote, "Newer site default");
  assert.equal(h.stored.showGridLines, false);
  assert.equal(h.form.hostDefaults.duelNote, "Latest");
});

test("invalid input stays unsaved and correction resumes automatic saving", async () => {
  const h = harness();
  h.invalid(true);
  await h.autosave.save();
  assert.equal(h.writes.length, 0);
  assert.equal(h.statuses.at(-1).state, "invalid");
  h.invalid(false);
  h.form.appearance.mode = "light";
  await h.autosave.save();
  assert.equal(h.stored.appearance.mode, "light");
  assert.equal(h.statuses.at(-1).state, "saved");
});

test("failed writes retain edits for retry and confirmed resets clear deck memory", async () => {
  const h = harness();
  h.form.hostDefaults.duelNote = "Keep me";
  h.fail(true);
  await h.autosave.save();
  assert.equal(h.statuses.at(-1).state, "error");
  assert.equal(h.stored.hostDefaults.duelNote, "");
  h.fail(false);
  await h.autosave.save();
  assert.equal(h.stored.hostDefaults.duelNote, "Keep me");
  h.stored.deckCardpools[42] = { kind: "native", value: "tcg" };
  h.form = core.createDefaultSettings();
  await h.autosave.save(true);
  assert.deepEqual(h.stored.deckCardpools, {});
  assert.equal(h.stored.hostDefaults.duelNote, "");
  assert.equal(h.writes.at(-1).resetDeckMemory, true);
});
