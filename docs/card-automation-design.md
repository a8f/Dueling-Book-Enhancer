# Card automation design proposal

Status: historical proposal. The implemented, normative formats and lifecycle
are in [automation contracts](automation-contracts.md). This proposal is not an
accepted schema or a backlog of promised behavior.

Implementation note: the current generic engine and optional external-list
contract are documented in [card automation](card-automation.md). Card effect
definitions are maintained outside this extension repository; none are bundled.
The schema sketch below is an earlier proposal, not the current import schema.

## Product direction

Build an opt-in assistant that performs explicitly selected card procedures using
Duelingbook's native actions. Start with a small, reliable subset of effects and
expand the supported action vocabulary over time. Lists describe procedures;
the extension owns execution, validation, and confirmation policy.

This is a path toward simulator-style execution, not initially a complete rules
engine. Matching a card or receiving an activation is insufficient to establish
legality, successful resolution, or the absence of a response. Unsupported
interactions remain manual and must be shown before execution.

No list server, opponent extension, or new network protocol is required for v1.
Native actions continue to synchronize through Duelingbook as today.

## Player interaction

Add **Resolve with automation…** beside **Declare** in the card action menu.
Also offer it near Activate / Apply effect where those actions are available.
Use the exact clicked card instance, never the last hovered card. Only offer
procedures whose card, zone, controller, format, and supported-state checks match.
Multiple effects produce a named chooser; no matching procedure leaves native
controls available. A small pending-action panel persists after the menu closes.

For an example draw procedure, the panel could read:

> Card name — Draw effect
> On resolution: draw 2 cards.
> [Resolve now] [Wait for opponent] [Cancel]

The preview names the source list/version, choices, costs already paid, actions
that will be automated, and any remaining manual steps. Do not imply complete
automation when only part of an effect is supported.

Two distinct entry paths avoid duplicate declarations:

1. **Declare & prepare** sends the appropriate native declaration/activation
   once, then prepares resolution. Declaration is publicly visible; preparing
   the local panel alone is not.
2. **Resolve existing declaration** attaches to an observed local declaration
   or activation and never declares or pays the cost again.

Separate activation and resolution explicitly. Costs and targeting belong at
activation when applicable; effect operations run after the chosen resolution
gate. Canceling or negating resolution never automatically refunds a paid cost.
Initially leave unsupported costs and targeting manual. If their completion
cannot be established from available state, ask the player to confirm completion
before arming resolution. Use a declaration receipt/execution checkpoint before
allowing a related procedure to advance.

## Confirmation without constant thumbs-up

| Mode | Behavior | Intended use |
| --- | --- | --- |
| Resolve now | The player's explicit click releases this procedure after validation | Players have already communicated that it resolves |
| Wait for opponent | Arm one procedure; a fresh opponent thumbs-up releases it after validation | Player wants the native signal to gate execution |
| Automatic | A reviewed local policy releases a supported procedure from its observed trigger | Narrow opt-in convenience actions, such as supported costs |

Default card effects to manual resolution release. Remember the player's choice
per effect in local preferences, with a visible mode label and an easy override.
Imported lists may recommend a mode but cannot enable Automatic, change an
existing preference, or override a required player choice. Existing LP-cost
automation retains its explicit opt-in.

Do not use a timeout, silence, or an already-held thumbs-up as consent. Do not
automatically treat an opponent's casual thumbs-up as approval for every effect.
In waiting mode:

- Permit only one armed procedure per local duel. Show its card and effect.
- Capture both receive and execution checkpoints when arming. Accept only a
  fresh opponent `Good` received after arming and after the declaration's native
  execution; a signal received earlier but animated later is ineligible.
- Do not use the existing `still_good` state. Require a fresh signal; a new
  held-signal event may approve only the currently armed procedure once.
- Thinking, Stop good, a response activation, or an intervening gameplay action
  before release suspends waiting. Revalidate and explicitly re-arm after the
  players resolve the interruption. Typing/chat alone does not cancel it.
- Receive-stage signals can suspend immediately, before queued animations;
  mutations wait for the necessary native execution checkpoints.
- Expiry, disconnect, leaving the duel, game reset, account change, or disabling
  the feature cancels waiting. Returning does not resume it automatically.
- Offer **Resolve now**, **Re-arm**, and **Cancel** as appropriate. Resolve now
  records the local player's instruction; it does not claim opponent approval.

A native `Good` has no effect/chain identifier in the inspected dispatcher.
The waiting-mode association is therefore a user-selected convention, not a
verified agreement or proof of legal chain resolution. V1 should describe it as
**Waiting for opponent thumbs-up**, not **Verified resolution**. Opponents can
use native controls without installing this extension.

