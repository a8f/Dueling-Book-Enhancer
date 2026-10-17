(function attach(root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory;
  else (root.DBEnhancerFeatures ||= {})["connection-health"] = factory;
})(typeof window !== "undefined" ? window : globalThis, function createFeature(context) {
  "use strict";
  const { window: page, document } = context;
  const now = context.now || (() => page.performance.now());
  // Only commands known to echo back. Ready, typing, and multi-step choices
  // deliberately stay out: they may wait on another player or change play names.
  const echoed = new Set(["Draw card", "Normal Summon", "Flip Summon", "Activate ST",
    "Set monster", "Set ST", "To GY", "To hand", "Banish", "Mill", "Reveal",
    "Attack", "Attack directly", "Life points", "Shuffle hand", "Shuffle deck",
    "Add counter", "Remove counter", "Coin", "Die", "Declare"]);
  let socket = null;
  let originalSend = null;
  let sendWrapper = null;
  let listeners = null;
  let lastReceive = null;
  let heartbeat = null;
  let pending = [];
  let failed = false;
  let lastTick = null;
  let graceStart = 0;
  let wasHidden = false;
  let duelId;
  let localUsername;
  let banner = null;
  let status = { state: "idle", reason: "", message: "" };

  function parse(data) {
    if (typeof data !== "string") return null;
    try {
      const message = JSON.parse(data);
      return message && typeof message === "object" && !Array.isArray(message) ? message : null;
    } catch (_) { return null; }
  }

  function liveDuel() {
    return page.duelist === true && !page.replay && !page.automatic && !page.resetting &&
      String(page.currentLabel).startsWith("duel_start");
  }

  function received(event) {
    syncDuel();
    const message = parse(event.data);
    if (!message || typeof message.action !== "string") return;
    lastReceive = now();
    failed = false;
    if (message.action === "Heartbeat") heartbeat = null;
    if (message.action === "Connected" || message.action === "Reconnected") {
      heartbeat = null;
      pending = [];
    }
    if (message.action !== "Duel" || message.username !== page.username) return;
    // A response consumes one matching command, never all commands of that play.
    // Outgoing card is the instance ID; incoming card is the card definition.
    const index = pending.findIndex(item => item.play === message.play &&
      (item.card == null || item.card === message.id));
    if (index >= 0) pending.splice(index, 1);
  }

  function installSocket() {
    const next = page.websocket;
    if (next === socket) return;
    if (socket && listeners) {
      for (const [type, handler] of Object.entries(listeners)) socket.removeEventListener(type, handler);
      if (socket.send === sendWrapper) socket.send = originalSend;
    }
    socket = next || null;
    heartbeat = null;
    pending = [];
    failed = false;
    lastReceive = socket ? now() : null;
    listeners = null;
    if (!socket || typeof socket.addEventListener !== "function") return;
    listeners = { message: received, close: () => { failed = true; }, error: () => { failed = true; },
      open: () => { failed = false; lastReceive = now(); } };
    for (const [type, handler] of Object.entries(listeners)) socket.addEventListener(type, handler);
    originalSend = socket.send;
    const nativeSend = originalSend;
    sendWrapper = function sendWithHealthTracking(data) {
      // Observe actual sends, including resend(), without modifying native payloads.
      const result = nativeSend.apply(this, arguments);
      syncDuel();
      const message = parse(data);
      if (message && message.action === "Heartbeat" && heartbeat == null) heartbeat = now();
      if (message && message.action === "Duel" && echoed.has(message.play) && liveDuel()) {
        pending.push({ play: message.play,
          // Fast consecutive draws/mills can send the same stale top-card ID;
          // the server advances the deck and echoes a different instance ID.
          card: !["Shuffle deck", "Draw card", "Mill"].includes(message.play) &&
            typeof message.card === "number" ? message.card : null, time: now() });
        // Bound memory during a long stall; preserve the oldest unanswered action.
        if (pending.length > 100) pending.pop();
      }
      return result;
    };
    socket.send = sendWrapper;
  }

  function render(next) {
    status = next;
    if (!next.message) {
      if (banner) banner.hidden = true;
      return;
    }
    if (!banner && document.body) {
      banner = document.createElement("div");
      banner.id = "dbx-connection-health";
      banner.setAttribute("role", "status");
      banner.setAttribute("aria-live", "polite");
      document.body.appendChild(banner);
    }
    if (!banner) return;
    banner.hidden = false;
    if (banner.textContent !== next.message) banner.textContent = next.message;
    banner.dataset.state = next.state;
  }

  function syncDuel() {
    if (duelId !== page.duelId || localUsername !== page.username || !liveDuel()) pending = [];
    duelId = page.duelId;
    localUsername = page.username;
  }

  function tick() {
    // Startup tests and pages without the native socket need no timing APIs.
    if (!page.websocket && !socket) return;
    const time = now();
    installSocket();
    if (lastTick == null || time - lastTick > 5000 || wasHidden && !document.hidden) graceStart = time;
    lastTick = time;
    wasHidden = Boolean(document.hidden);
    syncDuel();
    let next = { state: socket ? "healthy" : "idle", reason: "", message: "" };
    if (socket && page.navigator && page.navigator.onLine === false) {
      next = { state: "disconnected", reason: "offline", message: "Connection lost: your browser is offline. Wait for Duelingbook to reconnect." };
    } else if (socket && (failed || socket.readyState >= 2)) {
      next = { state: "disconnected", reason: "socket", message: "Connection lost: the server connection closed or failed. Wait for Duelingbook to reconnect." };
    } else if (page.reconnecting) {
      next = { state: "stalled", reason: "reconnecting", message: "Connection interrupted: Duelingbook is reconnecting. Your latest actions may not have reached the server." };
    } else if (socket && socket.readyState === 1 && !document.hidden) {
      if (heartbeat != null && time - Math.max(heartbeat, graceStart) >= 15000) {
        next = { state: "stalled", reason: "heartbeat", message: "Connection stalled: no heartbeat reply for 15 seconds. Your duel may be out of sync." };
      } else if (lastReceive != null && time - Math.max(lastReceive, graceStart) >= 45000) {
        next = { state: "stalled", reason: "silence", message: "Connection stalled: no server messages for 45 seconds. Your duel may be out of sync." };
      } else if (pending.length && time - Math.max(pending[0].time, graceStart) >= 10000) {
        next = { state: "stalled", reason: "action", message: "Possible duel desync: still waiting for the server to confirm “" + pending[0].play + "” after 10 seconds. Check before repeating the action." };
      }
    }
    render(next);
  }

  return { initialize: tick, tick, settingsKeys: [], diagnostics: {
    connectionHealth: () => ({ ...status, socketState: socket ? socket.readyState : null,
      lastReceive, heartbeatSentAt: heartbeat, pendingActions: pending.map(item => ({ ...item })) })
  } };
});
