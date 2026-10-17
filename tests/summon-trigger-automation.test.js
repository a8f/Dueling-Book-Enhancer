"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const core = require("../enhancer-core.js");
const { create } = require("../card-automation.js");
const { createRuntime } = require("../duel-events.js");
const createFeature = require("../features/card-automation.js");

function definition() {
  return { schemaVersion: 3, id: "test.trigger", name: "Trigger list", version: "1.0.0", formats: ["eu", "so"], enabled: true,
    rules: [{ id: "trigger", card: { passcode: "09000001", name: "Example Scout" }, label: "Summon choice",
      requires: { sourceZone: "monster", ownTurn: false, phases: ["DP", "SP", "M1", "BP", "M2", "EP"], trigger: "normal-or-special-summon" },
      activation: [], resolution: [{ op: "choose-search-or-destroy", monsterNamePrefixes: ["Example HERO "],
        searchAbsentFaceUpCards: [{ passcode: "09000009", name: "Example Search Blocker" }] }] }] };
}
function harness() {
  const cards = [];
  function card(instance, name, type = "Monster", passcode = "09000002") {
    const front = { name, card_type: type, serial_number: passcode };
    const data = { id: instance, face_down: false, cardfront: { data: key => front[key] } };
    const result = { front, data(key, value) { if (arguments.length === 2) data[key] = value; return data[key]; } };
    cards.push(result); return result;
  }
  const self = { username: "Self", main_arr: [], hand_arr: [], grave_arr: [], banished_arr: [] };
  const opponent = { username: "Opponent", main_arr: [], hand_arr: [], grave_arr: [], banished_arr: [], opponent: self };
  self.opponent = opponent;
  const source = self.m1 = card(1, "Example Scout", "Monster", "09000001");
  const ally = self.m2 = card(2, "Example HERO Ally");
  const target = card(3, "Example HERO Search");
  const wrong = card(4, "Unrelated HERO Kid");
  const ownSpell = self.s1 = card(5, "Example Spell", "Spell");
  const hidden = opponent.s3 = card(6, "Secret name must stay hidden", "Trap");
  hidden.data("face_down", true);
  self.main_arr = [wrong, target];
  for (const item of cards) { item.data("owner", item === hidden ? opponent : self); item.data("controller", item === hidden ? opponent : self); }
  const settings = { automationLists: [definition()], automationConfirmSelections: true }, commands = [];
  let clock = 0, lock = true;
  const page = { username: self.username, player1: self, player2: opponent, duelId: 7, duelist: true,
    duelFormat: "eu", currentLabel: "duel_start", currentPhase: "BP", turnCount: 2, turn_player: opponent,
    actionsQueue: [], stopQueue: false, viewing: "", document: { hidden: false }, websocket: { readyState: 1 }, console,
    performance: { now: () => clock }, navigator: { locks: { request(_key, _options, callback) { return Promise.resolve(callback(lock ? {} : null)); } } },
    getDuelCard: instance => cards.find(item => item.data("id") === instance),
    viewingE(view) { page.viewing = view; },
    exitViewing() { page.Send({ action: "Duel", play: "Stop viewing", viewing: page.viewing }); page.viewing = ""; },
    Send(message) { runtime.outgoing(message); commands.push(message); },
    duelResponse(message) { page.duelResponse2(message.username === self.username ? self : opponent, message); },
    duelResponse2(player, message) { page.actionsQueue.push(() => {
      const item = cards.find(card => card.data("id") === message.id);
      if (message.play === "View deck") page.viewing = "Deck";
      if (["To hand", "To hand from deck"].includes(message.play) && item) { self.main_arr = self.main_arr.filter(card => card !== item); self.hand_arr.push(item); }
      if (message.play === "To GY" && item) {
        for (const side of [self, opponent]) for (const key of ["fieldSpell", ...[1, 2, 3, 4, 5].flatMap(i => ["m" + i, "s" + i])]) if (side[key] === item) side[key] = null;
        item.data("owner").grave_arr.push(item);
      }
      page.actionsQueue.shift(); page.stopQueue = false;
    }); }
  };
  let runtime = create({ page, getSettings: () => settings, now: () => clock });
  const events = page.DBEnhancerDuelEvents = createRuntime(page);
  events.register({ id: "receive", includeNonLive: true, when: { stage: "receive" }, run: event => runtime.observe(event) });
  events.register({ id: "execute", includeNonLive: true, run: event => runtime.observe(event) });
  events.install();
  function flush() { while (page.actionsQueue.length) { page.stopQueue = true; page.actionsQueue[0](); } }
  function echo(play, extra = {}, defer = false) { page.duelResponse({ action: "Duel", play, username: "Self", ...extra }); if (!defer) flush(); }
  function ack(defer = false) {
    const sent = commands.at(-1);
    echo(sent.play, { id: sent.card, message: sent.message, ...sent.play === "View deck" ? { deck: self.main_arr.map(item => item.front) } : {} }, defer);
  }
  function start(choice = "search", mode = "resolve") {
    assert.equal(runtime.prepare(source), true); runtime.selectMode(mode); runtime.begin(choice); ack(); runtime.tick();
  }
  return { page, self, opponent, settings, commands, source, ally, target, wrong, ownSpell, hidden, card, echo, ack, flush, start,
    get runtime() { return runtime; }, setRuntime(value) { runtime = value; }, advance(ms) { clock += ms; }, denyLock() { lock = false; } };
}

