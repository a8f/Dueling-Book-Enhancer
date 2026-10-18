# Automation contracts

Status: implemented. Spec (1) is **card action version 2**. Spec (2) is
**card rule list version 4**. These replace the flat schema-3 list format.
They describe the current executor, not a complete Yu-Gi-Oh! rules engine.

## Sources and ownership

| Contract | Machine-readable source | Responsibility |
| --- | --- | --- |
| Spec (1): an action definition | [card-action-v2.schema.json](../schemas/card-action-v2.schema.json) | Complete supported prerequisites, activation costs and resolution pipeline |
| Spec (2): a portable list | [card-rule-list-v4.schema.json](../schemas/card-rule-list-v4.schema.json) | List metadata and entries containing card metadata plus a spec-(1) `action` |
| Developer callbacks and subscriptions | [automation.d.ts](../contracts/automation.d.ts) | Typed event and helper API; callbacks belong to extension code |
| Runtime validation | [enhancer-core.js](../extension/shared/enhancer-core.js) | Structural checks, identity consistency, unique rule IDs, transport limits and normalization |

The JSON Schemas use Draft 2020-12. Their `$id` values are stable identifiers,
not a promise that a schema server exists. Resolve both files locally; validation
does not require network access. Do not add `$schema` to imported documents:
unknown document fields are rejected. Configure editors with the external schema.
TypeScript types aid authors; they do not enforce lengths, uniqueness, pipeline
cardinality or all runtime conditions.

The extension owns the contract. The JSON action schema is the structural source
of truth: sync embeds its exact supported snapshot in enhancer-core, using a
small dependency-free validator for only the schema keywords present here.
That validator is internal, not a general user-provided JSON Schema interpreter.
Independent Draft 2020-12 mutation checks verify parity.

The extension owns the implementation. The extractor vendors the validator and both
schemas so it remains independently usable without an extension checkout.
`node scripts/sync-automation-contracts.mjs` updates those copies;
`node scripts/sync-automation-contracts.mjs --check` detects drift when the optional
extractor checkout is initialized. Ordinary builds/tests do not initialize or
download either submodule. The exporter, extractor and rules helper must produce
the same format; neither submodule is a runtime dependency.

## Spec (1): effect lifecycle

Action version 2 separates the semantic effect definition from native commands.
It follows the useful divisions in YGOPRO: registration/timing, activation
legality checks, activation choices, costs, targets and resolution operations.
It does not execute Lua, register arbitrary user callbacks or claim that
Duelingbook implements a simulator's rules engine.

| Field | Meaning |
| --- | --- |
| `schemaVersion` | `2`, independent of the list-envelope version |
| `source` | Source zone and acting player; the concrete source copy comes from the native menu |
| `timing` | Effect kind, turn scope, phases and explicitly manual timing verification |
| `filters` | Named card predicates used by operations/count expressions |
| `activation.checks` | Restrictions checked before declaration/cost |
| `activation.choices` | Player decisions made before declaration and retained for resolution |
| `activation.costs` | Operations with reason `cost`; payment is not resolution |
| `activation.targets` | Cards targeted at activation; empty in both supported compositions |
| `resolution` | Operations with effect semantics and references to activation choices |
| `coverage` | Required structured disclosure of remaining manual responsibilities |

The current executable subset accepts two complete compositions. The operation
vocabulary is reusable, but arbitrary compositions, new expression types and
new timing kinds are rejected until an adapter implements them. Empty stages
remain explicit. The exact cardinalities/constants are normative in the schema.
There are no list-supplied JavaScript, callbacks, native commands or URLs.

### Graveyard ignition and Deck summon

`source` is `{ "zone": "graveyard", "player": "self" }`. Timing is
`kind: "ignition"`, `turn: "self"`, `verification: "manual"`, and 1-6
unique phases from `DP SP M1 BP M2 EP`. Filters are empty. An optional activation
check has `check: "absent-face-up"` and up to 10 card identities; it scans both
ordinary fields before declaration and again before cost. An empty check array
means no such restriction. Negated continuous effects still need adjudication.

