"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mkdtemp, writeFile } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const core = require("../enhancer-core.js");
const { create, mergeList } = require("../rule-list-watch.js");
const { normalizeLocalUrl } = require("../rule-list-download.js");

function fixture() {
  return { schemaVersion: 3, id: "test.local", name: "Local example", version: "1.0.0", formats: ["au"],
    rules: [{ id: "recruit", label: "Example effect", card: { passcode: "09000001", name: "Example card" },
      requires: { sourceZone: "graveyard", ownTurn: true, phases: ["M1"] },
      activation: [{ op: "banish", card: "source" }],
      resolution: [{ op: "special-summon", from: "deck", card: { passcode: "09000002", name: "Example result" }, positions: ["DEF"] }] }] };
}
function harness() {
  let text = JSON.stringify(fixture()), next, writes = [], failWrite = false;
  const statuses = [];
  const watcher = create({ core, read: async () => text,
    apply: async list => { if (failWrite) throw new Error("Storage unavailable"); writes.push(list); },
    status: (text, state) => statuses.push({ text, state }),
    schedule: callback => { next = callback; return 1; }, cancel: () => { next = null; } });
  return { watcher, statuses, writes, tick: async () => { const callback = next; next = null; await callback(); },
    text: value => { text = value; }, fail: value => { failWrite = value; } };
}

test("local watcher applies initial and edited definitions without repeat writes or version bumps", async () => {
  const h = harness(); await h.watcher.start();
  assert.equal(h.writes.length, 1);
  await h.tick(); assert.equal(h.writes.length, 1);
  const edited = fixture(); edited.rules[0].label = "Changed effect";
  h.text(JSON.stringify(edited)); await h.tick();
  assert.equal(h.writes.length, 2);
  assert.equal(h.writes[1].version, "1.0.0");
  h.text("{incomplete"); await h.tick();
  assert.equal(h.writes.length, 2);
  assert.equal(h.statuses.at(-1).state, "error");
  h.text(JSON.stringify(edited)); await h.tick();
  assert.equal(h.statuses.at(-1).state, "updated");
  assert.equal(h.writes.length, 2);
  h.watcher.stop();
});

test("watch retries failed writes and refuses an unexpected change of list identity", async () => {
  const h = harness(); h.fail(true); await h.watcher.start();
  assert.equal(h.writes.length, 0);
  h.fail(false); await h.tick(); assert.equal(h.writes.length, 1);
  const other = fixture(); other.id = "different";
  h.text(JSON.stringify(other)); await h.tick();
  assert.equal(h.writes.length, 1);
  assert.match(h.statuses.at(-1).text, /ID changed/);
  h.watcher.stop();
});

test("stopping during a read prevents its eventual data from being applied", async () => {
  let release, writes = 0;
  const watcher = create({ core, read: () => new Promise(resolve => { release = resolve; }),
    apply: async () => { writes++; }, status() {}, schedule: () => { throw new Error("Must not reschedule"); } });
  const operation = watcher.start(); watcher.stop(); release(JSON.stringify(fixture())); await operation;
  assert.equal(writes, 0);
});

test("local updates preserve disabled state and format overrides; new watched lists enable explicitly", () => {
  const list = core.importAutomationList(JSON.stringify(fixture()));
  const existing = { ...list, enabled: false, formats: ["so"] };
  const edited = structuredClone(list); edited.rules[0].label = "Edited";
  const result = mergeList([existing], edited);
  assert.equal(result[0].enabled, false);
  assert.deepEqual(result[0].formats, ["so"]);
  assert.equal(result[0].rules[0].label, "Edited");
  assert.equal(existing.rules[0].label, "Example effect");
  assert.equal(mergeList([], list)[0].enabled, true);
  assert.throws(() => mergeList(Array.from({ length: 50 }, (_, id) => ({ ...list, id: String(id) })), list));
});

test("local URL validation expands bare filenames and allows only loopback JSON files", () => {
  assert.equal(normalizeLocalUrl("edison.json"), "http://127.0.0.1:8765/edison.json");
  assert.equal(normalizeLocalUrl("  custom-list.v2.json  "), "http://127.0.0.1:8765/custom-list.v2.json");
  assert.equal(normalizeLocalUrl("http://127.0.0.1:8765/example.json"), "http://127.0.0.1:8765/example.json");
  assert.equal(normalizeLocalUrl("http://127.0.0.1:9000/example.json"), "http://127.0.0.1:9000/example.json");
  for (const url of ["http://localhost:8765/example.json", "http://192.168.1.1/example.json", "https://example.com/example.json",
    "http://user:secret@127.0.0.1/example.json", "http://127.0.0.1/.git/config", "http://127.0.0.1/example.json?x=1",
    "", "../edison.json", "folder/edison.json", "//example.com/edison.json", "edison.json?x=1", "edison.json#fragment"]) {
    assert.throws(() => normalizeLocalUrl(url));
  }
});

test("local server reads current edits, stays read-only, and rejects unrelated origins and paths", async t => {
  const { serveRuleLists } = await import("../scripts/serve-rule-lists.mjs");
  const root = await mkdtemp(path.join(os.tmpdir(), "dbx-local-rules-"));
  await writeFile(path.join(root, "example.json"), JSON.stringify(fixture()));
  const server = await serveRuleLists(root, 0);
  t.after(() => server.close());
  const base = "http://127.0.0.1:" + server.address().port;
  assert.equal((await (await fetch(base + "/example.json")).json()).name, "Local example");
  await writeFile(path.join(root, "example.json"), "{edited}");
  assert.equal(await (await fetch(base + "/example.json")).text(), "{edited}");
  assert.equal((await fetch(base + "/.git/config")).status, 404);
  assert.equal((await fetch(base + "/example.json", { method: "POST" })).status, 405);
  assert.equal((await fetch(base + "/example.json", { headers: { Origin: "https://example.com" } })).status, 403);
  const fromExtension = await fetch(base + "/example.json", { headers: { Origin: "moz-extension://abc-123" } });
  assert.equal(fromExtension.headers.get("access-control-allow-origin"), "moz-extension://abc-123");
  assert.equal(fromExtension.headers.get("cache-control"), "no-store");
  await writeFile(path.join(root, "large.json"), "x".repeat(65537));
  assert.equal((await fetch(base + "/large.json")).status, 413);
});
