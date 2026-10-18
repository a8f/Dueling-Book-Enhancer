"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { existsSync } = require("node:fs");
const core = require("../extension/shared/enhancer-core.js");

const action = () => core.banishSummonAction({ card: { passcode: "09000002", name: "Example Result" }, positions: ["DEF"] });
const list = () => ({ schemaVersion: 4, id: "example", name: "Example", version: "1.0.0", formats: ["so"],
  rules: [{ id: "effect", card: { passcode: "09000001", name: "Example Source" }, label: "Example effect", action: action() }] });

test("spec 1 is independently validated and spec 2 embeds the same definition", () => {
  const input = action(), checked = core.validateAutomationAction(input);
  assert.deepEqual(checked, input);
  checked.timing.phases.push("EP");
  assert.equal(input.timing.phases.length, 2);
  const imported = core.importAutomationList(JSON.stringify({ ...list(), enabled: true }));
  assert.equal(imported.enabled, false);
  assert.equal(JSON.parse(core.exportAutomationList(imported)).enabled, undefined);
  assert.deepEqual(imported.rules[0].action, input);
});

test("breaking contracts reject old, future, mixed and incomplete definitions", () => {
  for (const version of [1, 2, 3, 5]) assert.throws(() => core.validateAutomationList({ ...list(), schemaVersion: version }));
  for (const key of ["schemaVersion", "source", "timing", "filters", "activation", "resolution", "coverage"]) {
    const value = action(); delete value[key];
    assert.throws(() => core.validateAutomationAction(value), key);
  }
  for (const extra of [{ schemaVersion: 1 }, { subscriptions: [] }, { callback: "send" }, { resolution: [{ op: "draw", count: 1 }] }]) {
    assert.throws(() => core.validateAutomationAction({ ...action(), ...extra }));
  }
  const flat = list(); Object.assign(flat.rules[0], flat.rules[0].action); delete flat.rules[0].action;
  assert.throws(() => core.validateAutomationList(flat));
  const repeated = list(); repeated.formats.push("so");
  assert.throws(() => core.validateAutomationList(repeated));
  const phases = action(); phases.timing.phases.push("M1");
  assert.throws(() => core.validateAutomationAction(phases));
});

test("semantic validation crosses action and metadata boundaries", () => {
  const value = list(); value.rules[0].action.resolution[0].card = { ...value.rules[0].card, name: "Conflicting name" };
  assert.throws(() => core.validateAutomationList(value), /belongs to/);
  const duplicated = list(); duplicated.rules.push(structuredClone(duplicated.rules[0]));
  assert.throws(() => core.validateAutomationList(duplicated));
});

test("effect contracts reject unsupported lifecycle semantics and incomplete coverage", () => {
  for (const mutate of [value => value.coverage.manual = [],
    value => value.activation.costs[0].reason = "effect",
    value => value.activation.targets.push({ card: "source" }),
    value => value.resolution[0].position.choice = "missing",
    value => value.timing.verification = "automatic",
    value => value.timing.turn = "either",
    value => value.resolution[0].onNoMonsterZone = { op: "send-to-graveyard", reason: "effect" }]) {
    const value = action(); mutate(value);
    assert.throws(() => core.validateAutomationAction(value));
  }
  const trigger = core.summonChoiceAction({ monsterNamePrefixes: ["Example "] });
  const target = structuredClone(trigger); target.resolution[0].cases.destroy[0].selection.at = "activation";
  assert.throws(() => core.validateAutomationAction(target));
  trigger.coverage.manual = trigger.coverage.manual.filter(code => code !== "opponent-movement");
  assert.throws(() => core.validateAutomationAction(trigger));
});

test("the transport limit counts UTF-8 bytes including whitespace", () => {
  const base = JSON.stringify(list());
  assert.doesNotThrow(() => core.importAutomationList(base + " ".repeat(65536 - Buffer.byteLength(base))));
  assert.throws(() => core.importAutomationList(base + " ".repeat(65537 - Buffer.byteLength(base))), /64 KB/);
  const value = list(); value.name = "界".repeat(80);
  const json = JSON.stringify(value);
  const text = json + " ".repeat(65536 - json.length);
  assert.equal(text.length, 65536);
  assert.throws(() => core.importAutomationList(text), /64 KB/);
});

test("optional extractor checkout has exact contract and schema copies", {
  skip: !existsSync(require("node:path").join(__dirname, "../card-rule-extractor/extract-card-rules.mjs"))
}, async () => {
  const { syncAutomationContracts } = await import("../scripts/sync-automation-contracts.mjs");
  await syncAutomationContracts({ check: true });
  const vendor = (await import("../card-rule-extractor/schema-4.mjs")).default;
  assert.deepEqual(vendor.validateAutomationAction(action()), core.validateAutomationAction(action()));
  assert.deepEqual(vendor.importAutomationList(JSON.stringify(list())), core.importAutomationList(JSON.stringify(list())));
});
