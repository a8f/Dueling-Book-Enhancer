"use strict";

const assert = require("node:assert/strict");
global.window = {};
require("../extension/data/bundled-banlists.js");
const core = require("../extension/shared/enhancer-core.js");

function card(data) {
  return { data: key => data[key] };
}

const defaults = core.createDefaultSettings();
assert.equal(defaults.schemaVersion, 2);
assert.equal(defaults.appearance.mode, "dark");
assert.equal(defaults.appearance.theme, "cyan");
assert.equal(defaults.rememberCardList, true);
assert.equal(defaults.showGridLines, true);
assert.deepEqual(core.CUSTOM_CARDPOOL_REGION_POLICY, { tcg: true, ocg: false });
assert.deepEqual(defaults.deckCardpools, {});
assert.equal(core.COLOR_DEFINITIONS.length, 33);
assert.equal(defaults.customBanlists.length, 88);
assert.equal(defaults.cardPools.enabled["dbx-bundled-tengu"], false);
assert.equal(defaults.cardPools.enabled["dbx-bundled-wind-up"], false);
assert.equal(defaults.customBanlists[0].name, "Yugi-Kaiba");
assert.equal(defaults.customBanlists.at(-1).name, "Protocol");
assert.equal(defaults.customBanlists.find(list => list.id === "dbx-bundled-wind-up").name, "Wind-up/REDU");
assert.equal(defaults.customBanlists.every(list => list.name.length <= 23), true);
assert.equal(new Set(defaults.customBanlists.map(list => list.id)).size, defaults.customBanlists.length);
assert.deepEqual(
  defaults.customBanlists.map(list => list.maxDate),
  defaults.customBanlists.map(list => list.maxDate).slice().sort()
);
assert.equal(defaults.customBanlists.some(list => list.name === "Goat"), false);
assert.equal(defaults.customBanlists.some(list => list.name === "Edison"), false);
assert.equal(core.sanitizeSettings(null).customBanlists.length, 88);
assert.equal(
  core.sanitizeSettings({
    customBanlists: [{ id: "dbx-long", name: "12345678901234567890123456789" }]
  }).customBanlists.find(list => list.id === "dbx-long").name,
  "12345678901234567890123"
);
const withoutTengu = core.sanitizeSettings({
  deletedBundledBanlists: ["dbx-bundled-tengu"]
});
assert.equal(withoutTengu.customBanlists.some(list => list.id === "dbx-bundled-tengu"), false);
assert.deepEqual(withoutTengu.deletedBundledBanlists, ["dbx-bundled-tengu"]);
assert.deepEqual(
  defaults.cardPools.order.slice(0, core.NATIVE_CARDPOOL_DEFINITIONS.length),
  core.NATIVE_CARDPOOL_DEFINITIONS.map(pool => pool.id)
);
assert.equal(core.customSortUsesDefaults(defaults.customSort), true);
assert.deepEqual(defaults.customSort.groups.map(group => group.types), [
  ["normal", "effect", "ritual", "pendulum"],
  ["spell"], ["trap"], ["fusion"], ["synchro"], ["xyz"], ["link"]
]);
assert.equal(
  core.TYPE_ORDER.every(type => core.TYPE_DEFINITIONS[type].fields.includes("limitedStatus")),
  true
);
assert.equal(
  core.TYPE_ORDER.every(type => core.TYPE_DEFINITIONS[type].fields.includes("copyCount")),
  true
);
assert.equal(core.intersectFields(["synchro", "xyz"]).includes("level"), false);
assert.equal(core.intersectFields(["synchro", "xyz"]).includes("rank"), false);
assert.equal(core.intersectFields(["synchro", "xyz"]).includes("name"), true);

const compactLayout = core.getRoomLayout(["gu", "eu", "tu"]);
assert.equal(compactLayout.pageCount, 1);
assert.deepEqual(compactLayout.placements.map(item => item.left), [5, 345, 685]);
assert.equal(core.getRoomLayout(core.ROOM_DEFINITIONS.map(room => room.id)).pageCount, 4);

