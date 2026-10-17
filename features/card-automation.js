(function attach(root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory;
  else (root.DBEnhancerFeatures ||= {})["card-automation"] = factory;
})(typeof window !== "undefined" ? window : globalThis, function createFeature(context) {
  "use strict";
  const { window: page, document, getSettings } = context;
  const ACTION = "DBX:card-automation";
  const wrappers = new Map();
  let initialized = false;
  let lastRenderedState;
  let host, title, status, positions, modes, resolve, wait, cancel, source, journal, previousFocus;
  const runtime = page.DBEnhancerCardAutomation.create({ page, getSettings, changed: render });

  function button(text, handler, parent) {
    const element = document.createElement("button");
    element.type = "button";
    element.textContent = text;
    element.addEventListener("click", handler);
    parent.appendChild(element);
    return element;
  }
  function ensurePanel() {
    if (host && host.isConnected) return;
    host = document.createElement("div");
    host.id = "dbx-card-automation";
    host.hidden = true;
    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = `
      :host { all:initial; position:fixed; left:50%; top:46%; transform:translate(-50%,-50%); z-index:2147483646;
        width:min(440px,calc(100vw - 40px)); max-height:calc(100vh - 40px); overflow:auto;
        color:#f1f7fb; font:14px/1.5 Arial,sans-serif; }
      :host([hidden]) { display:none; } * { box-sizing:border-box; }
      section { background:#162631f5; border:1px solid #91c8df; border-radius:12px;
        box-shadow:0 8px 30px #0008; padding:18px; } h2 { font-size:18px; margin:0 0 6px; }
      p { margin:8px 0; } .source { color:#b9cedb; font-size:12px; }
      .positions, .modes, footer { display:flex; gap:8px; flex-wrap:wrap; margin-top:12px; }
      .modes { background:#0b1b2599; border-radius:8px; padding:4px; }
      .modes button { flex:1; border-color:transparent; padding:9px 8px; font-size:13px; background:transparent; }
      .positions button { flex:1; background:#13556e; min-height:48px; }
      button { font:600 14px Arial,sans-serif; border:1px solid #86afc3; border-radius:6px;
        padding:10px 12px; background:#293f4d; color:white; cursor:pointer; }
      button[aria-pressed=true] { background:#086e8b; border-color:#a6eeff; }
      button:focus-visible { outline:2px solid #a6eeff; outline-offset:2px; }
      button:disabled { opacity:.5; cursor:default; } [hidden] { display:none !important; }
      ol { padding-left:20px; font-size:12px; color:#c4d9e5; }
    `;
    shadow.appendChild(style);
    const section = document.createElement("section");
    section.setAttribute("role", "dialog");
    section.setAttribute("aria-label", "Card automation");
    title = document.createElement("h2");
    source = document.createElement("p");
    source.className = "source";
    status = document.createElement("p");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    modes = document.createElement("div");
    modes.className = "modes";
    modes.setAttribute("role", "group");
    modes.setAttribute("aria-label", "Resolution timing");
    for (const mode of ["resolve", "wait"]) {
      const element = button(mode === "resolve" ? "Activate & resolve" : "Wait for opponent", () => runtime.selectMode(mode), modes);
      element.dataset.mode = mode;
    }
    positions = document.createElement("div");
    positions.className = "positions";
    positions.setAttribute("role", "group");
    positions.setAttribute("aria-label", "Special Summon position");
    for (const position of ["ATK", "DEF"]) {
      const element = button(position === "ATK" ? "Summon in ATK" : "Summon in DEF", () => runtime.begin(position), positions);
      element.dataset.position = position;
    }
    const footer = document.createElement("footer");
    resolve = button("Resolve now", () => runtime.release(), footer);
    wait = button("Wait for opponent", () => runtime.release(true), footer);
    cancel = button("Cancel", () => {
      const state = runtime.snapshot();
      if (state && !state.finished) runtime.cancel();
      else hide();
    }, footer);
    journal = document.createElement("ol");
    for (const child of [title, source, modes, status, positions, footer, journal]) section.appendChild(child);
    shadow.appendChild(section);
    // Keep native single-key duel shortcuts from handling panel interactions.
    for (const type of ["keydown", "keyup", "keypress"]) section.addEventListener(type, event => {
      event.stopPropagation();
      if (type === "keydown" && event.key === "Escape") {
        event.preventDefault();
        const state = runtime.snapshot();
        if (state && !state.finished) runtime.cancel();
        else hide();
      }
    });
    document.documentElement.appendChild(host);
  }
  function hide() {
    if (!host) return;
    const focused = host.shadowRoot.activeElement;
    host.hidden = true;
    if (focused && previousFocus && previousFocus.isConnected) previousFocus.focus();
  }
  function render(value) {
    if (!value) { hide(); return; }
    if (value.state === "completed") { hide(); return; }
    ensurePanel();
    const opening = host.hidden;
    host.hidden = false;
    title.textContent = value.cardName;
    source.textContent = value.list + " · " + value.version + " · " + value.effectLabel + " · " + (value.position || "Choose position");
    status.textContent = value.message;
    const canChoose = value.state === "choose";
    modes.hidden = !canChoose;
    for (const element of modes.children) element.setAttribute("aria-pressed", String(element.dataset.mode === value.mode));
    positions.hidden = !canChoose;
    for (const element of positions.children) {
      element.hidden = !value.positions.includes(element.dataset.position);
      element.setAttribute("aria-pressed", String(element.dataset.position === value.position));
    }
    const canResolve = value.costPaid && ["ready", "waiting", "suspended"].includes(value.state);
    resolve.hidden = !canResolve;
    wait.hidden = !canResolve || value.state === "waiting";
    wait.textContent = "Re-arm opponent wait";
    cancel.textContent = value.finished ? "Close" : "Cancel";
    journal.replaceChildren();
    for (const step of value.journal) {
      const item = document.createElement("li");
      item.textContent = step;
      journal.appendChild(item);
    }
    if (opening || (value.state === "choose" && lastRenderedState === "locking")) {
      (canChoose ? Array.from(positions.children).find(element => !element.hidden) : cancel).focus();
    } else {
      const focused = host.shadowRoot.activeElement;
      if (focused && (focused.hidden || focused.parentElement?.hidden)) {
        (canResolve ? resolve : cancel).focus();
      }
    }
    lastRenderedState = value.state;
  }
  function wrap(name, make) {
    const original = page[name];
    if (typeof original !== "function" || original === wrappers.get(name)) return;
    const wrapper = make(original);
    page[name] = wrapper;
    wrappers.set(name, wrapper);
  }
  function install() {
    wrap("showMenu", original => function(card, items) {
      if (Array.isArray(items) && runtime.available(card) && !items.some(item => item.data === ACTION)) {
        items = items.slice();
        const declare = items.findIndex(item => item.data === "Declare");
        items.splice(declare < 0 ? items.length : declare + 1, 0, { label: "Automate effect…", data: ACTION });
      }
      return original.call(this, card, items);
    });
    wrap("cardMenuClicked", original => function(card, action, event) {
      if (action !== ACTION) return original.apply(this, arguments);
      if (!runtime.available(card)) return;
      const current = runtime.snapshot();
      if (current && !current.finished) { if (host) host.hidden = false; return; }
      previousFocus = document.activeElement;
      if (host) host.hidden = true;
      if (typeof page.removeCardMenu === "function") page.removeCardMenu("card automation");
      runtime.prepare(card);
    });
    wrap("Send", original => function(message) {
      runtime.outgoing(message);
      return original.apply(this, arguments);
    });
  }
  return {
    settingsKeys: ["automationLists"],
    initialize() {
      if (initialized || !page.DBEnhancerDuelEvents) return;
      initialized = true;
      page.DBEnhancerDuelEvents.register({ id: "card-automation-receive", includeNonLive: true,
        when: { stage: "receive" }, run: runtime.observe });
      page.DBEnhancerDuelEvents.register({ id: "card-automation-execute", includeNonLive: true, run: runtime.observe });
      install();
      document.addEventListener("visibilitychange", () => { if (document.hidden) runtime.cancel(); });
    },
    tick() { install(); runtime.tick(); },
    settingsChanged() { runtime.tick(); },
    diagnostics: { cardAutomation: runtime.snapshot }
  };
});
