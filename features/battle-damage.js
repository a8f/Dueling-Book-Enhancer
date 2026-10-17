(function attach(root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory;
  else (root.DBEnhancerFeatures ||= {})["battle-damage"] = factory;
})(typeof window !== "undefined" ? window : globalThis, function createFeature(context) {
  "use strict";
  const { window: page, document } = context;
  let pending = null;
  let panel, summary, amount, updateNotice, ok, cancel, previousFocus;
  let noticeAnimation, amountAnimation;
  let initialized = false;
  const local = () => [page.player1, page.player2, page.player3, page.player4]
    .find(player => player && player.username === page.username);
  const live = () => page.duelist === true && !page.replay && !page.resetting && !page.automatic &&
    !page.paused && !page.awaiting_defeat && String(page.currentLabel).startsWith("duel_start");

  function hide() {
    if (noticeAnimation) noticeAnimation.cancel();
    if (amountAnimation) amountAnimation.cancel();
    if (panel) {
      const focused = panel.shadowRoot.activeElement;
      panel.hidden = true;
      if (focused && previousFocus && previousFocus.isConnected) previousFocus.focus();
    }
  }

  function close() {
    pending = null;
    hide();
  }

  function lifeChanged(event) {
    if (!pending) return;
    const payment = pending.payments.find(item => !item[event.stage]);
    if (!payment || payment.amount !== event.amount || event.actor.username !== pending.username) {
      close();
      return;
    }
    payment[event.stage] = true;
    if (event.stage === "execute") {
      // Execute notifications precede the site's native LP update.
      pending.previousLife = local().lifepoints;
      const nextLife = typeof event.data.life === "number" ? Math.max(0, event.data.life) :
        Math.max(0, pending.life + event.amount);
      pending.paid += pending.life - nextLife + event.amount;
      pending.life = nextLife;
      pending.payments = pending.payments.filter(item => !item.execute);
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
      attribute: hidden ? null : front && front.data("attribute"),
      faceDown: Boolean(card.data("face_down")),
      atk: hidden ? null : card.data("new_atk") ?? (front && front.data("atk")),
      def: hidden ? null : card.data("new_def") ?? (front && front.data("def")),
      position: card.data("inDEF") ? "defense" : card.data("inATK") ? "attack" : null
    });
  }

  function current() {
    if (!pending) return null;
    if (!live() || page.duelId !== pending.duelId || page.player1 !== pending.game ||
        page.username !== pending.username || page.currentPhase !== pending.phase ||
        page.turnCount !== pending.turn || local() !== pending.local ||
        (local().lifepoints !== pending.life && local().lifepoints !== pending.previousLife)) return null;
    if (local().lifepoints === pending.life) pending.previousLife = undefined;
    const attacker = monster(pending.attacker);
    const target = pending.target == null ? null : monster(pending.target);
    if (!attacker || attacker.controller !== pending.actor || attacker.position !== "attack" ||
        (pending.target != null && (!target || target.controller !== pending.defender))) return null;
    const battle = pending.effects.apply(Object.freeze({ attacker, target, event: pending.event, damageTo: pending.damageTo }));
    const result = page.DBEnhancerBattleDamage.calculate(battle);
    return { battle, result, difference: result.damage == null ? null : result.damage - pending.paid };
  }

  function refresh() {
    if (!pending) return;
    const value = current();
    if (!value) { close(); return; }
    if (value.difference === 0) { hide(); return; }
    summary.textContent = `${value.battle.attacker.name} → ${value.battle.target ? value.battle.target.name : "Direct attack"}`;
    amount.textContent = value.difference == null ? "Stats unknown" : value.difference < 0 ?
      `${(-value.difference).toLocaleString()} LP back` :
      `${value.difference.toLocaleString()} ${pending.paid ? "more damage" : "damage"}`;
    amount.title = [value.result.explanation, ...value.battle.assumedEffects,
      `${pending.paid} already taken`].join(" · ");
    const updateText = pending.updateText || "";
    updateNotice.hidden = !updateText;
    if (updateNotice.textContent !== updateText) updateNotice.textContent = updateText;
    ok.disabled = value.difference == null;
    ok.textContent = value.difference > 0 ? `OK — take ${value.difference.toLocaleString()}` :
      value.difference < 0 ? `OK — restore ${(-value.difference).toLocaleString()}` : "OK";
    pending.displayedDamage = value.difference;
    // A battle that initially dealt no damage can become relevant after a
    // stat change. Confirmed battles reopen only for newly detected effects.
    if (panel.hidden && !pending.confirmed) {
      previousFocus = document.activeElement;
      panel.hidden = false;
      (ok.disabled ? cancel : ok).focus();
    }
  }

  function highlightUpdate() {
    if (noticeAnimation) noticeAnimation.cancel();
    if (amountAnimation) amountAnimation.cancel();
    if (page.matchMedia && page.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (typeof updateNotice.animate === "function") {
      noticeAnimation = updateNotice.animate([
        { backgroundColor: "rgba(79,214,255,.45)", boxShadow: "0 0 18px #50d5ff80" },
        { backgroundColor: "rgba(79,214,255,.1)", boxShadow: "0 0 0 #50d5ff00" }
      ], { duration: 1400, easing: "ease-out" });
      amountAnimation = amount.animate([
        { transform: "scale(1)", color: "#fff" },
        { transform: "scale(1.08)", color: "#7fe5ff", offset: .25 },
        { transform: "scale(1)", color: "#fff" }
      ], { duration: 550, easing: "ease-out" });
    }
  }

  function show() {
    ensurePanel();
    previousFocus = document.activeElement;
    panel.hidden = false;
    refresh();
    if (pending && !panel.hidden) (ok.disabled ? cancel : ok).focus();
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
      .amount { margin:12px 0; font-size:32px; font-weight:700; color:white; }
      .update { padding:7px 10px; background:rgba(79,214,255,.1); border-left:3px solid #7fe5ff;
        border-radius:4px; color:#c7f3ff; font-size:13px; }
      .update[hidden] { display:none; }
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
    amount.className = "amount";
    amount.setAttribute("aria-live", "polite");
    updateNotice = document.createElement("p");
    updateNotice.className = "update";
    updateNotice.id = "dbx-battle-damage-update";
    updateNotice.hidden = true;
    updateNotice.setAttribute("role", "status");
    updateNotice.setAttribute("aria-live", "polite");
    updateNotice.setAttribute("aria-atomic", "true");
    const footer = document.createElement("footer");
    cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", close);
    ok = document.createElement("button");
    ok.type = "button";
    ok.addEventListener("click", () => {
      if (!pending || panel.hidden) return;
      const value = current();
      if (!value) { close(); return; }
      // Recalculate at confirmation; changed values need another click.
      if (value.difference == null || value.difference !== pending.displayedDamage) { refresh(); return; }
      if (value.difference !== 0) {
        const battle = pending;
        const payment = { amount: -value.difference };
        battle.payments.push(payment);
        battle.paid += value.difference;
        if (!battle.actions.adjustLifePoints(payment.amount)) {
          battle.payments = battle.payments.filter(item => item !== payment);
          battle.paid -= value.difference;
          close();
          return;
        }
      }
      if (pending) pending.confirmed = true;
      hide();
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
    for (const child of [title, summary, amount, updateNotice, footer]) section.appendChild(child);
    shadow.appendChild(section);
    document.body.appendChild(panel);
  }

  function observe(event, actions) {
    if (event.type === "attack" || event.type === "attack-direct") {
      close();
      if (!event.live || !["self", "opponent"].includes(event.actor.relation) || !local()) return;
      const ownAttack = event.actor.relation === "self";
      const target = event.type === "attack" && monster(event.target.instanceId);
      if (event.type === "attack" && (!target || (ownAttack ? target.controller === page.username : target.controller !== page.username))) return;
      pending = { event, actions, paid: 0, payments: [], effects: page.DBEnhancerBattleDamage.createEffectTracker(), attacker: event.attacker.instanceId,
        target: target ? target.instanceId : null, actor: event.actor.username,
        defender: target ? target.controller : null, damageTo: ownAttack ? "attacker" : "defender",
        duelId: page.duelId, game: page.player1, username: page.username,
        local: local(), life: local().lifepoints, phase: page.currentPhase, turn: page.turnCount };
      show();
    } else if (pending && (!event.live || event.type === "reset")) close();
    else if (pending && event.type === "life-points" && ["self", "partner"].includes(event.actor.relation)) lifeChanged(event);
    else if (pending && ["activate", "effect", "to-grave"].includes(event.type)) {
      // Execute events run before the native move, so hand membership is still
      // available. Supplied card identity is public even for the opponent's hand.
      const actor = [page.player1, page.player2, page.player3, page.player4]
        .find(player => player && player.username === event.actor.username);
      const fromHand = actor && Array.isArray(actor.hand_arr) && actor.hand_arr.some(card =>
        String(card.data("id")) === String(event.card.instanceId));
      // Ordinary discard uses "To GY", with its origin in the native public
      // log. Do not depend on a special play name or cached hidden card fronts.
      const logs = Array.isArray(event.data.log) ? event.data.log : [event.data.log];
      const fromHandLog = event.type === "to-grave" && logs.some(log =>
        log && /\bfrom hand\b/i.test(log.public_log || ""));
      if (!fromHand && !fromHandLog && event.play !== "To grave from hand") return;
      const value = current();
      if (!value) { close(); return; }
      // Feed raw stats to the tracker; current() already projects inferred boosts.
      const battle = { attacker: monster(pending.attacker),
        target: pending.target == null ? null : monster(pending.target), event: pending.event };
      if (pending.effects.observe(event, battle)) {
        pending.actions = actions;
        const updated = current();
        if (!updated) { close(); return; }
        const name = event.card.name === "Honest" ? "Honest" : "Kalut";
        const action = event.type === "to-grave" ? "discarded" : "activated";
        const format = damage => damage == null ? "?" : damage.toLocaleString();
        pending.updateText = `${name} ${action} · ${format(value.result.damage)} → ${format(updated.result.damage)} damage`;
        if (panel.hidden && updated.difference !== 0) show();
        else refresh();
        if (!panel.hidden) highlightUpdate();
      }
    }
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
          if (pending && (!event.live || event.type === "reset")) close();
          else if (pending && event.type === "life-points" &&
              ["self", "partner"].includes(event.actor.relation)) lifeChanged(event);
        }
      });
    },
    tick: refresh
  };
});
