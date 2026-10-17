import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const FORMAT_LIBRARY = "https://formatlibrary.com";
const EXCLUDED_FORMATS = new Set([
  "Advanced",
  "Edison",
  "Genesys",
  "Goat",
  "Traditional"
]);
const OUTPUT_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "..", "extension", "data", "bundled-banlists.js");

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function displayName(format) {
  return format.name === "Wind-Up" ? "Wind-up/REDU" : format.name;
}

async function getJson(path) {
  const response = await fetch(FORMAT_LIBRARY + path, {
    headers: { accept: "application/json" }
  });
  if (!response.ok) throw new Error(path + " returned HTTP " + response.status);
  return response.json();
}

function restrictionBuckets(banlist) {
  const latestByCard = new Map();
  ["forbidden", "limited", "semiLimited", "unlimited"].forEach(key => {
    (Array.isArray(banlist[key]) ? banlist[key] : []).forEach(record => {
      if (!record || !record.cardName) return;
      const cardKey = record.cardId || record.cardName;
      const previous = latestByCard.get(cardKey);
      if (!previous || Number(record.id) > Number(previous.id)) latestByCard.set(cardKey, record);
    });
  });
  const buckets = { forbidden: [], limited: [], semiLimited: [] };
  latestByCard.forEach(record => {
    const key = record.restriction === "semi-limited" ? "semiLimited" : record.restriction;
    if (buckets[key]) buckets[key].push(record.cardName);
  });
  Object.values(buckets).forEach(cards => cards.sort((first, second) => first.localeCompare(second)));
  return buckets;
}

const formats = (await getJson("/api/formats"))
  .filter(format =>
    format.category === "TCG" &&
    /^\d{4}-\d{2}-\d{2}$/.test(format.date || "") &&
    !EXCLUDED_FORMATS.has(format.name)
  )
  .sort((first, second) => first.date.localeCompare(second.date) || first.id - second.id);

const banlistCache = new Map();
const banlistNames = Array.from(new Set(formats.map(format => format.banlist)));
let nextBanlistIndex = 0;
await Promise.all(Array.from({ length: 8 }, async function loadBanlists() {
  while (nextBanlistIndex < banlistNames.length) {
    const limitName = banlistNames[nextBanlistIndex++];
    banlistCache.set(
      limitName,
      await getJson("/api/banlists/" + encodeURIComponent(limitName) + "?category=TCG")
    );
  }
}));

const bundled = [];
for (const format of formats) {
  const name = displayName(format);
  if (name.length > 23) throw new Error(name + " exceeds Dueling Book's 23-character display limit");
  const banlist = banlistCache.get(format.banlist);
  const restrictions = restrictionBuckets(banlist);
  bundled.push({
    name,
    maxDate: format.date,
    forbidden: restrictions.forbidden,
    limited: restrictions.limited,
    semiLimited: restrictions.semiLimited,
    unlimited: [],
    id: "dbx-bundled-" + slugify(format.name),
    source: "bundled"
  });
}

const output = `(function(root){
  "use strict";
  // Generated from Format Library's TCG format catalog and banlist API.
  // Goat and Edison are omitted because Dueling Book already supplies them.
  // Current/dynamic Advanced, Genesys, and Traditional entries are not historical snapshots.
  root.DBEnhancerBundledBanlists = Object.freeze(${JSON.stringify(bundled, null, 2)});
})(typeof window !== "undefined" ? window : typeof self !== "undefined" ? self : globalThis);
`;

await writeFile(OUTPUT_PATH, output, "utf8");
console.log(`Wrote ${bundled.length} chronological TCG formats to ${OUTPUT_PATH}`);
