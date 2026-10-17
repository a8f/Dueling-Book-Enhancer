# Dueling Book Enhancer

Version 1.1.6 is a local Chrome extension for customizing Dueling Book without replacing its native duel, matchmaking, or deck-saving workflows.

## Features

- Hide and reorder Duel Room panels while keeping the three-room carousel compact.
- Keep the Host a Duel format dropdown synchronized with visible rooms; Solo Mode is always available.
- Save Host a Duel defaults and optionally preserve the last successfully hosted setup.
- Add a self-healing Custom Sort control to Deck Constructor.
- Create, reorder, group, and ungroup card-type sorting rules.
- Sort by card details, current limited status, and copies within each individual Main, Side, or Extra Deck.
- Enable, disable, and reorder Dueling Book Card Pools.
- Browse 88 date-sorted historical TCG formats sourced from Format Library, all disabled by default; Goat and Edison remain Dueling Book's native pools.
- Enable, reorder, or delete included formats, including corrected Tengu and Wind-up/REDU snapshots, and import additional JSON banlists.
- Keep enhancer-supplied Card Pools TCG-only by automatically excluding OCG-only cards from Deck Constructor searches.
- Remember the active Card Pool whenever a deck is saved.
- Restore the remembered Card Pool immediately after Dueling Book's deck-loading function completes.
- Customize interface colors, opacity, and selected background-image surfaces.
- Show or hide Dueling Book's `greenlines` background-grid layer independently of the main background.
- Choose dark or light mode and cyan, pink/lavender, or autumn settings themes.
- Reveal or mask either saved Host password with a state-matched eye icon.
- Choose a saved RPS mode: Manual, Random on tie, or Automatic.
- Click Automatic to pick randomly now, repeat after ties, and start future duels automatically. Random on tie waits for your first manual card choice.
- Disable all RPS controls and automatic picks under Automation in settings.
- Opt in to automatically choosing First whenever you can select the turn order, including after siding, under Automation → Turn order.
- Toggle Automatically go first below the turn-selection cards; it saves the same preference and enabling it chooses First immediately.
- Opt in to shuffling your hand after your first draw in your own Draw Phase, once per turn, under Automation in settings.
- Optionally batch any draws before shuffling, with an aggressiveness slider from cautious to fast. The default waits 1 second after the last draw and 0.32 seconds with the pointer at least 44 pixels from the deck/draw menu. Manual shuffling immediately cancels the pending automatic shuffle, as do hand edits, leaving the tab, or 20 seconds of waiting. This delayed option takes priority over immediate turn-draw shuffling.
- Group RPS, battle damage, and spell/trap LP costs under Automation in settings; battle damage suggestions can be disabled independently.
- Import optional card rules by duel format from JSON files, strings, or public raw GitHub URLs. The generic engine handles choices, activation costs, native actions, and optional opponent thumbs-up. No card-effect lists are included in the extension checkout or downloaded automatically. See [card automation](docs/card-automation.md).
- Iterate on local rule JSON without publishing: run `node scripts/serve-rule-lists.mjs personal-rules`, then watch a printed URL under Automation → Local rules development. Saved valid edits update live while settings stays open.
- Optionally initialize the separate `card-rule-extractor` submodule to inspect local simulator behavior and generate reviewed card rules. Use `--write <path>` to choose a list and `--ruleset` to select the target rules; historical Edison exports reject unreviewed or incompatible behavior. See [simulator rule extraction](docs/simulator-rule-extraction.md).
- Opt in to automatic LP cost payment for your own spell/trap activations. Detects clear fixed and half-LP costs in modern text and simple older Edison wording; ambiguous effects, monster effects, upkeep, and Apply effect actions stay manual. See [activation costs](docs/activation-costs.md).
- Confirm battle damage you owe with an OK/Cancel popup using current board ATK/DEF, including your own attacks into stronger monsters. Zero-damage battles stay quiet. LP changes only after OK; cancel stopped attacks or special damage effects.
- Update the open damage popup for Honest/Kalut hand activations or discards, counting each copy once and reconciling matching board stat edits. Effects are assumed to resolve; cancel if negated.
- Reopen the popup for a late Honest/Kalut discard after OK, charging only additional damage or offering a refund against LP already taken.
- Show a connection warning for offline/closed sockets, unanswered heartbeats (15 seconds), server silence (45 seconds), or supported duel actions awaiting a matching server response (10 seconds). Warnings clear when the relevant condition recovers; detection does not resend actions or force reconnection.

Replay controls are intentionally not modified in this release.

For code structure, feature extension points and settings persistence, see
[architecture](docs/architecture.md). Run self-contained regression checks with
`npm test`, or `npm run test:all` when local site references are available.
See [testing](docs/testing.md) for requirements and fixture setup.