Multiple simultaneous chain links and automatic chain-order inference are out
of scope initially. After a response, resume through an explicit player choice.
A future two-extension handshake could correlate proposal IDs and hashes, but
would need a separately researched transport and compatible implementations;
do not assume arbitrary data can be sent through Duelingbook's duel protocol.

## Execution architecture

Reuse the existing classic-script / feature-factory structure:

| Proposed module | Responsibility |
| --- | --- |
| `automation-lists.js` | Pure schema validation, import/export, normalization, conflicts |
| `automation-planner.js` | Pure matching, supported-state checks, choices and step planning |
| `automation-runtime.js` | Pending procedure state, gates, stale-state checks, command ownership |
| `duel-actions.js` | Allowlisted native action adapters, prerequisites and response matching |
| `features/card-automation.js` | Card-menu integration, preview, pending panel, lifecycle |

Load pure/runtime dependencies before feature scripts in `manifest.json`.
Use `DBEnhancerDuelEvents` for observations and the shared recovery tick for
replaceable controls. Extend its guarded action model rather than allowing
imported rules to call `Send`, page globals, or arbitrary event callbacks.

State progression:

`selected -> choices -> prepared -> waiting/ready -> executing -> completed`

Any pre-execution stage can become `suspended` or `canceled`. Execution may stop
as `partial` or `uncertain`; never represent partial completion as success.

Each run holds a unique local ID, duel/game/account generation, exact card
instances, rule content hash, gate checkpoints, choices, relevant state
fingerprint, and a bounded step journal. A changed list or relevant game state
invalidates the prepared plan and requires another preview/release.

Validate relevant prerequisites immediately before each native command. Observe
public state and the player's normally available private choices; never identify
opponent face-down cards using cached fronts. Bind chosen cards by duel instance
ID, while list matching uses database identity plus optional format/text checks.

Send one native command at a time. Wait for its expected incoming message and
native state application before planning the next step. The existing `execute`
event runs before queued native mutation, so it alone is not an after-action
checkpoint. Add a documented completion/state-settled mechanism to the event
framework or adapter, tested against the native queue; avoid fixed sleeps.

Native commands have no assumed transaction or idempotency support. On timeout,
ambiguous echo, competing manual action, or disconnect, stop and show confirmed
steps plus the uncertain step. Never retry or roll back automatically. Require
manual reconciliation before creating another run. Undo can itself be a new,
explicit native action only where its meaning is known.

Coordinate ownership with existing activation-cost, battle-damage and shuffle
features. One procedure owns each applicable payment/operation; other features
must observe that reservation and abstain. A generic event listener per imported
rule would risk charging or executing the same effect twice.

Only one executing procedure per duel across extension tabs. Before mutations,
obtain a short-lived ownership lease through the background writer. Loss of the
lease aborts further sends. After expiry or worker/browser restart, require
manual reconciliation; lease expiry cannot prove an in-flight command failed.

The page MAIN world is shared with site code, so this is not an adversarial
security boundary. Keep import, persistence and local permission changes in the
extension context, validate bridge messages, and expose only narrow runtime
operations. Do not let a page command enable packs or relax consent policies.

## Shareable rule lists

Adopt the useful list model: named packs, enable/disable toggles, local overrides,
clear provenance, versioned updates, and conflict reporting. Use structured JSON
as the editable source rather than raw JavaScript or a new text grammar in v1.
Community authors can write lists with a documented schema and sample pack.
A visual authoring editor can come later.

Illustrative v1 record (proposed schema, not executable today):

```json
{
  "schemaVersion": 1,
  "id": "community.example.draw-procedures",
  "name": "Example draw procedures",
  "author": "Example author",
  "version": "1.0.0",
  "rules": [
    {
      "id": "pot-of-greed.draw",
      "card": { "name": "Pot of Greed" },
      "effectKey": "draw",
      "label": "Draw 2 cards",
      "trigger": "user",
      "requires": { "actor": "self", "deckCountAtLeast": 2 },
      "resolution": [{ "op": "draw", "player": "self", "count": 2 }]
    }
  ]
}
```

Production rules should prefer verified Duelingbook card database IDs, with names
as readable metadata. Resolve name-only entries explicitly during import; show
missing/ambiguous names. Include optional format, source-zone, card-text/errata
fingerprints and compatibility constraints. Do not mistake a duel instance ID
for a database ID. State checks do not establish overall activation legality.

