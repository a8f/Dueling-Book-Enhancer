"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync(require.resolve("../content.js"), "utf8");
const native = fs.readFileSync(require.resolve("../duelingbook/main.js"), "utf8");
const elements = {};
const sent = [];
let sample = 0;
let localPlayer = true;
let panelVisible = true;

function card() {
  const content = { pointerEvents: "auto" };
  const element = {
    pointerEvents: "none", style: { top: "726.8px" }, handler: null,
    querySelector: selector => selector === ".content" ? content : null
  };
  // Model a click on a child bubbling to the handler bound to its card.
  content.click = () => { if (element.handler) element.handler.call(element); };
  const result = [element];
  result.off = () => { element.handler = null; return result; };
  result.css = (key, value) => {
    if (value === undefined) return "523";
    if (key === "pointer-events") element.pointerEvents = value;
    return result;
  };
  result.find = () => ({ css(key, value) {
    if (key === "pointer-events") content.pointerEvents = value;
  } });
  return result;
}

const cards = [card(), card(), card()];
elements.rps_start = {
  querySelectorAll: selector => selector === ".rps_card" && localPlayer ? cards.map(c => c[0]) : [],
  appendChild: element => { elements[element.id] = element; }
};
const savedPreferences = [];
const context = {
  state: { settings: { autoPickRps: false } },
  postToBridge: (type, payload) => savedPreferences.push({ type, ...payload }),
  document: {
    getElementById: id => elements[id],
    createElement: () => ({
      attributes: {},
      attachShadow() {
        const children = {};
        this.shadowRoot = {
          getElementById: id => children[id],
          appendChild(element) {
            if (element.id) children[element.id] = element;
            for (const child of element.children || []) if (child.id) children[child.id] = child;
          }
        };
        return this.shadowRoot;
      },
      children: [],
      appendChild(element) { this.children.push(element); },
      setAttribute(name, value) { this.attributes[name] = value; },
      getAttribute(name) { return this.attributes[name]; },
      addEventListener(type, handler) { this[type] = handler; }
    })
  },
  currentLabel: "rps_start", duelist: true, pickedRPS: false,
  username: "Player", Player1: () => ({ username: "Player" }),
  rock1: cards[0], paper1: cards[1], scissors1: cards[2],
  bottomChoices: cards,
  TweenMax: { fromTo() {} },
  isVisible: () => panelVisible,
  Math: Object.assign(Object.create(Math), { random: () => sample }),
  Send: message => sent.push(message), ABOUT_ZERO: 0.001,
  console: { log() {} }
};
// The enhancer must work without page globals or access to a jQuery instance.
context.window = { getComputedStyle: element => element };
vm.createContext(context);
// Exercise the site's actual choice handler, including its unbinding behavior.
vm.runInContext(native.slice(native.indexOf("function chooseRPS("), native.indexOf("function pickFirst(")), context);
vm.runInContext(source.slice(source.indexOf("  function randomRpsCards("), source.indexOf("  function installObservers(")), context);

function readyRound(allowAutoPick) {
  context.pickedRPS = false;
  cards.forEach(item => {
    item[0].handler = context.chooseRPS;
    item[0].style.top = "478.1px";
    item[0].querySelector(".content").pointerEvents = "auto";
  });
  context.syncRpsControls(allowAutoPick);
}