The position choice has ID `position`, kind `position`, and one or both of
`ATK`, `DEF`. Costs contain exactly
`{ "op": "banish", "card": "source", "reason": "cost" }`.
Targets are empty. Resolution contains one `special-summon` from `deck` with a
card selector, `position: { "choice": "position" }` and `reason: "effect"`.
The engine reads the selected position, declares once, confirms cost payment,
then resolves after explicit release or a fresh opponent signal.

Source/result identities may differ. Activation requires a nonempty Deck and
free monster zone but cannot prove a legal matching hidden copy exists. The
adapter uses a fresh native Deck view and a concrete instance. It picks the
first free monster zone. `IsCanBeSpecialSummoned`, replacement effects and other
legality remain manual. Cancellation cannot refund the cost.

Optional `onNoMonsterZone: { "op": "destroy", "reason": "effect" }`
expresses destruction of the matching Deck copy if the zones fill before
resolution. The adapter implements native movement to Graveyard; it does not
implement destruction consequences. A free zone is still required at activation.
Without this operation the adapter stops on a full field. Native search closure
performs the shuffle; no duplicate shuffle command is sent.

### Summon trigger with an activation choice

`source` is `{ "zone": "monster", "player": "self" }`. Timing is
`kind: "optional-trigger"`, `turn: "either"`, all six phases,
`events: ["normal-summon", "special-summon"]`, `damageStep: true` and
`verification: "manual"`. These events describe **game timing**, not normalized
website messages and not an automatic subscription. The player must establish
that a qualifying summon/window occurred, including missed timing and Damage Step.
A native summon event cannot prove that an effect is legally activatable.

`filters.monsters` requires `cardType: "monster"` and exactly one of:

- `cards`: 1-500 printed identity selectors, a static membership snapshot;
- `namePrefixes`: 1-10 prefixes, at most 80 characters each, ending with a literal
  space. This historical fallback matches case-insensitively.

Activation has no global checks, costs or targets. Its choice has ID `mode`,
kind `option` and options `search`, `destroy`. Resolution contains a `branch`
referencing `mode`; its `cases` contain the separate operations below. The
adapter checks branch availability before activation and retains the allowed
choices. Changing mode during the response wait invalidates previous approval.
Once resolution starts the mode is locked. No second declaration is sent.

The **search** operation has `from: "deck"`, `to: "hand"`,
`filter: "monsters"`, `count: 1`, `reveal: true`, `shuffle: true` and branch
`checks` for absent-face-up prohibitions. Those restrictions block only search
and are rechecked at resolution. It selects one current matching Deck monster,
adds/reveals it and closes the native view for the shuffle. Grouping identical
copies in the picker retains a concrete instance. A changed Deck or unavailable
identity cannot be replaced with cached hidden information.

The **destroy** operation has `reason: "effect"` and an explicit `selection`:
`at: "resolution"`, `from: "field"`, `players: "both"`,
`cardTypes: ["spell", "trap"]`, `minimum: 0 | 1`, and a `maximum.count`
expression counting your other face-up monsters matching `monsters`. That count
specifies `zone: "monster"`, `player: "self"`, `faceUp: true`,
`exclude: "source"`, `filter: "monsters"`. It is recomputed at resolution.
If no matching monsters/eligible cards remain, the adapter allows zero movements.
No activation targets are created: selecting at resolution is a separate concept.

Committed selections send native Target markers for visibility. Those markers
are UI annotations, not proof of rules targeting. The adapter moves your cards
sequentially and waits for the opponent to move theirs. It confirms Graveyard
placement but does not implement simultaneous destruction consequences,
protection or replacements. Hidden opponent field cards never reveal cached
names/art. Source departure after activation does not itself cancel the effect.

### Structured coverage

`coverage.level` is currently only `assisted`. Its unique `manual` codes are
required, checked against the operation composition, and rendered in the duel
panel after effect selection. A list cannot omit or claim away known limitations.
The executor also retains concrete warning text during search/destruction.

