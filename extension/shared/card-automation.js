(function attach(root, factory) {
  const api = factory(typeof module === "object" && module.exports ? require("./enhancer-core.js") : root.DBEnhancerCore);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.DBEnhancerCardAutomation = api;
})(typeof window !== "undefined" ? window : globalThis, function (core) {
  "use strict";
  const passive = new Set(["Good", "Stop good", "Thinking", "Typing", "Duel message", "Add watcher", "Remove watcher"]);
  const id = card => card && card.data("id");
  const name = card => card && card.data("cardfront") && card.data("cardfront").data("name");
  function normalizePasscode(value) {
    const text = typeof value === "number" && Number.isSafeInteger(value) ? String(value) : value;
    return typeof text === "string" && /^\d{1,8}$/.test(text) && Number(text) > 0 ? text.padStart(8, "0") : null;
  }
  const matchesData = (selector, data) => selector.passcode !== undefined ?
    [data.passcode, data.serial_number, data.alt_passcode].some(value => normalizePasscode(value) === selector.passcode) :
    Number.isSafeInteger(selector.id) && selector.id > 0 && selector.id === data.id;
  function matches(selector, card) {
    const front = card && card.data("cardfront");
    return Boolean(front && matchesData(selector, Object.fromEntries(["id", "passcode", "serial_number", "alt_passcode"].map(key => [key, front.data(key)]))));
  }

  function createBanish({ page, getSettings, changed = () => {}, now = () => page.performance.now() }) {
    let run = null;
    let internalSend = false;
    let lastSequence = 0;
    const goodReceipts = [];
    const local = () => page.player1 && page.player1.username === page.username ? page.player1 : null;
    const live = () => page.duelist === true && !page.replay && !page.automatic && !page.resetting &&
      !page.paused && !page.awaiting_defeat && !page.tag_duel && String(page.currentLabel).startsWith("duel_start") &&
      (!page.websocket || page.websocket.readyState === 1);
    const idle = () => Array.isArray(page.actionsQueue) && page.actionsQueue.length === 0 && page.stopQueue === false;
    const zone = player => [1, 2, 3, 4, 5].find(index => !player["m" + index]);
    const hasOverflowResolution = () => run?.rule.action.resolution[0].onNoMonsterZone?.op === "destroy";
    function prerequisiteProblem(rule) {
      for (const selector of rule.action.activation.checks.flatMap(check => check.cards) || []) {
        for (const player of [page.player1, page.player2]) {
          const cards = [player?.fieldSpell, ...[1, 2, 3, 4, 5].flatMap(index => [player?.["m" + index], player?.["s" + index]])];
          if (cards.some(card => card && !card.data("face_down") && matches(selector, card))) {
            return "This effect cannot activate while " + selector.name + " is face-up. If its effect is negated, adjudicate and play manually.";
          }
        }
      }
      return null;
    }
    function matchingLists(card = run && run.source) {
      return (getSettings().automationLists || []).filter(list => list.enabled && list.formats.includes(page.duelFormat) &&
        list.rules.some(rule => matches(rule.card, card)));
    }
    function available(card) {
      const player = local();
      return Boolean(live() && player && !card?.data("face_down") &&
        player.grave_arr.includes(card) && card.data("owner") === player &&
        (getSettings().automationLists || []).some(list => list.rules.some(rule => rule.action.source.zone === "graveyard" && matches(rule.card, card))));
    }
    function activationProblem(card) {
      if (!available(card)) return "Select your own face-up graveyard card in a live manual duel.";
      const lists = matchingLists(card);
      if (!lists.length) {
        const format = page.solo || page.duelFormat === "so" ? "Solo Mode" : String(page.duelFormat || "unknown");
        return "No enabled matching rules list loads in this duel's format (" + format +
          "). Open extension settings → Automation → Card rules lists. Enable a matching list and select this format if you want to use it here.";
      }
      const rules = lists.flatMap(list => list.rules.filter(rule => matches(rule.card, card)));
      if (rules.length > 1) return "Multiple enabled rules overlap for this card. Enable only one implementation in Automation settings.";
      const rule = rules[0];
      const problem = identityProblem(rule, card);
      if (problem) return problem;
      const prerequisite = prerequisiteProblem(rule);
      if (prerequisite) return prerequisite;
      if ((rule.action.timing.turn === "self") && page.turn_player !== local()) return "This rule requires your own turn.";
      if (!rule.action.timing.phases.includes(page.currentPhase)) return "This rule requires phase " + rule.action.timing.phases.join(" or ") + ". Change phase, then open automation again.";
      if (!local().main_arr.length) return "Your Deck is empty. The rule requires a matching card in your Deck.";
      if (!zone(local())) return "Free a monster zone before activating this effect.";
      if (!idle()) return "Wait for Duelingbook's current actions to finish, then open automation again.";
      if (typeof page.exitViewing !== "function" || typeof page.viewingE !== "function") return "Duelingbook's card controls are still loading. Open this action again shortly.";
      return null;
    }
    function eligible(card) {
      const player = local();
      const lists = matchingLists(card);
      const rules = lists.flatMap(list => list.rules.filter(rule => matches(rule.card, card)));
      const rule = rules[0];
      return Boolean(live() && player && rules.length === 1 && !identityProblem(rule, card) && !prerequisiteProblem(rule) &&
        !card.data("face_down") && player.grave_arr.includes(card) && card.data("owner") === player &&
        player.main_arr.length && zone(player) && (!(rule.action.timing.turn === "self") || page.turn_player === player) && rule.action.timing.phases.includes(page.currentPhase));
    }
    function identityProblem(rule, source) {
      if (name(source) !== rule.card.name) return "The source card identifier and name do not match the rule. Correct the rules list.";
      for (const selector of [rule.card, rule.action.resolution[0].card, ...(rule.action.activation.checks.flatMap(check => check.cards) || [])]) {
        const lookup = selector.passcode !== undefined ? page.getCardByPasscode : page.getCard;
        const known = typeof lookup === "function" ? lookup.call(page, selector.passcode ?? selector.id) : null;
        if (known && known.name && known.name !== selector.name) return "Card " + (selector.passcode ?? selector.id) + " belongs to " + known.name + ". Correct the rules list.";
      }
      return null;
    }
    function snapshot() {
      if (!run) return null;
      return { state: run.state, message: run.message, position: run.position, costPaid: run.costPaid,
        cardName: run.rule.card.name, effectLabel: run.rule.label, positions: run.rule.action.activation.choices[0].options,
        mode: run.mode,
        finished: run.finished, list: run.list.name, version: run.list.version, journal: run.journal.slice() };
    }
    function notify() { changed(snapshot()); }
    function finish(message, state = "stopped") {
      if (!run || run.finished) return;
      run.state = state;
      run.message = message;
      run.finished = true;
      if (run.release) run.release();
      notify();
    }
    function valid() {
      return run && !run.finished && live() && page.websocket === run.socket && page.duelId === run.duelId && local() === run.player &&
        page.username === run.username && page.turnCount === run.turn && page.currentPhase === run.phase &&
        page.turn_player === run.player && JSON.stringify(matchingLists()) === run.listsKey;
    }
    function setState(state, message) {
      run.state = state;
      run.message = message;
      run.since = now();
      run.expected = null;
      notify();
    }
    function expect(state, play, card, message) {
      setState(state, message);
      run.expected = { play, card, after: lastSequence, received: false, executed: false };
    }
    function send(play, card, extra = {}) {
      if (!valid() || typeof page.Send !== "function") { finish("Duel changed. Continue manually."); return; }
      internalSend = true;
      try { page.Send({ action: "Duel", play, ...(card == null ? {} : { card }), ...extra }); }
      catch (_) { finish("Command result is uncertain. Check the board and continue manually."); }
      finally { internalSend = false; }
    }
    function stopViewing(state) {
      expect(state, "Stop viewing", null, "Closing the native card view…");
      internalSend = true;
      try { page.exitViewing(); }
      catch (_) { finish("Could not close the card view. Continue manually."); }
      finally { internalSend = false; }
    }
    function prepare(card, { autoStart = false, mode = autoStart ? "wait" : "resolve" } = {}) {
      if (!["resolve", "wait"].includes(mode)) return false;
      if ((run && !run.finished) || !available(card)) return false;
      const lists = matchingLists(card);
      const list = lists[0] || getSettings().automationLists.find(list => list.rules.some(rule => matches(rule.card, card)));
      run = { state: "locking", message: "Preparing automation…", player: local(), username: page.username, socket: page.websocket,
        source: card, sourceId: id(card), duelId: page.duelId, turn: page.turnCount, phase: page.currentPhase,
        list, rule: list.rules.find(rule => matches(rule.card, card)),
        listsKey: JSON.stringify(lists), costPaid: false, position: null, mode, journal: [], since: now() };
      const problem = activationProblem(card);
      if (problem) { finish(problem, "unavailable"); return false; }
      const candidate = run;
      notify();
      if (!page.navigator || !page.navigator.locks) {
        finish("Automation needs browser support for coordinating duel tabs.");
        return false;
      }
      page.navigator.locks.request("dbx-card-automation:" + page.username + ":" + page.duelId,
        { ifAvailable: true }, lock => {
          if (run !== candidate || candidate.finished) return;
          if (!lock) { finish("Another tab is preparing this duel's automation."); return; }
          if (!valid()) { finish("Duel changed. Open the card menu again."); return; }
          return new Promise(resolve => {
            candidate.release = resolve;
            setState("choose", run.mode === "wait" ? "Choose ATK or DEF to activate. Resolution will wait for the opponent." :
              "Choose ATK or DEF to activate and resolve this effect.");
            // Multiple legal positions are a player decision, even in quick
            // mode. Only an unambiguous single-position rule can auto-start.
            if (autoStart && run.rule.action.activation.choices[0].options.length === 1) begin(run.rule.action.activation.choices[0].options[0]);
          });
        }).catch(() => { if (run === candidate) finish("Could not coordinate duel tabs. Continue manually."); });
      return true;
    }
    function choose(position) {
      if (!valid() || !["choose", "declaring", "banishing", "ready", "waiting", "approved", "suspended"].includes(run.state) || !run.rule.action.activation.choices[0].options.includes(position) || run.position === position) return;
      run.position = position;
      if (["waiting", "approved"].includes(run.state)) {
        setState("ready", "Position changed. Waiting for a fresh opponent thumbs-up.");
        release(true);
      }
      else notify();
    }
    function activate() {
      if (!valid() || run.state !== "choose" || !run.position || !eligible(run.source) || !idle()) return;
      expect("declaring", "Declare", run.sourceId, "Declaring " + run.rule.card.name + "…");
      send("Declare", run.sourceId);
    }
    function selectMode(mode) {
      if (!valid() || run.state !== "choose" || !["resolve", "wait"].includes(mode)) return;
      run.mode = mode;
      run.message = mode === "resolve" ? "Choose ATK or DEF to activate and resolve this effect." :
        "Choose ATK or DEF to activate. Resolution will wait for a fresh opponent thumbs-up.";
      notify();
    }
    function begin(position) {
      if (!valid() || run.state !== "choose" || !eligible(run.source) || !idle() ||
          !run.rule.action.activation.choices[0].options.includes(position)) return;
      run.position = position;
      run.flow = run.mode;
      activate();
    }
    function release(waitForOpponent = false) {
      if (!valid() || !["ready", "waiting", "suspended"].includes(run.state) || (!waitForOpponent && !idle())) return;
      if (!run.costPaid || !run.player.banished_arr.includes(run.source) || run.source.data("face_down") ||
          (!zone(run.player) && !hasOverflowResolution())) { finish("The source card or available zones changed. Continue manually."); return; }
      if (waitForOpponent) {
        run.armedAfter = lastSequence;
        run.goodExecuted = false;
        run.goodPending = false;
        setState("waiting", "Waiting for a fresh opponent thumbs-up. Resolve now is also available.");
        return;
      }
      if (page.viewing && !["Graveyard", "Banished"].includes(page.viewing)) {
        setState("suspended", "Close the current card view, then resolve again."); return;
      }
      if (page.viewing) stopViewing("close-source");
      else openDeck();
    }
    function openDeck() {
      if (!run.player.main_arr.length || (!zone(run.player) && !hasOverflowResolution())) { finish("No deck cards or free monster zones. Continue manually."); return; }
      run.deckInstances = run.player.main_arr.slice();
      expect("view-deck", "View deck", null, "Searching your Deck for " + run.rule.action.resolution[0].card.name + "…");
      send("View deck", id(run.player.main_arr[0]));
    }
    function sameExpected(event) {
      const expected = run.expected;
      return expected && event.actor.relation === "self" && event.play === expected.play &&
        event.sequence > expected.after && (expected.card == null || event.card.instanceId === expected.card);
    }
    function observe(event) {
      lastSequence = event.sequence;
      if (!run || run.finished) return;
      if (!valid() || event.type === "reset" || /^(Rejoin duel|Reconnected|Quit duel|Admit defeat)$/.test(event.play)) {
        finish("Duel changed. Check any commands already sent and continue manually."); return;
      }
      if (sameExpected(event)) {
        if (event.stage === "receive") {
          run.expected.received = true;
          if (event.play === "View deck") run.deckData = event.data.deck;
        } else if (event.stage === "execute" && run.expected.received) run.expected.executed = true;
        return;
      }
      if (event.stage === "receive" && event.actor.relation === "self" && event.play === "Shuffle deck" && run.state === "close-deck") {
        run.shuffleReceived = true;
        return;
      }
      if (event.stage === "execute" && event.actor.relation === "self" && event.play === "Shuffle deck" && run.state === "close-deck") {
        run.shuffleExecuted = run.shuffleReceived;
        return;
      }
      if (event.stage !== "receive") return;
      if (["Thinking", "Stop good"].includes(event.play) && event.actor.relation === "opponent" &&
          run.flow && ["declaring", "banishing"].includes(run.state)) {
        run.interrupted = true;
        return;
      }
      if (run.state === "waiting" && event.actor.relation === "opponent" && event.play === "Good" &&
          event.sequence > run.armedAfter) {
        // Release only after that particular fresh signal has executed as well.
        run.goodSequence = event.sequence;
        run.goodPending = true;
        setState("approved", "Opponent thumbs-up received. Waiting for native actions to finish…");
        return;
      }
      if (["Thinking", "Stop good"].includes(event.play) && event.actor.relation === "opponent" &&
          ["waiting", "approved"].includes(run.state)) {
        setState("suspended", "Opponent paused or withdrew the signal. Resolve manually or re-arm after responses.");
        return;
      }
      if (passive.has(event.play)) return;
      if (["ready", "waiting", "approved", "suspended", "choose"].includes(run.state)) {
        setState("suspended", "The board changed. Check responses, then resolve now or re-arm.");
        // A pre-activation interruption cannot be treated as a paid activation.
        if (!run.costPaid) finish("Board changed before activation. Open the card menu again.");
      } else finish("Another action interrupted automation. Check the board and continue manually.");
    }
    function tick() {
      if (!run || run.finished) return;
      if (!valid() || page.document?.hidden) { finish("Duel paused, hidden, or changed. Continue manually."); return; }
      if (now() - run.since > (run.expected ? 15000 : 120000)) {
        finish("Automation expired. Check any completed steps and continue manually."); return;
      }
      if (!idle()) return;
      if (run.state === "approved" && run.goodExecuted) {
        setState("ready", "Opponent signaled OK.");
        release();
        return;
      }
      const expected = run.expected;
      if (!expected || !expected.received || !expected.executed) return;
      switch (run.state) {
        case "declaring":
          if (!eligible(run.source)) { finish("The source card is no longer eligible. Continue manually."); return; }
          run.journal.push("Declared " + run.rule.card.name);
          expect("banishing", "Banish", run.sourceId, "Banishing the source card as the activation cost…");
          send("Banish", run.sourceId);
          break;
        case "banishing":
          if (!run.player.banished_arr.includes(run.source) || run.player.grave_arr.includes(run.source)) return;
          run.costPaid = true;
          run.journal.push("Banished source card (cost paid)");
          if (run.interrupted) {
            setState("suspended", "Opponent paused. Cost paid; handle responses, then resolve or re-arm the wait.");
          } else {
            setState("ready", "Cost paid. Ready to resolve.");
            if (run.flow) release(run.flow === "wait");
          }
          break;
        case "close-source": openDeck(); break;
        case "view-deck": {
          if (!Array.isArray(run.deckData) || run.deckData.length !== run.player.main_arr.length ||
              run.deckInstances.some((card, index) => card !== run.player.main_arr[index])) {
            finish("Deck information changed or is unavailable. Finish the search manually."); return;
          }
          const selector = run.rule.action.resolution[0].card;
          const index = run.deckData.findIndex(card => matchesData(selector, card) && card.card_type === "Monster");
          if (index < 0) { finish("No matching card found. Close the native Deck view and finish manually."); return; }
          if (run.deckData[index].name !== selector.name) {
            finish("The Deck card identifier and name do not match the rule. Correct the list and finish manually."); return;
          }
          run.target = run.player.main_arr[index];
          const free = zone(run.player);
          if (!free && !hasOverflowResolution()) { finish("No free monster zone. Finish manually."); return; }
          if (page.viewing !== "Deck") page.viewingE("Deck");
          run.targetId = id(run.target);
          if (!free) {
            run.resolutionOutcome = "destroyed";
            expect("destroying", "To GY", run.targetId, "No monster zone remains: destroying the Deck copy and sending it to the Graveyard…");
            // Native manual-mode destruction uses the normal To GY movement;
            // Duelingbook has no separate Destroy command (duel.js card menu).
            send("To GY", run.targetId);
            break;
          }
          run.summonZone = "m" + free;
          expect("summoning", "SS " + run.position, run.targetId, "Special Summoning in " + run.position + "…");
          send("SS " + run.position, run.targetId, { zone: "M-" + free });
          break;
        }
        case "summoning":
          if (run.player.main_arr.includes(run.target) || run.player[run.summonZone] !== run.target || !matches(run.rule.action.resolution[0].card, run.target) ||
              !run.target.data("in" + run.position) || run.target.data("face_down")) return;
          run.journal.push("Special Summoned " + run.rule.action.resolution[0].card.name + " in " + run.position);
          stopViewing("close-deck");
          break;
        case "destroying":
          if (run.player.main_arr.includes(run.target) || !run.player.grave_arr.includes(run.target) ||
              !matches(run.rule.action.resolution[0].card, run.target) || run.target.data("face_down")) return;
          run.journal.push("Destroyed " + run.rule.action.resolution[0].card.name + " from Deck and sent it to the Graveyard (no monster zone)");
          stopViewing("close-deck");
          break;
        case "close-deck":
          // Captures show Stop viewing Deck causes a server-issued shuffle.
          // Sending our own Shuffle deck here would duplicate that native step.
          if (run.player.main_arr.length && !run.shuffleExecuted) return;
          run.journal.push("Closed Deck search" + (run.shuffleExecuted ? " and shuffled Deck" : ""));
          finish(run.resolutionOutcome === "destroyed" ? "Effect resolved: Deck copy destroyed and sent to the Graveyard." : "Effect resolved in " + run.position + ".", "completed");
          break;
      }
    }
    function outgoing(message) {
      if (internalSend || !run || run.finished || !message || message.action !== "Duel") return;
      if (passive.has(message.play) && !(message.play === "Duel message" && /^\s*\//.test(message.message || ""))) return;
      finish("A manual action interrupted automation. Check the board and continue manually.");
    }
    function cancel() { finish(run && run.costPaid ? "Canceled. The source remains banished; its cost was paid." : "Canceled. Check any command already sent.", "canceled"); }
    return { available, eligible, prepare, choose, activate, selectMode, begin, release, tick, outgoing, cancel, snapshot,
      observe(event) {
        if (event.actor.relation === "opponent" && event.play === "Good") {
          const key = JSON.stringify([event.actor.username, event.data.long, event.data.seconds]);
          if (event.stage === "receive") {
            goodReceipts.push({ key, sequence: event.sequence });
            if (goodReceipts.length > 100) goodReceipts.shift();
          } else {
            const index = goodReceipts.findIndex(receipt => receipt.key === key);
            const receipt = index < 0 ? null : goodReceipts.splice(index, 1)[0];
            if (run && !run.finished && run.state === "approved" && receipt?.sequence === run.goodSequence) {
              run.goodPending = false;
              run.goodExecuted = true;
            }
          }
        }
        observe(event);
      } };
  }
  // A separate executor keeps the original cost/summon lifecycle unchanged.
  // These rules have no cost, choose their mode at activation, and choose cards
  // only at resolution. Opponents retain control of their own field movements.
  function createTrigger({ page, getSettings, changed = () => {}, now = () => page.performance.now() }) {
    let run = null, sequence = 0, internal = false;
    const receipts = [];
    const local = () => page.player1?.username === page.username ? page.player1 : null;
    const live = () => page.duelist === true && !page.automatic && !page.replay && !page.resetting && !page.paused &&
      !page.awaiting_defeat && !page.tag_duel && String(page.currentLabel).startsWith("duel_start") && (!page.websocket || page.websocket.readyState === 1);
    const idle = () => Array.isArray(page.actionsQueue) && page.actionsQueue.length === 0 && page.stopQueue === false;
    const lists = card => (getSettings().automationLists || []).filter(list => list.enabled && list.formats.includes(page.duelFormat) && list.rules.some(rule => matches(rule.card, card)));
    const field = player => [1, 2, 3, 4, 5].map(i => player?.["m" + i]).filter(Boolean);
    const allField = () => [page.player1, page.player2].flatMap(player => [player?.fieldSpell,
      ...[1, 2, 3, 4, 5].flatMap(i => [player?.["s" + i], player?.["m" + i]])]).filter(Boolean);
    const effect = () => run.rule.action.resolution[0];
    const monster = data => data.card_type === "Monster" && typeof data.name === "string" &&
      (run.rule.action.filters.monsters.cards ? run.rule.action.filters.monsters.cards.some(selector => matchesData(selector, data) && selector.name === data.name) :
        run.rule.action.filters.monsters.namePrefixes.some(prefix => data.name.toLowerCase().startsWith(prefix.toLowerCase())));
    const count = () => field(run.player).filter(card => card !== run.source && !card.data("face_down") &&
      monster(Object.fromEntries(["name", "card_type", "id", "passcode", "serial_number", "alt_passcode"].map(key => [key, card.data("cardfront")?.data(key)])))).length;
    const blockedSearch = () => effect().cases.search[0].checks.flatMap(check => check.cards).find(selector => allField().some(card => !card.data("face_down") && matches(selector, card)));
    function spells() {
      return [page.player1, page.player2].flatMap(player => {
        if (!player) return [];
        const entries = [["Field", player.fieldSpell], ...[1, 2, 3, 4, 5].map(i => ["S/T " + i, player["s" + i]]),
          ...[1, 2, 3, 4, 5].filter(i => player["m" + i] && !player["m" + i].data("face_down") &&
            ["Spell", "Trap"].includes(player["m" + i].data("cardfront")?.data("card_type"))).map(i => ["Monster " + i, player["m" + i]])];
        return entries.filter(([, card]) => card).map(([zone, card]) => ({ card, player, zone,
          label: (player === local() ? "Your " : "Opponent's ") + zone + ": " +
            (card.data("face_down") ? "face-down card" : name(card) || "face-up card") }));
      });
    }
    function available(card) {
      return Boolean(live() && local() && card && !card.data("face_down") && field(local()).includes(card) &&
        (getSettings().automationLists || []).some(list => list.rules.some(rule => rule.action.source.zone === "monster" && matches(rule.card, card))));
    }
    function problem(card) {
      if (!available(card)) return "Select a face-up monster you control in a live manual duel.";
      const matching = lists(card).flatMap(list => list.rules.filter(rule => matches(rule.card, card)));
      if (matching.length !== 1) return matching.length ? "Multiple enabled rules overlap for this card." : "Enable this rules list and the current duel format in Automation settings.";
      if (matching[0].action.source.zone !== "monster" || name(card) !== matching[0].card.name) return "The card identity or source zone does not match the rule.";
      for (const selector of [matching[0].card, ...(matching[0].action.filters.monsters.cards || []), ...matching[0].action.resolution[0].cases.search[0].checks.flatMap(check => check.cards)]) {
        const lookup = selector.passcode !== undefined ? page.getCardByPasscode : page.getCard;
        const known = typeof lookup === "function" ? lookup.call(page, selector.passcode ?? selector.id) : null;
        if (known?.name && known.name !== selector.name) return "A card identifier and name do not match the native catalog. Correct the rules list.";
      }
      if (!matching[0].action.timing.phases.includes(page.currentPhase)) return "This phase is unsupported.";
      if (!idle()) return "Wait for Duelingbook's actions to finish, then open automation again.";
      if (typeof page.exitViewing !== "function" || typeof page.viewingE !== "function" || typeof page.Send !== "function") return "Native card controls are still loading.";
      return null;
    }
    const eligible = card => !problem(card);
    function image(card, revealedDeck = false) {
      if (!card || (card.data("face_down") && !revealedDeck)) return null;
      const front = card.data("cardfront");
      const src = front?.find?.(".pic")?.attr?.("src");
      if (typeof src === "string" && /^https:\/\//i.test(src)) return src;
      const databaseId = front?.data("id");
      return Number.isSafeInteger(databaseId) && databaseId > 0 ? "https://images.duelingbook.com/low-res/" + databaseId + ".jpg" : null;
    }
    function snapshot() {
      if (!run) return null;
      return { state: run.state, message: run.message, cardName: run.rule.card.name, effectLabel: run.rule.label,
        list: run.list.name, version: run.list.version, journal: run.journal.slice(), finished: run.finished,
        positions: [], mode: run.mode, trigger: true, activated: run.activated, effectChoice: run.choice,
        confirmSelections: getSettings().automationConfirmSelections === true,
        options: ["choose", "declaring", "ready", "waiting", "approved", "suspended"].includes(run.state) ? effectOptions() : [],
        choices: run.choices?.map(choice => ({ key: choice.key, label: choice.label, instanceId: id(choice.card),
          imageUrl: image(choice.card, run.choice === "search"), copies: choice.copies || 1, selected: run.selected.includes(choice.key) })) || [],
        maximum: run.state === "select-destroy" ? count() : 1,
        minimum: run.state === "select-destroy" && count() > 0 && spells().length > 0 ? effect().cases.destroy[0].selection.minimum || 0 : 0 };
    }
    const notify = () => changed(snapshot());
    function state(value, message) { run.state = value; run.message = message; run.since = now(); run.expected = null; notify(); }
    function finish(message, value = "stopped") {
      if (!run || run.finished) return;
      run.finished = true; state(value, message); run.unlock?.();
    }
    function valid() {
      return run && !run.finished && live() && local() === run.player && page.username === run.username &&
        page.websocket === run.socket && page.duelId === run.duelId && page.turnCount === run.turn &&
        page.turn_player === run.turnPlayer && page.currentPhase === run.phase && JSON.stringify(lists(run.source)) === run.listsKey;
    }
    function send(play, card, extra = {}) {
      if (!valid()) { finish("Duel changed. Continue manually."); return; }
      internal = true;
      try { page.Send({ action: "Duel", play, ...(card == null ? {} : { card }), ...extra }); }
      catch (_) { finish("Command result is uncertain. Check the board and continue manually."); }
      finally { internal = false; }
    }
    function expect(value, play, card, message, text) {
      state(value, message);
      run.expected = { play, card, text, after: sequence };
    }
    function effectOptions() {
      return [{ key: "search", label: "Search Deck", disabled: !run.player.main_arr.length || Boolean(blockedSearch()) || Boolean(run.allowedChoices && !run.allowedChoices.includes("search")) },
        { key: "destroy", label: "Destroy Spells/Traps", disabled: count() === 0 || spells().length === 0 || Boolean(run.allowedChoices && !run.allowedChoices.includes("destroy")) }];
    }
    function prepare(card, { autoStart = false, mode = "wait" } = {}) {
      if (!["resolve", "wait"].includes(mode)) return false;
      if ((run && !run.finished) || !available(card)) return false;
      const matching = lists(card);
      const list = matching[0] || getSettings().automationLists.find(list => list.rules.some(rule => matches(rule.card, card)));
      run = { source: card, player: local(), username: page.username, socket: page.websocket, duelId: page.duelId,
        turn: page.turnCount, turnPlayer: page.turn_player, phase: page.currentPhase, list,
        rule: list.rules.find(rule => matches(rule.card, card)), listsKey: JSON.stringify(matching),
        journal: [], mode, state: "locking", message: "Preparing automation…", since: now(), selected: [] };
      const error = problem(card);
      if (error) { finish(error, "unavailable"); return false; }
      if (!page.navigator?.locks) { finish("Automation needs browser support for coordinating duel tabs."); return false; }
      const candidate = run;
      notify();
      page.navigator.locks.request("dbx-card-automation:" + page.username + ":" + page.duelId, { ifAvailable: true }, lock => {
        if (candidate !== run || candidate.finished) return;
        if (!lock || !valid()) { finish("Another tab is active or the duel changed."); return; }
        return new Promise(resolve => {
          run.unlock = resolve;
          state("choose", "Choose an effect. Summon timing, responses and negation remain manual.");
          if (autoStart) {
            const choices = effectOptions().filter(option => !option.disabled);
            if (choices.length === 1) begin(choices[0].key);
            else if (!choices.length) finish("No supported effect is currently available.", "unavailable");
          }
        });
      }).catch(() => { if (candidate === run) finish("Could not coordinate duel tabs."); });
      return true;
    }
    function selectMode(mode) { if (valid() && run.state === "choose" && ["wait", "resolve"].includes(mode)) { run.mode = mode; notify(); } }
    function begin(choice) {
      if (!valid() || !["choose", "declaring", "ready", "waiting", "approved", "suspended"].includes(run.state) || !effectOptions().some(option => option.key === choice && !option.disabled)) return;
      if (run.state !== "choose") {
        if (run.choice === choice) return;
        run.choice = choice;
        run.journal.push("Changed effect choice to " + choice);
        run.goodExecuted = false;
        if (run.state === "declaring") { notify(); return; }
        run.armedAfter = sequence;
        state("waiting", "Effect changed to " + choice + ". Waiting for a fresh opponent thumbs-up.");
        return;
      }
      if (!eligible(run.source)) return;
      run.allowedChoices = effectOptions().filter(option => !option.disabled).map(option => option.key);
      run.choice = choice;
      expect("declaring", "Declare", id(run.source), "Declaring the effect: " + (choice === "search" ? "search Deck." : "destroy Spells/Traps."));
      send("Declare", id(run.source));
    }
    function release(wait = false) {
      if (!valid() || !run.activated || !["ready", "waiting", "suspended"].includes(run.state) || !idle()) return;
      if (wait) { run.armedAfter = sequence; run.goodExecuted = false; state("waiting", "Waiting for a fresh opponent thumbs-up. Resolve now is also available."); return; }
      if (run.choice === "destroy") {
        run.selected = [];
        run.choices = spells().map(entry => ({ ...entry, key: String(id(entry.card)) }));
        const minimum = count() > 0 && run.choices.length > 0 ? effect().cases.destroy[0].selection.minimum || 0 : 0;
        state("select-destroy", "Choose " + (minimum ? "1 to " : "up to ") + count() + " Spells/Traps to destroy now. The count excludes this copy and uses your other face-up matching monsters at resolution. Opponents move their own cards.");
        return;
      }
      if (blockedSearch()) { finish("A face-up search prohibition prevents adding a card. Adjudicate negated continuous effects manually."); return; }
      if (!run.player.main_arr.length) { finish("Deck is empty; no card can be added.", "completed"); return; }
      if (page.viewing) {
        if (!["Graveyard", "Banished"].includes(page.viewing)) { state("suspended", "Close the native card view, then resolve again."); return; }
        closeView("close-source");
      } else openDeck();
    }
    function closeView(value) {
      expect(value, "Stop viewing", null, "Closing the native card view…");
      internal = true;
      try { page.exitViewing(); } catch (_) { finish("Could not close the native view. Continue manually."); }
      finally { internal = false; }
    }
    function openDeck() {
      if (blockedSearch() || !run.player.main_arr.length) { finish("Deck or search restrictions changed. Continue manually."); return; }
      run.deckInstances = run.player.main_arr.slice();
      expect("view-deck", "View deck", null, "Opening your Deck…");
      send("View deck", id(run.player.main_arr[0]));
    }
    function deckUnchanged() { return run.deckInstances.length === run.player.main_arr.length && run.deckInstances.every((card, i) => card === run.player.main_arr[i]); }
    function selectCard(key) {
      if (!valid() || !idle() || !["select-search", "select-destroy"].includes(run.state) || !run.choices.some(choice => choice.key === key)) return;
      if (run.state === "select-search") {
        run.selected = [key];
        if (getSettings().automationConfirmSelections === true) notify();
        else confirmCards();
        return;
      }
      if (run.selected.includes(key)) run.selected = run.selected.filter(value => value !== key);
      else if (run.selected.length < count()) run.selected.push(key);
      if (getSettings().automationConfirmSelections !== true && run.selected.length > 0 && run.selected.length === count()) confirmCards();
      else notify();
    }
    function confirmCards() {
      if (!valid() || !idle()) return;
      if (run.state === "select-search") {
        if (blockedSearch() || !deckUnchanged()) { finish("Deck or search restrictions changed. Finish manually."); return; }
        const chosen = run.choices.find(choice => choice.key === run.selected[0]);
        if (!chosen || run.selected.length !== 1) return;
        run.target = chosen.card;
        if (page.viewing !== "Deck") page.viewingE("Deck");
        expect("adding", "To hand", id(run.target), "Adding and revealing " + chosen.label + "…");
        send("To hand", id(run.target));
      } else if (run.state === "select-destroy") {
        const current = spells();
        const minimum = count() > 0 && current.length > 0 ? effect().cases.destroy[0].selection.minimum || 0 : 0;
        if (run.selected.length < minimum) return;
        if (run.selected.length > count() || run.selected.some(key => !current.some(entry => String(id(entry.card)) === key && run.choices.some(old => old.key === key && old.card === entry.card)))) {
          finish("The field or destruction count changed. Continue manually."); return;
        }
        run.destructions = run.choices.filter(choice => run.selected.includes(choice.key));
        if (!run.destructions.length) { finish("Resolved without destroying cards.", "completed"); return; }
        run.journal.push("Selected for destruction: " + run.destructions.map(entry => entry.label).join("; "));
        // Use the native visual marker so both duelists can see the final choices.
        for (const entry of run.destructions) {
          send("Target", id(entry.card));
          if (run.finished) return;
        }
        moveNext();
      }
    }
    function moveNext() {
      const mine = run.destructions.find(entry => entry.player === run.player && allField().includes(entry.card));
      if (mine) {
        run.target = mine.card;
        expect("destroying-field", "To GY", id(mine.card), "Sending your selected card to the Graveyard…");
        send("To GY", id(mine.card));
      } else {
        const remaining = run.destructions.filter(entry => entry.player !== run.player).map(entry => entry.label).join("; ");
        state("opponent-moves", "Waiting for the opponent to move their selected cards" + (remaining ? ": " + remaining : ".") +
          " Replacement effects or destruction prevention must be handled manually.");
      }
    }
    function observe(event) {
      sequence = event.sequence;
      if (!run || run.finished) return;
      if (!valid() || event.type === "reset" || /^(Rejoin duel|Reconnected|Quit duel|Admit defeat)$/.test(event.play)) { finish("Duel changed. Continue manually."); return; }
      const expected = run.expected;
      if (expected && event.actor.relation === "self" && (event.play === expected.play || (expected.play === "To hand" && event.play === "To hand from deck")) && event.sequence > expected.after &&
          (expected.card == null || event.card.instanceId === expected.card) && (expected.text === undefined || event.data.message === expected.text)) {
        if (event.stage === "receive") { expected.received = true; if (event.play === "View deck") run.deckData = event.data.deck; }
        else if (expected.received) expected.executed = true;
        return;
      }
      if (event.actor.relation === "self" && event.play === "Shuffle deck" && run.state === "close-deck") {
        if (event.stage === "receive") run.shuffleReceived = true;
        else if (run.shuffleReceived) run.shuffled = true;
        return;
      }
      if (event.actor.relation === "opponent" && event.play === "Good") {
        const key = JSON.stringify([event.actor.username, event.data.long, event.data.seconds]);
        if (event.stage === "receive") {
          receipts.push({ key, sequence: event.sequence }); if (receipts.length > 100) receipts.shift();
          if (run.state === "waiting" && event.sequence > run.armedAfter) { run.goodSequence = event.sequence; state("approved", "Opponent signaled OK; waiting for native actions…"); }
        } else {
          const index = receipts.findIndex(entry => entry.key === key);
          const receipt = index < 0 ? null : receipts.splice(index, 1)[0];
          if (run.state === "approved" && receipt?.sequence === run.goodSequence) run.goodExecuted = true;
        }
        return;
      }
      if (event.stage !== "receive") return;
      if (event.actor.relation === "self" && event.play === "Target card" &&
          run.destructions?.some(entry => id(entry.card) === event.card.instanceId)) return;
      if (run.destructions && event.play === "To GY" && run.destructions.some(entry => entry.player !== run.player && id(entry.card) === event.card.instanceId) && event.actor.relation === "opponent") return;
      if (["Thinking", "Stop good"].includes(event.play) && event.actor.relation === "opponent") {
        if (run.state === "declaring") { run.interrupted = true; return; }
        if (["waiting", "approved"].includes(run.state)) state("suspended", "Opponent paused. Handle responses, then resolve or re-arm.");
        return;
      }
      if (passive.has(event.play)) return;
      if (run.activated && ["ready", "waiting", "approved", "suspended"].includes(run.state)) {
        state("suspended", "The board changed. Handle responses, then resolve or re-arm.");
      } else finish("Another action interrupted automation. Check completed steps and continue manually.");
    }
    function tick() {
      if (!run || run.finished) return;
      if (!valid() || page.document?.hidden) { finish("Duel paused, hidden, or changed. Continue manually."); return; }
      if (now() - run.since > (run.expected ? 15000 : 120000)) { finish("Automation expired. Check completed steps and continue manually."); return; }
      if (!idle()) return;
      if (run.state === "approved" && run.goodExecuted) { run.goodExecuted = false; state("ready", "Opponent signaled OK."); release(); return; }
      if (run.state === "opponent-moves") {
        if (run.destructions.every(entry => !allField().includes(entry.card) && entry.card.data("owner")?.grave_arr?.includes(entry.card))) {
          finish("Selected cards sent to the Graveyard. Apply consequences of destruction manually.", "completed");
        }
        return;
      }
      const expected = run.expected;
      if (!expected?.received || !expected.executed) return;
      switch (run.state) {
        case "declaring":
          run.activated = true; run.journal.push("Activated: " + run.choice);
          state(run.interrupted ? "suspended" : "ready", "Effect chosen: " + run.choice + ". Handle responses before resolution.");
          if (!run.interrupted) release(run.mode === "wait");
          break;
        case "close-source": openDeck(); break;
        case "view-deck":
          if (!deckUnchanged() || !Array.isArray(run.deckData) || run.deckData.length !== run.deckInstances.length) { finish("Deck information changed. Finish manually."); return; }
          run.selected = [];
          {
            const groups = new Map();
            run.deckData.forEach((data, i) => {
              if (!monster(data)) return;
              const code = normalizePasscode(data.serial_number ?? data.passcode);
              const identity = code ? "passcode:" + code : data.id != null ? "id:" + data.id : "name:" + data.name.toLowerCase();
              const existing = groups.get(identity);
              if (existing) existing.copies++;
              else groups.set(identity, { key: String(i), card: run.deckInstances[i], label: data.name, copies: 1 });
            });
            run.choices = [...groups.values()].sort((a, b) => a.label.localeCompare(b.label));
          }
          if (page.viewing !== "Deck") page.viewingE("Deck");
          if (!run.choices.length) { run.noMatch = true; closeView("close-deck"); }
          else state("select-search", "Choose 1 matching monster to add to your hand. It will be revealed automatically.");
          break;
        case "adding":
          if (run.player.main_arr.includes(run.target) || !run.player.hand_arr.includes(run.target)) return;
          run.journal.push("Added and revealed " + name(run.target)); closeView("close-deck"); break;
        case "close-deck":
          if (run.player.main_arr.length && !run.shuffled) return;
          finish(run.noMatch ? "No matching monster found. Deck search closed and shuffled." : "Search resolved; Deck view closed and shuffled.", "completed"); break;
        case "destroying-field":
          if (allField().includes(run.target) || !run.target.data("owner")?.grave_arr?.includes(run.target)) return;
          run.journal.push("Sent selected card to Graveyard"); moveNext(); break;
      }
    }
    function outgoing(message) {
      if (internal || !run || run.finished || message?.action !== "Duel") return;
      if (passive.has(message.play) && !(message.play === "Duel message" && /^\s*\//.test(message.message || ""))) return;
      finish("A manual action interrupted automation. Check completed steps and continue manually.");
    }
    return { available, eligible, prepare, begin, selectMode, selectCard, confirmCards, release, observe, tick, outgoing, snapshot,
      cancel: () => finish("Canceled. Check any commands already sent.", "canceled") };
  }
  function create(options) {
    const read = options.getSettings, changed = options.changed || (() => {}), page = options.page;
    const now = options.now || (() => page.performance.now());
    let selection = null, pending = null;
    function scopedSettings() {
      const settings = read();
      if (!selection) return settings;
      // Retain the complete definitions in the invalidation key, even when only
      // one effect is exposed to a native-operation adapter.
      return { ...settings, automationLists: settings.automationLists.map(list => ({ ...list,
        effectScope: JSON.stringify(settings.automationLists),
        rules: list.rules.filter(rule => list.id === selection.list.id && rule.id === selection.rule.id)
      })).filter(list => list.rules.length) };
    }
    function render(snapshot) {
      changed(snapshot && { ...snapshot, effectId: selection?.rule.id,
        manualResponsibilities: (selection?.rule.action.coverage.manual || []).map(code => core.AUTOMATION_MANUAL[code]) });
    }
    const config = { ...options, getSettings: scopedSettings, changed: render };
    const banish = createBanish(config), trigger = createTrigger(config);
    let active = banish;
    const adapter = entry => entry.rule.action.timing.kind === "optional-trigger" ? trigger : banish;
    function candidates(card) {
      return (read().automationLists || []).filter(list => list.enabled && list.formats.includes(page.duelFormat))
        .flatMap(list => list.rules.filter(rule => matches(rule.card, card) &&
          (rule.action.source.zone === "graveyard" ? page.player1?.grave_arr?.includes(card) :
            [1, 2, 3, 4, 5].some(index => page.player1?.["m" + index] === card)))
          .map(rule => ({ list, rule })));
    }
    function inspect(entry, callback) {
      const previous = selection; selection = entry;
      try { return callback(adapter(entry)); } finally { selection = previous; }
    }
    function fingerprint() {
      return JSON.stringify([read().automationLists, page.duelFormat, page.duelId, page.username, page.turnCount, page.currentPhase]);
    }
    function pendingValid() {
      return pending && pending.key === fingerprint() && pending.socket === page.websocket &&
        pending.turnPlayer === page.turn_player && pending.player === page.player1 && !page.document?.hidden &&
        candidates(pending.card).some(entry => inspect(entry, engine => engine.available(pending.card)));
    }
    function pendingSnapshot() {
      return { state: pending.finished ? "canceled" : "choose", message: pending.message,
        cardName: name(pending.card), effectLabel: "Choose an effect", list: "Installed effects", version: "", journal: [],
        positions: [], trigger: true, effectPicker: true, finished: pending.finished, options: pending.entries.map((entry, index) => ({
          key: "effect:" + index, label: entry.rule.label + " (" + entry.list.name + ")",
          disabled: pending.entries.filter(other => other.rule.id === entry.rule.id).length > 1
        })) };
    }
    function stopPending(message) {
      if (!pending || pending.finished) return;
      pending.finished = true; pending.message = message; changed(pendingSnapshot());
    }
    function start(entry, card, prepareOptions) {
      selection = entry; pending = null; active = adapter(entry);
      return active.prepare(card, prepareOptions);
    }
    const result = {
      available(card) {
        const previous = selection; selection = null;
        try { return banish.available(card) || trigger.available(card); } finally { selection = previous; }
      },
      eligible(card) {
        const entries = candidates(card);
        return entries.some(entry => entries.filter(other => other.rule.id === entry.rule.id).length === 1 &&
          inspect(entry, engine => engine.eligible(card)));
      },
      prepare(card, prepareOptions = {}) {
        if ((pending && !pending.finished) || (active.snapshot() && !active.snapshot().finished)) return false;
        selection = null; pending = null;
        const entries = candidates(card);
        if (entries.length === 1) return start(entries[0], card, prepareOptions);
        if (entries.length > 1 && result.available(card)) {
          pending = { card, entries, options: prepareOptions, key: fingerprint(), socket: page.websocket,
            turnPlayer: page.turn_player, player: page.player1, since: now(), finished: false,
            message: "Choose an effect before declaring. Duplicate effect IDs are conflicting implementations and cannot run." };
          changed(pendingSnapshot()); return true;
        }
        active = trigger.available(card) ? trigger : banish;
        return active.prepare(card, prepareOptions);
      },
      begin(choice) {
        if (!pending) return active.begin?.(choice);
        if (pending.finished) return;
        if (!pendingValid()) { stopPending("Duel or rules changed. Open automation again."); return; }
        const option = pendingSnapshot().options.find(option => option.key === choice && !option.disabled);
        if (!option) return;
        const entry = pending.entries[Number(choice.slice(7))], card = pending.card, prepareOptions = pending.options;
        start(entry, card, prepareOptions);
      },
      observe(event) {
        if (pending && !pending.finished && (!pendingValid() || (event.stage === "receive" && !passive.has(event.play))))
          stopPending("Another action changed the duel. Choose the effect again.");
        banish.observe(event); trigger.observe(event);
      },
      outgoing(message) {
        if (pending && !pending.finished && message?.action === "Duel" &&
          (!passive.has(message.play) || (message.play === "Duel message" && /^\s*\//.test(message.message || ""))))
          stopPending("A manual action interrupted effect selection.");
        active.outgoing(message);
      },
      tick() {
        if (pending && !pending.finished && (!pendingValid() || now() - pending.since > 120000)) stopPending("Effect selection expired or the duel changed.");
        active.tick();
      },
      cancel() { if (pending) stopPending("Canceled effect selection."); else active.cancel(); },
      snapshot() { return pending ? pendingSnapshot() : active.snapshot() && { ...active.snapshot(), effectId: selection?.rule.id,
        manualResponsibilities: (selection?.rule.action.coverage.manual || []).map(code => core.AUTOMATION_MANUAL[code]) }; }
    };
    for (const method of ["choose", "activate", "selectMode", "release", "selectCard", "confirmCards"]) {
      result[method] = (...args) => { if (!pending) return active[method]?.(...args); };
    }
    return result;
  }
  return { create };
});
