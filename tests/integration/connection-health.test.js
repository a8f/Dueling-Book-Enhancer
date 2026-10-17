"use strict";
const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const createFeature = require("../../extension/page/features/connection-health.js");

class Socket {
  constructor() { this.readyState = 1; this.listeners = {}; this.sent = []; }
  addEventListener(type, handler) { (this.listeners[type] ||= new Set()).add(handler); }
  removeEventListener(type, handler) { this.listeners[type].delete(handler); }
  emit(type, message) {
    for (const handler of this.listeners[type] || []) handler({ data: JSON.stringify(message) });
  }
  send(data) {
    if (this.readyState !== 1) throw new Error("Socket closed");
    this.sent.push(data);
    return "native result";
  }
}

function setup() {
  let time = 0;
  const banners = [];
  const document = { hidden: false,
    body: { appendChild: element => banners.push(element) },
    createElement: () => ({ dataset: {}, setAttribute() {} }) };
  const page = { websocket: new Socket(), navigator: { onLine: true },
    duelist: true, duelId: 1, username: "Local", currentLabel: "duel_start" };
  const feature = createFeature({ window: page, document, now: () => time });
  feature.initialize();
  return { page, document, feature, banners,
    status: () => feature.diagnostics.connectionHealth(),
    send: message => page.websocket.send(JSON.stringify(message)),
    receive: message => page.websocket.emit("message", message),
    advance(ms, ticking = true) {
      const end = time + ms;
      if (ticking) while (time + 500 < end) { time += 500; feature.tick(); }
      time = end;
      feature.tick();
    }
  };
}

test("turn changes warn while unrelated opponent traffic continues, and matching echoes clear them", () => {
  const h = setup();
  for (const play of ["End turn", "Start turn"]) {
    h.send({ action: "Duel", play });
    h.advance(10000);
    h.receive({ action: "Duel", play: "Draw card", username: "Opponent" });
    assert.equal(h.status().reason, "action");
    h.receive({ action: "Duel", play, username: "Local" });
    h.feature.tick();
    assert.equal(h.status().state, "healthy");
  }
});

test("post-send observer failure preserves a successful native send", () => {
  const h = setup();
  Object.defineProperty(h.page, "duelId", { get() { throw new Error("observer unavailable"); } });
  assert.equal(h.send({ action: "Duel", play: "End turn" }), "native result");
  assert.equal(h.page.websocket.sent.length, 1);
});

test("socket failures and browser offline show a warning, recovery hides it", () => {
  const h = setup();
  assert.equal(h.banners.length, 0);
  h.page.websocket.emit("error");
  h.feature.tick();
  assert.equal(h.status().reason, "socket");
  assert.equal(h.banners[0].hidden, false);
  h.receive({ action: "Heartbeat" });
  h.feature.tick();
  assert.equal(h.banners[0].hidden, true);
  h.page.navigator.onLine = false;
  h.feature.tick();
  assert.equal(h.status().reason, "offline");
  h.page.navigator.onLine = true;
  h.page.websocket.readyState = 3;
  h.feature.tick();
  assert.equal(h.status().state, "disconnected");
});

test("heartbeat replies are tracked separately from unrelated traffic and repeated sends", () => {
  const h = setup();
  assert.equal(h.send({ action: "Heartbeat" }), "native result");
  h.advance(10000);
  h.receive({ action: "Online users" });
  h.send({ action: "Heartbeat" });
  h.advance(5000);
  assert.equal(h.status().reason, "heartbeat");
  h.receive({ action: "Heartbeat" });
  h.feature.tick();
  assert.equal(h.status().state, "healthy");
  assert.deepEqual(JSON.parse(h.page.websocket.sent[0]), { action: "Heartbeat" });
});

test("45 seconds of silence warns, malformed traffic does not reset the clock", () => {
  const h = setup();
  h.advance(44000);
  assert.equal(h.status().state, "healthy");
  for (const data of ["garbage", "null", "[]", "{}"])
    for (const handler of h.page.websocket.listeners.message) handler({ data });
  h.advance(1000);
  assert.equal(h.status().reason, "silence");
  h.receive({ action: "Online users" });
  h.feature.tick();
  assert.equal(h.status().state, "healthy");
});

