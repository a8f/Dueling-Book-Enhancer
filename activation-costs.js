(function attach(root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.DBEnhancerActivationCosts = factory();
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  // Intentionally a small grammar, not a general card-text/rules interpreter.
  function detect(card) {
    if (!card || !["Spell", "Trap"].includes(card.cardType) || typeof card.effect !== "string") return null;
    const text = card.effect.replace(/\s+/g, " ").trim();
    if (!text || /[<>●•①-⑨]|\b(?:choose|select|apply) (?:1|one|any|either|up to).*\beffects?\b|\bonce per\b/i.test(text) ||
        (text.match(/;/g) || []).length > 1 || (text.match(/:/g) || []).length > 1 ||
        (text.match(/\bpay(?:ing)?\b/gi) || []).length !== 1) return null;

    const payment = "(\\d{1,3}(?:,\\d{3})+|\\d+|half (?:of )?your) (?:LP|Life Points)";
    // Modern activation clause: a mandatory payment first, optionally after a condition.
    // A condition cannot contain another sentence/effect or a periodic payment.
    const modern = new RegExp("^(?:([^.;:]+): )?Pay " + payment + "(;|, (?:then )?target\\b[^;]*;)", "i");
    const legacy = new RegExp("^Pay " + payment + "(?:\\. | to )", "i");
    const explicit = new RegExp("^Activate this card by paying " + payment + "[.;]", "i");
    let match = text.match(modern);
    let value;
    if (match) {
      if (text.slice(match[0].length).includes(":")) return null;
      if (["Continuous", "Field", "Equip"].includes(card.type)) return null;
      if (match[1] && /\bphase\b|\beach\b|\byou can\b|\b(?:GY|Graveyard|banished|hand)\b/i.test(match[1])) return null;
      value = match[2];
    } else {
      // Without PSCT punctuation, only accept an explicit leading payment.
      if (text.includes(":") || text.includes(";")) {
        match = text.match(explicit);
      } else match = text.match(explicit) || text.match(legacy);
      if (!match) return null;
      if (text.slice(match[0].length).includes(":")) return null;
      if (["Continuous", "Field", "Equip"].includes(card.type) && !text.match(explicit) &&
          !/^Pay .+? (?:LP|Life Points) to activate this card\./i.test(text) &&
          card.name !== "Skill Drain") return null;
      value = match[1];
    }
    if (/^half/i.test(value)) return Object.freeze({ kind: "half" });
    const amount = Number(value.replace(/,/g, ""));
    return Number.isSafeInteger(amount) && amount > 0 && amount <= 2147483647 ?
      Object.freeze({ kind: "fixed", amount }) : null;
  }

  function amount(cost, life) {
    if (!cost || !Number.isSafeInteger(life) || life <= 0) return null;
    if (cost.kind === "half") return Math.floor(life / 2);
    return cost.kind === "fixed" && cost.amount < life ? cost.amount : null;
  }
  return { detect, amount };
});
