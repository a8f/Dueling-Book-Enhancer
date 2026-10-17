(function attach(root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory;
  else (root.DBEnhancerFeatures ||= {})["turn-order"] = factory;
})(typeof window !== "undefined" ? window : globalThis, function createFeature(context) {
  "use strict";
  const { document, window, isVisible, lifecycle } = context;
  const chosen = new WeakSet();
  const controls = new Map();

  function syncControl(panel, selectable) {
    let control = controls.get(panel);
    if (!control && selectable) {
      control = document.createElement("div");
      control.className = "dbx-turn-order-control";
      const shadow = control.attachShadow({ mode: "open" });
      const style = document.createElement("style");
      style.textContent = `
        label { display:flex; align-items:center; gap:9px; padding:9px 14px;
          border:1px solid #637982; border-radius:4px;
          background:linear-gradient(#303c43,#141b20); color:#d9f8ff;
          font:600 14px/1.3 Arial,sans-serif; cursor:pointer; white-space:nowrap; }
        input { margin:0; width:17px; height:17px; accent-color:#58cce9; }
        input:focus-visible { outline:2px solid #65dfff; outline-offset:3px; }
      `;
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.title = "Choose First now and whenever you can select the turn order in future games.";
      input.addEventListener("change", () => {
        context.getSettings().autoGoFirst = input.checked;
        context.postToBridge("save-auto-go-first", { enabled: input.checked });
        tick();
      });
      const text = document.createElement("span");
      text.textContent = "Automatically go first";
      label.appendChild(input);
      label.appendChild(text);
      shadow.appendChild(style);
      shadow.appendChild(label);
      control.input = input;
      panel.appendChild(control);
      controls.set(panel, control);
    }
    if (control) {
      control.hidden = !selectable;
      control.input.checked = context.getSettings().autoGoFirst;
    }
  }

  function cards() {
    // initTPStart inserts First then Second and adds tp_card only after the
    // reveal, only for the duelist entitled to choose (duel.js).
    return Array.from(document.querySelectorAll(".tp_card"));
  }

  function rememberChoice(event) {
    if (event.target.closest?.(".tp_card")) cards().forEach(card => chosen.add(card));
  }

  function tick() {
    const panel = ["tp_start", "tp_start2"].map(id => document.getElementById(id)).find(panel => panel && isVisible(panel));
    const choices = cards();
    for (const [owner, control] of controls) {
      if (owner !== panel) control.hidden = true;
    }
    if (!panel) return;
    syncControl(panel, choices.length === 2 && choices.every(isVisible));
    if (!context.getSettings().autoGoFirst) return;
    if (choices.length !== 2 || choices.some(card => chosen.has(card) || !isVisible(card))) return;
    const content = choices[0].querySelector(".content");
    if (!content || window.getComputedStyle(content).pointerEvents === "none") return;
    // Native pickFirst does not unbind itself while waiting for the server.
    // Remember both cards before clicking, also honoring manual selections.
    choices.forEach(card => chosen.add(card));
    content.click();
  }

  return {
    initialize() {
      lifecycle.listen("turn-order-choice", document, "click", rememberChoice, true);
      tick();
    },
    tick,
    settingsKeys: ["autoGoFirst"],
    settingsChanged() { if (!context.isStarted || context.isStarted()) tick(); }
  };
});
