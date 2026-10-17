"use strict";
const assert = require("node:assert/strict");
const { test } = require("node:test");
const core = require("../extension/shared/enhancer-core.js");
const { create, changes } = require("../extension/shared/settings-store.js");

test("existing settings get duel-focused shortcuts without changing feature preferences", () => {
  const existing = core.createDefaultSettings();
  delete existing.popupShortcuts;
  existing.autoGoFirst = false;
  const migrated = core.sanitizeSettings(existing);
  assert.deepEqual(migrated.popupShortcuts, ["battleDamageConfirmation", "autoShuffleAfterDraw", "autoGoFirst"]);
  assert.equal(migrated.autoGoFirst, false);
  assert.equal(migrated.autoShuffleAfterDraw, false);
});

test("shortcut preferences allow none, remove duplicates and unknown IDs, and cap at four", () => {
  assert.deepEqual(core.sanitizeSettings({ popupShortcuts: [] }).popupShortcuts, []);
  assert.deepEqual(core.sanitizePopupShortcuts(["unknown", "showGridLines", "showGridLines", "rememberCardList", "autoGoFirst", "preserveLastUsed", "battleDamageConfirmation"]), ["showGridLines", "rememberCardList", "autoGoFirst", "preserveLastUsed"]);
  assert.deepEqual(core.sanitizePopupShortcuts(null), [...core.DEFAULT_POPUP_SHORTCUTS]);
});

test("pinning controls does not enable features and stale full-page edits preserve new shortcuts", async () => {
  let stored = core.createDefaultSettings();
  const baseline = structuredClone(stored);
  const store = create({ core, read: async () => stored, write: async value => { stored = value; } });
  await store.execute({ type: "update-preferences", changes: [{ path: ["popupShortcuts"], value: ["autoGoFirst", "preserveLastUsed"] }] }, true);
  assert.equal(stored.autoGoFirst, false);
  assert.equal(stored.hostDefaults.preserveLastUsed, false);
  const edit = structuredClone(baseline);
  edit.showGridLines = false;
  await store.execute({ type: "update-preferences", changes: changes(baseline, edit) }, true);
  assert.deepEqual(stored.popupShortcuts, ["autoGoFirst", "preserveLastUsed"]);
  const host = core.QUICK_SETTING_DEFINITIONS.find(item => item.id === "preserveLastUsed");
  await store.execute({ type: "update-preferences", changes: [{ path: [...host.path], value: true }] }, true);
  assert.equal(stored.hostDefaults.preserveLastUsed, true);
  assert.equal(stored.hostDefaults.duelNote, baseline.hostDefaults.duelNote);
});
