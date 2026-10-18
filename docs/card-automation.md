# Optional card rules

The extension contains a generic interpreter, native action adapters and UI.
It ships with **no card rules installed**. Card identities, format-specific
requirements and effect definitions belong to separately maintained JSON lists.
Cloning, testing, building or loading this extension never downloads or requires
a list repository. The optional submodule is not a build dependency.

## Install and share lists

Settings shows one rule-set table with enabled state, unique card count, load
formats and export controls. Select the rule-set name to expand its card table.
Cards are grouped by passcode (or fallback database ID), display name and passcode,
are searchable by name/passcode/effect, and are paginated at 10, 25 or
50 cards per page. The format column uses a checkbox dropdown; at least one
format must remain selected. Card browsing does not change settings, and local
file updates preserve expansion, search and pagination where possible.

Under **Automation → Card rule sets**, open **Import list** in the table toolbar.
Choose a JSON file, paste its contents, or enter a public raw GitHub JSON URL and
select **Load from URL**. URL downloads request optional access to
`raw.githubusercontent.com` only when clicked. They omit browser credentials,
refuse redirects, have a timeout and a 64 KB limit, and never execute remote code.
Private repositories use file/string import; do not paste access tokens into URLs.

Review the preview, select **Install disabled**, then enable the list and select
the duel formats in which it should run. Updates are manual imports using the
same list ID; review replacements before installing. Keep an export of an old
version if you want to restore it. Exports omit local enablement. There is no
automatic polling, list discovery, update subscription or publisher verification.
The preview separately reports structurally valid programs whose native operation
handlers cannot yet be composed. They may be installed for review, but remain
unavailable in the duel UI until the runtime gains that handler composition.

Lists use schema 4 with action schema 3. Schema 1-3 lists and action schema 1-2
definitions must be converted and reimported. See the [formal contracts and upgrade
instructions](automation-contracts.md). Printed passcode and native database ID
selectors remain supported; names alone never match a card.
Invalid persisted definitions cannot execute. No specific list is recreated
automatically during settings sanitization or reset.

**Validate passcodes and names** in the import panel optionally downloads Duelingbook's
public catalog after requesting access to `static.duelingbook.com`. Validation
checks both source and resolution selectors. Known passcode/name mismatches block
import, including later previews in the same settings tab; unknown identifiers are shown
as unverified and can still be imported, including custom cards. The catalog is
not bundled, saved, downloaded at startup, or required to use the extension.
Only the checked identities remain in memory until the settings tab closes.
Permission denial or download failure does not install or replace a list and allows
retrying or ordinary offline preview/import. The duel runtime also blocks known
name mismatches before activation or summoning.

The summon-choice adapter accepts either historical `monsterNamePrefixes` or an
explicit `monsterCards` selector list generated from a simulator archetype snapshot.
`destructionMinimum` can require one selection when eligible cards remain at
resolution; its historical default is zero. Search uses the same filtered native
Deck picker for either selector form, with an art grid fallback and grouped Deck
copies. Deck-to-Graveyard effects use this same picker, grouping and confirmation
preference. A face-up public Graveyard-replacement effect prompts for the
movement only when it could apply; ordinary sends issue native Graveyard
movements directly. For field destruction, click the highlighted cards directly on the board;
click again to deselect. Gold dashes animate around eligible cards (unless reduced
motion is enabled), and selected
cards have cyan outlines. A compact panel in the bottom-right corner shows the
selection count and confirmation/cancel controls. If native card elements cannot
be located, the panel falls back to individual card choices. Field cards remain
separate choices by zone. Names/types/archetypes changed
by effects, chains, negation and replacement effects are adjudicated manually.

When multiple distinct effect entries match a card, first choose an effect.
This sends no declaration or cost. Duplicate effect IDs across enabled lists
are conflicting implementations and cannot execute. The chosen effect's manual
responsibilities appear in the panel.

The native card menu offers **Resolve now** to declare and begin resolution
after any required effect/position choice, or **Wait for opponent** to declare and wait for a fresh opponent
thumbs-up. When multiple effects are available, choose one before the card is
declared or resolution starts. A single available effect starts immediately. Summon effects
with multiple legal positions require an ATK/DEF choice before activation in
either mode; a single-position rule can start immediately. Effect/position buttons remain available
while waiting. Changing a choice invalidates pending approval and automatically
re-arms the wait. **Resolve now** remains available for manual release. Summon
timing stays manual without a confirmation checkbox. Effect choice locks when
resolution starts, and activation is sent only once.

**Automation → Confirm card selections** is off by default. A Deck-selection click
immediately applies the selected card, and the native Deck picker has no extra
confirmation panel. Enable it to select first and confirm (near the middle of the
screen for Deck selections, in the corner panel for field choices). Hand discard
costs always require confirmation before declaration and payment.
Multi-card choices finish automatically at their maximum
when confirmation is off; **Done selecting** resolves fewer selections, and
**Destroy no cards** remains available when zero is legal. This preference is
local and independent of the selected rule list and opponent-approval mode.

Finalizing field destruction selections also sends Duelingbook's native **Target**
marker for each chosen card, so both players can see the choices. Tentative
selections and deselections send no marker when confirmation is enabled.
The marker identifies the resolution choices; opponents still move their own cards.
The selection panel closes once choices are finalized, including when the maximum
is reached with confirmation off. It stays closed while field movements finish;
an interruption or timeout shows the status again.

## Local development without publishing