context.syncRpsControls();
function segment(mode) {
  return elements["dbx-auto-rps-control"].shadowRoot.getElementById("dbx-rps-mode-" + mode);
}
function poll() {
  for (let refresh = 0; refresh < 100; refresh++) context.syncRpsControls();
}
assert.equal(elements["dbx-random-rps-button"], undefined, "the separate random button is removed");
assert.equal(segment("manual").getAttribute("aria-pressed"), "true");
assert.equal(segment("repeat").textContent, "Random on tie");
segment("automatic").click();
assert.equal(sent.length, 0, "wait until the cards finish revealing");
sample = 0;
readyRound();
assert.equal(sent.length, 1, "Automatic picks once the cards are ready");
assert.equal(sent.at(-1).choice, "Rock");
for (const [random, expected] of [[0.4, "Paper"], [0.99999, "Scissors"]]) {
  segment("manual").click();
  readyRound();
  sample = random;
  segment("automatic").click();
  assert.equal(sent.at(-1).choice, expected);
  assert.equal(sent.at(-1).play, "RPS");
  const count = sent.length;
  segment("automatic").click();
  poll();
  assert.equal(sent.length, count, "clicks while waiting never submit duplicates");
  context.pickedRPS = false;
  context.syncRpsControls();
  assert.equal(sent.length, count, "ties wait for the native cards to accept picks again");
}
assert.equal(sent.length, 3);
assert.deepEqual(savedPreferences.at(-1), { type: "save-rps-mode", mode: "automatic" });
assert.equal(segment("automatic").getAttribute("aria-pressed"), "true");
// Automatic still acts as a pick action when the mode is already selected.
readyRound(false);
segment("automatic").click();
assert.equal(sent.length, 4);
sample = 0.4;
readyRound();
assert.equal(sent.length, 5, "Automatic repeats tied rounds");
assert.equal(sent.at(-1).choice, "Paper");
segment("manual").click();
readyRound();
poll();
assert.equal(sent.length, 5, "Manual stops repetition");
segment("repeat").click();
poll();
assert.equal(sent.length, 5, "Random on tie waits for the first manual card pick");
cards[0][0].querySelector(".content").click();
context.syncRpsControls();
readyRound();
assert.equal(sent.length, 7, "a manual card pick starts random tie repetition");
panelVisible = false;
context.syncRpsControls();
panelVisible = true;
readyRound();
poll();
assert.equal(sent.length, 7, "Random on tie waits again in the next duel");
segment("automatic").click();
assert.equal(sent.length, 8, "clicking Automatic starts now");
panelVisible = false;
context.syncRpsControls();
panelVisible = true;
readyRound();
assert.equal(sent.length, 9, "the saved Automatic mode starts the next duel");
// Replacing cards identifies a fresh duel even if the hidden state was missed.
cards.splice(0, cards.length, card(), card(), card());
context.rock1 = cards[0]; context.paper1 = cards[1]; context.scissors1 = cards[2];
readyRound();
assert.equal(sent.length, 10);
context.state.settings.rpsEnhancements = false;
context.syncRpsControls();
assert.equal(elements["dbx-auto-rps-control"].hidden, true);
segment("automatic").click();
readyRound();
poll();
assert.equal(sent.length, 10, "the master switch disables every enhancer choice");
context.state.settings.rpsEnhancements = true;
localPlayer = false;
context.syncRpsControls();
assert.equal(elements["dbx-auto-rps-control"].hidden, true);
segment("automatic").click();
poll();
assert.equal(sent.length, 10, "spectators cannot use automation");
panelVisible = false;
localPlayer = true;
segment("automatic").click();
poll();
assert.equal(sent.length, 10, "hidden RPS cannot submit choices");

// Card contents are centered at y=162 and y=478, scaled from 580px tall.
const css = fs.readFileSync(require.resolve("../content.css"), "utf8");
const modeCss = css.match(/#dbx-auto-rps-control\s*\{([^}]+)\}/)[1];
const top = Number(modeCss.match(/top:\s*([\d.]+)px/)[1]);
const height = Number(modeCss.match(/height:\s*([\d.]+)px/)[1]);
assert.match(modeCss, /pointer-events:\s*auto\s*!important/);
assert.match(modeCss, /transform:\s*translate\(-50%, -50%\)/);
assert.ok(top - height / 2 > 162 + 580 * 0.4375 / 2);
assert.ok(top + height / 2 < 478 - 580 * 0.4375 / 2);
assert.equal(Number(modeCss.match(/left:\s*([\d.]+)px/)[1]), 523, "center the modes above the cards");
console.log("Random RPS regression tests passed.");
