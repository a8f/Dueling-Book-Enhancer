"use strict";
const assert = require("node:assert/strict");
const { test } = require("node:test");
const core = require("../extension/shared/enhancer-core.js");
const store = require("../extension/shared/settings-store.js");
const createFeature = require("../extension/page/features/intro.js");

test("intro skipping defaults on for existing settings and preserves a saved opt-out", () => {
  assert.equal(core.createDefaultSettings().autoSkipIntro, true);
  assert.equal(core.sanitizeSettings({ autoGoFirst: true }).autoSkipIntro, true);
  const settings = core.createDefaultSettings();
  const updated = store.applyChanges(settings, store.changes(settings, { ...settings, autoSkipIntro: false }));
  assert.equal(core.sanitizeSettings(updated).autoSkipIntro, false);
});

test("intro automation waits for preferences and native startup, then skips once", () => {
  const settings = core.createDefaultSettings();
  const elements = { start: { visible: true }, skip_intro_btn: { visible: true } };
  const observers = {};
  let calls = 0;
  const page = { currentLabel: "start" };
  const feature = createFeature({
    window: page,
    document: { getElementById: id => elements[id] },
    lifecycle: { observe(key, target, callback) { observers[key] = callback; } },
    isVisible: element => Boolean(element?.visible),
    getSettings: () => settings
  });
  page.skipIntro = () => { calls++; page.currentLabel = "front_page"; };
  feature.initialize();
  assert.equal(calls, 0, "defaults must not override a pending saved preference");
  settings.autoSkipIntro = false;
  feature.settingsChanged();
  feature.tick();
  assert.equal(calls, 0);
  settings.autoSkipIntro = true;
  page.currentLabel = "loading";
  feature.settingsChanged();
  assert.equal(calls, 0, "native initialization must finish first");
  page.currentLabel = "start";
  elements.start.visible = false;
  feature.tick();
  assert.equal(calls, 0);
  elements.start.visible = true;
  elements.skip_intro_btn.visible = false;
  feature.tick();
  assert.equal(calls, 0);
  elements.skip_intro_btn.visible = true;
  const nativeSkip = page.skipIntro;
  delete page.skipIntro;
  feature.tick();
  assert.equal(calls, 0, "wait for the native action to become available");
  page.skipIntro = nativeSkip;
  observers["intro-screen"]();
  assert.equal(calls, 1);
  for (let i = 0; i < 10; i++) feature.tick();
  assert.equal(calls, 1, "the front page is left alone");
});