test("choice schema validates both contracts and rejects unsupported instructions", async () => {
  const vendored = (await import("../card-rule-extractor/schema-3.mjs")).default;
  for (const api of [core, vendored]) {
    assert.equal(api.importAutomationList(JSON.stringify(definition())).rules[0].requires.ownTurn, false);
    for (const mutate of [list => list.rules[0].requires.trigger = "flip-summon", list => list.rules[0].activation.push({ op: "banish", card: "source" }),
      list => list.rules[0].resolution[0].monsterNamePrefixes = [], list => list.rules[0].resolution[0].monsterNamePrefixes = ["HERO"],
      list => list.rules[0].requires.phases = ["M1"], list => list.rules[0].resolution[0].script = "arbitrary",
      list => list.rules[0].resolution[0].searchAbsentFaceUpCards[0].passcode = "09000001"]) {
      const value = definition(); mutate(value);
      assert.throws(() => api.importAutomationList(JSON.stringify(value)));
    }
  }
});

test("search works during the opponent's turn without a timing checkbox and acknowledges native reveal/shuffle", () => {
  const h = harness();
  assert.equal(h.runtime.available(h.source), true); assert.equal(h.runtime.eligible(h.source), true);
  h.runtime.prepare(h.source); assert.equal(h.commands.length, 0);
  h.runtime.selectMode("resolve"); h.runtime.begin("search");
  assert.equal(h.commands.at(-1).play, "Declare");
  h.ack(true); h.runtime.tick(); assert.equal(h.commands.length, 1, "receipt alone cannot resolve");
  h.flush(); h.runtime.tick(); assert.equal(h.commands.at(-1).play, "View deck");
  h.ack(); h.runtime.tick();
  assert.deepEqual(h.runtime.snapshot().choices.map(choice => choice.label), ["Example HERO Search"]);
  h.runtime.selectCard("1"); h.runtime.confirmCards();
  assert.deepEqual(h.commands.at(-1), { action: "Duel", play: "To hand", card: 3 });
  h.echo("To hand from deck", { id: 3 }); h.runtime.tick();
  assert.equal(h.self.hand_arr[0], h.target); assert.equal(h.commands.at(-1).play, "Stop viewing");
  h.ack(); h.runtime.tick(); assert.equal(h.runtime.snapshot().finished, undefined);
  h.echo("Shuffle deck"); h.runtime.tick(); assert.equal(h.runtime.snapshot().state, "completed");
  assert.equal(h.commands.filter(command => command.play === "Shuffle deck").length, 0);
  assert.equal(h.commands.some(command => command.play === "Banish" || command.play === "Duel message"), false);
});