The schema has separate activation cost/target and resolution sections as support
expands. `requires` is a bounded declarative vocabulary. Actions are allowlisted
operations with validated operands, limits, and derived capabilities. No JS,
`eval`, arbitrary expressions, HTML, network fetches, loops or recursive rules.
Initially allow only locally authorized actions; a list cannot mutate the
opponent's LP or cards just because it names them.

Do not claim arbitrary effects are expressible immediately. Opponent-owned
operations stay explicit manual checklist steps in v1. For example, a procedure
requiring the opponent to gain LP cannot be labeled fully completed until that
step is observed or explicitly acknowledged as manual. Searches, random choices,
continuous modifiers, replacement effects and hidden-information interactions
need dedicated adapters and tests before becoming supported primitives.

## Import/export without hosting

- Canonical source: readable `.json` file. Offer **Export list** and **Copy share
  string**. The share form is `DBEA1:` plus base64url-encoded UTF-8 JSON. The
  prefix versions the envelope; the JSON versions the schema independently.
- Start uncompressed for simplicity. Add a distinct compressed envelope later
  only if size warrants it; enforce decoded/decompressed limits before parsing.
- **Import** accepts a pasted share string or JSON file/text and opens a preview:
  author claim, version, cards/effects, supported/unsupported operations,
  capabilities, conflicts, and changes from an installed version.
- Validate in the extension context, reject unknown executable operations and
  malformed data, bound bytes/depth/rules/steps/counts, and reject prototype keys.
  Use an explicit compatibility error rather than silently ignoring semantics.
- Install disabled; the user enables it locally after reviewing the preview.
  Permission/mode preferences never travel inside an exported list.
- Store normalized packs in `chrome.storage.local` through the existing sole
  background writer. Use a separate versioned pack key and dedicated commands;
  keep small preferences in settings and publish only needed runtime data.
  Report quota failures without losing the installed version.
- Keep exports limited to rule definitions and metadata, with no duel history,
  private deck information, player identity, or local usage preferences.
- Updating is another import with the same pack ID. Show a diff and retain the
  previous version for rollback. IDs/authors are self-asserted; content hashes
  detect changes but do not authenticate publishers. Reject same-version changed
  content as a silent update; offer an explicit reviewed replacement or fork.
- Deduplicate identical content. For competing rules for one card/effect, require
  an explicit active implementation choice; do not execute all matches or let
  import order silently replace behavior. Disabling a rule can expose a chooser
  again, but must never silently switch to another implementation mid-run.

People can share strings in messages or share JSON files anywhere. The extension
does not need to host, discover, or automatically download lists. URL-based
subscriptions can be a later optional feature with separate permission/update
design; they are unnecessary for the first release.

## Delivery stages and acceptance checks

1. **Foundation:** JSON/share-string import/export, preview, local pack storage,
   matching/conflicts and simulated previews. No imported rule sends commands.
2. **First usable release:** user-triggered local draw procedures through a
   verified adapter, both declaration entry paths, Resolve now and fresh-thumbs
   waiting, cancellation, command journal and single-tab ownership enforcement.
   Keep opponent actions, complex costs and responses manual.
3. **Broader procedures:** validated local moves, choice UI, targeting/cost
   adapters, migration of overlapping existing automations into shared command
   ownership, and selected effect-specific interaction checks.
4. **Optional expansion:** authoring UI, additional primitives, reviewed automatic
   policies and potentially an explicit two-extension proposal protocol.

Stage 2 ships only once it covers: duplicate clicks/messages, stale/held/local
thumbs-up, delayed queued signals, Thinking/responses, two active tabs, replaced
controls, disabled/updated packs, reset/reconnect/spectating, manual interference,
partial failure, ambiguous command echoes and worker restarts. Test imports and
planner logic with `node --test`; extend capture-derived event/adapter tests and
manually verify the unpacked extension in a controlled duel. A complete rules
engine would require separate chain, priority, legality, replacement and
continuous-effect models; do not hide that scope inside the list interpreter.

## Local reference basis

- [Architecture](architecture.md): feature factories, lifecycle, bridge and
  background-only storage writes.
- [Duel events](duel-events.md) and `duel-events.js`: receive vs execute timing,
  hidden-card restrictions, live guards, current LP/shuffle helpers.
- `duelingbook/duel.js`: card-menu Declare entries; queued Declare / Apply effect /
  Good / Stop good dispatch; `allGood`, `stillGood`, and `stopGood` behavior.
- [Activation costs](activation-costs.md) and `features/activation-costs.js`:
  existing opt-in cost handling and pending LP reservation.
- `features/connection-health.js`: native echo tracking and draw/card-ID caveats.
- `duelingbook/network-captures/` and current capture-derived tests: fixtures for
  validating each additional native adapter before enabling its operation.
