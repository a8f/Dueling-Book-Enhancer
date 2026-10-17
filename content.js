(function startDuelingBookEnhancer() {
  "use strict";

  const core = window.DBEnhancerCore;
  const CHANNEL = "dueling-book-enhancer-v1";
  const COMMAND_EVENT = "dueling-book-enhancer-v1-command";
  const SETTINGS_EVENT = "dueling-book-enhancer-v1-settings";
  const ENHANCER_VERSION = "1.1.5";
  const seenSettingsDeliveries = new Set();
  let commandSequence = 0;
  let settings = core ? core.createDefaultSettings() : null;
  let started = false;
  let settingsReceived = false;
  const features = [];
  if (!core) throw new Error("Dueling Book Enhancer core did not load.");

  function postToBridge(type, payload) {
    const message = Object.assign(
      {
        channel: CHANNEL,
        source: "page-main",
        type: type,
        requestId: "command-" + Date.now() + "-" + ++commandSequence
      },
      payload || {}
    );

    window.postMessage(message, "*");

    try {
      document.dispatchEvent(
        new CustomEvent(COMMAND_EVENT, {
          detail: JSON.stringify(message)
        })
      );
    } catch (error) {
      console.debug(
        "[Dueling Book Enhancer] DOM command relay was unavailable.",
        error
      );
    }
  }

  function isVisible(element) {
    return Boolean(element && window.getComputedStyle(element).display !== "none");
  }

  function invoke(feature, method, ...args) {
    try { if (feature[method]) feature[method](...args); }
    catch (error) { console.error("[Dueling Book Enhancer] Feature " + feature.id + " failed during " + method, error); }
  }

  const context = { window, document, core, postToBridge, isVisible, getSettings: () => settings, isStarted: () => started };
  for (const [id, create] of Object.entries(window.DBEnhancerFeatures)) {
    features.push({ id, ...create({ ...context, lifecycle: window.DBEnhancerLifecycle.create(window) }) });
  }

  function initializeDomFeatures() {
    if (started) return;
    started = true;
    features.forEach(feature => invoke(feature, "initialize"));
    if (window.DBEnhancerDuelEvents) window.DBEnhancerDuelEvents.install();
    window.setInterval(() => {
      features.forEach(feature => invoke(feature, "tick"));
      if (window.DBEnhancerDuelEvents) window.DBEnhancerDuelEvents.install();
    }, 500);
  }

  function receiveBridgeSettings(message) {
    if (!message || message.channel !== CHANNEL || message.source !== "extension-bridge" || message.type !== "settings") return;
    if (message.deliveryId) {
      if (seenSettingsDeliveries.has(message.deliveryId)) return;
      if (seenSettingsDeliveries.size > 200) seenSettingsDeliveries.clear();
      seenSettingsDeliveries.add(message.deliveryId);
    }
    const previous = settings;
    settings = core.sanitizeSettings(message.settings);
    // Deliver before DOM startup too: a saved RPS mode must initialize correctly.
    features.forEach(feature => {
      if (!settingsReceived || !feature.settingsKeys || feature.settingsKeys.some(key => JSON.stringify(previous[key]) !== JSON.stringify(settings[key]))) {
        invoke(feature, "settingsChanged", previous);
      }
    });
    settingsReceived = true;
  }

  window.addEventListener("message", event => {
    if (event.source === window) receiveBridgeSettings(event.data);
  });
  document.addEventListener(SETTINGS_EVENT, event => {
    try { receiveBridgeSettings(JSON.parse(event.detail)); }
    catch (error) { console.debug("[Dueling Book Enhancer] Invalid settings relay.", error); }
  });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initializeDomFeatures, { once: true });
  else initializeDomFeatures();
  postToBridge("request-settings");
  window.DBEnhancerDiagnostics = {
    version: ENHANCER_VERSION,
    duelEvents: () => window.DBEnhancerDuelEvents ? window.DBEnhancerDuelEvents.diagnostics() : null,
    ...Object.assign({}, ...features.map(feature => feature.diagnostics || {}))
  };
})();
