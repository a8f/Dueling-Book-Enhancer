(function attach(root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory;
  else (root.DBEnhancerFeatures ||= {})["intro"] = factory;
})(typeof window !== "undefined" ? window : globalThis, function createFeature(context) {
  "use strict";
  const { window, document, lifecycle, isVisible } = context;
  let settingsReceived = false;

  function skip() {
    // Wait for saved preferences so an explicit opt-out wins over the default.
    // The native action cleans up animation timers/tweens and opens the front page.
    if (!settingsReceived || !context.getSettings().autoSkipIntro || window.currentLabel !== "start") return;
    const start = document.getElementById("start");
    const button = document.getElementById("skip_intro_btn");
    if (isVisible(start) && isVisible(button) && typeof window.skipIntro === "function") window.skipIntro();
  }

  function tick() {
    lifecycle.observe("intro-screen", document.getElementById("start"), skip);
    lifecycle.observe("intro-button", document.getElementById("skip_intro_btn"), skip);
    skip();
  }

  return {
    initialize: tick,
    tick,
    settingsKeys: ["autoSkipIntro"],
    settingsChanged() {
      settingsReceived = true;
      if (!context.isStarted || context.isStarted()) tick();
    }
  };
});
