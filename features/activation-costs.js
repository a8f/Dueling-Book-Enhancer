(function attach(root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory;
  else (root.DBEnhancerFeatures ||= {})["activation-costs"] = factory;
})(typeof window !== "undefined" ? window : globalThis, function createFeature(context) {
  "use strict";
  const { window: page, getSettings } = context;
  let initialized = false;
  let pending = null;
  let lastResult = null;
  const plays = new Set(["Activate ST", "Activate Spell", "Activate Spell from hand",
    "Activate Field Spell", "Activate Field Spell from hand", "Activate Field Spell 2"]);
  const local = () => [page.player1, page.player2, page.player3, page.player4]
    .find(player => player && player.username === page.username);

  function resetStale() {
    if (pending && (page.duelId !== pending.duelId || page.player1 !== pending.game ||
        local() !== pending.player || page.resetting || !page.duelist || page.replay ||
        page.automatic || !String(page.currentLabel).startsWith("duel_start"))) pending = null;
  }

  function observe(event, actions) {
    resetStale();
    if (event.type === "reset") pending = null;
    if (event.type === "life-points" && event.actor.relation === "self") {
      // Retain the reservation until execution, rather than receipt, updates LP.
      if (pending && event.stage === "execute") pending = null;
      return;
    }
    if (!event.live || event.stage !== "execute" || event.type !== "activate" || event.actor.relation !== "self" ||
        !plays.has(event.play) || !getSettings().autoPayActivationCosts) return;
    const skip = reason => { lastResult = { card: event.card && event.card.name, skipped: reason }; };
    if (pending) { skip("Waiting for previous LP payment"); return; }
    const element = event.card && typeof page.getDuelCard === "function" && page.getDuelCard(event.card.instanceId);
    const front = element && element.data("cardfront");
    const read = key => event.data.card && event.data.card[key] != null ? event.data.card[key] :
      front && typeof front.data === "function" ? front.data(key) : null;
    const card = { name: read("name"), cardType: read("card_type"), type: read("type"), effect: read("effect") };
    const cost = page.DBEnhancerActivationCosts.detect(card);
    if (!cost) { skip("No unambiguous supported activation cost"); return; }
    // Spell Economics can waive spell activation payments. Do not infer whether
    // its continuous effect is negated; leave these activations to the player.
    if (card.cardType === "Spell" && [page.player1, page.player2, page.player3, page.player4].some(player =>
      player && [player.s1, player.s2, player.s3, player.s4, player.s5, player.fieldSpell].some(node => {
        const data = node && node.data("cardfront");
        return node && !node.data("face_down") && data && data.data("name") === "Spell Economics";
      }))) { skip("Spell Economics is on the field"); return; }
    const player = local();
    const amount = page.DBEnhancerActivationCosts.amount(cost, player && player.lifepoints);
    if (amount == null) { skip("Insufficient or unknown LP"); return; }
    if (!amount) { skip("No whole LP payment needed"); return; }
    pending = { duelId: page.duelId, game: page.player1, player };
    if (actions.adjustLifePoints(-amount)) lastResult = { card: event.card.name, paid: amount };
    else { pending = null; skip("Native LP command unavailable"); }
  }

  return {
    settingsKeys: ["autoPayActivationCosts"],
    initialize() {
      if (initialized || !page.DBEnhancerDuelEvents) return;
      initialized = true;
      page.DBEnhancerDuelEvents.register({ id: "spell-trap-activation-costs", includeNonLive: true, run: observe });
    },
    tick: resetStale,
    diagnostics: { activationCosts: () => ({ pending: Boolean(pending), lastResult }) }
  };
});
