# Automation contracts

Status: implemented. Spec (1) is **card action version 1**. Spec (2) is
**card rule list version 4**. These replace the flat schema-3 list format.
They describe the current executor, not a complete Yu-Gi-Oh! rules engine.

## Sources and ownership

| Contract | Machine-readable source | Responsibility |
| --- | --- | --- |
| Spec (1): an action definition | [card-action-v1.schema.json](../schemas/card-action-v1.schema.json) | Complete supported prerequisites, activation costs and resolution pipeline |
| Spec (2): a portable list | [card-rule-list-v4.schema.json](../schemas/card-rule-list-v4.schema.json) | List metadata and entries containing card metadata plus a spec-(1) `action` |
| Developer callbacks and subscriptions | [automation.d.ts](../contracts/automation.d.ts) | Typed event and helper API; callbacks belong to extension code |
| Runtime validation | [enhancer-core.js](../extension/shared/enhancer-core.js) | Structural checks, identity consistency, unique rule IDs, transport limits and normalization |

The JSON Schemas use Draft 2020-12. Their `$id` values are stable identifiers,
not a promise that a schema server exists. Resolve both files locally; validation
does not require network access. Do not add `$schema` to imported documents:
unknown document fields are rejected. Configure editors with the external schema.
TypeScript types aid authors; they do not enforce lengths, uniqueness, pipeline
cardinality or all runtime conditions.

The extension owns the contract. The extractor vendors the validator and both
schemas so it remains independently usable without an extension checkout.
`node scripts/sync-automation-contracts.mjs` updates those copies;
`node scripts/sync-automation-contracts.mjs --check` detects drift when the optional
extractor checkout is initialized. Ordinary builds/tests do not initialize or
download either submodule. The exporter, extractor and rules helper must produce
the same format; neither submodule is a runtime dependency.

## Spec (1): card action

An action contains exactly `schemaVersion`, `requires`, `activation` and
`resolution`. Version 1 accepts **two complete pipeline shapes**, not arbitrary
combinations of individually recognized operations. Each array has exactly the
cardinality defined below. There are no user expressions, executable callbacks,
arbitrary commands, URLs, subscriptions or JavaScript in action JSON.

```json
{
  "schemaVersion": 1,
  "requires": { "sourceZone": "graveyard", "ownTurn": true, "phases": ["M1", "M2"] },
  "activation": [{ "op": "banish", "card": "source" }],
  "resolution": [{
    "op": "special-summon", "from": "deck",
    "card": { "passcode": "09000002", "name": "Example Result" },
    "positions": ["ATK", "DEF"]
  }]
}
```

The source is the concrete card instance chosen through the native menu. Its
printed identity and display label come from the enclosing list entry. An
extractor's per-card `result.rule.action` follows this spec;
`result.rule` is the enclosing spec-(2) entry. Extraction reports also contain
diagnostics, Lua analysis and research; they are not themselves importable lists.
Unsupported/ambiguous results are diagnostics, never executable partial actions.

### Graveyard banish and Deck summon

`requires.sourceZone` is `graveyard`, `ownTurn` is `true`, and `phases` contains
1–6 distinct phase codes (`DP`, `SP`, `M1`, `BP`, `M2`, `EP`). The optional
`absentFaceUpCards` contains 1–10 identity selectors. None may be face-up on
either player's ordinary field zones when declaring or paying cost. A negated
continuous effect still blocks; its adjudication remains manual.

`activation` is exactly `[{ "op": "banish", "card": "source" }]`.
The engine declares once, waits for receipt/execution, sends the cost, and
confirms the source is banished before releasing resolution. Cancellation does
not refund it.

`resolution` contains one `special-summon` from `deck`, one identity selector,
and 1–2 distinct `positions` (`ATK`, `DEF`). Source and result identities can
differ. Multiple positions require a player choice; the engine chooses the
first free monster zone. Activation checks a nonempty Deck and a free zone,
but cannot prove a matching hidden Deck copy exists. Resolution uses only a
fresh native Deck-search response, paired with the current Deck instances.

Optional `onNoMonsterZone: "destroy-to-graveyard"` sends a matching Deck copy
to the Graveyard if the field fills after cost. It still requires a free zone
at activation. Without it, a full field stops resolution. Native `To GY` is
movement; the journal's destruction description does not implement destruction
consequences, replacements or protection. Search closure uses the native shuffle;
the extension sends no duplicate shuffle.

### Manually timed summon choice

