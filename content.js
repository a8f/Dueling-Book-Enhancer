(function startDuelingBookEnhancer() {
  "use strict";

  const core = window.DBEnhancerCore;
  const CHANNEL = "dueling-book-enhancer-v1";
  const COMMAND_EVENT = "dueling-book-enhancer-v1-command";
  const SETTINGS_EVENT = "dueling-book-enhancer-v1-settings";
  const ENHANCER_VERSION = "1.1.6";
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
    catch (error) {
      if (window.DBEnhancerDebug) window.DBEnhancerDebug.error("feature-error", error, { feature: feature.id, method });
      else console.error("[Dueling Book Enhancer] Feature " + feature.id + " failed during " + method, error);
    }
  }

  const context = { window, document, core, postToBridge, isVisible, getSettings: () => settings, isStarted: () => started,
    reportIssue: (type, details) => window.DBEnhancerDebug?.record(type, details) };
  for (const [id, create] of Object.entries(window.DBEnhancerFeatures)) {
    try { features.push({ id, ...create({ ...context, lifecycle: window.DBEnhancerLifecycle.create(window) }) }); }
    catch (error) {
      window.DBEnhancerDebug?.error("feature-error", error, { feature: id, method: "create" });
      console.error("[Dueling Book Enhancer] Feature " + id + " failed during create", error);
    }
  }

  function installDuelEvents() {
    try { if (window.DBEnhancerDuelEvents) window.DBEnhancerDuelEvents.install(); }
    catch (error) { window.DBEnhancerDebug?.error("duel-hooks-error", error); }
  }

  function initializeDomFeatures() {
    if (started) return;
    started = true;
    features.forEach(feature => invoke(feature, "initialize"));
    installDuelEvents();
    window.setInterval(() => {
      features.forEach(feature => invoke(feature, "tick"));
      installDuelEvents();
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
    runtime: () => ({ started, settingsReceived, features: features.map(feature => feature.id) }),
    duelEvents: () => window.DBEnhancerDuelEvents ? window.DBEnhancerDuelEvents.diagnostics() : null,
    ...Object.assign({}, ...features.map(feature => feature.diagnostics || {}))
  };
})();