Both compositions require `activation-legality`, `responses-and-chains`,
`negation`, `replacement-and-protection`, `movement-consequences`. Ignition also
requires `special-summon-legality`. Summon choice requires `trigger-window`,
`dynamic-card-properties`, `opponent-movement`. Additional recognized manual
codes may be disclosed. These codes describe responsibilities, not implemented
capabilities or a promise of full legality. Full text lives in `AUTOMATION_MANUAL`.

An extractor result's `rule.action` follows spec (1); `rule` is a spec-(2) entry.
The report's Lua/research details are diagnostics and not importable list syntax.
Builders `banishSummonAction`/`summonChoiceAction` create the supported lifecycle
shapes; import and producer boundaries still validate them. Reviewed historical
facts retain their independent sidecar format; the compiler translates those
facts into these operations and coverage requirements.

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
      "schemaVersion": 2,
      "source": { "zone": "graveyard", "player": "self" },
      "timing": { "kind": "ignition", "turn": "self", "phases": ["M1", "M2"], "verification": "manual" },
      "filters": {},
      "activation": {
        "checks": [],
        "choices": [{ "id": "position", "kind": "position", "options": ["DEF"] }],
        "costs": [{ "op": "banish", "card": "source", "reason": "cost" }],
        "targets": []
      },
      "resolution": [{ "op": "special-summon", "from": "deck",
        "card": { "passcode": "09000002", "name": "Example Result" },
        "position": { "choice": "position" }, "reason": "effect" }],
      "coverage": {
        "level": "assisted",
        "manual": ["activation-legality", "responses-and-chains", "negation",
          "replacement-and-protection", "movement-consequences", "special-summon-legality"]
      }
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
`enabled`. Importing the same list ID replaces it after preview. Each entry ID
identifies one effect on that card, not the whole card. Use stable
IDs across revisions and publishers when referring to the same effect. Several
distinct effect IDs may match a card. The native menu then asks for an effect
before declaring, paying cost or selecting its activation mode/position.
Same-card/same-effect-ID implementations in enabled lists conflict and are
disabled in the chooser. Different IDs are treated as distinct effects even if
one publisher actually renamed an existing effect; equivalence is not inferred.
An effect choice is fixed for a run. Changing settings/game state or making a
manual action cancels a pending chooser; it also expires after 120 seconds.
The chosen adapter acquires the duel lock before it can send a command.

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
token; consumers must not mutate it. Prepared effect snapshots expose `effectId`
and `manualResponsibilities`. The effect chooser exposes `effectPicker` and
effect options before an adapter starts. Trigger snapshots additionally expose
mode/card choices/minimum/maximum; banish snapshots expose position/costPaid.

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
manual merge; the current extractor recognizes one logical effect per source
pattern and will not guess which custom effect ID to replace. Writes use a temporary file and recheck that the original has not
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

List schemas 1-3 and action schema 1 are rejected; there is no runtime migration
or fallback. The list envelope remains version 4 because its shape is unchanged;
the nested action is now version 2. Recompile through the updated extractor or
rewrite actions using the lifecycle above. Keep list ID, effect ID, card and
label stable, bump the publisher version, validate/reimport and enable again.
Export old installed data before upgrading. Invalid persisted lists are removed
from sanitized settings. The checked-in Edison list version 3.0.0 has been
converted; restart watching with that valid file if an old list was discarded.

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
| C07 | Automatic equivalence detection between publisher effect IDs | Distinct effects have a chooser; identical IDs conflict; authors maintain stable identity |
| C08 | Automatic opponent control, multiplayer/tag and cross-device locking | Opponents move their cards; unsupported duel modes blocked |
| C09 | Transactional rollback, reconnect resume and command retries | Stop and reconcile manually |
| C10 | Automatic list updates, publisher verification, discovery and private URL auth | Explicit import/watch; no remote code |