`requires` is exactly `sourceZone: "monster"`, `ownTurn: false`,
`trigger: "normal-or-special-summon"` and all six distinct phases. Here
`ownTurn: false` means **either player's turn**, not opponent-only. The trigger
is a timing declaration for the human, not an automatic event subscription or
proof that the last action was a qualifying summon. Optional timing, missed
timing and the Damage Step remain manual. There is no activation cost.

`activation` is empty. `resolution` contains one `choose-search-or-destroy`:

| Field | Meaning |
| --- | --- |
| `monsterCards` | 1–500 explicit identity selectors; mutually exclusive with prefixes |
| `monsterNamePrefixes` | Historical alternative: 1–10 prefixes, each at most 80 characters, ending in a literal space; matching ignores case |
| `searchAbsentFaceUpCards` | Required array of 0–10 prohibiting identities; checked on both fields, including again before adding |
| `destructionMinimum` | Optional `0` or `1`; omitted means `0` |

Choose search or destruction before declaring. Only choices available at that
point can be selected later. Changing the effect while waiting requires a fresh
opponent approval. Source departure after activation does not itself cancel
the effect. The engine does not reconstruct an earlier summon or its properties.

Search adds and reveals one matching monster from the current Deck and closes
the view for the native shuffle. Identical Deck copies are grouped for display
while retaining a concrete instance. An empty/no-match search cannot add a
cached card. Destruction counts your other face-up matching monsters at
resolution, excluding the source, and chooses up to that many field Spells/Traps.
Field copies remain separate. If no matching monsters/eligible cards remain,
the effective minimum is zero. Eligible opponent face-down cards expose no
cached name or art. Committed choices send native Target markers for visibility;
selection remains non-targeting in the effect's rules sense. Your cards are moved
sequentially; the opponent moves their own cards. Simultaneous consequences,
prevention and replacement effects remain manual.

## Spec (2): portable rule list

```json
{
  "schemaVersion": 4,
  "id": "example.rules",
  "name": "Example rules",
  "version": "1.0.0",
  "formats": ["so"],
  "rules": [{
    "id": "example-effect",
    "card": { "passcode": "09000001", "name": "Example Source" },
    "label": "Banish this copy; summon from Deck",
    "action": {
      "schemaVersion": 1,
      "requires": { "sourceZone": "graveyard", "ownTurn": true, "phases": ["M1", "M2"] },
      "activation": [{ "op": "banish", "card": "source" }],
      "resolution": [{ "op": "special-summon", "from": "deck",
        "card": { "passcode": "09000002", "name": "Example Result" }, "positions": ["DEF"] }]
    }
  }]
}
```

List/rule IDs match `[a-z0-9][a-z0-9._-]{0,79}`. Rule IDs are unique within a
list. A list name has at most 80 characters; labels and card names at most 160.
Strings must contain non-whitespace. Only the list name is trimmed. The version
is three dot-separated groups of 1–4 digits; it identifies publisher content,
not capabilities. Formats are a nonempty distinct subset of
`ar au er eu gr gu yu cu su ru uu tu so` (native format codes; `so` is Solo).
There are 1–100 entries per list and at most 50 installed lists.

Each selector has a name and **exactly one** identity: a nonzero eight-digit
string `passcode` (preserving leading zeros), or a positive safe-integer native
database `id`. Names are checked metadata, not name-only identity matching.
One identifier cannot have conflicting names anywhere in the list, including
source, results and prohibition/membership selectors. Passcodes and database
IDs are different namespaces; offline validation cannot prove their equivalence.
Commands use duel instance IDs, not either printed identity. Native passcode
matching accepts numeric/short values and alternative passcodes; list passcodes
remain strictly padded strings. Catalog verification is optional and separate.

The runtime validator adds checks that JSON Schema alone cannot express: unique
rule IDs, cross-selector identity/name consistency, and transport size. Import
and export limit UTF-8 JSON to 65,536 bytes, including whitespace. In-memory
structural validation does not measure serialized size. Large archetype snapshots
may hit this limit before reaching 500 members. Export's indentation also counts.

`enabled` is accepted as a boolean for local storage, forced false on ordinary
import and omitted from export. Local watch is an explicit development action:
new watched lists are enabled; replacements preserve local enablement and format
overrides. These settings are not publisher authority. Shared files should omit
`enabled`. Importing the same list ID replaces it after preview. Enabled overlapping
entries for the same card/format block execution, including multiple separate
effects in one list; use the supported combined choice action where appropriate.

## Events, subscriptions and callbacks