The optional [simulator extractor](simulator-rule-extraction.md) lives in its own
`card-rule-extractor` submodule. Its CLI uses `--write <list-path>` and an explicit
target `--ruleset`. Sourced historical mappings can correct or reconstruct card
behavior; `--research` looks up historical/revised rulings and suggests further
corrections. Ordinary extension work does not need this tool.

To iterate against a local rules checkout, run:

```sh
node scripts/serve-rule-lists.mjs personal-rules
```

The script prints URLs for the top-level JSON files, binds only to `127.0.0.1`
on port 8765, and reads each file afresh on every request. A different directory
and optional port can be provided. It serves only bounded, read-only JSON files
from that directory; it is a development helper, not public list hosting.

In **Automation → Card rules lists → Local rules development**, paste a printed
URL and select **Watch local list**. Grant the optional loopback permission if
asked. A new list is installed/enabled by this explicit development action;
an existing list keeps its current enablement. Keep the settings tab open, even
while testing in the duel tab.

Save local JSON edits normally. The watcher checks about once a second (subject
to background-tab throttling), validates changes and saves through the existing
background settings queue. Duelingbook receives the updated rules live. No Git
commit, push, reimport, version bump or duel-page reload is needed for JSON edits.
Extension JavaScript changes still require the normal extension/page reload.

Existing enablement and local format overrides are preserved, so selecting Solo
Mode once remains effective during later edits. Invalid JSON, unsupported actions,
failed reads and failed saves keep the last committed rules and show a retrying
error. Restoring a valid file recovers automatically. A change of list ID requires
stopping and starting the watcher deliberately. Rule changes invalidate prepared
duel actions; reconcile any commands already sent manually.

**Stop watching**, closing/navigating away from settings, or resetting settings
stops polling. The last saved list remains installed unless reset removes it.
Watching is session-only: it never starts automatically on browser/extension
startup. No rules source, local URL or watcher configuration is published or
bundled into the extension by this workflow.

## Formal contracts

[Automation contracts](automation-contracts.md) defines spec (1), card action
version 3, and spec (2), list version 4, with JSON Schemas and TypeScript
contracts. Each list entry contains card metadata and a nested `action`.
The document covers executable action programs, event/callback subscriptions,
validation, producer requirements, limitations, the capability backlog and
breaking upgrade instructions.

Lists remain data only. New cards using supported operations require only JSON
changes. A new operation requires a versioned contract and generic native
operation handler with protocol/lifecycle tests. No card rules are bundled.

Before execution, the runtime recursively compiles activation costs and branch
cases into an operation plan. Native executors are registered by operation name.
Timing kinds, card identities and the first resolution entry do not select an
executor, so definitions that share operations use the same runtime path.

## Duel UI and execution

Matching local graveyard cards offer **Automate effect…** beside Declare. The
panel uses imported card names, labels and available positions. It remains
discoverable outside a list's format/phase and explains why activation is blocked.
The prompt appears near the center of the screen. Select **Activate & resolve**
(the default) or **Wait for opponent**, then choose **Summon in ATK** or **Summon
in DEF**. The position click starts activation immediately: declare, pay the cost,
and either complete resolution automatically or arm a fresh opponent thumbs-up
gate. There is no second activation/resolution confirmation. Successful completion
closes the prompt. Waiting or interrupted procedures retain **Resolve now** and
cancel/re-arm controls. Canceling resolution does not refund the activation cost.

Previously held, old queued or local thumbs-up, silence and timeouts never
release a procedure. Thinking, Stop good and intervening gameplay suspend waiting.
Handle responses manually before resolving or re-arming. A native thumbs-up has
no effect identifier and is not proof of legal resolution.

Deck searches use the normal native request and its current response, never a
cached hidden identity. Summons use the chosen position and first free monster
zone. Closing the native search lets the server perform its normal shuffle;
the interpreter does not send a duplicate shuffle.

Commands execute one at a time after matching receipt/execution and an idle
native queue. A bounded journal shows completed steps. Manual interference,
disconnect/socket replacement, hidden tabs, expired waits, game or settings
changes stop further commands. There are no automatic retries, refunds or
rollbacks. Reconcile uncertain steps and finish manually; close an open search
normally to obtain its native shuffle. Replay, spectating and tag play are excluded.

Web Locks coordinate this feature across tabs on the same origin only, not across
devices, browsers, the alternate www/non-www origin or other extensions.

## Optional repositories

The `personal-rules/` Git submodule is an optional pinned development checkout
with independent history. Only its repository URL and commit pointer belong to
this repository, not the card-effect files. Ordinary clones do not download it.
Developers who want it can explicitly run `git submodule update --init personal-rules`.

The `card-rule-extractor/` submodule points to
[`a8f/dbe-sim-extractor`](https://github.com/a8f/dbe-sim-extractor) and contains the
independent simulator extractor, historical profiles and checks. Initialize it
with `git submodule update --init card-rule-extractor` only when wanted. Extension
builds and normal regression tests do not depend on either optional repository.

The extension tests use fictional card fixtures and work when the submodule is
uninitialized. Rule-specific checks live in the rules repository. The runtime-only
build (`node scripts/build-extension.mjs`) copies manifest dependencies and excludes
the submodule even when it is initialized. No runtime code fetches that repository
automatically; end users choose whether to import a URL/file/string after loading
the extension. A recursive Git clone is an explicit choice to download submodules.

Run `node scripts/test.mjs` for generic regression checks.
`DBEnhancerDiagnostics.cardAutomation()` shows the current status and journal
without exposing the searched Deck. Live-duel verification remains separate.
