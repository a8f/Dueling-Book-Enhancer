"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { create } = require("../extension/page/lifecycle.js");

test("observers reconnect to replaced elements without accumulating old observers", () => {
  const observers = [];
  const lifecycle = create({ MutationObserver: class {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe(target) { this.target = target; }
    disconnect() { this.disconnected = true; }
  } });
  const original = {};
  const replacement = {};
  assert.equal(lifecycle.observe("panel", original, () => {}), true);
  assert.equal(lifecycle.observe("panel", original, () => {}), false);
  assert.equal(observers.length, 1);
  assert.equal(lifecycle.observe("panel", replacement, () => {}), true);
  assert.equal(observers[0].disconnected, true);
  assert.equal(observers[1].target, replacement);
  lifecycle.observe("panel", null, () => {});
  assert.equal(observers[1].disconnected, true);
  lifecycle.dispose();
});

test("listeners move to replacement elements and dispose cleanly", () => {
  const events = [];
  const element = id => ({
    addEventListener(...args) { events.push([id, "add", ...args]); },
    removeEventListener(...args) { events.push([id, "remove", ...args]); }
  });
  const lifecycle = create({});
  const a = element("a");
  const b = element("b");
  const handler = () => {};
  lifecycle.listen("scroll", a, "scroll", handler, true);
  lifecycle.listen("scroll", a, "scroll", handler, true);
  lifecycle.listen("scroll", b, "scroll", handler, true);
  lifecycle.dispose();
  assert.deepEqual(events.map(event => event.slice(0, 2)), [["a", "add"], ["a", "remove"], ["b", "add"], ["b", "remove"]]);
  assert.ok(events.every(event => event[3] === handler && event[4] === true));
});