test("search prohibition on either field blocks only search, and a newly applied prohibition is checked at resolution", () => {
  for (const side of ["self", "opponent"]) {
    const h = harness(); h[side].m3 = h.card(9, "Example Search Blocker", "Monster", "09000009");
    h.runtime.prepare(h.source); h.runtime.begin("search"); assert.equal(h.commands.length, 0);
    assert.equal(h.runtime.snapshot().options[0].disabled, true); assert.equal(h.runtime.snapshot().options[1].disabled, false);
  }
  const h = harness(); h.start("search", "wait");
  h.opponent.m3 = h.card(9, "Example Search Blocker", "Monster", "09000009");
  h.runtime.release(); assert.match(h.runtime.snapshot().message, /prohibition/); assert.equal(h.commands.length, 1);
});

test("destruction requires another face-up matching monster, ignores unrelated names, works without a Deck or empty monster zone", () => {
  const h = harness(); h.self.main_arr = []; h.self.m3 = h.wrong; h.self.m4 = h.target; h.self.m5 = h.card(12, "Other");
  h.ally.data("face_down", true); h.target.data("face_down", true);
  h.runtime.prepare(h.source); h.runtime.begin("destroy"); assert.equal(h.commands.length, 0);
  assert.equal(h.runtime.snapshot().options[1].disabled, true);
  h.runtime.cancel(); h.ally.data("face_down", false); h.start("destroy");
  assert.equal(h.runtime.snapshot().state, "select-destroy"); assert.equal(h.runtime.snapshot().maximum, 1);
});

