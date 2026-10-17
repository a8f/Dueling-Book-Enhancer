(function attachEnhancerCore(root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.DBEnhancerCore = api;
})(typeof window !== "undefined" ? window : typeof self !== "undefined" ? self : this, function createEnhancerCore(environment) {
  "use strict";

  // Only self-contained switches belong in the popup. LP cost payment and RPS
  // modes need their fuller explanations and stay on the Automation page.
  const QUICK_SETTING_DEFINITIONS = Object.freeze([
    { id: "battleDamageConfirmation", control: "battle-damage-confirmation", path: ["battleDamageConfirmation"], label: "Battle damage prompts",
      on: "Shows damage you owe. Your LP changes only if you confirm.",
      off: "Off: no battle damage prompts or LP adjustments from this feature. Adjust battle damage manually." },
    { id: "autoShuffleAfterDraw", control: "auto-shuffle-after-draw", path: ["autoShuffleAfterDraw"], label: "Shuffle after finishing draws",
      on: "Shuffles after you stop drawing and move your pointer away from the deck and draw menu.",
      off: "Off: no shuffle after a batch of draws. The separate turn-draw setting still applies." },
    { id: "autoGoFirst", control: "auto-go-first", path: ["autoGoFirst"], label: "Automatically choose First",
      on: "Chooses First as soon as the turn-order choice is available, including after siding.",
      off: "Off: choose First or Second yourself." },
    { id: "rememberCardList", control: "remember-card-list", path: ["rememberCardList"], label: "Remember each deck's card filter",
      on: "Saving a deck remembers its Card Pool filter, such as Edison or Goat. Loading it restores that filter.",
      off: "Off: saving and loading decks won't remember or restore their Card Pool filters." },
    { id: "preserveLastUsed", control: "preserve-last-used", path: ["hostDefaults", "preserveLastUsed"], label: "Reuse last hosted duel setup",
      on: "Remembers your most recently hosted duel's options for the next time you host.",
      off: "Off: use the Host Defaults configured in All settings." },
    { id: "showGridLines", control: "show-grid-lines", path: ["showGridLines"], label: "Background grid lines",
      on: "Shows the grid over Dueling Book's background.",
      off: "Off: hides the background grid." }
  ].map(definition => Object.freeze({ ...definition, path: Object.freeze(definition.path) })));
  const DEFAULT_POPUP_SHORTCUTS = Object.freeze(["battleDamageConfirmation", "autoShuffleAfterDraw", "autoGoFirst"]);

  function sanitizePopupShortcuts(value) {
    if (!Array.isArray(value)) return [...DEFAULT_POPUP_SHORTCUTS];
    const allowed = new Set(QUICK_SETTING_DEFINITIONS.map(definition => definition.id));
    return [...new Set(value.filter(id => allowed.has(id)))].slice(0, 4);
  }

  const ROOM_DEFINITIONS = Object.freeze([
    { id: "ar", label: "Ranked" },
    { id: "au", label: "Advanced (Unrated)" },
    { id: "yu", label: "Genesys Format" },
    { id: "gu", label: "Goat Format" },
    { id: "eu", label: "Edison Format" },
    { id: "cu", label: "Custom Cards (Unrated)" },
    { id: "su", label: "Speed Duels" },
    { id: "ru", label: "Rush Duels" },
    { id: "uu", label: "Unlimited (Unrated)" },
    { id: "tu", label: "Traditional (Unrated)" }
  ].map(Object.freeze));

  const NATIVE_CARDPOOL_DEFINITIONS = Object.freeze([
    { id: "native-official", label: "Official Cards Only" },
    { id: "native-my-custom", label: "My Custom Cards" },
    { id: "native-all-custom", label: "All Custom Cards" },
    { id: "native-goat", label: "Goat Format Cards" },
    { id: "native-edison", label: "Edison Format Cards" },
    { id: "native-speed", label: "Speed Duel Cards" },
    { id: "native-rush", label: "Rush Duel Cards" },
    { id: "native-skill", label: "Skill Cards" },
    { id: "native-favorites", label: "My Favorite Cards" }
  ].map(Object.freeze));

  const CUSTOM_CARDPOOL_REGION_POLICY = Object.freeze({ tcg: true, ocg: false });

  const COLOR_DEFINITIONS = Object.freeze([
    { key: "roomRanked", group: "Room panels", label: "Ranked room panel", selector: "#ar .format_inner", property: "background-color", defaultValue: "rgba(183, 218, 255, 0.8)", imageAspect: "4:3", imageWidth: 800, imageHeight: 600 },
    { key: "roomAdvanced", group: "Room panels", label: "Advanced (Unrated) room panel", selector: "#au .format_inner", property: "background-color", defaultValue: "rgba(166, 237, 214, 0.8)", imageAspect: "4:3", imageWidth: 800, imageHeight: 600 },
    { key: "roomGenesys", group: "Room panels", label: "Genesys Format room panel", selector: "#yu .format_inner", property: "background-color", defaultValue: "rgba(255, 208, 183, 0.8)", imageAspect: "4:3", imageWidth: 800, imageHeight: 600 },
    { key: "roomGoat", group: "Room panels", label: "Goat Format room panel", selector: "#gu .format_inner", property: "background-color", defaultValue: "rgba(213, 185, 255, 0.8)", imageAspect: "4:3", imageWidth: 800, imageHeight: 600 },
    { key: "roomEdison", group: "Room panels", label: "Edison Format room panel", selector: "#eu .format_inner", property: "background-color", defaultValue: "rgba(255, 244, 161, 0.8)", imageAspect: "4:3", imageWidth: 800, imageHeight: 600 },
    { key: "roomCustom", group: "Room panels", label: "Custom Cards room panel", selector: "#cu .format_inner", property: "background-color", defaultValue: "rgba(183, 218, 255, 0.8)", imageAspect: "4:3", imageWidth: 800, imageHeight: 600 },
    { key: "roomSpeed", group: "Room panels", label: "Speed Duels room panel", selector: "#su .format_inner", property: "background-color", defaultValue: "rgba(206, 250, 225, 0.8)", imageAspect: "4:3", imageWidth: 800, imageHeight: 600 },
    { key: "roomRush", group: "Room panels", label: "Rush Duels room panel", selector: "#ru .format_inner", property: "background-color", defaultValue: "rgba(255, 219, 196, 0.8)", imageAspect: "4:3", imageWidth: 800, imageHeight: 600 },
    { key: "roomUnlimited", group: "Room panels", label: "Unlimited room panel", selector: "#uu .format_inner", property: "background-color", defaultValue: "rgba(239, 239, 239, 0.8)", imageAspect: "4:3", imageWidth: 800, imageHeight: 600 },
    { key: "roomTraditional", group: "Room panels", label: "Traditional room panel", selector: "#tu .format_inner", property: "background-color", defaultValue: "rgba(255, 200, 222, 0.8)", imageAspect: "4:3", imageWidth: 800, imageHeight: 600 },
    { key: "pageBackground", group: "Main interface", label: "Main page background", selector: "#dark", property: "background-color", defaultValue: "rgb(7, 7, 7)", imageAspect: "16:10", imageWidth: 1600, imageHeight: 1000 },
    { key: "circuitTint", group: "Main interface", label: "Circuit-pattern dark tint", selector: "#circuit_cover", property: "background-color", defaultValue: "rgba(7, 7, 7, 0.3)", imageAspect: "16:10", imageWidth: 1600, imageHeight: 1000 },
    { key: "bulletinBackground", group: "Main interface", label: "Welcome bulletin background", selector: "#bulletin_txt", property: "background-color", defaultValue: "rgb(255, 255, 255)", imageAspect: "8:3", imageWidth: 1200, imageHeight: 450 },
    { key: "bulletinText", group: "Main interface", label: "Welcome bulletin text", selector: "#bulletin_txt", property: "color", defaultValue: "rgb(0, 0, 0)" },
    { key: "mainMenuText", group: "Main interface", label: "Main menu text", selector: ".menu_btn", property: "color", defaultValue: "rgb(255, 255, 255)" },
    { key: "chatSidebarText", group: "Main interface", label: "Chat and online-users text", selector: "#widget", property: "color", defaultValue: "rgb(255, 255, 255)" },
    { key: "welcomeLink", group: "Navigation accents", label: "Welcome link", selector: "#welcome_btn", property: "color", defaultValue: "rgb(255, 73, 110)" },
    { key: "forumLink", group: "Navigation accents", label: "Forum link", selector: "#forum_btn", property: "color", defaultValue: "rgb(102, 204, 255)" },
    { key: "rulesLink", group: "Navigation accents", label: "Rules link", selector: "#rules_btn", property: "color", defaultValue: "rgb(144, 252, 152)" },
    { key: "postStatusLink", group: "Navigation accents", label: "Post Status link", selector: "#post_status_btn", property: "color", defaultValue: "rgb(0, 119, 255)" },
    { key: "carouselArrows", group: "Duel Room", label: "Room carousel arrow buttons", selector: "#pools_prev_btn, #pools_next_btn", property: "background-color", defaultValue: "rgb(204, 204, 204)" },
    { key: "roomTitleText", group: "Duel Room", label: "Room panel titles", selector: "#duel_room .format_txt", property: "color", defaultValue: "rgb(255, 255, 255)" },
    { key: "roomBodyText", group: "Duel Room", label: "Room panel body text", selector: "#duel_room .format_inner, #duel_room .format .desc_txt, #duel_room .format .format_lbl, #duel_room .format .rules_lbl, #duel_room .format .type_lbl", property: "color", defaultValue: "rgb(0, 0, 0)" },
    { key: "hostHeading", group: "Duel Room", label: "Host a Duel heading", selector: "#host_lbl", property: "color", defaultValue: "rgb(255, 255, 255)" },
    { key: "hostFormText", group: "Duel Room", label: "Host a Duel form labels", selector: "#host, #host span, #host label", property: "color", defaultValue: "rgb(255, 255, 255)" },
    { key: "deckConstructorText", group: "Deck Constructor", label: "Deck Constructor labels", selector: "#deck_constructor", property: "color", defaultValue: "rgb(0, 0, 0)" },
    { key: "deckControlsBackground", group: "Deck Constructor", label: "Deck Constructor dropdown backgrounds", selector: "#deck_constructor select", property: "background-color", defaultValue: "rgb(239, 239, 239)" },
    { key: "rankingRating", group: "Rankings", label: "Rankings — By Rating tab", selector: "#by_rating_btn", property: "background-color", defaultValue: "rgb(204, 255, 153)" },
    { key: "rankingWins", group: "Rankings", label: "Rankings — By Wins tab", selector: "#by_wins_btn", property: "background-color", defaultValue: "rgb(255, 204, 204)" },
    { key: "rankingExperience", group: "Rankings", label: "Rankings — By Experience tab", selector: "#by_experience_btn", property: "background-color", defaultValue: "rgb(159, 224, 255)" },
    { key: "rankingTotalExperience", group: "Rankings", label: "Rankings — By Total Experience tab", selector: "#by_total_experience_btn", property: "background-color", defaultValue: "rgb(255, 255, 153)" },
    { key: "sidingNote", group: "Duel interface", label: "Siding instruction overlay", selector: "#siding_note", property: "background-color", defaultValue: "rgba(0, 0, 0, 0.65)" },
    { key: "watchersPanel", group: "Duel interface", label: "Watchers panel background", selector: "#watchers", property: "background-color", defaultValue: "rgb(255, 255, 255)" }
  ].map(Object.freeze));

  const HOST_FORMAT_OPTIONS = Object.freeze([
    { value: "au", label: "Advanced (Unrated)" }, { value: "yu", label: "Genesys Format (Unrated)" },
    { value: "cu", label: "Custom Cards (Unrated)" }, { value: "gu", label: "Goat Format (Unrated)" },
    { value: "eu", label: "Edison Format (Unrated)" }, { value: "uu", label: "Unlimited (Unrated)" },
    { value: "su", label: "Speed Duels (Unrated)" }, { value: "ru", label: "Rush Duels (Unrated)" },
    { value: "tu", label: "Traditional (Unrated)" }, { value: "so", label: "Solo Mode" }
  ].map(Object.freeze));
  const HOST_TYPE_OPTIONS = Object.freeze([
    { value: "s", label: "Single (with siding)" }, { value: "n", label: "Single (no siding)" }, { value: "m", label: "2 out of 3 Match" }
  ].map(Object.freeze));
  const HOST_RULE_OPTIONS = Object.freeze([
    { value: "*", label: "TCG + OCG" }, { value: "TCG", label: "TCG" }, { value: "OCG", label: "OCG" }
  ].map(Object.freeze));

  const TYPE_ORDER = Object.freeze(["normal", "effect", "ritual", "pendulum", "spell", "trap", "fusion", "synchro", "xyz", "link"]);
  const FIELD_LIBRARY = Object.freeze({
    name: { key: "name", label: "Name", kind: "text" },
    level: { key: "level", label: "Level", kind: "number" },
    rank: { key: "rank", label: "Rank", kind: "number" },
    linkRating: { key: "linkRating", label: "Link Rating", kind: "number" },
    atk: { key: "atk", label: "ATK", kind: "number" },
    def: { key: "def", label: "DEF", kind: "number" },
    attribute: { key: "attribute", label: "Attribute", kind: "text" },
    type: { key: "type", label: "Monster Type / Card Subtype", kind: "text" },
    ability: { key: "ability", label: "Ability", kind: "text" },
    pendulum: { key: "pendulum", label: "Pendulum Status", kind: "boolean" },
    scale: { key: "scale", label: "Pendulum Scale", kind: "number" },
    monsterColor: { key: "monsterColor", label: "Monster Subtype / Frame", kind: "text" },
    effectLength: { key: "effectLength", label: "Effect Text Length", kind: "number" },
    copyCount: { key: "copyCount", label: "Number of Copies", kind: "number" },
    limitedStatus: { key: "limitedStatus", label: "Limited Status (0–3)", kind: "number" }
  });
  const TYPE_DEFINITIONS = Object.freeze({
    normal: { key: "normal", label: "Normal", fields: ["name", "level", "atk", "def", "attribute", "type", "monsterColor", "copyCount", "limitedStatus"] },
    effect: { key: "effect", label: "Effect", fields: ["name", "level", "atk", "def", "attribute", "type", "ability", "monsterColor", "effectLength", "copyCount", "limitedStatus"] },
    ritual: { key: "ritual", label: "Ritual", fields: ["name", "level", "atk", "def", "attribute", "type", "ability", "monsterColor", "effectLength", "copyCount", "limitedStatus"] },
    pendulum: { key: "pendulum", label: "Pendulum", fields: ["name", "level", "atk", "def", "attribute", "type", "ability", "pendulum", "scale", "monsterColor", "effectLength", "copyCount", "limitedStatus"] },
    spell: { key: "spell", label: "Spell", fields: ["name", "type", "effectLength", "copyCount", "limitedStatus"] },
    trap: { key: "trap", label: "Trap", fields: ["name", "type", "effectLength", "copyCount", "limitedStatus"] },
    fusion: { key: "fusion", label: "Fusion", fields: ["name", "level", "atk", "def", "attribute", "type", "ability", "pendulum", "scale", "effectLength", "copyCount", "limitedStatus"] },
    synchro: { key: "synchro", label: "Synchro", fields: ["name", "level", "atk", "def", "attribute", "type", "ability", "pendulum", "scale", "effectLength", "copyCount", "limitedStatus"] },
    xyz: { key: "xyz", label: "Xyz", fields: ["name", "rank", "atk", "def", "attribute", "type", "ability", "pendulum", "scale", "effectLength", "copyCount", "limitedStatus"] },
    link: { key: "link", label: "Link", fields: ["name", "linkRating", "atk", "attribute", "type", "ability", "effectLength", "copyCount", "limitedStatus"] }
  });

  function copy(value) { return JSON.parse(JSON.stringify(value)); }
  function isObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
  function cleanText(value, maximumLength) { return typeof value === "string" ? value.slice(0, maximumLength) : ""; }
  function cleanColor(value) {
    if (typeof value !== "string") return "";
    const trimmed = value.trim().slice(0, 64);
    return /^[#(),.%+\-\/\sa-zA-Z0-9]+$/.test(trimmed) ? trimmed : "";
  }
  function allowedValue(value, options, fallback) { return options.some(option => option.value === value) ? value : fallback; }
  function intersectFields(types) {
    const safe = Array.isArray(types) ? types.filter(type => TYPE_DEFINITIONS[type]) : [];
    if (!safe.length) return [];
    return TYPE_DEFINITIONS[safe[0]].fields.filter(field => safe.every(type => TYPE_DEFINITIONS[type].fields.includes(field)));
  }
  function defaultRowsForTypes(types) { return intersectFields(types).map(key => ({ key: key, enabled: key === "name", direction: "asc" })); }
  function normalizeGroupRows(types, candidateRows) {
    const defaults = defaultRowsForTypes(types); const allowed = defaults.map(row => row.key); const seen = new Set(); const rows = [];
    if (Array.isArray(candidateRows)) candidateRows.forEach(candidate => {
      if (!isObject(candidate) || !allowed.includes(candidate.key) || seen.has(candidate.key)) return;
      seen.add(candidate.key);
      rows.push({ key: candidate.key, enabled: Boolean(candidate.enabled), direction: candidate.direction === "desc" ? "desc" : "asc" });
    });
    defaults.forEach(row => { if (!seen.has(row.key)) rows.push(row); });
    return rows;
  }
  function createDefaultGroups() {
    return [["normal", "effect", "ritual", "pendulum"], ["spell"], ["trap"], ["fusion"], ["synchro"], ["xyz"], ["link"]].map((types, index) => ({
      id: "group-" + (index + 1), types: types.slice(), rows: defaultRowsForTypes(types)
    }));
  }
  function createDefaultSettings() {
    const visibleRooms = {}; ROOM_DEFINITIONS.forEach(room => { visibleRooms[room.id] = true; });
    const bundled = Array.isArray(environment && environment.DBEnhancerBundledBanlists)
      ? copy(environment.DBEnhancerBundledBanlists)
      : [];
    const cardPoolEnabled = {};
    NATIVE_CARDPOOL_DEFINITIONS.forEach(pool => { cardPoolEnabled[pool.id] = true; });
    bundled.forEach(list => { cardPoolEnabled[list.id] = false; });
    return {
      schemaVersion: 2, appearance: { mode: "dark", theme: "cyan" }, popupShortcuts: [...DEFAULT_POPUP_SHORTCUTS],
      visibleRooms: visibleRooms, roomOrder: ROOM_DEFINITIONS.map(room => room.id),
      hostDefaults: { format: "au", type: "s", rules: "*", duelNote: "", duelPassword: "", watching: true, classic: false, tagDuel: false, watchNote: "", watchPassword: "", preserveLastUsed: false },
      rememberCardList: true, deckCardpools: {}, showGridLines: true, autoSkipIntro: true,
      rpsEnhancements: true, autoStartRps: false, autoPickRps: false, autoGoFirst: false,
      autoPayActivationCosts: false, battleDamageConfirmation: true, autoShuffleHand: false,
      autoShuffleAfterDraw: false,
      handShuffleAggressiveness: 80,
      customSort: { groups: createDefaultGroups() },
      customBanlists: bundled,
      deletedBundledBanlists: [],
      cardPools: {
        order: NATIVE_CARDPOOL_DEFINITIONS.map(pool => pool.id).concat(bundled.map(list => list.id)),
        enabled: cardPoolEnabled
      },
      customColors: {}
    };
  }
  const DEFAULT_SETTINGS = createDefaultSettings();

  function cleanBanlistCard(value) {
    if (isObject(value)) return value.id !== undefined ? cleanBanlistCard(value.id) : value.name !== undefined ? cleanBanlistCard(value.name) : null;
    if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
    if (typeof value !== "string") return null;
    const trimmed = value.trim().slice(0, 160);
    return !trimmed ? null : /^\d+$/.test(trimmed) ? Number(trimmed) : trimmed;
  }
  function cleanBanlistCards(candidate) {
    const source = isObject(candidate) && Array.isArray(candidate.cards) ? candidate.cards : candidate;
    const seen = new Set(); const result = []; if (!Array.isArray(source)) return result;
    source.slice(0, 20000).forEach(value => {
      const cleaned = cleanBanlistCard(value); if (cleaned === null) return;
      const signature = typeof cleaned + ":" + String(cleaned).toLowerCase();
      if (!seen.has(signature)) { seen.add(signature); result.push(cleaned); }
    });
    return result;
  }
  function sanitizeCustomBanlist(candidate, index) {
    if (!isObject(candidate)) return null;
    let name = cleanText(candidate.name || candidate.n, 23).trim(); if (!name) return null;
    let id = cleanText(candidate.id, 100).trim(); if (!/^dbx-[a-zA-Z0-9._:-]+$/.test(id)) id = "dbx-custom-" + index;
    const min = candidate.minDate || candidate.min || ""; const max = candidate.maxDate || candidate.max || "";
    return {
      id: id, name: name, forbidden: cleanBanlistCards(candidate.forbidden || candidate.f),
      limited: cleanBanlistCards(candidate.limited || candidate.l),
      semiLimited: cleanBanlistCards(candidate.semiLimited || candidate.semi_limited || candidate.s),
      unlimited: cleanBanlistCards(candidate.unlimited || candidate.u),
      minDate: /^\d{4}-\d{2}-\d{2}$/.test(min) ? min : "", maxDate: /^\d{4}-\d{2}-\d{2}$/.test(max) ? max : "",
      source: candidate.source === "bundled" ? "bundled" : "uploaded"
    };
  }
  function sanitizeGroups(candidateGroups) {
    if (!Array.isArray(candidateGroups)) return createDefaultGroups();
    const seen = new Set(); const groups = [];
    candidateGroups.forEach(candidate => {
      if (!isObject(candidate) || !Array.isArray(candidate.types)) return;
      const types = candidate.types
        .filter((type, index, all) =>
          TYPE_DEFINITIONS[type] &&
          !seen.has(type) &&
          all.indexOf(type) === index
        )
        .sort((first, second) => TYPE_ORDER.indexOf(first) - TYPE_ORDER.indexOf(second));
      types.forEach(type => seen.add(type)); if (!types.length) return;
      groups.push({ id: "group-" + (groups.length + 1), types: types, rows: normalizeGroupRows(types, candidate.rows) });
    });
    TYPE_ORDER.forEach(type => { if (!seen.has(type)) groups.push({ id: "group-" + (groups.length + 1), types: [type], rows: defaultRowsForTypes([type]) }); });
    return groups.length ? groups : createDefaultGroups();
  }
  function sanitizeCardpoolDescriptor(candidate) {
    if (!isObject(candidate)) return null;
    if (candidate.kind === "custom") {
      const id = cleanText(candidate.id, 100);
      return /^dbx-[a-zA-Z0-9._:-]+$/.test(id) ? { kind: "custom", id: id } : null;
    }
    if (candidate.kind === "native") {
      const value = cleanText(candidate.value, 20); return value ? { kind: "native", value: value } : null;
    }
    return null;
  }
  function sanitizeSettings(candidate) {
    const safe = isObject(candidate) ? candidate : {}; const defaults = createDefaultSettings(); const result = createDefaultSettings();
    const appearance = isObject(safe.appearance) ? safe.appearance : {};
    result.appearance.mode = appearance.mode === "light" ? "light" : "dark";
    result.appearance.theme = ["cyan", "lavender", "autumn"].includes(appearance.theme) ? appearance.theme : "cyan";
    result.popupShortcuts = sanitizePopupShortcuts(safe.popupShortcuts);
    const rooms = isObject(safe.visibleRooms) ? safe.visibleRooms : {}; const host = isObject(safe.hostDefaults) ? safe.hostDefaults : {};
    ROOM_DEFINITIONS.forEach(room => { result.visibleRooms[room.id] = rooms[room.id] !== false; });
    const roomIds = ROOM_DEFINITIONS.map(room => room.id); const order = Array.isArray(safe.roomOrder) ? safe.roomOrder : [];
    result.roomOrder = order.filter((id, index, all) => roomIds.includes(id) && all.indexOf(id) === index);
    roomIds.forEach(id => { if (!result.roomOrder.includes(id)) result.roomOrder.push(id); });
    result.hostDefaults.format = allowedValue(host.format, HOST_FORMAT_OPTIONS, defaults.hostDefaults.format);
    result.hostDefaults.type = allowedValue(host.type, HOST_TYPE_OPTIONS, defaults.hostDefaults.type);
    result.hostDefaults.rules = allowedValue(host.rules, HOST_RULE_OPTIONS, defaults.hostDefaults.rules);
    result.hostDefaults.duelNote = cleanText(host.duelNote, 100); result.hostDefaults.duelPassword = cleanText(host.duelPassword, 200);
    result.hostDefaults.watching = typeof host.watching === "boolean" ? host.watching : defaults.hostDefaults.watching;
    result.hostDefaults.classic = Boolean(host.classic); result.hostDefaults.tagDuel = Boolean(host.tagDuel);
    result.hostDefaults.watchNote = cleanText(host.watchNote, 100); result.hostDefaults.watchPassword = cleanText(host.watchPassword, 200);
    result.hostDefaults.preserveLastUsed = Boolean(host.preserveLastUsed);
    result.rememberCardList = safe.rememberCardList !== false;
    result.showGridLines = safe.showGridLines !== false;
    result.autoPickRps = safe.autoPickRps === true;
    result.autoGoFirst = safe.autoGoFirst === true;
    result.autoSkipIntro = safe.autoSkipIntro !== false;
    result.rpsEnhancements = safe.rpsEnhancements !== false;
    result.autoPayActivationCosts = safe.autoPayActivationCosts === true;
    result.autoShuffleHand = safe.autoShuffleHand === true;
    result.autoShuffleAfterDraw = safe.autoShuffleAfterDraw === true;
    result.handShuffleAggressiveness = sanitizeShuffleAggressiveness(safe.handShuffleAggressiveness);
    result.battleDamageConfirmation = safe.battleDamageConfirmation !== false;
    result.autoStartRps = safe.autoStartRps === true;
    if (result.autoStartRps) result.autoPickRps = true;
    result.customSort.groups = sanitizeGroups(isObject(safe.customSort) ? safe.customSort.groups : null);
    const bundledIds = new Set(defaults.customBanlists.map(list => list.id));
    const deletedBundled = Array.isArray(safe.deletedBundledBanlists)
      ? safe.deletedBundledBanlists.filter((id, index, all) => bundledIds.has(id) && all.indexOf(id) === index)
      : [];
    result.deletedBundledBanlists = deletedBundled;
    const seenIds = new Set();
    const bundled = defaults.customBanlists.filter(list => !deletedBundled.includes(list.id));
    const uploaded = (Array.isArray(safe.customBanlists) ? safe.customBanlists : [])
      .filter(list => !isObject(list) || list.source !== "bundled")
      .slice(0, 25);
    result.customBanlists = bundled.concat(uploaded).map(sanitizeCustomBanlist).filter(list => {
      if (!list || seenIds.has(list.id)) return false; seenIds.add(list.id); return true;
    });
    const allPoolIds = NATIVE_CARDPOOL_DEFINITIONS.map(pool => pool.id).concat(result.customBanlists.map(list => list.id));
    const poolSettings = isObject(safe.cardPools) ? safe.cardPools : {};
    const poolOrder = Array.isArray(poolSettings.order) ? poolSettings.order : [];
    result.cardPools.order = poolOrder.filter((id, index, all) => allPoolIds.includes(id) && all.indexOf(id) === index);
    allPoolIds.forEach(id => { if (!result.cardPools.order.includes(id)) result.cardPools.order.push(id); });
    const enabled = isObject(poolSettings.enabled) ? poolSettings.enabled : {};
    result.cardPools.enabled = {};
    NATIVE_CARDPOOL_DEFINITIONS.forEach(pool => { result.cardPools.enabled[pool.id] = enabled[pool.id] !== false; });
    result.customBanlists.forEach(list => {
      const defaultEnabled = list.source !== "bundled";
      result.cardPools.enabled[list.id] = typeof enabled[list.id] === "boolean" ? enabled[list.id] : defaultEnabled;
    });
    const colors = isObject(safe.customColors) ? safe.customColors : {};
    COLOR_DEFINITIONS.forEach(definition => {
      const source = isObject(colors[definition.key]) ? colors[definition.key] : {}; const value = {};
      const color = cleanColor(source.color); if (color) value.color = color;
      const opacity = Number(source.opacity);
      if (source.opacity !== undefined && Number.isFinite(opacity)) value.opacity = Math.max(0, Math.min(1, opacity));
      if (definition.imageAspect && typeof source.imageData === "string" && /^data:image\/(?:png|jpeg|webp);base64,/.test(source.imageData) && source.imageData.length <= 2500000) {
        value.imageData = source.imageData;
        value.imageName = cleanText(source.imageName, 100);
      }
      if (Object.keys(value).length) result.customColors[definition.key] = value;
    });
    const mappings = isObject(safe.deckCardpools) ? safe.deckCardpools : {};
    Object.keys(mappings).slice(-1000).forEach(deckId => {
      if (!/^\d+$/.test(deckId)) return;
      const descriptor = sanitizeCardpoolDescriptor(mappings[deckId]);
      if (descriptor) result.deckCardpools[deckId] = descriptor;
    });
    return result;
  }

  function readCardValue(card, key) { return card && typeof card.data === "function" ? card.data(key) : card ? card[key] : undefined; }
  function classifyCard(card) {
    const cardType = String(readCardValue(card, "card_type") || "").toLowerCase();
    const color = String(readCardValue(card, "monster_color") || "").toLowerCase();
    if (cardType === "spell") return "spell";
    if (cardType === "trap") return "trap";
    if (color.includes("fusion")) return "fusion";
    if (color.includes("synchro")) return "synchro";
    if (color.includes("xyz")) return "xyz";
    if (color.includes("link") || readCardValue(card, "is_link")) return "link";
    const pendulum = readCardValue(card, "pendulum");
    if (
      pendulum === true ||
      pendulum === 1 ||
      String(pendulum).toLowerCase() === "true" ||
      String(pendulum) === "1" ||
      color.includes("pendulum")
    ) return "pendulum";
    if (color.includes("ritual")) return "ritual";
    return color === "normal" ? "normal" : "effect";
  }
  function fieldValue(card, key) {
    if (key === "rank" || key === "linkRating") return readCardValue(card, "level");
    if (key === "copyCount") return readCardValue(card, "dbx_copy_count");
    if (key === "monsterColor") return readCardValue(card, "monster_color");
    if (key === "effectLength") { const effect = readCardValue(card, "effect"); return typeof effect === "string" ? effect.length : null; }
    if (key === "limitedStatus") { const limit = Number(readCardValue(card, "dbx_limit")); return limit >= 0 && limit <= 3 ? limit : null; }
    return readCardValue(card, key);
  }
  function numericValue(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value !== "string" && typeof value !== "boolean") return null;
    const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null;
  }
  function compareField(first, second, row) {
    const field = FIELD_LIBRARY[row.key]; let a = fieldValue(first, row.key); let b = fieldValue(second, row.key);
    const aMissing = a === undefined || a === null || a === ""; const bMissing = b === undefined || b === null || b === "";
    if (aMissing !== bMissing) return aMissing ? 1 : -1; if (aMissing) return 0;
    let result = 0;
    if (field.kind === "number" || field.kind === "boolean") {
      a = numericValue(a); b = numericValue(b);
      if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
      result = a === b ? 0 : a < b ? -1 : 1;
    } else result = String(a).localeCompare(String(b), undefined, { sensitivity: "base", numeric: true });
    return row.direction === "desc" ? -result : result;
  }
  function activeSignature(rows) { return rows.filter(row => row.enabled).map(row => row.key + ":" + row.direction).join("|"); }
  function customSortUsesDefaults(customSort) {
    const groups = sanitizeGroups(isObject(customSort) ? customSort.groups : null); const defaults = createDefaultGroups();
    return JSON.stringify(groups.map(group => [group.types, activeSignature(group.rows)])) === JSON.stringify(defaults.map(group => [group.types, activeSignature(group.rows)]));
  }
  function groupUsesDefault(group) {
    return createDefaultGroups().some(defaultGroup =>
      JSON.stringify(defaultGroup.types) === JSON.stringify(group.types) &&
      activeSignature(defaultGroup.rows) === activeSignature(group.rows)
    );
  }
  function compareCards(first, second, customSort, originalComparator) {
    const groups = sanitizeGroups(isObject(customSort) ? customSort.groups : null);
    const firstIndex = groups.findIndex(group => group.types.includes(classifyCard(first)));
    const secondIndex = groups.findIndex(group => group.types.includes(classifyCard(second)));
    if (firstIndex !== secondIndex) return firstIndex - secondIndex;
    for (const row of groups[firstIndex].rows) {
      if (!row.enabled) continue;
      const result = compareField(first, second, row); if (result) return result;
    }
    return groupUsesDefault(groups[firstIndex]) &&
      typeof originalComparator === "function"
      ? originalComparator(first, second) || 0
      : 0;
  }
  function splitColorValue(value) {
    const raw = String(value || "").trim();
    const match = /^rgba\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)$/i.exec(raw);
    return match ? { color: "rgb(" + match[1] + ", " + match[2] + ", " + match[3] + ")", opacity: Math.max(0, Math.min(1, Number(match[4]))) } : { color: raw, opacity: 1 };
  }
  function composeColor(color, opacity) {
    const percent = Math.round(Math.max(0, Math.min(1, Number(opacity))) * 10000) / 100;
    return percent >= 100 ? color : "color-mix(in srgb, " + color + " " + percent + "%, transparent)";
  }
  function getRoomLayout(visibleRoomIds) {
    const allowed = new Set(ROOM_DEFINITIONS.map(room => room.id));
    const ids = Array.isArray(visibleRoomIds) ? visibleRoomIds.filter((id, index, all) => allowed.has(id) && all.indexOf(id) === index) : [];
    const pageCount = Math.max(1, Math.ceil(ids.length / 3));
    return { pageCount: pageCount, width: pageCount * 1024, placements: ids.map((id, index) => ({ id: id, page: Math.floor(index / 3), slot: index % 3, left: Math.floor(index / 3) * 1024 + 5 + (index % 3) * 340 })) };
  }
  function getAvailableHostFormats(roomOrder, visibleRooms) {
    const formats = new Map(HOST_FORMAT_OPTIONS.map(option => [option.value, option]));
    const order = Array.isArray(roomOrder) ? roomOrder : ROOM_DEFINITIONS.map(room => room.id);
    const visibility = isObject(visibleRooms) ? visibleRooms : {};
    const available = order
      .filter((id, index, all) => id !== "ar" && visibility[id] !== false && all.indexOf(id) === index)
      .map(id => formats.get(id))
      .filter(Boolean);
    available.push(formats.get("so"));
    return available;
  }
  function selectAvailableHostFormat(previousValues, currentValue, availableOptions) {
    const available = Array.isArray(availableOptions) ? availableOptions : [];
    if (!available.length) return "so";
    if (available.some(option => option.value === currentValue)) return currentValue;
    const previous = Array.isArray(previousValues) ? previousValues : [];
    const previousIndex = Math.max(0, previous.indexOf(currentValue));
    return available[Math.min(previousIndex, available.length - 1)].value;
  }
  function sanitizeShuffleAggressiveness(value) {
    return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : 80;
  }
  function handShuffleTiming(value) {
    const fraction = sanitizeShuffleAggressiveness(value) / 100;
    return { idleMs: Math.round(3000 - 2500 * fraction),
      awayMs: Math.round(1000 - 850 * fraction), distance: Math.round(100 - 70 * fraction) };
  }
  return Object.freeze({
    COLOR_DEFINITIONS, CUSTOM_CARDPOOL_REGION_POLICY, DEFAULT_SETTINGS, FIELD_LIBRARY, HOST_FORMAT_OPTIONS, HOST_RULE_OPTIONS, HOST_TYPE_OPTIONS,
    QUICK_SETTING_DEFINITIONS, DEFAULT_POPUP_SHORTCUTS, sanitizePopupShortcuts,
    NATIVE_CARDPOOL_DEFINITIONS, ROOM_DEFINITIONS, TYPE_DEFINITIONS, TYPE_ORDER, classifyCard, compareCards, composeColor, copy,
    createDefaultGroups, createDefaultSettings, customSortUsesDefaults, defaultRowsForTypes, getAvailableHostFormats, getRoomLayout,
    intersectFields, normalizeGroupRows, readCardValue, sanitizeCardpoolDescriptor, sanitizeSettings, selectAvailableHostFormat, splitColorValue, handShuffleTiming
  });
});