const formatVisibility = Object.fromEntries(
  core.ROOM_DEFINITIONS.map(room => [room.id, true])
);
const formatRoomOrder = core.ROOM_DEFINITIONS.map(room => room.id);
const orderedFormats = core.getAvailableHostFormats(formatRoomOrder, formatVisibility);
assert.equal(orderedFormats.at(-1).value, "so");
const previousFormatValues = orderedFormats.map(option => option.value);
formatVisibility.eu = false;
const withoutEdison = core.getAvailableHostFormats(formatRoomOrder, formatVisibility);
assert.equal(
  core.selectAvailableHostFormat(previousFormatValues, "eu", withoutEdison),
  withoutEdison[previousFormatValues.indexOf("eu")].value
);
Object.keys(formatVisibility).forEach(id => { formatVisibility[id] = false; });
const soloOnly = core.getAvailableHostFormats(formatRoomOrder, formatVisibility);
assert.deepEqual(soloOnly.map(option => option.value), ["so"]);
assert.equal(core.selectAvailableHostFormat(previousFormatValues, "eu", soloOnly), "so");


let originalCalls = 0;
function originalComparator(first, second) {
  originalCalls += 1;
  return String(first.data("name")).localeCompare(String(second.data("name")));
}

const normalZulu = card({ card_type: "Monster", monster_color: "Normal", name: "Zulu" });
const effectAlpha = card({ card_type: "Monster", monster_color: "Effect", name: "Alpha" });
assert.equal(core.classifyCard(normalZulu), "normal");
assert.equal(core.classifyCard(effectAlpha), "effect");
assert.ok(core.compareCards(normalZulu, effectAlpha, defaults.customSort, originalComparator) > 0);

const configured = core.copy(defaults.customSort);
const synchro = configured.groups.find(group => group.types[0] === "synchro");
const level = synchro.rows.splice(synchro.rows.findIndex(row => row.key === "level"), 1)[0];
level.enabled = true;
synchro.rows.unshift(level);
const synchros = [
  card({ card_type: "Monster", monster_color: "Synchro", name: "Alpha 10", level: 10 }),
  card({ card_type: "Monster", monster_color: "Synchro", name: "Zulu 5", level: 5 }),
  card({ card_type: "Monster", monster_color: "Synchro", name: "Alpha 5", level: 5 })
];
synchros.sort((a, b) => core.compareCards(a, b, configured, originalComparator));
assert.deepEqual(synchros.map(item => item.data("name")), ["Alpha 5", "Zulu 5", "Alpha 10"]);

const limitedSort = core.copy(defaults.customSort);
const spells = limitedSort.groups.find(group => group.types[0] === "spell");
const status = spells.rows.splice(spells.rows.findIndex(row => row.key === "limitedStatus"), 1)[0];
status.enabled = true;
spells.rows.unshift(status);
const spellCards = [
  card({ card_type: "Spell", name: "Unlimited", dbx_limit: 3 }),
  card({ card_type: "Spell", name: "Limited", dbx_limit: 1 }),
  card({ card_type: "Spell", name: "Banned", dbx_limit: 0 }),
  card({ card_type: "Spell", name: "Semi", dbx_limit: 2 })
];
spellCards.sort((a, b) => core.compareCards(a, b, limitedSort, originalComparator));
assert.deepEqual(spellCards.map(item => item.data("name")), ["Banned", "Limited", "Semi", "Unlimited"]);

const copySort = core.copy(defaults.customSort);
const copySpellGroup = copySort.groups.find(group => group.types[0] === "spell");
const copyRow = copySpellGroup.rows.splice(
  copySpellGroup.rows.findIndex(row => row.key === "copyCount"),
  1
)[0];
copyRow.enabled = true;
copySpellGroup.rows.unshift(copyRow);
const copiedSpells = [
  card({ card_type: "Spell", name: "Triple", dbx_copy_count: 3 }),
  card({ card_type: "Spell", name: "Single", dbx_copy_count: 1 }),
  card({ card_type: "Spell", name: "Double", dbx_copy_count: 2 })
];
copiedSpells.sort((a, b) => core.compareCards(a, b, copySort, originalComparator));
assert.deepEqual(copiedSpells.map(item => item.data("name")), ["Single", "Double", "Triple"]);