An internal [duel event framework](docs/duel-events.md) supports future features
that react to all incoming duel messages, including card activations, attacks,
thumbs up, thinking, typing, and lifecycle events. It includes arrival/execution
stages, card/player filters, and a guarded native life-point action helper. The
battle damage popup uses this framework and a separate, extensible calculator;
see [battle damage](docs/battle-damage.md) for future effect integration.

## Install in Chrome

For a clean runtime-only build, run `node scripts/build-extension.mjs` and load
the printed directory. The build does not include or require optional rules
repositories, local captures, tests or development files. Rules can be imported
after the extension is loaded.

1. Unzip the download.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select the folder containing `manifest.json`: `extension/` in a repository checkout, or the unpacked extension folder in a release download.
6. Click the extension's toolbar button for quick settings. Choose a section shortcut or **All settings** to open the full settings page; an existing settings tab is reused. Choose **Customize** in the popup to pin up to four controls. Pinning a control does not enable it. The full page has searchable section navigation.
7. Settings save automatically as you edit them. Check for **All changes saved** before closing the settings tab. Dueling Book receives saved changes automatically.

For later updates, replace the folder contents, then click **Reload** on the extension card in `chrome://extensions`.

If you previously loaded the repository root, load `extension/` once after this
reorganization. Changing the unpacked path can change the extension ID and give
it separate settings. Record preferences you want to reapply before removing
the old entry, and keep only one entry enabled while using the site.

## Run locally in Firefox

From the repository root, run `npx.cmd web-ext run --source-dir extension` on Windows (or
`npx web-ext run --source-dir extension` on other platforms). Firefox uses the manifest's ordered
background scripts; Chrome uses its background service worker. The shared
manifest requires Chrome 121 or newer.

## Repository layout

- `extension/` is the complete installable extension, with no build step.
  `page/features/` holds site behavior, `shared/` holds reusable logic and settings
  helpers, and `background/`, `bridge/`, `options/`, and `popup/` hold their
  respective entry points. `data/` holds generated banlists; `icons/` holds assets.
- `tests/` holds self-contained checks; `tests/integration/` holds checks that
  also use local native-site sources and network captures.
- `scripts/` holds test and asset-generation tools; `docs/` explains the internals.
- `duelingbook/` is ignored local reference material; `dist/` is ignored output.
- `card-rule-extractor/` and `personal-rules/`, when present, are independent,
  optional Git checkouts. They are ignored by this repository and managed and
  tested separately. New checkouts can live beside this repository instead.

Generate assets with `node scripts/generate-bundled-banlists.mjs` and
`python scripts/generate-icons.py`; they write into `extension/data/` and
`extension/icons/`. The icon generator documents its Python dependencies.
For release packaging, archive the contents of `extension/` with `manifest.json`
at the archive root. Exclude local references, tests and tools from the package.

## Custom banlist JSON

A single object, an array of objects, or an object with a `banlists` array is accepted:

```json
{
  "name": "Example Format",
  "maxDate": "2012-09-01",
  "forbidden": ["Card Name", 12345],
  "limited": ["Card Name"],
  "semiLimited": ["Card Name"],
  "unlimited": []
}
```

Card names and numeric Dueling Book card IDs are accepted. The aliases `banned`, `semi_limited`, `semi-limited`, and Dueling Book's short `n/f/l/s/u` keys are also supported.

## Failure behavior

Missing Dueling Book controls are skipped. Custom Sort falls back to Dueling Book's original sorter if it encounters an error. A remembered Card Pool that no longer exists falls back to the first enabled native pool, while decks without a remembered pool are left unchanged.

## When game controls stop responding

Before refreshing, press **Ctrl+Alt+Shift+D** on the Duelingbook tab to download a debug report. There is no on-page debug button. Send the downloaded `duelingbook-debug-*.json` file along with what you clicked and what you expected to happen. Reload the extension and refresh existing Duelingbook tabs once after installing this update to enable reporting.

The report includes recent click/command/server-event summaries, errors, connection status, native click guards, animation queue state, automation settings, player LP/card counts, and control visibility/pointer hit tests. Warnings are also logged to the browser console when a control sends no command, a queue head remains unchanged for 15 seconds, or a supported command (including End/Start turn) awaits its echo for 10 seconds. These are diagnostic signals; animations, deliberate waits and disabled controls can also trigger them. The add-on does not retry game actions or change the site's queue/lock flags.

Reports are created locally and never uploaded automatically. Structured state excludes passwords, chat, account names, card identities, deck contents and raw network messages. Error messages/stacks can contain page-provided text; review the file before sharing. History keeps at most 300 entries in memory for this tab and clears on refresh. Developer-console alternatives: `DBEnhancerDiagnostics.snapshot()` returns the report object and `DBEnhancerDiagnostics.download()` downloads it. See the [interaction audit](docs/interaction-debugging.md).