test("destruction counts at resolution, excludes source, never leaks a face-down name, chooses at resolution and lets opponent move their own card", () => {
  const h = harness(); h.start("destroy", "wait");
  assert.equal(h.runtime.snapshot().choices.length, 0);
  h.self.m3 = h.target; h.runtime.release();
  assert.equal(h.runtime.snapshot().maximum, 2);
  assert.equal(JSON.stringify(h.runtime.snapshot()).includes("Secret name"), false);
  h.runtime.selectCard("5"); h.runtime.selectCard("6"); h.runtime.confirmCards();
  assert.match(h.runtime.snapshot().journal.at(-1), /Your S\/T 1.*Opponent's S\/T 3: face-down card/);
  assert.deepEqual(h.commands.at(-1), { action: "Duel", play: "To GY", card: 5 });
  h.ack(); h.runtime.tick(); assert.equal(h.runtime.snapshot().state, "opponent-moves");
  assert.match(h.runtime.snapshot().message, /Opponent's S\/T 3: face-down card/);
  assert.equal(h.commands.some(command => command.card === 6), false);
  h.echo("To GY", { id: 6, username: "Opponent" }); h.runtime.tick();
  assert.equal(h.runtime.snapshot().state, "completed");
  assert.equal(h.commands.some(command => command.play === "Target"), false);
  assert.equal(h.commands.some(command => command.play === "Duel message"), false);
});

test("a source that leaves the field does not cancel an already activated trigger; zero destruction is allowed", () => {
  const h = harness(); h.start("destroy", "wait");
  h.echo("To GY", { id: 1 }); h.runtime.tick();
  assert.equal(h.runtime.snapshot().state, "suspended");
  h.self.m2 = null; h.runtime.release();
  assert.equal(h.runtime.snapshot().maximum, 0);
  h.runtime.confirmCards(); assert.equal(h.runtime.snapshot().state, "completed"); assert.equal(h.commands.length, 1);
});

test("wait gate requires a fresh opponent receive and execution, and re-arming clears previous approval", () => {
  const h = harness(); h.start("search", "wait");
  h.echo("Good"); h.runtime.tick(); assert.equal(h.runtime.snapshot().state, "waiting");
  h.echo("Good", { username: "Opponent", seconds: 1 }, true); h.runtime.tick(); assert.equal(h.commands.length, 1);
  h.echo("Thinking", { username: "Opponent" }); h.runtime.release(true);
  h.echo("Good", { username: "Opponent", seconds: 2 }, true); h.runtime.tick(); assert.equal(h.commands.length, 1);
  h.flush(); h.runtime.tick(); assert.equal(h.commands.at(-1).play, "View deck");
});

test("unmatched search closes and shuffles without moving a nonmatching monster; changed Deck stops", () => {
  const h = harness(); h.self.main_arr = [h.wrong]; h.start(); h.ack(); h.runtime.tick();
  assert.equal(h.commands.at(-1).play, "Stop viewing"); h.ack(); h.echo("Shuffle deck"); h.runtime.tick();
  assert.equal(h.runtime.snapshot().state, "completed"); assert.equal(h.self.hand_arr.length, 0);
  const other = harness(); other.start(); other.ack(); other.runtime.tick(); other.runtime.selectCard("1"); other.self.main_arr.reverse(); other.runtime.confirmCards();
  assert.equal(other.runtime.snapshot().state, "stopped"); assert.equal(other.commands.length, 2);
});

test("reset, hidden tab, settings, phase, socket, timeout, denied lock and manual actions prevent further commands", () => {
  for (const change of [h => h.page.document.hidden = true, h => h.page.currentPhase = "M1", h => h.page.websocket = {},
    h => h.settings.automationLists[0].enabled = false, h => h.advance(120001), h => h.runtime.outgoing({ action: "Duel", play: "Draw card" }),
    h => h.echo("Reset game")]) {
    const h = harness(); h.start("search", "wait"); change(h); h.runtime.tick(); h.runtime.release(); assert.equal(h.commands.length, 1); assert.equal(h.runtime.snapshot().finished, true);
  }
  const h = harness(); h.denyLock(); h.runtime.prepare(h.source); h.runtime.begin("search"); assert.equal(h.commands.length, 0);
});

test("native toHand implementation reveals Deck cards, and field menus restrict opponent movement", () => {
  const native = fs.readFileSync(require.resolve("../duelingbook/duel.js"), "utf8");
  assert.match(native.slice(native.indexOf("function toHand("), native.indexOf("function toHandFromField(")), /removeFromDeck[\s\S]*revealAndToHand/);
  assert.match(native.slice(native.indexOf("function cardMenuE()"), native.indexOf("function cardMenuE2(")), /You don't control this card/);
});

test("native menu declares immediately, offers editable effects during the wait, and has no timing or activation controls", () => {
  const h = harness(), nodes = []; let shadow;
  function element(tag) {
    const node = { tag, children: [], dataset: {}, attrs: {}, listeners: {}, isConnected: true,
      appendChild(child) { this.children.push(child); child.parentElement = this; }, replaceChildren(...children) { this.children = children; },
      setAttribute(key, value) { this.attrs[key] = value; }, addEventListener(type, callback) { this.listeners[type] = callback; },
      attachShadow() { return shadow = this.shadowRoot = element("shadow"); }, focus() { shadow.activeElement = this; },
      click() { if (!this.disabled && !this.hidden) this.listeners.click?.(); } };
    nodes.push(node); return node;
  }
  const document = { createElement: element, documentElement: element("html"), addEventListener() {}, activeElement: null };
  h.page.DBEnhancerCardAutomation = require("../card-automation.js"); h.page.showMenu = () => {}; h.page.cardMenuClicked = () => {};
  const feature = createFeature({ window: h.page, document, getSettings: () => h.settings }); feature.initialize();
  h.page.cardMenuClicked(h.source, "DBX:card-automation", {});
  const latest = text => nodes.filter(node => node.textContent === text).at(-1);
  assert.equal(latest("Search Deck").disabled, false); latest("Search Deck").click();
  assert.equal(h.commands.at(-1).play, "Declare"); assert.equal(feature.diagnostics.cardAutomation().trigger, true);
  assert.equal(h.commands.length, 1);
  assert.equal(nodes.some(node => node.type === "checkbox"), false);
  assert.equal(latest("Activate & resolve"), undefined);
  latest("Destroy Spells/Traps").click();
  h.echo("Declare", { id: 1 }); feature.tick();
  assert.equal(feature.diagnostics.cardAutomation().state, "waiting");
  assert.equal(feature.diagnostics.cardAutomation().effectChoice, "destroy");
  assert.equal(h.commands.length, 1, "configuration changes do not repeat activation");
});

test("changing an effect while approval is queued requires a new opponent signal and executes the latest choice", () => {
  const h = harness();
  assert.equal(h.runtime.prepare(h.source, { autoStart: true }), true);
  assert.equal(h.commands.at(-1).play, "Declare");
  h.ack(); h.runtime.tick(); assert.equal(h.runtime.snapshot().state, "waiting");
  h.echo("Good", { username: "Opponent", seconds: 1 }, true);
  assert.equal(h.runtime.snapshot().state, "approved");
  h.runtime.begin("destroy");
  h.flush(); h.runtime.tick();
  assert.equal(h.runtime.snapshot().state, "waiting");
  assert.equal(h.commands.length, 1);
  h.echo("Good", { username: "Opponent", seconds: 2 }); h.runtime.tick();
  assert.equal(h.runtime.snapshot().state, "select-destroy");
  assert.equal(h.commands.length, 1);
  h.runtime.begin("search"); assert.equal(h.runtime.snapshot().effectChoice, "destroy", "choice locks once resolution starts");
});

test("automatic activation chooses an available effect and leaves an unavailable card undeclared", () => {
  const h = harness(); h.self.main_arr = [];
  h.runtime.prepare(h.source, { autoStart: true }); assert.equal(h.runtime.snapshot().effectChoice, "destroy");
  assert.equal(h.commands.length, 1);
  const blocked = harness(); blocked.self.main_arr = []; blocked.self.m2 = null;
  blocked.runtime.prepare(blocked.source, { autoStart: true });
  assert.equal(blocked.runtime.snapshot().state, "unavailable"); assert.equal(blocked.commands.length, 0);
});

test("quick native menu action declares and begins resolution without opponent approval or a mode step", () => {
  const h = harness(), ui = selectionUI(h);
  h.page.cardMenuClicked(h.source, "DBX:card-automation-resolve", {});
  assert.equal(h.commands.length, 1); assert.equal(h.commands.at(-1).play, "Declare");
  assert.equal(h.runtime.snapshot().mode, "resolve");
  h.ack(); ui.feature.tick();
  assert.equal(h.commands.at(-1).play, "View deck");
  h.ack(); ui.feature.tick();
  assert.equal(h.runtime.snapshot().state, "select-search");
  ui.clickCard(h.target); h.runtime.confirmCards();
  assert.equal(h.commands.at(-1).play, "To hand");
});

test("quick activation allows an effect change before declaration executes and pauses on an opponent response", () => {
  const h = harness();
  h.runtime.prepare(h.source, { autoStart: true, mode: "resolve" }); h.runtime.begin("destroy");
  h.ack(); h.runtime.tick();
  assert.equal(h.runtime.snapshot().state, "select-destroy"); assert.equal(h.commands.length, 1);
  const interrupted = harness();
  interrupted.runtime.prepare(interrupted.source, { autoStart: true, mode: "resolve" });
  interrupted.echo("Thinking", { username: "Opponent" }); interrupted.ack(); interrupted.runtime.tick();
  assert.equal(interrupted.runtime.snapshot().state, "suspended"); assert.equal(interrupted.commands.length, 1);
});

test("search groups duplicate copies by printed identity and keeps a concrete Deck instance for resolution", () => {
  const h = harness();
  const duplicate = h.card(12, h.target.front.name, "Monster", 9000002);
  duplicate.data("owner", h.self); duplicate.data("controller", h.self);
  const different = h.card(13, "Example HERO Different", "Monster", "09000003");
  h.self.main_arr.push(duplicate, different);
  const original = h.self.main_arr.slice();
  h.start(); h.ack(); h.runtime.tick();
  const choices = h.runtime.snapshot().choices;
  assert.equal(choices.length, 2);
  assert.deepEqual(choices.map(choice => choice.label), ["Example HERO Different", "Example HERO Search"]);
  const grouped = choices.find(choice => choice.label === h.target.front.name);
  assert.equal(grouped.copies, 2); assert.equal(grouped.instanceId, 3);
  assert.deepEqual(h.self.main_arr, original, "grouping must not edit or reorder the actual Deck");
  h.runtime.selectCard(grouped.key); h.runtime.confirmCards();
  assert.equal(h.commands.at(-1).card, 3);
});

function selectionUI(h, native = true) {
  const nodes = [], listeners = {}, rendered = [];
  let shadow;
  function element(tag) {
    const node = { tag, children: [], dataset: {}, attrs: {}, listeners: {}, style: { outline: "", outlineOffset: "" }, isConnected: true,
      appendChild(child) {
        if (child.parentElement) child.parentElement.children = child.parentElement.children.filter(item => item !== child);
        this.children.push(child); child.parentElement = this;
      },
      contains(child) { return this === child || this.children.some(item => item.contains?.(child)); },
      querySelector(selector) { return selector === ":scope > .content" ? this.children.find(child => child.className === "content") || null : null; },
      remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(item => item !== this); this.parentElement = null; },
      replaceChildren(...children) { this.children = []; children.forEach(child => this.appendChild(child)); },
      setAttribute(key, value) { this.attrs[key] = value; }, removeAttribute(key) { delete this.attrs[key]; },
      addEventListener(type, callback) { this.listeners[type] = callback; },
      attachShadow() { return shadow = this.shadowRoot = element("shadow"); }, focus() { shadow.activeElement = this; },
      click() { if (!this.disabled && !this.hidden) this.listeners.click?.(); } };
    nodes.push(node); return node;
  }
  const content = element("content");
  const view = element("view"); view.appendChild(content);
  view.style.getPropertyValue = key => view.style[key] || "";
  view.style.getPropertyPriority = () => "";
  view.style.setProperty = (key, value) => { view.style[key] = value; };
  view.style.removeProperty = key => { delete view.style[key]; };
  for (const card of [h.source, h.ally, h.ownSpell, h.hidden, ...h.self.main_arr]) {
    card[0] = element("card");
    const face = element("face"); face.className = "content";
    face.style.transform = "translate(-50%, -50%)";
    face.appendChild(element("art")); card[0].appendChild(face);
  }
  const document = { createElement: element, documentElement: element("html"), activeElement: null,
    getElementById: id => id === "view" ? view : null,
    querySelector: selector => native && selector === "#view > .content" ? content : null,
    addEventListener(type, callback, capture) { (listeners[type] ||= []).push({ callback, capture }); } };
  h.page.DBEnhancerCardAutomation = { create(options) { const runtime = create(options); h.setRuntime(runtime); return runtime; } };
  h.page.showMenu = () => { throw new Error("Native hover menu should be suppressed during selection"); };
  h.page.cardMenuClicked = () => {};
  h.page.removeCardMenu = () => {};
  if (native) h.page.viewCards = (cards, options) => {
    rendered.push({ cards: cards.slice(), options });
    content.replaceChildren(...cards.map(card => card[0]));
  };
  const feature = createFeature({ window: h.page, document, getSettings: () => h.settings });
  feature.initialize();
  return { feature, nodes, content, view, rendered, clickCard(card, button = 0) {
    let stopped = false;
    for (const listener of listeners.click || []) listener.callback({ target: card[0].children[0], button,
      preventDefault() {}, stopImmediatePropagation() { stopped = true; } });
    return stopped;
  } };
}

test("native Deck picker filters legal unique cards, preserves metadata pairing and search, selects by left-click, and restores on cancellation", () => {
  const h = harness(), duplicate = h.card(12, h.target.front.name);
  h.self.main_arr.push(duplicate);
  const original = h.self.main_arr.slice();
  const ui = selectionUI(h);
  h.start(); h.ack(); h.runtime.tick();
  assert.deepEqual(ui.rendered.at(-1).cards, [h.target]);
  const face = h.target[0].children[0];
  assert.equal(face.children.at(-1).textContent, "×2");
  assert.equal(face.children.at(-1).parentElement, face, "copy badge must share the visible card's translated coordinate space");
  assert.equal(h.target[0].children.length, 1, "no badge on the outer centre anchor");
  h.page.showMenu(h.target, []);
  const data = h.self.main_arr.map(card => card.front);
  h.page.viewCards(h.self.main_arr, { deck: data });
  assert.deepEqual(ui.rendered.at(-1).options.deck, [h.target.front]);
  assert.deepEqual(h.self.main_arr, original);
  assert.equal(ui.clickCard(h.target, 2), false, "right-click does not select");
  assert.equal(ui.clickCard(h.target), true);
  assert.equal(h.runtime.snapshot().choices[0].selected, true);
  assert.match(face.style.outline, /solid/);
  assert.equal(h.target[0].style.outline, "", "outline must not be drawn around the outer centre anchor");
  assert.equal(face.style.transform, "translate(-50%, -50%)", "native card geometry is preserved");
  h.page.viewCards(h.self.main_arr);
  assert.deepEqual(ui.rendered.at(-1).cards, [h.target], "native search/repaint remains filtered");
  assert.equal(h.commands.length, 2, "selecting does not move until confirmation");
  h.runtime.cancel();
  assert.deepEqual(ui.rendered.at(-1).cards, original);
  assert.equal(face.style.outline, "");
  assert.equal(face.children.some(node => node.textContent === "×2"), false);
});

test("native selection confirms a specific card and exits filtered mode before movement", () => {
  const h = harness(), ui = selectionUI(h);
  h.start(); h.ack(); h.runtime.tick();
  ui.clickCard(h.target); h.runtime.confirmCards();
  assert.deepEqual(h.commands.at(-1), { action: "Duel", play: "To hand", card: 3 });
  assert.deepEqual(ui.rendered.at(-1).cards, h.self.main_arr);
});

test("fallback card grid displays native art with one entry per Deck card identity", () => {
  const h = harness(); h.target.front.id = 1234;
  const duplicate = h.card(12, h.target.front.name); h.self.main_arr.push(duplicate);
  const ui = selectionUI(h, false);
  h.start(); h.ack(); h.runtime.tick();
  const images = ui.nodes.filter(node => node.tag === "img");
  assert.equal(images.length, 1);
  assert.equal(images[0].src, "https://images.duelingbook.com/low-res/1234.jpg");
  assert.equal(images[0].alt, h.target.front.name);
  assert.equal(ui.nodes.filter(node => node.className === "copies").at(-1).textContent, "×2");
  const choice = images[0].parentElement;
  choice.click(); assert.equal(h.runtime.snapshot().choices[0].selected, true);
});

test("destruction keeps identical field copies separate and never shows hidden opponent art", () => {
  const h = harness();
  h.self.s2 = h.card(15, h.ownSpell.front.name, "Spell");
  h.hidden.front.id = 999; h.hidden.front.pic = "https://example.test/secret.jpg";
  h.start("destroy");
  const choices = h.runtime.snapshot().choices;
  assert.equal(choices.filter(choice => choice.label.includes(h.ownSpell.front.name)).length, 2);
  assert.equal(choices.find(choice => choice.instanceId === 6).imageUrl, null);
});

test("database-backed monster selectors match identity, not family-looking names, and enforce the Lua destruction minimum", () => {
  const h = harness();
  const step = h.settings.automationLists[0].rules[0].resolution[0];
  delete step.monsterNamePrefixes;
  step.monsterCards = [{ passcode: "09000002", name: "Example HERO Search" }];
  step.destructionMinimum = 1;
  assert.doesNotThrow(() => core.validateAutomationList(h.settings.automationLists[0]));
  h.start("search"); h.ack(); h.runtime.tick();
  assert.deepEqual(h.runtime.snapshot().choices.map(choice => choice.label), ["Example HERO Search"]);
  h.runtime.cancel();
  h.self.m2 = h.target;
  h.start("destroy");
  assert.equal(h.runtime.snapshot().maximum, 1);
  assert.equal(h.runtime.snapshot().minimum, 1);
  h.runtime.confirmCards(); assert.equal(h.runtime.snapshot().state, "select-destroy");
  h.runtime.selectCard("5"); h.runtime.confirmCards(); assert.equal(h.commands.at(-1).play, "To GY");
});

test("explicit monster selectors and destruction minimum reject ambiguous or unsupported schema variants", async () => {
  const vendor = (await import("../card-rule-extractor/schema-3.mjs")).default;
  for (const api of [core, vendor]) {
    for (const patch of [{ monsterCards: [] }, { monsterCards: [{ passcode: "09000006", name: "Member" }], monsterNamePrefixes: ["Example "] },
      { destructionMinimum: 2 }, { destructionMinimum: "1" }]) {
      const list = definition(); Object.assign(list.rules[0].resolution[0], patch);
      assert.throws(() => api.importAutomationList(JSON.stringify(list)));
    }
  }
});

test("manual card confirmation is opt-in and persists through settings sanitization", () => {
  assert.equal(core.createDefaultSettings().automationConfirmSelections, false);
  assert.equal(core.sanitizeSettings({}).automationConfirmSelections, false);
  assert.equal(core.sanitizeSettings({ automationConfirmSelections: true }).automationConfirmSelections, true);
  assert.equal(core.sanitizeSettings({ automationConfirmSelections: "true" }).automationConfirmSelections, false);
});

test("default native search resolves on one left-click without a separate confirmation panel", () => {
  const h = harness(); delete h.settings.automationConfirmSelections;
  const ui = selectionUI(h);
  h.start(); h.ack(); h.runtime.tick();
  const host = ui.nodes.find(node => node.id === "dbx-card-automation");
  assert.equal(host.hidden, true);
  ui.clickCard(h.target);
  assert.deepEqual(h.commands.at(-1), { action: "Duel", play: "To hand", card: 3 });
  assert.equal(ui.view.style.visibility, "hidden", "Deck window hides immediately, before the move acknowledgment");
  assert.equal(h.page.viewing, "Deck", "native protocol state remains valid while the move is in flight");
  assert.equal(h.commands.some(command => command.play === "Stop viewing"), false, "closing cannot race the move");
  assert.equal(h.runtime.snapshot().state, "adding");
  assert.equal(host.hidden, true, "adding progress must not reopen the panel");
  ui.clickCard(h.target); assert.equal(h.commands.filter(command => command.play === "To hand").length, 1);
  h.ack(); h.runtime.tick();
  assert.equal(h.self.hand_arr.includes(h.target), true);
  assert.equal(h.runtime.snapshot().state, "close-deck");
  assert.equal(h.page.viewing, "");
  assert.equal(host.hidden, true, "closing the Deck must stay silent");
  h.ack(); h.runtime.tick(); assert.equal(host.hidden, true);
  h.echo("Shuffle deck"); h.runtime.tick();
  assert.equal(h.runtime.snapshot().state, "completed"); assert.equal(host.hidden, true);
  assert.equal(ui.view.style.visibility, undefined, "native visibility is restored for subsequent searches");
});

test("confirmation setting keeps the native search panel near the centre and requires confirmation", () => {
  const h = harness(), ui = selectionUI(h);
  h.start(); h.ack(); h.runtime.tick();
  const host = ui.nodes.find(node => node.id === "dbx-card-automation");
  assert.equal(host.hidden, false);
  const style = ui.nodes.find(node => node.tag === "style").textContent;
  assert.match(style, /:host\(\[data-native-picker\]\) \{ left:50%; top:60%/);
  ui.clickCard(h.target); assert.equal(h.commands.at(-1).play, "View deck");
  h.runtime.confirmCards(); assert.equal(h.commands.at(-1).play, "To hand");
  assert.equal(host.hidden, true, "explicit confirmation also closes the panel through resolution");
  h.advance(15001); h.runtime.tick();
  assert.equal(h.runtime.snapshot().state, "stopped");
  assert.equal(host.hidden, false, "an uncertain or failed movement must still surface its error");
  assert.equal(ui.view.style.visibility, undefined, "failure restores the Deck window for manual recovery");
});

test("default multi-card selection auto-finishes at the maximum and still supports finishing with fewer", () => {
  const h = harness(); h.settings.automationConfirmSelections = false; h.self.m3 = h.target;
  h.start("destroy"); h.runtime.selectCard("5");
  assert.equal(h.runtime.snapshot().state, "select-destroy");
  h.runtime.selectCard("6"); assert.equal(h.commands.at(-1).play, "To GY");
  const fewer = harness(); fewer.settings.automationConfirmSelections = false; fewer.self.m3 = fewer.target;
  fewer.start("destroy"); fewer.runtime.selectCard("5"); fewer.runtime.confirmCards();
  assert.equal(fewer.commands.at(-1).play, "To GY");
});
