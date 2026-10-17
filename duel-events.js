(function attachDuelEvents(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.DBEnhancerDuelEvents = api.createRuntime(root);
})(typeof window !== "undefined" ? window : this, function duelEventsModule() {
  "use strict";

  // Hook action execution, rather than receipt: the site's animation queue may
  // still be applying earlier moves when a network message arrives.
  const HANDLERS = Object.freeze({
    normalSummon: "summon", specialSummon: "summon", olSummon: "summon",
    flipSummon: "summon", summonToken: "summon",
    activateST: "activate", activateFieldSpell: "activate",
    activateFieldSpell2: "activate", activatePendulumLeft: "activate",
    activatePendulumRight: "activate", activateSkill: "activate",
    attack: "attack", attackDirectly: "attack-direct",
    targetCardResponse: "target", applyEffect: "effect",
    setMonster: "set", setST: "set", setFieldSpell: "set",
    setFieldSpell2: "set", drawCard: "draw",
    toHand: "to-hand", toDeck: "to-deck", toGY: "to-grave",
    toED: "to-extra", banish: "banish", move: "move",
    flip: "flip", turnFaceDown: "flip", changeControl: "control",
    updateLifePoints: "life-points", resetGame: "reset",
    allGood: "good", stopGood: "stop-good", thinking: "thinking"
  });

  function typeForPlay(play) {
    if (/^(SS|OL) (ATK|DEF)|^(Normal Summon|Flip Summon|Summon [Tt]oken)$/.test(play)) return "summon";
    if (/^Activate /.test(play)) return "activate";
    if (/^Set /.test(play)) return "set";
    if (/^Banish/.test(play)) return "banish";
    if (/^To hand/.test(play)) return "to-hand";
    if (/^To [BT] Deck/.test(play)) return "to-deck";
    if (/^To (GY|grave|Grave)/.test(play)) return "to-grave";
    if (/^To (ED|Extra)/.test(play)) return "to-extra";
    const aliases = { "Attack directly": "attack-direct", "Target card": "target",
      "Apply effect": "effect", "Draw card": "draw", "Reset game": "reset",
      "Change control": "control", "Flip monster": "flip", "Turn face-down": "flip" };
    return Object.prototype.hasOwnProperty.call(aliases, play) ? aliases[play] :
      String(play || "message").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }

  function frozenCopy(value) {
    if (!value || typeof value !== "object") return value;
    return Object.freeze(Array.isArray(value) ? value.map(frozenCopy) :
      Object.fromEntries(Object.entries(value).map(([key, item]) => [key, frozenCopy(item)])));
  }

  function createRuntime(page) {
    const rules = new Map();
    const wrappers = new Map();
    let sequence = 0;
    const activeMessages = new WeakSet();
    const dispatches = new WeakMap();
    let enqueueing = null;
    let gameGeneration = 0;

    function report(error) {
      try { page.DBEnhancerDebug?.error("duel-rule-error", error); } catch (_) { /* optional diagnostics */ }
      try { page.console.warn("[Dueling Book Enhancer] Duel rule failed.", error); } catch (_) { /* optional console */ }
    }

    function live() {
      return page.duelist === true && !page.replay && !page.resetting &&
        !page.automatic && !page.paused && !page.awaiting_defeat &&
        typeof page.currentLabel === "string" && page.currentLabel.startsWith("duel_start");
    }

    function actorRelation(player) {
      if (!player || !page.username) return "unknown";
      if (player.username === page.username) return "self";
      if (!page.duelist) return "unknown";
      // In tag duels, teammates must never match an opponent rule.
      const local = [page.player1, page.player2, page.player3, page.player4]
        .find(item => item && item.username === page.username);
      if (!local) return "unknown";
      if (local.partner && local.partner.username === player.username) return "partner";
      if (local.opponent && (local.opponent.username === player.username ||
          (local.opponent.partner && local.opponent.partner.username === player.username))) return "opponent";
      return "unknown";
    }

    function cardSnapshot(instanceId, supplied) {
      let front;
      let element;
      if (instanceId != null && typeof page.getDuelCard === "function") {
        element = page.getDuelCard(instanceId);
        if (element) front = element.data("cardfront");
      }
      const read = key => supplied && supplied[key] != null ? supplied[key] :
        front && typeof front.data === "function" ? front.data(key) : null;
      // Never infer an opponent's face-down identity from a cached card front.
      const hidden = !supplied && element && element.data("face_down") &&
        actorRelation(element.data("controller")) !== "self";
      return Object.freeze({
        instanceId: instanceId == null ? null : instanceId,
        id: hidden ? null : read("id"),
        name: hidden ? null : read("name"),
        cardType: hidden ? null : read("card_type")
      });
    }

    function matchesCard(filter, card) {
      if (filter == null) return true;
      if (!card) return false;
      return typeof filter === "number" ? card.id === filter : card.name === filter;
    }

    function matches(filter, event) {
      return (!filter.type || filter.type === event.type) &&
        (filter.stage || "execute") === event.stage &&
        (!filter.play || filter.play === event.play) &&
        (!filter.actor || filter.actor === event.actor.relation) &&
        matchesCard(filter.card, event.card) &&
        matchesCard(filter.attacker, event.attacker) &&
        matchesCard(filter.target, event.target);
    }

    function publish(type, player, message, stage = "execute", isLive = live()) {
      const eventSequence = ++sequence;
      try { page.DBEnhancerDebug?.record("duel-event", { type, stage, play: message.play || null, live: isLive }); } catch (_) {}
      const listeners = Array.from(rules.values()).filter(rule =>
        (rule.when.stage || "execute") === stage && (rule.includeNonLive || isLive));
      if (!listeners.length) return;
      const event = Object.freeze({
        sequence: eventSequence, type, stage, play: message.play || null,
        data: frozenCopy(message),
        duelId: page.duelId == null ? null : page.duelId,
        live: isLive, phase: page.currentPhase || null,
        turn: page.turnCount == null ? null : page.turnCount,
        actor: Object.freeze({ username: player && player.username || null, relation: actorRelation(player) }),
        card: cardSnapshot(message.id ?? message.start_id, message.card),
        attacker: type === "attack" ? cardSnapshot(message.attacking_id) :
          type === "attack-direct" ? cardSnapshot(message.id) : null,
        target: type === "attack" ? cardSnapshot(message.attacked_id) :
          type === "target" ? cardSnapshot(message.id, message.card) : null,
        amount: typeof message.amount === "number" ? message.amount : null
      });
      const game = page.player1;
      const generation = gameGeneration;
      const localUsername = page.username;
      for (const rule of listeners) {
        if (rules.get(rule.id) !== rule) continue;
        let usedLifeAction = false;
        let usedShuffleAction = false;
        const actions = Object.freeze({
          shuffleHand() {
            if (usedShuffleAction || !event.live || !live() || page.duelId !== event.duelId ||
                page.player1 !== game || generation !== gameGeneration || page.username !== localUsername ||
                rules.get(rule.id) !== rule || page.turnCount !== event.turn ||
                typeof page.shuffleHandE !== "function") return false;
            usedShuffleAction = true;
            page.shuffleHandE();
            return true;
          },
          adjustLifePoints(amount) {
            // One command per rule/event, even when a feature defers its action.
            if (usedLifeAction || !event.live || !live() || page.duelId !== event.duelId ||
                page.player1 !== game || generation !== gameGeneration || page.username !== localUsername ||
                rules.get(rule.id) !== rule ||
                !Number.isSafeInteger(amount) || amount === 0 || Math.abs(amount) > 2147483647 ||
                typeof page.updateLifePointsE !== "function") return false;
            usedLifeAction = true;
            page.updateLifePointsE(amount);
            return true;
          }
        });
        try {
          if (matches(rule.when, event) && (!rule.test || rule.test(event))) {
            const result = rule.run(event, actions);
            if (result && typeof result.then === "function") Promise.resolve(result).catch(report);
          }
        } catch (error) { report(error); }
      }
    }

    function execute(record, callback, receiver, args) {
      const outermost = !activeMessages.has(record.message);
      if (outermost) activeMessages.add(record.message);
      try {
        if (!record.emitted) {
          record.emitted = true;
          try {
            publish(typeForPlay(record.message.play), record.player, record.message, "execute",
              record.inline ? record.liveAtReceipt || live() : live());
          } catch (error) { report(error); }
        }
        try { return callback.apply(receiver, args); }
        catch (error) {
          try { page.DBEnhancerDebug?.error("native-queue-error", error, { play: record.message.play || null }); } catch (_) {}
          throw error;
        }
      } finally { if (outermost) activeMessages.delete(record.message); }
    }

    function messagePlayer(message) {
      return [page.player1, page.player2, page.player3, page.player4]
        .find(player => player && player.username === message.username) ||
        (message.username ? { username: message.username } : null);
    }

    function installDispatchers() {
      for (const name of ["duelResponse", "duelResponse2"]) {
        const original = page[name];
        if (typeof original !== "function" || original === wrappers.get(name)) continue;
        function enhancedDispatch(player, message) {
          if (name === "duelResponse") {
            message = player;
            player = message && messagePlayer(message);
          }
          if (!message || typeof message !== "object") return original.apply(this, arguments);
          const existing = dispatches.get(message);
          const record = existing || { player, message, queued: false, emitted: false, liveAtReceipt: live() };
          if (!existing) dispatches.set(message, record);
          try {
            if (name === "duelResponse") {
              try { publish(typeForPlay(message.play), player, message, "receive"); } catch (error) { report(error); }
              const replayQueue = page.replay && Array.isArray(page.actionsQueue) ? page.actionsQueue : null;
              const previousActions = replayQueue ? new Set(replayQueue) : null;
              const result = original.apply(this, arguments);
              // The first dispatcher also queues its normally inline actions
              // during replay. If still pending, observe their actual execution.
              if (replayQueue && replayQueue === page.actionsQueue && !record.queued && !record.emitted) {
                let index = replayQueue.length - 1;
                while (index >= 0 && previousActions.has(replayQueue[index])) index--;
                if (index >= 0) {
                  const callback = replayQueue[index];
                  record.queued = true;
                  replayQueue[index] = function replayDuelEvent() { return execute(record, callback, this, arguments); };
                }
              }
              // Inline and log-only messages have no queue callback. Known
              // handler hooks emit before execution; other inline cases emit
              // after the dispatcher returns, preserving all protocol events.
              if (!record.queued && !record.emitted) {
                record.inline = true;
                execute(record, () => {}, null, []);
              }
              return result;
            }
            const queue = page.actionsQueue;
            if (!Array.isArray(queue)) return original.apply(this, arguments);
            const descriptor = Object.getOwnPropertyDescriptor(queue, "push");
            const originalPush = queue.push;
            const previous = enqueueing;
            function pushActions(...items) {
              if (enqueueing !== record) return originalPush.apply(this, items);
              return originalPush.apply(this, items.map(callback => {
                if (typeof callback !== "function") return callback;
                record.queued = true;
                return function queuedDuelEvent() { return execute(record, callback, this, arguments); };
              }));
            }
            // Observation is optional: a non-writable queue must still reach
            // the native dispatcher exactly once.
            try { queue.push = pushActions; }
            catch (error) { report(error); return original.apply(this, arguments); }
            if (queue.push !== pushActions) return original.apply(this, arguments);
            enqueueing = record;
            try { return original.apply(this, arguments); }
            finally {
              enqueueing = previous;
              try {
                if (queue.push === pushActions) {
                  if (descriptor) Object.defineProperty(queue, "push", descriptor);
                  else delete queue.push;
                }
              } catch (error) { report(error); }
            }
          } finally { if (!existing) dispatches.delete(message); }
        }
        try {
          page[name] = enhancedDispatch;
          if (page[name] === enhancedDispatch) wrappers.set(name, enhancedDispatch);
        } catch (error) { report(error); }
      }
    }

    function install() {
      installDispatchers();
      for (const [name, type] of Object.entries({ ...HANDLERS, initUserDuelStart: null })) {
        const original = page[name];
        if (typeof original !== "function" || original === wrappers.get(name)) continue;
        function enhancedAction(player, message) {
          if (name === "initUserDuelStart") gameGeneration++;
          const observable = type && message && typeof message === "object";
          const outermost = observable && !activeMessages.has(message);
          if (outermost) activeMessages.add(message);
          try {
            if (outermost) {
              const record = dispatches.get(message);
              if (!record || !record.emitted) {
                if (record) record.emitted = true;
                try { publish(type, player, message); } catch (error) { report(error); }
              }
            }
            try { return original.apply(this, arguments); }
            catch (error) {
              try { page.DBEnhancerDebug?.error("native-handler-error", error, { name, play: message && message.play || null }); } catch (_) {}
              throw error;
            }
          } finally { if (outermost) activeMessages.delete(message); }
        }
        try {
          page[name] = enhancedAction;
          if (page[name] === enhancedAction) wrappers.set(name, enhancedAction);
        } catch (error) { report(error); }
      }
      return diagnostics();
    }

    function register(rule) {
      if (!rule || typeof rule.id !== "string" || !rule.id || typeof rule.run !== "function" ||
          (rule.test != null && typeof rule.test !== "function")) throw new TypeError("A duel rule needs an id and run(event, actions).");
      if (rules.has(rule.id)) throw new Error("Duplicate duel rule: " + rule.id);
      const record = Object.freeze({ ...rule, when: Object.freeze({ ...rule.when }) });
      rules.set(rule.id, record);
      return function unregister() {
        if (rules.get(record.id) === record) rules.delete(record.id);
      };
    }

    function diagnostics() {
      return {
        rules: Array.from(rules.keys()), events: sequence,
        installed: [...Object.keys(HANDLERS), "initUserDuelStart", "duelResponse", "duelResponse2"].filter(name => page[name] === wrappers.get(name) && wrappers.has(name)),
        missing: [...Object.keys(HANDLERS), "initUserDuelStart", "duelResponse", "duelResponse2"].filter(name => !wrappers.has(name) || page[name] !== wrappers.get(name))
      };
    }

    return Object.freeze({ register, install, diagnostics });
  }

  return { createRuntime, typeForPlay };
});
