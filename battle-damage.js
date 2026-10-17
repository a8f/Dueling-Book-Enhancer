(function attach(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.DBEnhancerBattleDamage = api.createCalculator();
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  function stat(value) {
    if (typeof value !== "number" && !(typeof value === "string" && /^\d+$/.test(value))) return null;
    const number = Number(value);
    return Number.isSafeInteger(number) && number >= 0 && number <= 2147483647 ? number : null;
  }

  // Pure input/output boundary: future rules can replace stats, add piercing,
  // prevent damage, or return unknown without coupling effects to the popup.
  function calculate(battle) {
    if (battle.damageTo === "attacker" && !battle.target) {
      return { damage: 0, explanation: "Direct attack — no damage to the attacker" };
    }
    const atk = stat(battle.attacker.atk);
    const target = battle.target;
    const defense = target && target.position === "defense";
    const opposing = target ? stat(defense ? target.def : target.atk) : 0;
    if (atk == null || opposing == null || (target && !["attack", "defense"].includes(target.position))) {
      return { damage: null, explanation: "Waiting for known battle stats." };
    }
    const damage = battle.damageTo === "attacker" ? (target ? Math.max(0, opposing - atk) : 0) :
      target && defense ? 0 : Math.max(0, atk - opposing);
    return { damage, explanation: target ?
      `${atk} ATK vs ${opposing} ${defense ? "DEF — no piercing assumed" : "ATK"}` : `${atk} ATK — direct attack` };
  }

  function createCalculator() {
    const modifiers = new Map();
    return Object.freeze({
      createEffectTracker,
      calculate(battle) {
        let result = calculate(battle);
        for (const modifier of modifiers.values()) result = modifier(battle, Object.freeze({ ...result }));
        if (!result || (result.damage !== null && stat(result.damage) == null)) throw new TypeError("Invalid battle damage result");
        return Object.freeze({ ...result });
      },
      registerModifier(id, modify) {
        if (!id || typeof modify !== "function" || modifiers.has(id)) throw new TypeError("A damage modifier needs a unique id and function");
        modifiers.set(id, modify);
        return () => { if (modifiers.get(id) === modify) modifiers.delete(id); };
      }
    });
  }

  const HAND_BOOSTS = Object.freeze({
    Honest: { eligible: monster => monster.attribute === "LIGHT", boost: other => stat(other && other.atk) },
    "Blackwing - Kalut the Moon Shadow": {
      eligible: monster => /^Blackwing - /i.test(monster.name || ""), boost: () => 1400
    }
  });

  // One tracker per popup. Only public, hand-origin signals reach observe().
  // Store fixed boost amounts: Honest must not keep growing as stats refresh.
  function createEffectTracker() {
    const seen = new Set();
    const sides = new Map();
    const labels = [];
    function side(monster) {
      let state = sides.get(monster.instanceId);
      const atk = stat(monster.atk);
      if (!state) {
        state = { board: atk, boosts: [] };
        sides.set(monster.instanceId, state);
      } else if (atk !== state.board) {
        // A matching native stat edit incorporates one or more inferred boosts.
        let total = 0;
        for (let index = 0; index < state.boosts.length; index++) {
          total += state.boosts[index];
          if (state.board != null && atk === state.board + total) {
            state.boosts.splice(0, index + 1);
            break;
          }
        }
        state.board = atk;
      }
      return state;
    }
    function project(monster) {
      if (!monster) return null;
      const state = side(monster);
      return Object.freeze({ ...monster, atk: state.board == null ? null :
        state.board + state.boosts.reduce((sum, boost) => sum + boost, 0) });
    }
    function apply(battle) {
      return Object.freeze({ ...battle, attacker: project(battle.attacker), target: project(battle.target),
        assumedEffects: Object.freeze(labels.slice()) });
    }
    return Object.freeze({
      apply,
      observe(event, battle) {
        const rule = event.card && Object.prototype.hasOwnProperty.call(HAND_BOOSTS, event.card.name) && HAND_BOOSTS[event.card.name];
        if (!rule || event.card.instanceId == null || !["activate", "effect", "to-grave"].includes(event.type)) return false;
        const key = `${event.actor.username}:${event.card.instanceId}`;
        if (seen.has(key)) return false;
        const projected = apply(battle);
        const beneficiary = [projected.attacker, projected.target].find(monster =>
          monster && monster.controller === event.actor.username);
        if (!beneficiary || beneficiary.faceDown || !rule.eligible(beneficiary)) return false;
        const other = beneficiary === projected.attacker ? projected.target : projected.attacker;
        // Kalut also boosts direct attacks. Honest's boost function requires
        // an opposing monster's ATK and returns unknown without one.
        const boost = rule.boost(other);
        if (boost == null || stat(beneficiary.atk) == null) return false;
        side(beneficiary === projected.attacker ? battle.attacker : battle.target).boosts.push(boost);
        seen.add(key);
        labels.push(event.card.name === "Honest" ? `Honest +${boost}` : `Kalut +${boost}`);
        return true;
      }
    });
  }
  return { calculate, createCalculator, createEffectTracker };
});
