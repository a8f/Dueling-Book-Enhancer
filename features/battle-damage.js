(function attach(root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory;
  else (root.DBEnhancerFeatures ||= {})["battle-damage"] = factory;
})(typeof window !== "undefined" ? window : globalThis, function createFeature(context) {
  "use strict";
  const { window: page, document } = context;
  let pending = null;
  let panel, summary, amount, ok, cancel, previousFocus;
  let initialized = false;
  const local = () => [page.player1, page.player2, page.player3, page.player4]
    .find(player => player && player.username === page.username);
  const live = () => page.duelist === true && !page.replay && !page.resetting && !page.automatic &&
    !page.paused && !page.awaiting_defeat && String(page.currentLabel).startsWith("duel_start");

  function close() {
    pending = null;
    if (panel) {
      const focused = panel.shadowRoot.activeElement;
      panel.hidden = true;
      if (focused && previousFocus && previousFocus.isConnected) previousFocus.focus();
    }
  }

  function monster(id) {
    const card = typeof page.getDuelCard === "function" && page.getDuelCard(id);
    if (!card) return null;
    const owner = card.data("controller");
    // getDuelCard also returns cards in the hand/GY. Only field monsters count.
    if (!owner || ![owner.m1, owner.m2, owner.m3, owner.m4, owner.m5, page.linkLeft, page.linkRight].includes(card)) return null;
    const front = card.data("cardfront");
    const hidden = card.data("face_down") && owner.username !== page.username;
    return Object.freeze({
      instanceId: id, controller: owner.username,
      name: hidden ? "Face-down monster" : front && front.data("name") || "Monster",
      atk: hidden ? null : card.data("new_atk") ?? (front && front.data("atk")),
      def: hidden ? null : card.data("new_def") ?? (front && front.data("def")),
      position: card.data("inDEF") ? "defense" : card.data("inATK") ? "attack" : null
    });
  }

  function current() {
    if (!pending) return null;
    if (!live() || page.duelId !== pending.duelId || page.player1 !== pending.game ||
        page.username !== pending.username || page.currentPhase !== pending.phase ||
        page.turnCount !== pending.turn || local() !== pending.local || local().lifepoints !== pending.life) return null;
    const attacker = monster(pending.attacker);
    const target = pending.target == null ? null : monster(pending.target);
    if (!attacker || attacker.controller !== pending.actor || attacker.position !== "attack" ||
        (pending.target != null && (!target || target.controller !== page.username))) return null;
    const battle = Object.freeze({ attacker, target, event: pending.event });
    return { battle, result: page.DBEnhancerBattleDamage.calculate(battle) };
  }

  function refresh() {
    if (!pending) return;
    const value = current();
    if (!value) { close(); return; }
    summary.textContent = `${value.battle.attacker.name} → ${value.battle.target ? value.battle.target.name : "Direct attack"}`;
    amount.textContent = value.result.damage == null ? "Stats unknown" :
      `${value.result.damage.toLocaleString()} damage`;
    amount.title = value.result.explanation;
    ok.disabled = value.result.damage == null;
    ok.textContent = value.result.damage > 0 ? `OK — take ${value.result.damage.toLocaleString()}` : "OK";
    pending.displayedDamage = value.result.damage;
  }

  function ensurePanel() {
    if (panel) return;
    panel = document.createElement("div");
    panel.id = "dbx-battle-damage";
    panel.hidden = true;
    const shadow = panel.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = `
      :host { all:initial; position:fixed; left:50%; top:50%; transform:translate(-50%,-50%);
        z-index:2147483647; }
      :host([hidden]) { display:none; }
      section { width:360px; max-width:calc(100vw - 64px); padding:20px; color:#edf5fa;
        background:rgba(18,31,41,.78); backdrop-filter:blur(8px); border:1px solid #9bb9cc80;
        border-radius:12px; text-align:center; box-shadow:0 8px 32px #0006;
        font:14px/1.4 Arial,sans-serif; }
      h2 { margin:0 0 8px; font-size:16px; font-weight:500; color:#c5d8e4; }
      p { margin:8px 0; overflow-wrap:anywhere; color:#d5e3eb; }
      p[aria-live] { margin:12px 0; font-size:32px; font-weight:700; color:white; }
      footer { display:flex; gap:12px; margin-top:18px; }
      button { flex:1; min-height:54px; padding:12px 16px; border:1px solid #96b7ca80;
        border-radius:8px; cursor:pointer; background:#293e4bc9; color:white;
        font:600 16px Arial,sans-serif; }
      button:last-child { background:#176078e6; } button:hover { filter:brightness(1.2); }
      button:disabled { opacity:.5; cursor:default; }
      button:focus-visible { outline:2px solid #70dfff; outline-offset:2px; }
    `;
    shadow.appendChild(style);
    const section = document.createElement("section");
    section.setAttribute("role", "dialog");
    section.setAttribute("aria-label", "Battle damage");
    const title = document.createElement("h2");
    title.textContent = "Battle damage";
    summary = document.createElement("p");
    amount = document.createElement("p");
    amount.setAttribute("aria-live", "polite");
    const footer = document.createElement("footer");
    cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", close);
    ok = document.createElement("button");
    ok.type = "button";
    ok.addEventListener("click", () => {
      const value = current();
      if (!value) { close(); return; }
      // Recalculate at confirmation; changed values need another click.
      if (value.result.damage == null || value.result.damage !== pending.displayedDamage) { refresh(); return; }
      const { actions } = pending;
      close();
      if (value.result.damage > 0) actions.adjustLifePoints(-value.result.damage);
    });
    section.addEventListener("keydown", event => {
      // Keep dialog shortcuts from reaching the site's duel/chat shortcuts.
      if (!["Escape", "Enter", "Tab"].includes(event.key)) return;
      event.stopPropagation();
      if (event.key === "Escape") { event.preventDefault(); close(); }
      if (event.key === "Enter") {
        event.preventDefault();
        if (!event.repeat) (shadow.activeElement === cancel ? cancel : ok).click();
      }
      if (event.key === "Tab") {
        event.preventDefault();
        const buttons = ok.disabled ? [cancel] : [cancel, ok];
        const index = buttons.indexOf(shadow.activeElement);
        buttons[(index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length].focus();
      }
    });
    footer.appendChild(cancel);
    footer.appendChild(ok);
    for (const child of [title, summary, amount, footer]) section.appendChild(child);
    shadow.appendChild(section);
    document.body.appendChild(panel);
  }

  function observe(event, actions) {
    if (event.type === "attack" || event.type === "attack-direct") {
      close();
      if (!event.live || event.actor.relation !== "opponent" || !local()) return;
      const target = event.type === "attack" && monster(event.target.instanceId);
      if (event.type === "attack" && (!target || target.controller !== page.username)) return;
      pending = { event, actions, attacker: event.attacker.instanceId,
        target: target ? target.instanceId : null, actor: event.actor.username,
        duelId: page.duelId, game: page.player1, username: page.username,
        local: local(), life: local().lifepoints, phase: page.currentPhase, turn: page.turnCount };
      ensurePanel();
      previousFocus = document.activeElement;
      panel.hidden = false;
      refresh();
      if (pending) (ok.disabled ? cancel : ok).focus();
    } else if (pending && (!event.live || event.type === "reset" || event.type === "life-points" &&
        ["self", "partner"].includes(event.actor.relation))) close();
  }

  return {
    settingsKeys: [],
    initialize() {
      if (initialized || !page.DBEnhancerDuelEvents) return;
      initialized = true;
      page.DBEnhancerDuelEvents.register({ id: "battle-damage-confirmation", includeNonLive: true, run: observe });
      page.DBEnhancerDuelEvents.register({ id: "battle-damage-invalidation", includeNonLive: true,
        when: { stage: "receive" },
        run(event) {
          if (pending && (!event.live || event.type === "reset" || event.type === "life-points" &&
              ["self", "partner"].includes(event.actor.relation))) close();
        }
      });
    },
    tick: refresh
  };
});