const reordered = core.copy(defaults.customSort);
reordered.groups.unshift(reordered.groups.splice(1, 1)[0]);
const aSpell = card({ card_type: "Spell", name: "Z Spell" });
assert.ok(core.compareCards(aSpell, effectAlpha, reordered, originalComparator) < 0);

const grouped = core.copy(defaults.customSort);
const synchroIndex = grouped.groups.findIndex(group => group.types[0] === "synchro");
const xyzIndex = grouped.groups.findIndex(group => group.types[0] === "xyz");
grouped.groups[synchroIndex].types.push("xyz");
grouped.groups.splice(xyzIndex, 1);
grouped.groups[synchroIndex].rows = core.normalizeGroupRows(
  grouped.groups[synchroIndex].types,
  grouped.groups[synchroIndex].rows
);
assert.equal(grouped.groups[synchroIndex].rows.some(row => row.key === "level"), false);

const sanitized = core.sanitizeSettings({
  visibleRooms: { ar: false },
  roomOrder: ["tu", "eu", "tu", "invalid"],
  rememberCardList: false,
  showGridLines: false,
  customSort: {
    groups: [
      { types: ["synchro", "xyz"], rows: [
        { key: "rank", enabled: true, direction: "desc" },
        { key: "name", enabled: true, direction: "desc" }
      ] }
    ]
  },
  customColors: {
    roomEdison: { color: "#123456" },
    roomGoat: { opacity: 0.4 },
    roomRanked: { color: "red; background: blue" }
  },
  customBanlists: [{ id: "dbx-test", name: "Test", forbidden: [123] }],
  deckCardpools: {
    "42": { kind: "custom", id: "dbx-deleted-later" },
    nope: { kind: "native", value: "0" }
  }
});
assert.equal(sanitized.visibleRooms.ar, false);
assert.deepEqual(sanitized.roomOrder.slice(0, 2), ["tu", "eu"]);
assert.equal(sanitized.rememberCardList, false);
assert.equal(sanitized.showGridLines, false);
assert.deepEqual(sanitized.customSort.groups[0].types, ["synchro", "xyz"]);
assert.equal(sanitized.customSort.groups[0].rows.some(row => row.key === "rank"), false);
assert.equal(sanitized.customSort.groups[0].rows[0].key, "name");
assert.deepEqual(sanitized.customColors.roomEdison, { color: "#123456" });
assert.deepEqual(sanitized.customColors.roomGoat, { opacity: 0.4 });
assert.equal(sanitized.customColors.roomRanked, undefined);
assert.deepEqual(sanitized.deckCardpools["42"], { kind: "custom", id: "dbx-deleted-later" });
assert.equal(sanitized.deckCardpools.nope, undefined);

assert.deepEqual(core.splitColorValue("rgba(1, 2, 3, 0.65)"), {
  color: "rgb(1, 2, 3)",
  opacity: 0.65
});
assert.equal(core.composeColor("#123456", 1), "#123456");
assert.match(core.composeColor("#123456", 0.5), /50%/);

const legacyShapeIsNotMigrated = core.sanitizeSettings({
  customSort: { categories: { synchro: [{ key: "level", enabled: true }] } },
  customColors: { roomEdison: "#123456" }
});
assert.equal(core.customSortUsesDefaults(legacyShapeIsNotMigrated.customSort), true);
assert.deepEqual(legacyShapeIsNotMigrated.customColors, {});

core.compareCards(
  card({ card_type: "Spell", name: "Same" }),
  card({ card_type: "Spell", name: "Same" }),
  defaults.customSort,
  originalComparator
);
assert.ok(originalCalls > 0);
console.log("Enhancer core tests passed.");
