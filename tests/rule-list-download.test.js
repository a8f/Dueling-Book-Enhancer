"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { download, normalizeUrl } = require("../rule-list-download.js");
const URL = "https://raw.githubusercontent.com/example/rules/main/list.json";

test("only public raw GitHub JSON URLs are accepted", () => {
  assert.equal(normalizeUrl(URL), URL);
  for (const value of ["http://raw.githubusercontent.com/example/rules/main/list.json", "https://github.com/a/b/blob/main/list.json",
    "https://raw.githubusercontent.com.evil.test/a/b/main/list.json", URL + "?token=secret", URL + "#x",
    "https://user:secret@raw.githubusercontent.com/a/b/main/list.json", "file:///tmp/list.json", "https://raw.githubusercontent.com/a/b/list.json"]) {
    assert.throws(() => normalizeUrl(value));
  }
});

test("denied optional permission sends no network request", async () => {
  let calls = 0;
  await assert.rejects(download(URL, { requestPermission: async () => false, fetch: async () => { calls++; } }), /permission/);
  assert.equal(calls, 0);
});

test("download omits credentials, rejects redirects, and returns data without installing it", async () => {
  const calls = [];
  const text = await download(URL, { requestPermission: async input => { calls.push(input); return true; },
    fetch: async (url, options) => { calls.push({ url, options }); return new Response('{"schemaVersion":2}'); } });
  assert.equal(text, '{"schemaVersion":2}');
  assert.deepEqual(calls[0], { origins: ["https://raw.githubusercontent.com/*"] });
  assert.equal(calls[1].options.credentials, "omit");
  assert.equal(calls[1].options.redirect, "error");
  assert.equal(calls[1].options.referrerPolicy, "no-referrer");
});

test("size is bounded both with and without Content-Length; HTTP errors are explicit", async () => {
  for (const response of [new Response("x", { headers: { "content-length": "65537" } }), new Response("x".repeat(65537))]) {
    await assert.rejects(download(URL, { requestPermission: async () => true, fetch: async () => response }), /64 KB/);
  }
  await assert.rejects(download(URL, { requestPermission: async () => true,
    fetch: async () => new Response("", { status: 404 }) }), /HTTP 404/);
});
