# Duel event features

`duel-events.js` exposes `window.DBEnhancerDuelEvents` in the page's MAIN world.
Register features from a script loaded after it (add the script to the MAIN
content scripts in `manifest.json`). Registrations can happen before the site
finishes loading. `content.js` installs available hooks and checks every 500 ms
for dispatchers and handlers loaded or replaced later. The battle damage feature
registers confirmation and invalidation rules using this API. All incoming `Duel` messages reaching the site's
`duelResponse` dispatcher are observable, including unknown future `play` names.
This is a duel-message framework, not a feed of unrelated account/lobby traffic
or local mouse movements that the site does not send as duel messages.

```js
const removeFeature = window.DBEnhancerDuelEvents.register({
  id: "my-battle-feature",
  when: {
    type: "attack",
    actor: "opponent",
    attacker: "Blue-Eyes White Dragon",
    target: "Dark Magician"
  },
  run(event, actions) {
    console.log(event.attacker.name, "attacks", event.target.name);
  }
});

// Disable a feature and invalidate any of its deferred action helpers.
removeFeature();
```

Each rule has a unique `id`, optional `when` filters, an optional `test(event)`
predicate, and `run(event, actions)`. All supplied filters must match. `card`,
`attacker`, and `target` accept an exact card name or a numeric Dueling Book
database ID. These differ from duel instance IDs, which identify individual
copies. Actor filters are `self`, `opponent`, `partner`, or `unknown`.
Unknown identities do not match named cards.

`actions.shuffleHand()` sends the native hand-shuffle command once per rule/event.
It requires a live duel and rejects deferred calls
after the duel, game generation, username, turn, or rule registration changes.
The hand-shuffle feature defers until the native draw handler has added the card;
the site's animation queue then processes the shuffle response after the draw.

Rules run synchronously in registration order. Exceptions and rejected promises
are reported without interrupting the site's action or other rules. Avoid slow
work inside callbacks. Unregistering is immediate; registrations made during an
event start receiving the next event. Duplicate IDs throw an error.

## Events and timing

Rules use `stage: "execute"` by default. Queued events fire **just before the
native action executes**, after earlier queued actions have run. The framework
observes every callback queued by `duelResponse2`, including actions with no
dedicated handler hook. A message with several internal callbacks emits once.
Known inline handlers emit before their action; other inline and log-only
messages emit after the native dispatcher returns. Inline messages can overtake
the animation queue, just as they do in the site itself.

Use `when: { stage: "receive" }` to observe every incoming duel message before
native processing, including unknown messages and lifecycle/status messages.
This stage does not wait for queued animations and its card/phase context may
still reflect earlier actions. A rule selects one stage, so it does not receive
both stages accidentally. An activation event means the card was activated; it
does not mean its effect resolved. Nested native calls processing the same
message emit once. Repeated genuine actions are not deduplicated by card ID.
There is no historical catch-up for actions performed before hook installation.

Snapshots are frozen and contain:

- `sequence`, `type`, `stage`, native `play`, `duelId`, `live`, `phase`, and `turn`.
- `data`: an independent, deeply frozen copy of the complete native message,
  including event-specific fields, arrays, and nested objects.
- `actor: { username, relation }`.
- `card: { instanceId, id, name, cardType }`, from the message or current card.
- `attacker` and `target` for attacks; `attacker` for direct attacks; `target`
  for targeting. Missing identities are `null`.
- `amount` for life-point changes, when supplied.

Common types: `summon`, `activate`, `attack`, `attack-direct`, `target`,
`effect` (the native Apply effect action), `set`, `draw`, `to-hand`, `to-deck`,
`to-grave`, `to-extra`, `banish`, `move`, `flip`, `control`, `life-points`, `reset`.
Other types follow the native play name in lowercase with punctuation/spaces
converted to hyphens: `Good` → `good`, `Stop good` → `stop-good`, `Thinking` →
`thinking`, `Typing` → `typing`, `Enter BP` → `enter-bp`, `Add counter` →
`add-counter`, and `Offer draw` → `offer-draw`. All original names remain
available through `play`; matching `when.play` avoids any ambiguity between
aliases. New messages automatically use this convention without a code change.
Phase and turn are context snapshots; phase/turn changes themselves are also
observable through their native `play` values.

```js
DBEnhancerDuelEvents.register({
  id: "opponent-thumbs-up",
  when: { type: "good", actor: "opponent" },
  run(event) {
    console.log(event.data.long ? "Held thumbs up" : "Thumbs up");
  }
});

DBEnhancerDuelEvents.register({
  id: "either-player-thinking",
  when: { type: "thinking" },
  run(event) { console.log(event.actor.username, "is thinking"); }
});

DBEnhancerDuelEvents.register({
  id: "observe-all-incoming-duel-messages",
  includeNonLive: true,
  when: { stage: "receive" },
  run(event) { console.log(event.play, event.actor, event.data); }
});
```

The catch-all covers chat/typing, player signals, permissions, turns/phases,
counters, dice/coins, reveals/viewing, shuffling, card moves/positions/materials,
LP/stats, duel results, siding, RPS, watchers, judge calls, and pause/resume.
It remains an event feed rather than a game rules engine.

By default, rules only run for a player in a live manual duel. Replays,
spectating, state resets, automatic duels, paused duels, and pending defeat do
not trigger them. Set `includeNonLive: true` for observational features that
also need these events; their action helper remains blocked outside live play.
Face-down cards controlled by others are not identified from cached fronts.
`data` contains only what the native incoming message supplies. For inline
pause/end messages, live eligibility includes the status at receipt so the
transition remains observable; action helpers still check current live status.

## Example: Upstart life gain

This example is **not registered by the extension**. It illustrates the API:

```js
const removeUpstart = window.DBEnhancerDuelEvents.register({
  id: "example-upstart-life",
  when: { type: "activate", actor: "opponent", card: "Upstart Goblin" },
  run(event, actions) {
    actions.adjustLifePoints(1000);
  }
});
```

This sends the same native life-point command as the site's LP controls. The
server updates the duel for both players; the enhancer does not edit the LP
display. The helper allows one LP command per rule/event, requires a nonzero
signed 32-bit integer, and returns whether it invoked the native command (not
whether the server accepted it). It checks live status again when called and
rejects stale helpers after a duel/game change or feature removal.

For a production Upstart feature, choose how to handle negation, manual LP
adjustments, and effects that change life gain before enabling it. Activation
alone cannot resolve these cases. A feature can retain the helper for a later
confirmation or other observed condition; it must manage that pending state
and call the helper only when appropriate. The framework does not infer spell
resolution or automatically prevent a player from also changing LP manually.

Inspect installed/missing hooks, event count, and registered rule IDs with
`DBEnhancerDiagnostics.duelEvents()` or
`DBEnhancerDuelEvents.diagnostics()` in the page console.

Run the framework and coverage checks with
`node --test tests/duel-events.test.js tests/duel-event-coverage.test.js`.
Coverage tests derive all message names from the local native dispatchers and
exercise both players, all queued cases, signal variants, and unknown messages.
