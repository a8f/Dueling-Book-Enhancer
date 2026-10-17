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
    const atk = stat(battle.attacker.atk);
    const target = battle.target;
    const defense = target && target.position === "defense";
    const opposing = target ? stat(defense ? target.def : target.atk) : 0;
    if (atk == null || opposing == null || (target && !["attack", "defense"].includes(target.position))) {
      return { damage: null, explanation: "Waiting for known battle stats." };
    }
    const damage = target && defense ? 0 : Math.max(0, atk - opposing);
    return { damage, explanation: target ?
      `${atk} ATK vs ${opposing} ${defense ? "DEF — no piercing assumed" : "ATK"}` : `${atk} ATK — direct attack` };
  }

  function createCalculator() {
    const modifiers = new Map();
    return Object.freeze({
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
  return { calculate, createCalculator };
});
