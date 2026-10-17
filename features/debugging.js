(function attach(root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory;
  else (root.DBEnhancerFeatures ||= {})["debugging"] = factory;
})(typeof window !== "undefined" ? window : globalThis, function createFeature(context) {
  "use strict";
  const { window: page, document } = context;
  const history = [];
  const wrappers = new Map();
  let sequence = 0, commands = 0, queueHead, queueSince = 0, queueWarned = false;
  let lastBlocked = false;
  const clock = () => Date.now();
  const controls = ["end_turn", "start_turn", "dp", "sp", "m1", "bp", "m2", "ep", "field", "overlay", "dim"];
  const flags = ["currentLabel", "duelId", "duelist", "replay", "automatic", "resetting", "paused",
    "awaiting_defeat", "reconnecting", "clickedRecently", "stopQueue", "currentPhase", "turnCount", "viewing"];

  function record(type, details = {}) {
    // Never retain messages, DOM nodes, or arbitrary game objects.
    try {
      const entry = { sequence: ++sequence, time: new Date().toISOString(), type, details: JSON.parse(JSON.stringify(details)) };
      const previous = history[history.length - 1];
      if (previous && previous.type === type && JSON.stringify(previous.details) === JSON.stringify(entry.details)) {
        previous.repeated = (previous.repeated || 1) + 1;
        previous.lastTime = entry.time;
        return;
      }
      history.push(entry);
      if (history.length > 300) history.shift();
      if (/error|failed|stalled|blocked|no-command/.test(type)) page.console?.warn("[Dueling Book Enhancer] " + type, entry.details);
    } catch (_) { /* Diagnostics must never affect the game. */ }
  }

  function error(type, failure, details = {}) {
    record(type, { ...details, message: String(failure && failure.message || failure).slice(0, 1000),
      stack: String(failure && failure.stack || "").slice(0, 3000) });
  }

  function game() {
    const result = {};
    for (const key of flags) {
      const value = page[key];
      result[key] = value == null ? null : ["string", "boolean", "number"].includes(typeof value) ? value : typeof value;
    }
    result.turn = page.turn_player ? page.turn_player.username === page.username ? "self" : "other" : null;
    result.queueLength = Array.isArray(page.actionsQueue) ? page.actionsQueue.length : null;
    result.queueHeadAgeMs = queueSince ? clock() - queueSince : null;
    result.socket = page.websocket ? { readyState: page.websocket.readyState, bufferedAmount: page.websocket.bufferedAmount } : null;
    result.players = [page.player1, page.player2, page.player3, page.player4].filter(Boolean).map(player => ({
      self: player.username === page.username, life: player.lifepoints,
      handCount: player.hand_arr?.length, deckCount: player.main_arr?.length,
      graveCount: player.grave_arr?.length, extraCount: player.extra_arr?.length
    }));
    return result;
  }

  function describe(element) {
    return element ? { tag: element.tagName, id: element.id || "", classes: String(element.className || "").slice(0, 180) } : null;
  }

  function controlState(id) {
    const element = document.getElementById(id);
    if (!element) return { id, present: false };
    const rect = element.getBoundingClientRect();
    const style = page.getComputedStyle(element);
    const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
    const hit = document.elementFromPoint?.(x, y);
    const ancestors = [];
    for (let node = element; node && ancestors.length < 10; node = node.parentElement) {
      const css = page.getComputedStyle(node);
      if (css.pointerEvents === "none" || css.display === "none" || css.visibility === "hidden" || node.inert) {
        ancestors.push({ ...describe(node), display: css.display, visibility: css.visibility, pointerEvents: css.pointerEvents, inert: Boolean(node.inert) });
      }
    }
    return { id, present: true, display: style.display, visibility: style.visibility, pointerEvents: style.pointerEvents,
      disabled: Boolean(element.disabled), hidden: element.hidden, rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
      hit: describe(hit), receivesPointer: Boolean(hit && (hit === element || element.contains(hit))), blockingAncestors: ancestors };
  }

  function snapshot() {
    const safe = callback => { try { return callback(); } catch (failure) { return { error: String(failure.message || failure) }; } };
    const settings = context.getSettings();
    const automation = {};
    for (const key of ["autoGoFirst", "rpsEnhancements", "autoPickRps", "autoStartRps", "autoShuffleHand", "autoShuffleAfterDraw", "handShuffleAggressiveness", "battleDamageConfirmation", "autoPayActivationCosts"]) automation[key] = settings[key];
    return { schemaVersion: 1, version: page.DBEnhancerDiagnostics?.version, capturedAt: new Date().toISOString(),
      page: { hidden: Boolean(document.hidden), focused: document.hasFocus?.(), online: page.navigator?.onLine, activeElement: describe(document.activeElement) },
      game: safe(game), automation,
      controls: controls.map(id => safe(() => controlState(id))),
      duelEvents: safe(() => page.DBEnhancerDuelEvents?.diagnostics()),
      runtime: safe(() => page.DBEnhancerDiagnostics?.runtime?.()),
      connection: safe(() => page.DBEnhancerDiagnostics?.connectionHealth?.()),
      history: history.map(entry => JSON.parse(JSON.stringify(entry))) };
  }

  function download() {
    try {
      record("manual-dump");
      const blob = new page.Blob([JSON.stringify(snapshot(), null, 2)], { type: "application/json" });
      const url = page.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "duelingbook-debug-" + new Date().toISOString().replace(/[:.]/g, "-") + ".json";
      document.body.appendChild(link);
      try { link.click(); } finally { link.remove(); page.setTimeout(() => page.URL.revokeObjectURL(url), 1000); }
      return true;
    } catch (failure) { error("dump-error", failure); return false; }
  }

  function installHooks() {
    for (const name of ["Send", "endTurnE", "startTurnE", "performNextAction", "endAction"]) {
      const original = page[name];
      if (typeof original !== "function" || original === wrappers.get(name)) continue;
      let cursor = original;
      const seen = new Set();
      while (cursor && !seen.has(cursor) && cursor !== wrappers.get(name)) {
        seen.add(cursor); cursor = cursor.dbxEnhancerOriginal;
      }
      if (cursor && cursor === wrappers.get(name)) continue;
      const wrapped = function () {
        try {
          if (name === "Send") {
            commands++;
            const message = arguments[0];
            record("command", { action: typeof message?.action === "string" ? message.action : null,
              play: typeof message?.play === "string" ? message.play : null });
          } else if (name === "endTurnE" || name === "startTurnE") record("native-control", { name, clickedRecently: Boolean(page.clickedRecently) });
        } catch (failure) { error("observer-error", failure, { name }); }
        try { return original.apply(this, arguments); }
        catch (failure) { error("native-error", failure, { name }); throw failure; }
      };
      Object.defineProperty(wrapped, "dbxEnhancerOriginal", { value: original });
      try { page[name] = wrapped; if (page[name] === wrapped) wrappers.set(name, wrapped); }
      catch (failure) { error("hook-error", failure, { name }); }
    }
  }

  function tick() {
    installHooks();
    const head = page.actionsQueue?.[0];
    if (head !== queueHead || !head) { queueHead = head; queueSince = head ? clock() : 0; queueWarned = false; }
    if (head && !queueWarned && clock() - queueSince >= 15000 && !document.hidden && !page.replay && !page.paused) {
      queueWarned = true;
      record("queue-stalled", game());
    }
    const blocked = Boolean(page.clickedRecently);
    if (blocked !== lastBlocked) { lastBlocked = blocked; record("click-guard", { blocked }); }
  }

  function initialize() {
    page.addEventListener("error", event => error("page-error", event.error || event.message));
    page.addEventListener("unhandledrejection", event => error("unhandled-error", event.reason));
    document.addEventListener("click", event => {
      try {
        const control = event.target?.closest?.("#end_turn, #start_turn, #dp, #sp, #m1, #bp, #m2, #ep");
        if (!control) return;
        const before = commands;
        record("control-click", { id: control.id, clickedRecently: Boolean(page.clickedRecently), stopQueue: Boolean(page.stopQueue) });
        page.setTimeout(() => {
          if (commands === before) record("control-no-command", { id: control.id, clickedRecently: Boolean(page.clickedRecently), state: controlState(control.id) });
        }, 0);
      } catch (failure) { error("observer-error", failure); }
    }, true);
    document.addEventListener("keydown", event => {
      if (event.ctrlKey && event.altKey && event.shiftKey && event.code === "KeyD" && !event.repeat) download();
    }, true);
    record("startup");
    tick();
  }

  page.DBEnhancerDebug = { record, error, snapshot, download };
  return { initialize, tick, settingsKeys: [], diagnostics: { snapshot, download } };
});
