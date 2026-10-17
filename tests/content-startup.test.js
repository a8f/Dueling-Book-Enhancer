"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { test } = require("node:test");

function start(readyState = "loading", failingFeature = false) {
  const documentListeners = {};
  const windowListeners = {};
  const intervals = [];
  const errors = [];
  const sent = [];
  const toggles = [];
  const document = {
    readyState,
    documentElement: readyState === "loading" ? null : { classList: { toggle: (...args) => toggles.push(args) } },
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener(type, handler) { (documentListeners[type] ||= []).push(handler); },
    dispatchEvent(event) { (documentListeners[event.type] || []).forEach(handler => handler(event)); }
  };
  const page = vm.createContext({
    document,
    console: { debug() {}, warn: (...args) => errors.push(args), error: (...args) => errors.push(args) },
    addEventListener(type, handler) { windowListeners[type] = handler; },
    postMessage(message) { sent.push(message); },
    setInterval(callback) { intervals.push(callback); },
    setTimeout() {},
    getComputedStyle: element => element.style,
    CustomEvent: function(type, options) { this.type = type; this.detail = options.detail; }
  });
  page.window = page;
  const scripts = require("../extension/manifest.json").content_scripts[0].js;
  for (const script of scripts) {
    if (script === "page/content.js" && failingFeature) {
      page.DBEnhancerFeatures.broken = () => ({
        initialize() { throw new Error("broken initialization"); },
        tick() { throw new Error("broken health check"); }
      });
    }
    vm.runInContext(fs.readFileSync(require.resolve("../extension/" + script), "utf8"), page, { filename: script });
  }
  return {
    page, errors, sent, toggles, intervals,
    settings(settings, deliveryId) {
      const message = { channel: "dueling-book-enhancer-v1", source: "extension-bridge", type: "settings", settings, deliveryId };
      // Identity must be from inside the VM's window realm.
      page.message = message;
      page.receive = windowListeners.message;
      vm.runInContext("receive({ source: window, data: message })", page);
      document.dispatchEvent({ type: "dueling-book-enhancer-v1-settings", detail: JSON.stringify(message) });
    },
    ready() {
      document.documentElement = { classList: { toggle: (...args) => toggles.push(args) } };
      document.readyState = "complete";
      (documentListeners.DOMContentLoaded || []).forEach(handler => handler());
    }
  };
}

test("manifest scripts start before DOM readiness and accept settings over both transports once", () => {
  const h = start();
  assert.equal(h.sent[0].type, "request-settings");
  h.settings({ showGridLines: false }, "initial");
  assert.equal(h.toggles.length, 0, "DOM work waits for readiness");
  h.ready();
  assert.equal(h.intervals.length, 1);
  assert.deepEqual(h.toggles, [["dbx-hide-greenlines", true]]);
  h.settings({ showGridLines: true }, "updated");
  assert.equal(h.toggles.length, 2, "duplicate relay delivery does not apply twice");
  h.settings({ showGridLines: true, autoPickRps: true }, "rps-only");
  assert.equal(h.toggles.length, 2, "unrelated settings do not reapply appearance");
  h.ready();
  assert.equal(h.intervals.length, 1, "startup is idempotent");
  for (let i = 0; i < 5; i++) h.intervals[0]();
  assert.deepEqual(h.errors, []);
  assert.equal(typeof h.page.DBEnhancerDiagnostics.cardpool, "function");
  assert.equal(typeof h.page.DBEnhancerDiagnostics.deckMemory, "function");
});

test("scripts also start when DOM is ready and tolerate absent native controls", () => {
  const h = start("complete");
  h.intervals[0]();
  assert.deepEqual(h.errors, []);
  assert.equal(h.intervals.length, 1);
});

test("one feature failure does not prevent other features or future health checks", () => {
  const h = start("complete", true);
  assert.equal(h.errors.length, 1);
  assert.equal(h.toggles.length, 1);
  h.intervals[0]();
  assert.equal(h.errors.length, 2);
  h.settings({ showGridLines: false }, "after-failure");
  assert.equal(h.toggles.at(-1)[1], true);
});