`DBEnhancerDuelEvents.register(subscription)` is a **developer API**, independent
of imported card data. Its exact types are in the declaration file above; timing
and examples are in [duel events](duel-events.md). `id` and `run(event, actions)`
are required; `test(event)`, `when` and `includeNonLive` are optional. Registration
returns an immediate, idempotent unsubscriber. Duplicate IDs throw. All supplied
known filters must match; the default stage is `execute`. The existing runtime
does not strictly validate unknown filter keys or enum values: unknown keys are
ignored and invalid values can never match. Use the declared contract when writing
features; this permissive developer API is not the strict JSON import validator.

Every incoming native Duel play is observable, including future unknown names.
Normalized types include summon, activation, battle, targeting, draws, movements,
control, LP and resets; others derive from lowercase native play names with
punctuation collapsed to hyphens. Thus the valid type space is open, not a frozen
enum. `when.play` filters the exact native name. Card/attacker/target filters take
an exact name or numerical **database** ID, not passcodes or instance IDs.
Actors are `self`, `opponent`, `partner`, `unknown`.

Snapshots are deeply frozen: sequence, type, stage, native play/data, duel ID,
live status, phase, turn, actor, card, attacker, target and LP amount. Missing
card identity fields are null. Opponent face-down identities are not inferred
from cached fronts. Native supplied `data` is retained; it is not redacted or
validated by these schemas. Do not persist/log hidden Deck data or assume all
native message shapes have typed/verified values. Sequence is monotonic within
one event runtime, not a persistent ID; receipt/execution have different numbers.

`receive` precedes dispatch and may see earlier board state. Queued `execute`
fires before the native callback, not after board mutation; some inline/log-only
plays emit after dispatch. The executor additionally waits for queue idle and
required board placement. Nested callbacks emit once per native message per
stage; repeated real messages remain distinct. No historical event catch-up exists.

Callbacks run in registration order; errors/rejected promises are reported without
blocking other subscriptions/native actions. New registrations start on the next
event. Removing a subscription invalidates retained helpers. `includeNonLive`
allows observation outside live play, not native commands. `actions.shuffleHand()`
and `actions.adjustLifePoints(amount)` each allow at most one command per
subscription/event and return whether a native function was invoked. They check
live status, duel/account/game generation and continued registration. Shuffle
also invalidates on turn change; LP does not. LP requires a nonzero integer with
absolute value at most 2,147,483,647. Neither helper proves acceptance or legality.
These helpers are not imported action operations.

The automation feature registers both stages with `includeNonLive: true` and
feeds `runtime.observe(event)`. Its native Send wrapper calls
`runtime.outgoing(message)`; the shared recovery tick calls `runtime.tick()`.
`create({ page, getSettings, changed, now })` accepts a synchronous
`changed(snapshot)` render callback and optional monotonic clock. `snapshot()`
is null before preparation, otherwise a UI snapshot with state, message, source
metadata and journal. It is not an immutable public event or a serializable resume
token; consumers must not mutate it. Trigger snapshots additionally expose effect
options/card choices/minimum/maximum; banish snapshots expose position/costPaid.

User controls call `prepare`, `begin`, `choose` (position), `selectMode`,
`selectCard`, `confirmCards`, `release` or `cancel`. `available` controls menu
discovery; `eligible` checks current readiness. Discovery does not imply legal
activation. `prepare` accepts `autoStart` and `mode: "resolve" | "wait"`.
Invalid/inapplicable controls do nothing. UI rendering and ticks do not grant
resolution permission or retry uncertain commands.

## Execution and failure contract

Only one active run per runtime is allowed. Web Locks coordinate the same
username/duel on the same origin; they do not span browsers, devices or
www/non-www origins. Live manual play, local player ownership/controller checks,
visible tab, an idle native queue and loaded controls are required as appropriate.
Replays, spectating, automatic and tag duels are excluded.

Principal states are `locking → choose → declaring`, then `banishing` when
applicable, and `ready/waiting/approved/suspended`. Resolution uses
`close-source`, `view-deck`, `summoning`/`destroying` or `select-search`/`adding`
or `select-destroy`/`destroying-field`/`opponent-moves`, and `close-deck` as
applicable. Terminal states are `completed`, `stopped`, `canceled`, `unavailable`.
These are implementation diagnostics, not persistent protocol states.

