(function attach(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.DBEnhancerRuleCardValidation = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";
  const ORIGIN = "https://static.duelingbook.com/*";
  const URL = "https://static.duelingbook.com/cards.json";
  const MAX_BYTES = 32 * 1024 * 1024;
  const selectors = list => list.rules.flatMap(rule => [rule.card, ...(rule.requires?.absentFaceUpCards || []),
    ...rule.resolution.flatMap(step => [step.card, ...(step.monsterCards || []), ...(step.searchAbsentFaceUpCards || [])].filter(Boolean))]);
  const key = card => card.passcode !== undefined ? "Passcode " + card.passcode : "DB ID " + card.id;
  function normalizePasscode(value) {
    const text = typeof value === "number" && Number.isSafeInteger(value) ? String(value) : value;
    return typeof text === "string" && /^\d{1,8}$/.test(text) && Number(text) > 0 ? text.padStart(8, "0") : null;
  }

  function create({ requestPermission, fetchImpl = globalThis.fetch }) {
    // Retain only identities checked by the user in this settings session.
    // The downloaded catalog is never persisted or retained between checks.
    const known = new Map();
    function check(list) {
      const cards = selectors(list);
      for (const card of cards) {
        if (known.has(key(card)) && !known.get(key(card)).has(card.name)) {
          throw new Error(key(card) + " belongs to \"" + [...known.get(key(card))].join(" / ") + "\", not \"" + card.name + "\".");
        }
      }
      return { checked: new Set(cards.filter(card => known.has(key(card))).map(key)).size,
        unknown: [...new Set(cards.filter(card => !known.has(key(card))).map(key))] };
    }
    async function downloadAndCheck(list) {
      if (!await requestPermission({ origins: [ORIGIN] })) throw new Error("Card catalog permission was not granted.");
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), 30000);
      try {
        const response = await fetchImpl(URL, { signal: abort.signal, credentials: "omit", redirect: "error",
          referrerPolicy: "no-referrer", cache: "no-store" });
        if (!response.ok) throw new Error("Could not download the card catalog (HTTP " + response.status + ").");
        if (Number(response.headers.get("content-length")) > MAX_BYTES) throw new Error("Card catalog exceeds 32 MB.");
        const reader = response.body?.getReader();
        if (!reader) throw new Error("The card catalog has no readable body.");
        const chunks = [];
        let total = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > MAX_BYTES) { await reader.cancel(); throw new Error("Card catalog exceeds 32 MB."); }
          chunks.push(value);
        }
        const bytes = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        const data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
        const records = data.cards ?? data;
        if (!Array.isArray(records) || !records.some(card => Number.isSafeInteger(card?.id) && typeof (card.name ?? card.n) === "string")) {
          throw new Error("Invalid card catalog.");
        }
        const requested = new Set(selectors(list).map(key));
        const found = new Map();
        for (const card of records) {
          const name = card?.name ?? card?.n;
          if (typeof name !== "string" || !name) continue;
          const keys = ["DB ID " + card.id, ...[card.passcode, card.serial_number, card.s, card.alt_passcode]
            .map(normalizePasscode).filter(Boolean).map(passcode => "Passcode " + passcode)];
          for (const identity of keys) {
            if (!requested.has(identity)) continue;
            if (!found.has(identity)) found.set(identity, new Set());
            found.get(identity).add(name);
          }
        }
        for (const [identity, names] of found) known.set(identity, names);
        return check(list);
      } finally { clearTimeout(timer); }
    }
    return { check, downloadAndCheck };
  }
  return { create };
});
