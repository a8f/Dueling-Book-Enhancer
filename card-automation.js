(function attach(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.DBEnhancerCardAutomation = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
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

  function create({ page, getSettings, changed = () => {}, now = () => page.performance.now() }) {
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
    function matchingLists(card = run && run.source) {
      return (getSettings().automationLists || []).filter(list => list.enabled && list.formats.includes(page.duelFormat) &&
        list.rules.some(rule => matches(rule.card, card)));
    }
    function available(card) {
      const player = local();
      return Boolean(live() && player && !card?.data("face_down") &&
        player.grave_arr.includes(card) && card.data("owner") === player &&
        (getSettings().automationLists || []).some(list => list.rules.some(rule => matches(rule.card, card))));
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
      if (rule.requires.ownTurn && page.turn_player !== local()) return "This rule requires your own turn.";
      if (!rule.requires.phases.includes(page.currentPhase)) return "This rule requires phase " + rule.requires.phases.join(" or ") + ". Change phase, then open automation again.";
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
      return Boolean(live() && player && rules.length === 1 && !identityProblem(rule, card) &&
        !card.data("face_down") && player.grave_arr.includes(card) && card.data("owner") === player &&
        player.main_arr.length && zone(player) && (!rule.requires.ownTurn || page.turn_player === player) && rule.requires.phases.includes(page.currentPhase));
    }
    function identityProblem(rule, source) {
      if (name(source) !== rule.card.name) return "The source card identifier and name do not match the rule. Correct the rules list.";
      for (const selector of [rule.card, rule.resolution[0].card]) {
        const lookup = selector.passcode !== undefined ? page.getCardByPasscode : page.getCard;
        const known = typeof lookup === "function" ? lookup.call(page, selector.passcode ?? selector.id) : null;
        if (known && known.name && known.name !== selector.name) return "Card " + (selector.passcode ?? selector.id) + " belongs to " + known.name + ". Correct the rules list.";
      }
      return null;
    }
    function snapshot() {
      if (!run) return null;
      return { state: run.state, message: run.message, position: run.position, costPaid: run.costPaid,
        cardName: run.rule.card.name, effectLabel: run.rule.label, positions: run.rule.resolution[0].positions,
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
    function prepare(card) {
      if ((run && !run.finished) || !available(card)) return false;
      const lists = matchingLists(card);
      const list = lists[0] || getSettings().automationLists.find(list => list.rules.some(rule => matches(rule.card, card)));
      run = { state: "locking", message: "Preparing automation…", player: local(), username: page.username, socket: page.websocket,
        source: card, sourceId: id(card), duelId: page.duelId, turn: page.turnCount, phase: page.currentPhase,
        list, rule: list.rules.find(rule => matches(rule.card, card)),
        listsKey: JSON.stringify(lists), costPaid: false, position: null, mode: "resolve", journal: [], since: now() };
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
            setState("choose", "Choose ATK or DEF to activate and resolve this effect.");
          });
        }).catch(() => { if (run === candidate) finish("Could not coordinate duel tabs. Continue manually."); });
      return true;
    }
    function choose(position) {
      if (!valid() || !["choose", "ready", "waiting", "suspended"].includes(run.state) || !run.rule.resolution[0].positions.includes(position)) return;
      run.position = position;
      if (run.state === "waiting") setState("ready", "Position changed. Resolve now or wait for a fresh thumbs-up.");
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
          !run.rule.resolution[0].positions.includes(position)) return;
      run.position = position;
      run.flow = run.mode;
      activate();
    }
    function release(waitForOpponent = false) {
      if (!valid() || !["ready", "waiting", "suspended"].includes(run.state) || (!waitForOpponent && !idle())) return;
      if (!run.costPaid || !run.player.banished_arr.includes(run.source) || run.source.data("face_down") ||
          !zone(run.player)) { finish("The source card or available zones changed. Continue manually."); return; }
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
      if (!run.player.main_arr.length || !zone(run.player)) { finish("No deck cards or free monster zones. Continue manually."); return; }
      run.deckInstances = run.player.main_arr.slice();
      expect("view-deck", "View deck", null, "Searching your Deck for " + run.rule.resolution[0].card.name + "…");
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
          const selector = run.rule.resolution[0].card;
          const index = run.deckData.findIndex(card => matchesData(selector, card) && card.card_type === "Monster");
          if (index < 0) { finish("No matching card found. Close the native Deck view and finish manually."); return; }
          if (run.deckData[index].name !== selector.name) {
            finish("The Deck card identifier and name do not match the rule. Correct the list and finish manually."); return;
          }
          run.target = run.player.main_arr[index];
          const free = zone(run.player);
          if (!free) { finish("No free monster zone. Finish manually."); return; }
          if (page.viewing !== "Deck") page.viewingE("Deck");
          run.targetId = id(run.target);
          run.summonZone = "m" + free;
          expect("summoning", "SS " + run.position, run.targetId, "Special Summoning in " + run.position + "…");
          send("SS " + run.position, run.targetId, { zone: "M-" + free });
          break;
        }
        case "summoning":
          if (run.player.main_arr.includes(run.target) || run.player[run.summonZone] !== run.target || !matches(run.rule.resolution[0].card, run.target) ||
              !run.target.data("in" + run.position) || run.target.data("face_down")) return;
          run.journal.push("Special Summoned " + run.rule.resolution[0].card.name + " in " + run.position);
          stopViewing("close-deck");
          break;
        case "close-deck":
          // Captures show Stop viewing Deck causes a server-issued shuffle.
          // Sending our own Shuffle deck here would duplicate that native step.
          if (run.player.main_arr.length && !run.shuffleExecuted) return;
          run.journal.push("Closed Deck search" + (run.shuffleExecuted ? " and shuffled Deck" : ""));
          finish("Effect resolved in " + run.position + ".", "completed");
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
  return { create };
});