The wait gate requires a fresh opponent Good receipt after arming, matching
execution and queue idle. Old queued signals, local signals, held UI state,
silence and timeouts do not approve. Thinking/Stop good or intervening gameplay
can suspend approval. Effect/position changes invalidate approval. Resolve now
is an explicit manual release, not a legality check. Automatic approval has no
native effect ID and cannot resolve a game-rule chain.

Commands generally advance after matching receipt, execution and observed state.
Final Target markers are an exception: they are sent together for visibility
without waiting individually before movement. A send exception, missing response,
manual interference, changed account/socket/game/turn/phase/settings or hidden
tab stops/suspends further commands. Expected-command waits expire after 15s;
other states after 120s. Trigger source departure alone is allowed after activation.
There is no rollback, cost refund, replay-on-reconnect, automatic retry or safe
resume after uncertain commands. A completed status describes the adapter's
movements, not proof of full legal resolution. Reconcile manually, including any
native search still open. See [card automation](card-automation.md) for the UI.

## Producer and development flow

The extractor translates only recognized complete patterns and reviewed historical
mappings. `extractCards` returns supported results whose `rule.action` validates
under spec (1); the surrounding `rule` has spec-(2) entry metadata. Historical
reviews and source hashes stay in extraction reports/external review sidecars,
not extra fields in shared lists. Unsupported additional costs/restrictions/effects
fail closed instead of producing a plausible partial effect.

`mergeRules` validates the destination, requires every requested result to be
supported, rechecks historical approval, preserves existing effect IDs and checks
the final list/byte limit. More than one existing effect for a card requires a
manual merge. Writes use a temporary file and recheck that the original has not
changed. This check is not a cross-process lock: a narrow concurrent-write race
remains between checking and renaming. The Edison helper handles each card
independently; earlier successful writes survive later failures. Its output list
follows spec (2); its progress/report file is diagnostic data, not a shared list.

Continue using `node scripts/serve-rule-lists.mjs personal-rules` and Watch local
list. JSON edits do not require a version bump, commit or reload. Invalid updates
retain the last committed watched list; successful updates invalidate prepared
duel actions. Extension JavaScript changes require extension/page reload. Changes
in each submodule have their own Git history; this work does not publish them.

## Breaking upgrade and extension policy

Schema 1–3 lists are rejected; there is no runtime migration or fallback. Export
old installed data before upgrading, then change the list version marker to 4
and move each entry's `requires`, `activation`, `resolution` into
`action: { "schemaVersion": 1, ... }`. Keep `id`, `card` and `label` on the entry.
Validate/reimport and enable the list again. Invalid persisted lists are removed
from sanitized settings. The checked-in Edison list has been converted; restart
watching with that valid file if an old watched list was discarded.

List content `version`, list `schemaVersion`, and action `schemaVersion` serve
different purposes. Keep a version immutable once shared. Adding accepted action
fields/operations/semantics requires an action contract revision, validator and
adapter support, tests, updated schemas/types, a vendored extractor update and
documentation. List-envelope changes require a list contract revision. Unknown
versions, fields and unsupported compositions must remain rejected; never silently
ignore an instruction or enable a reserved capability.

## Capability backlog

This table records unimplemented areas; it does not reserve accepted JSON syntax.
When adding a card, extend the generic contract/adapter for the needed capability
and record coverage/remaining responsibilities here. Card identities and historical
exceptions remain in the rules repository.

| ID | Capability missing from imported actions | Current handling |
| --- | --- | --- |
| C01 | Declarative event subscriptions, callbacks and conditions | Developer callbacks only; explicit native-menu start |
| C02 | Legal trigger windows, priority, simultaneous triggers, Damage Step/missed timing | Human adjudication |
| C03 | Chain construction/resolution, negation, continuous-effect state | Manual release and native signals only |
| C04 | Arbitrary costs, targets, draws, LP, counters, tokens, materials and operation composition | Reject unsupported action shapes; event helpers do not make them importable |
| C05 | Protection, replacement, destruction consequences and simultaneous movement | Native movement plus human adjudication |
| C06 | Dynamic names/types/archetypes, IsAbleToHand and full legality | Printed identity snapshots and bounded filters |
| C07 | Separate independently selectable effects on one card | Overlaps blocked; current combined choice pipeline only |
| C08 | Automatic opponent control, multiplayer/tag and cross-device locking | Opponents move their cards; unsupported duel modes blocked |
| C09 | Transactional rollback, reconnect resume and command retries | Stop and reconcile manually |
| C10 | Automatic list updates, publisher verification, discovery and private URL auth | Explicit import/watch; no remote code |
