(function attach(root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory;
  else (root.DBEnhancerFeatures ||= {})["hand-shuffle"] = factory;
})(typeof window !== "undefined" ? window : globalThis, function createFeature(context) {
  "use strict";
  const { window: page, document, core, getSettings } = context;
  const now = context.now || (() => page.performance.now());
  let initialized = false;
  let lastDraw = null;
  let pending = null;
  let pointer = null;
  let pointerDown = false;
  let sendWrapper = null;
  let shuffleSequence = 0;

  function installSendHook() {
    const original = page.Send;
    if (typeof original !== "function" || original === sendWrapper) return;
    sendWrapper = function sendWithShuffleCancellation(message) {
      if (message && message.action === "Duel" && message.play === "Shuffle hand") {
        // Observe the outgoing command, including previously bound native click
        // handlers. Do not wait for a network echo or a changed hand order.
        shuffleSequence++;
        cancel();
      }
      return original.apply(this, arguments);
    };
    page.Send = sendWrapper;
  }

  function rect(element) {
    const bounds = element && element.getBoundingClientRect && element.getBoundingClientRect();
    return bounds && bounds.width > 0 && bounds.height > 0 ? bounds : null;
  }

  function deckRect(player) {
    const deck = player.main_arr;
    return rect(deck && deck.length && deck[0][0]);
  }

  function farFrom(bounds) {
    const dx = Math.max(bounds.left - pointer.x, 0, pointer.x - bounds.right);
    const dy = Math.max(bounds.top - pointer.y, 0, pointer.y - bounds.bottom);
    return Math.hypot(dx, dy) >= core.handShuffleTiming(getSettings().handShuffleAggressiveness).distance;
  }

  function checkPointer() {
    if (!pending) return;
    const deck = deckRect(pending.player);
    const menu = rect(document.getElementById("card_menu"));
    if (!pointer || pointerDown || !deck ||
        ![deck, menu, ...pending.regions].filter(Boolean).every(farFrom)) pending.awaySince = null;
    else if (pending.awaySince == null) pending.awaySince = now();
  }

  function cancel() { pending = null; }

  function tick() {
    installSendHook();
    if (!pending) return;
    const item = pending;
    if (!item.hand) return; // The native draw handler is still executing.
    if (!getSettings().autoShuffleAfterDraw || document.hidden || !document.hasFocus() ||
        !page.duelist || page.replay || page.resetting || page.automatic || page.paused || page.awaiting_defeat ||
        !String(page.currentLabel).startsWith("duel_start") || page.viewing ||
        page.player1 !== item.game || page.duelId !== item.duelId || page.username !== item.username ||
        page.turnCount !== item.turn || page.currentPhase !== item.phase || now() - item.time > 20000 ||
        item.player.hand_arr.length !== item.hand.length ||
        item.hand.some((card, index) => item.player.hand_arr[index] !== card)) { cancel(); return; }
    checkPointer();
    const timing = core.handShuffleTiming(getSettings().handShuffleAggressiveness);
    if (now() - item.time < timing.idleMs || item.awaySince == null || now() - item.awaySince < timing.awayMs ||
        pointerDown || page.stopQueue || page.actionsQueue && page.actionsQueue.length) return;
    cancel();
    item.actions.shuffleHand();
  }

  async function delayedDraw(event, actions, player) {
    const item = pending = { game: page.player1, duelId: event.duelId, username: page.username,
      turn: event.turn, phase: event.phase, player, time: now(), awaySince: null, actions,
      regions: [deckRect(player), rect(document.getElementById("card_menu"))].filter(Boolean) };
    const size = player.hand_arr.length;
    await Promise.resolve();
    if (pending !== item) return;
    if (player.hand_arr.length <= size || player.hand_arr.length < 2) { cancel(); return; }
    item.hand = player.hand_arr.slice();
    checkPointer();
  }

  async function observe(event, actions) {
    const player = [page.player1, page.player2, page.player3, page.player4]
      .find(item => item && item.username === page.username);
    if (!player || !Array.isArray(player.hand_arr)) return;
    if (getSettings().autoShuffleAfterDraw) return delayedDraw(event, actions, player);
    if (!getSettings().autoShuffleHand || event.phase !== "DP" ||
        !page.turn_player || page.turn_player.username !== page.username ||
        !Number.isSafeInteger(event.turn) || event.turn < 1) return;
    if (lastDraw && lastDraw.game === page.player1 && lastDraw.duelId === event.duelId &&
        lastDraw.turn === event.turn && lastDraw.player === player) return;
    const draw = lastDraw = { game: page.player1, duelId: event.duelId, turn: event.turn, player };
    const handSize = player.hand_arr.length;
    const sequence = shuffleSequence;
    // Events precede the native handler. Let drawCard add the card first;
    // the site's animation queue serializes the shuffle response after the draw.
    await Promise.resolve();
    if (sequence === shuffleSequence && lastDraw === draw && !getSettings().autoShuffleAfterDraw && getSettings().autoShuffleHand && player.hand_arr.length > handSize &&
        player.hand_arr.length > 1) actions.shuffleHand();
  }

  return {
    settingsKeys: ["autoShuffleHand", "autoShuffleAfterDraw", "handShuffleAggressiveness"],
    tick,
    settingsChanged: cancel,
    initialize() {
      if (initialized || !page.DBEnhancerDuelEvents) return;
      initialized = true;
      installSendHook();
      if (document) {
        document.addEventListener("pointermove", event => {
          pointer = { x: event.clientX, y: event.clientY };
          checkPointer();
        }, true);
        document.addEventListener("pointerdown", () => {
          pointerDown = true;
          if (pending) pending.awaySince = null;
        }, true);
        document.addEventListener("pointerup", () => { pointerDown = false; checkPointer(); }, true);
        document.addEventListener("pointercancel", () => { pointerDown = false; pointer = null; cancel(); }, true);
        document.addEventListener("pointerout", event => {
          if (!event.relatedTarget) { pointer = null; cancel(); }
        }, true);
        document.addEventListener("visibilitychange", () => { if (document.hidden) cancel(); });
        page.addEventListener("blur", () => { pointer = null; pointerDown = false; cancel(); });
      }
      page.DBEnhancerDuelEvents.register({
        id: "shuffle-hand-after-turn-draw", when: { type: "draw", actor: "self" }, run: observe
      });
      page.DBEnhancerDuelEvents.register({
        id: "reset-turn-draw-shuffle", when: { type: "reset" }, includeNonLive: true,
        run() { lastDraw = null; cancel(); }
      });
      page.DBEnhancerDuelEvents.register({
        id: "cancel-pending-hand-shuffle", includeNonLive: true,
        when: { stage: "receive" },
        run(event) {
          // Cancel on receipt, before a queued draw or hand edit can race the timer.
          if (event.actor.relation === "self" || ["reset", "start-turn", "end-turn"].includes(event.type)) cancel();
        }
      });
    }
  };
});