test("only the matching local echo acknowledges one action, even while heartbeats continue", () => {
  const h = setup();
  h.send({ action: "Duel", play: "Normal Summon", card: 501 });
  h.advance(9000);
  h.receive({ action: "Heartbeat" });
  h.receive({ action: "Duel", play: "Normal Summon", username: "Opponent", id: 501 });
  h.receive({ action: "Duel", play: "Normal Summon", username: "Local", id: 502 });
  h.receive({ action: "Duel", play: "Normal Summon", username: "Local" });
  h.advance(1000);
  assert.equal(h.status().reason, "action");
  assert.match(h.banners[0].textContent, /Normal Summon/);
  h.receive({ action: "Duel", play: "Normal Summon", username: "Local", id: 501 });
  h.feature.tick();
  assert.equal(h.status().state, "healthy");
  h.send({ action: "Duel", play: "Shuffle hand" });
  h.send({ action: "Duel", play: "Shuffle hand" });
  h.receive({ action: "Duel", play: "Shuffle hand", username: "Local" });
  assert.equal(h.status().pendingActions.length, 1);
});

test("new duels, leaving a duel, and reconnect confirmation discard obsolete acknowledgements", () => {
  const h = setup();
  h.send({ action: "Duel", play: "Shuffle hand" });
  h.page.duelId = 2;
  h.send({ action: "Duel", play: "Draw card", card: 1 });
  assert.equal(h.status().pendingActions.length, 1);
  h.receive({ action: "Reconnected" });
  assert.equal(h.status().pendingActions.length, 0);
  h.send({ action: "Duel", play: "Shuffle hand" });
  h.page.currentLabel = "siding";
  h.feature.tick();
  assert.equal(h.status().pendingActions.length, 0);
  for (const flags of [{ replay: true }, { automatic: true }, { duelist: false }]) {
    Object.assign(h.page, { currentLabel: "duel_start", replay: false, automatic: false, duelist: true }, flags);
    h.send({ action: "Duel", play: "Shuffle hand" });
    assert.equal(h.status().pendingActions.length, 0);
  }
});

test("replacing a native socket detaches old listeners and restores its send method", () => {
  const h = setup();
  const old = h.page.websocket;
  h.send({ action: "Heartbeat" });
  h.page.websocket = new Socket();
  h.feature.tick();
  assert.equal(old.send, Socket.prototype.send);
  assert.equal(old.listeners.message.size, 0);
  old.emit("close");
  h.feature.tick();
  assert.equal(h.status().state, "healthy");
  assert.equal(h.status().heartbeatSentAt, null);
  h.page.websocket.readyState = 3;
  assert.throws(() => h.send({ action: "Duel", play: "Draw card" }), /Socket closed/);
  assert.equal(h.status().pendingActions.length, 0);
});

test("suspended and hidden tabs get a fresh grace period before timed warnings", () => {
  const h = setup();
  h.send({ action: "Heartbeat" });
  h.send({ action: "Duel", play: "Shuffle hand" });
  h.advance(120000, false);
  assert.equal(h.status().state, "healthy");
  h.advance(10000);
  assert.equal(h.status().reason, "action");
  h.document.hidden = true;
  h.advance(60000);
  assert.equal(h.banners[0].hidden, true);
  h.document.hidden = false;
  h.feature.tick();
  assert.equal(h.status().state, "healthy");
  h.advance(15000);
  assert.equal(h.status().reason, "heartbeat");
});

test("commands that wait for other players are not timed; pending storage is bounded", () => {
  const h = setup();
  for (const play of ["Ready", "Typing", "Thinking", "Pick first"])
    h.send({ action: "Duel", play });
  h.advance(10000);
  assert.equal(h.status().state, "healthy");
  for (let i = 0; i < 110; i++) h.send({ action: "Duel", play: "Shuffle hand" });
  assert.equal(h.status().pendingActions.length, 100);
});

test("recorded duel traffic acknowledges the supported commands without false stall warnings", () => {
  for (const filename of ["lots_of_actions.har", "first_real_game.har", "duel_unranked_onegame.har"]) {
    const capture = JSON.parse(fs.readFileSync(require.resolve("../../duelingbook/network-captures/" + filename), "utf8"));
    const h = setup();
    let previous = null;
    let tracked = 0;
    for (const entry of capture.log.entries) for (const frame of entry._webSocketMessages || []) {
      let message;
      try { message = JSON.parse(frame.data); } catch (_) { continue; }
      // Read identity without printing or persisting capture credentials.
      if (frame.type === "send" && message.action === "Connect") h.page.username = message.username;
      if (previous != null) h.advance(Math.max(0, (frame.time - previous) * 1000));
      previous = frame.time;
      if (frame.type === "send") {
        const count = h.status().pendingActions.length;
        h.send(message);
        if (h.status().pendingActions.length > count) tracked++;
      } else h.receive(message);
      h.feature.tick();
      assert.equal(h.status().state, "healthy", filename + ": " + h.status().reason + " " + JSON.stringify(h.status().pendingActions));
    }
    assert.ok(tracked > 0, filename + " exercises action tracking");
  }
});
