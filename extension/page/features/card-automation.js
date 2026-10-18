(function attach(root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory;
  else (root.DBEnhancerFeatures ||= {})["card-automation"] = factory;
})(typeof window !== "undefined" ? window : globalThis, function createFeature(context) {
  "use strict";
  const { window: page, document, getSettings } = context;
  const ACTION = "DBX:card-automation";
  const QUICK_ACTION = "DBX:card-automation-resolve";
  const isDeckSelection = value => value?.selection?.from === "deck";
  const wrappers = new Map();
  let initialized = false;
  let nativePicker = false;
  let fieldPicker = false;
  let concealedDeck = null;
  let viewerMenu = null;
  const nativeDecorations = new Map();
  let lastRenderedState;
  let host, title, status, limitations, positions, resolve, wait, cancel, source, journal, previousFocus, effects, choices, confirm;
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
      :host([data-native-picker]) { left:50%; top:60%; transform:translate(-50%,-50%); width:340px; max-height:38vh; }
      :host([data-field-picker]) { left:auto; top:auto; right:16px; bottom:16px; transform:none; width:300px; max-height:40vh; }
      :host([data-field-picker]) section { padding:12px; }
      :host([data-field-picker]) h2 { font-size:16px; }
      :host([data-field-picker]) .source, :host([data-field-picker]) ol { display:none; }
      section { background:#162631f5; border:1px solid #91c8df; border-radius:12px;
        box-shadow:0 8px 30px #0008; padding:18px; } h2 { font-size:18px; margin:0 0 6px; }
      p { margin:8px 0; } .source { color:#b9cedb; font-size:12px; }
      .positions, footer { display:flex; gap:8px; flex-wrap:wrap; margin-top:12px; }
      .positions button { flex:1; background:#13556e; min-height:48px; }
      .card-choices { display:grid; grid-template-columns:repeat(auto-fill,minmax(90px,1fr)); gap:10px; margin-top:12px; }
      .card-choices button { position:relative; padding:4px; min-width:0; font-size:12px; }
      .card-choices img { display:block; width:100%; aspect-ratio:59/86; object-fit:contain; background:#0b1b25; }
      .card-choices .card-name { display:block; margin-top:5px; }
      .card-choices .copies { position:absolute; top:7px; right:7px; background:#12212dee; border-radius:10px; padding:2px 6px; }
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
    limitations = document.createElement("p");
    limitations.className = "source";
    positions = document.createElement("div");
    positions.className = "positions";
    positions.setAttribute("role", "group");
    positions.setAttribute("aria-label", "Special Summon position");
    for (const position of ["ATK", "DEF"]) {
      const element = button(position === "ATK" ? "Summon in ATK" : "Summon in DEF", () => runtime.snapshot()?.state === "choose" ? runtime.begin(position) : runtime.choose(position), positions);
      element.dataset.position = position;
    }
    effects = document.createElement("div");
    effects.className = "positions";
    choices = document.createElement("div");
    choices.className = "card-choices";
    choices.setAttribute("role", "group");
    choices.setAttribute("aria-label", "Cards chosen at resolution");
    const footer = document.createElement("footer");
    confirm = button("Confirm selection", () => runtime.confirmCards(), footer);
    resolve = button("Resolve now", () => runtime.release(), footer);
    wait = button("Wait for opponent", () => runtime.release(true), footer);
    cancel = button("Cancel", () => {
      const state = runtime.snapshot();
      if (state && !state.finished) runtime.cancel();
      else hide();
    }, footer);
    journal = document.createElement("ol");
    for (const child of [title, source, status, limitations, positions, effects, choices, footer, journal]) section.appendChild(child);
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
  function clearNativeDecorations() {
    for (const [node, previous] of nativeDecorations) {
      node.style.outline = previous.outline;
      node.style.outlineOffset = previous.outlineOffset;
      node.style.cursor = previous.cursor;
      previous.badge?.remove();
      previous.border?.remove();
    }
    nativeDecorations.clear();
  }
  function decorateNative(value, field = false) {
    clearNativeDecorations();
    for (const choice of value.choices) {
      const card = page.getDuelCard?.(choice.instanceId)?.[0];
      // Native .card is positioned at the card's centre. Its visible face lives
      // inside .content, translated by -50% on both axes (utils.js Card()).
      // Decorations must share that translated box, rather than the outer anchor.
      const node = card?.querySelector?.(":scope > .content") || card;
      if (!node?.style) continue;
      const previous = { outline: node.style.outline, outlineOffset: node.style.outlineOffset, cursor: node.style.cursor };
      if (field) {
        node.style.cursor = "pointer";
        if (!choice.selected) {
          const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
          svg.setAttribute("viewBox", "0 0 100 145");
          svg.setAttribute("preserveAspectRatio", "none");
          svg.setAttribute("aria-hidden", "true");
          svg.style.cssText = "position:absolute;left:-18px;top:-18px;width:calc(100% + 36px);height:calc(100% + 36px);overflow:visible;pointer-events:none;z-index:100;";
          const border = document.createElementNS("http://www.w3.org/2000/svg", "rect");
          for (const [key, value] of Object.entries({ x: 1, y: 1, width: 98, height: 143, rx: 2,
            fill: "none", stroke: "#ffd76a", "stroke-width": 2.5, pathLength: 100, "stroke-dasharray": "3 2",
            class: "dbx-field-selection-border" })) border.setAttribute(key, String(value));
          svg.appendChild(border);
          node.appendChild(svg);
          previous.border = svg;
        }
      }
      if (choice.selected) { node.style.outline = "14px solid #76e9ff"; node.style.outlineOffset = "8px"; }
      if (choice.copies > 1) {
        const badge = document.createElement("span");
        badge.textContent = "×" + choice.copies;
        badge.style.cssText = "position:absolute;right:16px;bottom:28px;z-index:100;pointer-events:none;font:bold 100px Arial;color:white;background:#12212dee;border-radius:35px;padding:8px 22px;";
        node.appendChild(badge); previous.badge = badge;
      }
      nativeDecorations.set(node, previous);
    }
  }
  function syncNativePicker(value) {
    const supported = isDeckSelection(value) && page.viewing === "Deck" && typeof page.viewCards === "function" &&
      typeof page.getDuelCard === "function" && Boolean(document.querySelector?.("#view > .content")) &&
      value.choices.every(choice => page.getDuelCard(choice.instanceId)?.[0]);
    const wasNative = nativePicker;
    nativePicker = Boolean(supported);
    if (nativePicker) {
      page.removeCardMenu?.("automation card picker");
      page.viewCards(page.player1.main_arr);
    } else if (wasNative) {
      clearNativeDecorations();
      if (page.viewing === "Deck") page.viewCards(page.player1.main_arr);
    }
  }
  function syncDeckVisibility(value) {
    // Keep native viewing state intact until the acknowledged move completes.
    // Hiding only the window avoids a second network command racing the move.
    const conceal = ["adding", "sending"].includes(value?.state) || (concealedDeck && value?.state === "close-deck");
    if (conceal && page.viewing === "Deck") {
      const view = document.getElementById?.("view");
      if (view?.style && !concealedDeck) {
        concealedDeck = { node: view, visibility: view.style.getPropertyValue("visibility"), priority: view.style.getPropertyPriority("visibility") };
        view.style.setProperty("visibility", "hidden", "important");
      }
    } else if (concealedDeck) {
      const { node, visibility, priority } = concealedDeck;
      if (visibility) node.style.setProperty("visibility", visibility, priority);
      else node.style.removeProperty("visibility");
      concealedDeck = null;
    }
  }
  function render(value) {
    if (fieldPicker) clearNativeDecorations();
    fieldPicker = false;
    syncDeckVisibility(value);
    syncNativePicker(value);
    fieldPicker = value?.state === "select-destroy" && typeof page.getDuelCard === "function" &&
      value.choices.every(choice => page.getDuelCard(choice.instanceId)?.[0]);
    if (fieldPicker) {
      page.removeCardMenu?.("automation field picker");
      decorateNative(value, true);
    }
    if (!value) { hide(); return; }
    if (["adding", "sending", "close-deck", "destroying-field", "opponent-moves", "completed"].includes(value.state)) { hide(); lastRenderedState = value.state; return; }
    if (nativePicker && !value.confirmSelections && !value.options?.length) { hide(); lastRenderedState = value.state; return; }
    ensurePanel();
    const opening = host.hidden;
    const focusedChoice = host.shadowRoot.activeElement?.dataset?.choice;
    const focusedEffect = host.shadowRoot.activeElement?.dataset?.effect;
    host.hidden = false;
    title.textContent = value.cardName;
    source.textContent = value.list + " · " + value.version + " · " + value.effectLabel + (value.trigger ? "" : " · " + (value.position || "Choose position"));
    status.textContent = value.message;
    limitations.textContent = (value.manualResponsibilities || []).join(" ");
    limitations.hidden = !value.manualResponsibilities?.length;
    const configuring = ["choose", "declaring", "banishing", "ready", "waiting", "approved", "suspended", "replacement-choice"].includes(value.state);
    const selecting = Boolean(value.selection) || value.state === "select-destroy";
    positions.hidden = !configuring || value.trigger;
    for (const element of positions.children) {
      element.hidden = !value.positions.includes(element.dataset.position);
      element.setAttribute("aria-pressed", String(element.dataset.position === value.position));
    }
    effects.hidden = !value.trigger || !(configuring || (selecting && value.options?.length));
    effects.replaceChildren();
    for (const option of value.options || []) {
      const element = button(option.label, () => runtime.begin(option.key), effects);
      element.dataset.effect = option.key;
      element.disabled = option.disabled;
      element.setAttribute("aria-pressed", String(option.key === value.effectChoice));
    }
    if (nativePicker) host.setAttribute("data-native-picker", "");
    else host.removeAttribute?.("data-native-picker");
    if (fieldPicker) host.setAttribute("data-field-picker", "");
    else host.removeAttribute?.("data-field-picker");
    if (isDeckSelection(value)) {
      const movement = { hand: "add it to your hand", graveyard: "send it to the Graveyard" }[value.selection.destination];
      status.textContent = (nativePicker ? "Left-click a card in the Deck window" : "Click a card") +
        (value.confirmSelections ? ", then confirm your selection here." : " to " + movement + ".");
    }
    const selectedCount = (value.choices || []).filter(choice => choice.selected).length;
    if (fieldPicker) status.textContent = "Click highlighted cards on the field to select or deselect them. Selected " + selectedCount +
      " of " + value.maximum + ".";
    choices.hidden = !selecting || nativePicker || fieldPicker;
    choices.replaceChildren();
    for (const choice of selecting && !nativePicker && !fieldPicker ? value.choices : []) {
      const element = button(choice.label, () => runtime.selectCard(choice.key), choices);
      element.textContent = "";
      element.setAttribute("aria-label", choice.label + (choice.copies > 1 ? " (" + choice.copies + " copies)" : ""));
      if (choice.imageUrl) {
        const art = document.createElement("img");
        art.src = choice.imageUrl; art.alt = choice.label; art.loading = "lazy";
        element.appendChild(art);
      }
      const name = document.createElement("span"); name.className = "card-name"; name.textContent = choice.label;
      element.appendChild(name);
      if (choice.copies > 1) {
        const count = document.createElement("span"); count.className = "copies"; count.textContent = "×" + choice.copies;
        element.appendChild(count);
      }
      element.dataset.choice = choice.key;
      element.setAttribute("aria-pressed", String(choice.selected));
      element.disabled = value.state === "select-destroy" && !choice.selected && selectedCount >= value.maximum;
    }
    confirm.hidden = !selecting || (isDeckSelection(value) && !value.confirmSelections);
    confirm.disabled = value.state === "select-destroy" ? selectedCount > value.maximum || selectedCount < (value.minimum || 0) : selectedCount !== 1;
    confirm.textContent = value.state === "select-destroy" && !selectedCount && !value.minimum ? "Destroy no cards" :
      value.state === "select-destroy" && !value.confirmSelections ? "Done selecting" : "Confirm selection";
    const canResolve = (value.costPaid || value.activated) && ["ready", "waiting", "suspended"].includes(value.state);
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
    if (value.trigger && configuring && focusedEffect !== undefined) {
      (Array.from(effects.children).find(element => element.dataset.effect === focusedEffect) || cancel).focus();
    } else if (selecting && !nativePicker && !fieldPicker && (value.state !== lastRenderedState || focusedChoice !== undefined)) {
      (Array.from(choices.children).find(element => element.dataset.choice === focusedChoice) || choices.children[0] || confirm).focus();
    } else if (opening || (value.state === "choose" && lastRenderedState === "locking")) {
      (configuring ? (value.trigger ? effects.children[0] || cancel : Array.from(positions.children).find(element => !element.hidden)) : cancel).focus();
    } else {
      const focused = host.shadowRoot.activeElement;
      if (focused && (focused.hidden || focused.parentElement?.hidden)) {
        (canResolve ? resolve : cancel).focus();
      }
    }
    lastRenderedState = value.state;
  }
  function restoreViewerMenu() {
    if (!viewerMenu) return;
    const { node, style, parent } = viewerMenu;
    node.classList.remove("dbx-native-card-menu");
    if (style === null) node.removeAttribute("style");
    else node.setAttribute("style", style);
    if (node.isConnected && parent?.isConnected && node.parentNode !== parent) parent.appendChild(node);
    viewerMenu = null;
  }
  function fitViewerMenu(card) {
    const viewer = document.querySelector?.("#view > .content");
    const anchor = card?.[0];
    const node = document.getElementById?.("card_menu");
    if (!viewer?.contains(anchor) || !node?.isConnected || (page.menu_card && page.menu_card[0] !== anchor)) return;
    // Preserve the native menu and its width. Prefer scrolling in the original
    // space above the card; move below only when that space cannot fit a row.
    const face = anchor.querySelector?.(":scope > .content") || anchor;
    const rect = face.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    viewerMenu = { node, style: node.getAttribute("style"), parent: node.parentNode };
    page.TweenMax?.killTweensOf(node);
    const content = node.querySelector("#card_menu_content");
    if (content) page.TweenMax?.killTweensOf(content);
    node.classList.add("dbx-native-card-menu");
    const margin = 12, gap = 6;
    const bounds = node.getBoundingClientRect();
    const scale = node.offsetWidth > 0 ? bounds.width / node.offsetWidth : 1;
    if (!(scale > 0)) return;
    let top = bounds.top, space = page.innerHeight - margin * 2;
    if (bounds.top < margin || bounds.bottom > page.innerHeight - margin) {
      const below = Math.max(0, page.innerHeight - margin - rect.bottom - gap);
      const above = Math.max(0, rect.top - gap - margin);
      const useBelow = above < 20 * scale && below > above;
      space = useBelow ? below : above;
      top = useBelow ? rect.bottom + gap : rect.top - gap - Math.min(bounds.height, space);
    }
    node.style.setProperty("max-height", Math.max(1, space / scale) + "px", "important");
    const height = Math.min(bounds.height, space);
    top = Math.max(margin, Math.min(top, page.innerHeight - margin - height));
    const left = Math.max(margin, Math.min(bounds.left, page.innerWidth - margin - bounds.width));
    node.style.setProperty("top", ((Number.parseFloat(node.style.top) || 0) + (top - bounds.top) / scale) + "px", "important");
    node.style.setProperty("left", ((Number.parseFloat(node.style.left) || 0) + (left - bounds.left) / scale) + "px", "important");
  }
  function wrap(name, make) {
    const original = page[name];
    if (typeof original !== "function" || original === wrappers.get(name)) return;
    const wrapper = make(original);
    page[name] = wrapper;
    wrappers.set(name, wrapper);
  }
  function install() {
    wrap("viewCards", original => function(cards, options) {
      const value = runtime.snapshot();
      if (nativePicker && isDeckSelection(value) && page.viewing === "Deck" && cards === page.player1.main_arr) {
        const entries = value.choices.map(choice => ({ choice, card: page.getDuelCard(choice.instanceId) }))
          .filter(entry => cards.includes(entry.card));
        // Native viewCards pairs cards with options.deck by index when supplied.
        // Preserve that pairing without changing the actual Deck or its order.
        const filteredOptions = options?.deck ? { ...options, deck: entries.map(entry => options.deck[cards.indexOf(entry.card)]) } : options;
        const result = original.call(this, entries.map(entry => entry.card), filteredOptions);
        decorateNative(value);
        return result;
      }
      return original.apply(this, arguments);
    });
    wrap("showMenu", original => function(card, items) {
      if (fieldPicker) return;
      if (nativePicker && page.viewing === "Deck" && page.player1.main_arr.includes(card)) return;
      if (Array.isArray(items) && runtime.available(card) && !items.some(item => item.data === ACTION || item.data === QUICK_ACTION)) {
        items = items.slice();
        const declare = items.findIndex(item => item.data === "Declare");
        items.splice(declare < 0 ? items.length : declare + 1, 0,
          { label: "Resolve now", data: QUICK_ACTION },
          { label: "Wait for opponent", data: ACTION });
      }
      restoreViewerMenu();
      const result = original.call(this, card, items);
      fitViewerMenu(card);
      return result;
    });
    wrap("removeCardMenu", original => function() {
      restoreViewerMenu();
      return original.apply(this, arguments);
    });
    wrap("cardMenuClicked", original => function(card, action, event) {
      if (action !== ACTION && action !== QUICK_ACTION) return original.apply(this, arguments);
      if (!runtime.available(card)) return;
      const current = runtime.snapshot();
      if (current && !current.finished) { if (host) host.hidden = false; return; }
      previousFocus = document.activeElement;
      if (host) host.hidden = true;
      if (typeof page.removeCardMenu === "function") page.removeCardMenu("card automation");
      runtime.prepare(card, { autoStart: true, mode: action === QUICK_ACTION ? "resolve" : "wait" });
    });
    wrap("Send", original => function(message) {
      runtime.outgoing(message);
      return original.apply(this, arguments);
    });
  }
  return {
    settingsKeys: ["automationLists", "automationConfirmSelections"],
    initialize() {
      if (initialized || !page.DBEnhancerDuelEvents) return;
      initialized = true;
      page.DBEnhancerDuelEvents.register({ id: "card-automation-receive", includeNonLive: true,
        when: { stage: "receive" }, run: runtime.observe });
      page.DBEnhancerDuelEvents.register({ id: "card-automation-execute", includeNonLive: true, run: runtime.observe });
      install();
      document.addEventListener("visibilitychange", () => { if (document.hidden) runtime.cancel(); });
      // Capture left-click before native card menus or actions can handle it.
      document.addEventListener("click", event => {
        if ((!nativePicker && !fieldPicker) || event.button !== 0) return;
        if (nativePicker) {
          const content = document.querySelector("#view > .content");
          if (!content?.contains(event.target)) return;
        }
        const value = runtime.snapshot();
        const choice = value?.choices.find(entry => {
          const node = page.getDuelCard(entry.instanceId)?.[0];
          return node && (node === event.target || node.contains(event.target));
        });
        if (!choice) return;
        event.preventDefault(); event.stopImmediatePropagation();
        runtime.selectCard(choice.key);
      }, true);
    },
    tick() { install(); runtime.tick(); },
    settingsChanged() { runtime.tick(); render(runtime.snapshot()); },
    diagnostics: { cardAutomation: runtime.snapshot }
  };
});
