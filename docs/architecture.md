# Architecture

The extension runs in three execution environments. It uses ordered classic
scripts in `manifest.json`; no bundler or runtime dependencies are required.

## Page integration (MAIN world)

`enhancer-core.js` contains shared settings normalization, sorting logic and
definitions. Its bundled-data dependency is supplied by its execution environment,
so the same module works in a page, a service worker and Node tests.

`content.js` coordinates startup, settings delivery, diagnostics and a shared
500 ms recovery tick. It delegates behavior to feature factories in `features/`:

| Module | Responsibility |
| --- | --- |
| `appearance.js` | Colors, background images and grid visibility |
| `rooms.js` | Room layout, carousel navigation and hosting defaults |
| `card-pools.js` | Native/custom pools, search regions and deck pool memory |
| `sorting.js` | Custom Sort control and native deck-sort integration |
| `rps.js` | RPS controls, saved modes and per-duel selection state |
| `battle-damage.js` | Incoming attack confirmation UI and pending battle lifecycle |
| `activation-costs.js` | Opt-in spell/trap activation LP payments |

Each factory receives page dependencies, a settings accessor, a command sender
and its own lifecycle bindings. Feature state stays inside the factory closure.
The coordinator isolates lifecycle failures and only notifies modules whose
`settingsKeys` changed. Settings arriving before DOM readiness update state;
DOM work begins at initialization.

`lifecycle.js` owns replaceable observers and element listeners. Features check
their native elements on recovery ticks; replacing an element disconnects its
previous binding. Features retain native selectors and hooks close to the code
that uses them. Native deck-load completion remains the normal restoration path;
polling is a fallback when that native function is unavailable.

`duel-events.js` provides a separate registration API for duel-reactive features.
See [duel events](duel-events.md) for event timing, filtering and action helpers.
`battle-damage.js` provides a separate pure calculator and ordered modifier API;
see [battle damage](battle-damage.md). It loads before the feature UI.
`activation-costs.js` contains the conservative, pure LP cost parser used by
`features/activation-costs.js`; see [activation costs](activation-costs.md).

To add a page feature, create a factory with `initialize`, optional `tick`,
`settingsChanged`, `settingsKeys` and `diagnostics`, then load it before
`content.js` in the MAIN script list. Use settings commands for persistence.
Do not add storage writes or another global polling interval to a feature.

## Settings transport (ISOLATED world)

`bridge.js` relays page commands to `settings-client.js` and relays committed
storage notifications back to the page. The existing postMessage and DOM-event
transports share request IDs so duplicate deliveries execute once. This layer
does not write storage and does not accept arbitrary preference patches from
the website.

## Persistence (extension background context)

Chrome runs `background.js` as a service worker. Firefox runs the ordered
`background.scripts` list as an event page. Dependencies load through
`importScripts` only in the worker; the event page loads them from the manifest.
Both environments use the same settings writer and command queue. Keep both
background entry points functional when changing initialization.

`background.js` is the only storage writer. It creates a `settings-store.js`
command queue shared by all site tabs and options pages. Each operation reads
the latest storage after the preceding operation commits. Failed operations
reject their caller and leave the queue available for subsequent commands.
There is no uncommitted cache to restore after the worker restarts.

`options.js` owns the settings UI. It keeps a separate saved baseline and sends
only user edits, including nested changes and removals. The worker merges those
edits into current settings, preserving newer host fields, RPS modes and deck
mappings when the user did not edit them. An explicit edit to the same field
wins in queue order. RPS mode's two stored booleans are updated together.
Edits made while a save is pending are rebased onto the committed result.

Reset explicitly replaces editable preferences and clears deck memory when
the user saves. Ordinary options saves cannot replace deck mappings. Imported
banlist arrays and ordering arrays are treated as complete edited values.

## Validation

Run `node --test` from the repository root. Tests cover core logic, native duel
dispatchers and capture fixtures, public RPS behavior, full MAIN script startup,
replaceable lifecycle bindings, native deck restoration and the real worker /
client / bridge scripts with asynchronous storage callbacks. These checks do
not replace testing an unpacked extension against the live website.

The `duelingbook/` tree is reference material rather than extension runtime code.
`bundled-banlists.js` is generated data; its generator lives in `scripts/`.
