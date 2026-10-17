(function attach(root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory;
  else (root.DBEnhancerFeatures ||= {})["rps"] = factory;
})(typeof window !== "undefined" ? window : globalThis, function createFeature(context) {
  "use strict";
  const { window, document, core, postToBridge, isVisible, lifecycle } = context;
  const random = context.random || Math.random;
  const state = {
    get settings() { return context.getSettings(); },
    rpsAutoStarted: false,
    rpsFirstPickMade: false,
    rpsWaitForManualPick: false,
    rpsSettingsReceived: false,
    rpsWasReady: false,
    rpsCard: null
  };
  function randomRpsCards() {
    if (state.settings.rpsEnhancements === false) return [];
    const panel = document.getElementById("rps_start");
    if (!panel || !isVisible(panel)) return [];
    // Only the local player's selectable cards receive this native class.
    // Use the DOM rather than globals or jQuery's private event registry.
    const cards = Array.from(panel.querySelectorAll(".rps_card"));
    if (cards.length !== 3) return [];
    if (cards.some(function cardIsUnavailable(card) {
      const content = card.querySelector(".content");
      // Native selection disables the contents immediately. The lower row's
      // center is 478 (478.1 after the initial reveal); wait for it to settle.
      const top = parseFloat(card.style.top);
      return !content || !Number.isFinite(top) || Math.abs(top - 478) > 0.2 ||
        window.getComputedStyle(content).pointerEvents === "none";
    })) return [];
    return cards;
  }

  function pickRandomRps() {
    const cards = randomRpsCards();
    if (!cards.length) return;
    // Use the same content surface and native handler as a manual card pick.
    cards[Math.floor(random() * cards.length)].querySelector(".content").click();
    syncRpsControls(false);
  }

  function syncRpsControls(allowAutoPick) {
    const panel = document.getElementById("rps_start");
    if (!panel) return;
    if (state.settings.rpsEnhancements === false) {
      const control = document.getElementById("dbx-auto-rps-control");
      if (control) control.hidden = true;
      state.rpsAutoStarted = false;
      state.rpsFirstPickMade = false;
      state.rpsWaitForManualPick = false;
      state.rpsWasReady = false;
      state.rpsCard = null;
      return;
    }
    let control = document.getElementById("dbx-auto-rps-control");
    if (!control) {
      control = document.createElement("div");
      control.id = "dbx-auto-rps-control";
      const shadow = control.attachShadow({ mode: "open" });
      const style = document.createElement("style");
      style.textContent = `
        .modes { display:flex; height:30px; border:1px solid #637982;
          border-radius:4px; overflow:hidden; box-sizing:border-box;
          background:linear-gradient(#303c43,#141b20); }
        button { appearance:none; border:0; border-right:1px solid #637982;
          margin:0; padding:0 11px; flex:1; background:transparent;
          color:#b8c7cf; font:600 13px/1 Arial,sans-serif; white-space:nowrap;
          cursor:pointer; pointer-events:auto; }
        button:last-child { border-right:0; }
        button:hover { background:#344b58; color:#fff; }
        button[aria-pressed="true"] { background:linear-gradient(#376273,#1d3b49);
          color:#d9f8ff; box-shadow:inset 0 2px 0 #58cce9; }
        button:focus-visible { outline:2px solid #65dfff; outline-offset:-3px; }
      `;
      shadow.appendChild(style);
      const modes = document.createElement("div");
      modes.className = "modes";
      modes.setAttribute("role", "group");
      modes.setAttribute("aria-label", "RPS automation");
      [
        ["manual", "Manual", "Choose each round yourself."],
        ["repeat", "Random on tie", "Choose your first card manually; after a tie, pick randomly for you."],
        ["automatic", "Automatic", "Pick randomly now, repeat after ties, and start automatically in future duels."]
      ].forEach(function createRpsMode(option) {
        const segment = document.createElement("button");
        segment.id = "dbx-rps-mode-" + option[0];
        segment.type = "button";
        segment.textContent = option[1];
        segment.title = option[2];
        segment.addEventListener("click", function changeRpsMode() {
          const current = state.settings.autoStartRps ? "automatic" : state.settings.autoPickRps ? "repeat" : "manual";
          if (state.settings.rpsEnhancements === false) return;
          if (current !== option[0]) {
            state.settings.autoStartRps = option[0] === "automatic";
            state.settings.autoPickRps = option[0] !== "manual";
            state.rpsWaitForManualPick = true;
            state.rpsAutoStarted = false;
            state.rpsWasReady = randomRpsCards().length === 3;
            postToBridge("save-rps-mode", { mode: option[0] });
          }
          if (option[0] === "automatic") {
            // Automatic is both a saved mode and the action to start now.
            state.rpsWaitForManualPick = false;
            state.rpsAutoStarted = true;
            pickRandomRps();
          }
          syncRpsControls(false);
        });
        modes.appendChild(segment);
      });
      shadow.appendChild(modes);
      panel.appendChild(control);
    }
    const mode = state.settings.autoStartRps ? "automatic" : state.settings.autoPickRps ? "repeat" : "manual";
    ["manual", "repeat", "automatic"].forEach(function highlightRpsMode(value) {
      control.shadowRoot.getElementById("dbx-rps-mode-" + value).setAttribute("aria-pressed", String(mode === value));
    });
    const localCards = panel.querySelectorAll(".rps_card");
    control.hidden = localCards.length !== 3;
    if (!isVisible(panel) || control.hidden || state.rpsCard !== localCards[0]) {
      state.rpsAutoStarted = false;
      state.rpsFirstPickMade = false;
      state.rpsWaitForManualPick = false;
      state.rpsWasReady = false;
    }
    state.rpsCard = localCards[0];
    const automatic = state.settings.autoPickRps;
    const disabled = randomRpsCards().length !== 3;
    // Native picks disable the cards immediately. Start repeating only after
    // that first manual selection, never merely from checking the preference.
    if (state.rpsWasReady && disabled && isVisible(panel) && !control.hidden) {
      state.rpsAutoStarted = true;
      state.rpsFirstPickMade = true;
      state.rpsWaitForManualPick = false;
    }
    state.rpsWasReady = !disabled;
    // The existing health check retries only once the native cards are ready.
    // A click's refresh must not recursively attempt another pick.
    const startAutomatically = state.settings.autoStartRps && !state.rpsFirstPickMade;
    const repeatTie = automatic && state.rpsAutoStarted;
    if (allowAutoPick !== false && !state.rpsWaitForManualPick && !disabled && (startAutomatically || repeatTie)) pickRandomRps();
  }


  function mode(settings) { return settings.autoStartRps ? "automatic" : settings.autoPickRps ? "repeat" : "manual"; }
  return {
    initialize: syncRpsControls, tick: syncRpsControls,
    settingsKeys: ["rpsEnhancements", "autoStartRps", "autoPickRps"],
    settingsChanged(previous) {
      if (state.rpsSettingsReceived && mode(previous) !== mode(state.settings)) {
        state.rpsWaitForManualPick = true;
        state.rpsAutoStarted = false;
        state.rpsWasReady = randomRpsCards().length === 3;
      }
      state.rpsSettingsReceived = true;
      if (!context.isStarted || context.isStarted()) syncRpsControls(false);
    }
  };

});
