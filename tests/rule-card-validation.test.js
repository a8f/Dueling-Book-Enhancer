"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { create } = require("../rule-card-validation.js");
const list = (name = "Known card", id = 123) => ({ rules: [{ card: { id, name }, resolution: [{ card: { id: 456, name: "Result" } }] }] });

test("catalog validation matches padded printed passcodes in compact and full records", async () => {
  const rules = list("Destiny HERO - Malicious");
  rules.rules[0].card = { passcode: "09411399", name: "Destiny HERO - Malicious" };
  rules.rules[0].resolution[0].card = { passcode: "09000002", name: "Result" };
  const validator = create({ requestPermission: async () => true, fetchImpl: async () => new Response(JSON.stringify({ cards: [
    { id: 1137, n: "Destiny HERO - Malicious", s: 9411399 },
    { id: 1234, name: "Result", serial_number: "09000002" }
  ] })) });
  assert.deepEqual(await validator.downloadAndCheck(rules), { checked: 2, unknown: [] });
  rules.rules[0].card.name = "Wrong card";
  assert.throws(() => validator.check(rules), /09411399.*Destiny HERO - Malicious/);
  assert.equal(validator.check(list()).checked, 0, "passcodes never match database IDs");
});

test("catalog validation is explicit, requests optional permission, and does not fetch on ordinary checks", async () => {
  let downloads = 0, permissions = 0;
  const validator = create({ requestPermission: async request => {
    permissions++;
    assert.deepEqual(request, { origins: ["https://static.duelingbook.com/*"] });
    return true;
  }, fetchImpl: async (url, options) => {
    downloads++;
    assert.equal(url, "https://static.duelingbook.com/cards.json");
    assert.equal(options.credentials, "omit");
    assert.equal(options.redirect, "error");
    assert.equal(options.cache, "no-store");
    return new Response(JSON.stringify({ cards: [{ id: 123, n: "Known card" }, { id: 456, name: "Result" }, { id: 789, n: "Unrelated" }] }));
  } });
  assert.deepEqual(validator.check(list()), { checked: 0, unknown: ["DB ID 123", "DB ID 456"] });
  assert.equal(downloads, 0); assert.equal(permissions, 0);
  assert.deepEqual(await validator.downloadAndCheck(list()), { checked: 2, unknown: [] });
  assert.equal(downloads, 1);
  assert.throws(() => validator.check(list("Wrong")), /123.*Known card.*Wrong/);
  assert.deepEqual(validator.check(list("Custom card", 789)), { checked: 1, unknown: ["DB ID 789"] }, "unrequested catalog records are discarded");
  const fresh = create({ requestPermission: async () => false });
  assert.equal(fresh.check(list()).checked, 0, "new sessions retain no catalog data");
});

test("mismatches remain known after a failed validation; unknown IDs stay usable and explicit", async () => {
  const validator = create({ requestPermission: async () => true,
    fetchImpl: async () => new Response(JSON.stringify([{ id: 123, name: "Known card" }])) });
  await assert.rejects(validator.downloadAndCheck(list("Wrong")), /belongs to/);
  assert.throws(() => validator.check(list("Wrong")), /belongs to/);
  assert.deepEqual(validator.check(list()), { checked: 1, unknown: ["DB ID 456"] });
});

test("denied permission, HTTP errors, malformed catalogs and size limits fail without accepting names", async () => {
  const denied = create({ requestPermission: async () => false, fetchImpl: () => assert.fail("must not fetch") });
  await assert.rejects(denied.downloadAndCheck(list()), /not granted/);
  for (const [response, expected] of [
    [new Response("", { status: 503 }), /HTTP 503/],
    [new Response("{}"), /Invalid card catalog/],
    [new Response("not json"), /JSON/],
    [new Response("{}", { headers: { "content-length": String(33 * 1024 * 1024) } }), /32 MB/],
    [new Response(new Uint8Array(33 * 1024 * 1024)), /32 MB/]
  ]) {
    const validator = create({ requestPermission: async () => true, fetchImpl: async () => response });
    await assert.rejects(validator.downloadAndCheck(list()), expected);
    assert.equal(validator.check(list()).checked, 0);
  }
});
