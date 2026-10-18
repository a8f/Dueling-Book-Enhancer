# Architecture

The extension runs in three execution environments. It uses ordered classic
scripts in `extension/manifest.json`; no bundler or runtime dependencies are required.

## Page integration (MAIN world)

`extension/shared/enhancer-core.js` contains shared settings normalization, sorting logic and
definitions. Its bundled-data dependency is supplied by its execution environment,
so the same module works in a page, a service worker and Node tests.

`extension/page/content.js` coordinates startup, settings delivery, diagnostics and a shared
500 ms recovery tick. It delegates behavior to feature factories in `extension/page/features/`:

| Module | Responsibility |
| --- | --- |
| `appearance.js` | Colors, background images and grid visibility |
| `rooms.js` | Room layout, carousel navigation and hosting defaults |
| `card-pools.js` | Native/custom pools, search regions and deck pool memory |
| `sorting.js` | Custom Sort control and native deck-sort integration |
| `rps.js` | RPS controls, saved modes and per-duel selection state |
| `battle-damage.js` | Incoming attack confirmation UI and pending battle lifecycle |
| `activation-costs.js` | Opt-in spell/trap activation LP payments |
| `card-automation.js` | Imported-rule card-menu actions and a generic position/resolution panel |
| `hand-shuffle.js` | Opt-in turn-draw shuffle and conservative batching of other draws |
| `connection-health.js` | Socket, heartbeat, server silence and duel response monitoring |

Hand-shuffle aggressiveness controls the draw delay (3s to 0.5s), pointer-away
duration (1s to 0.15s), and clearance (100px to 30px). The default is 80/100.
The feature wraps the native outgoing `Send` function to cancel pending work
immediately on a hand-shuffle command, including from already-bound native
handlers. Recovery ticks reinstall the hook if the site replaces `Send`.

Connection health observes the native `websocket` with event listeners and a
pass-through `send` wrapper, preserving native handlers and messages. Socket
replacement removes old listeners and restores the previous send method. It
uses the shared recovery tick, with no added polling interval or heartbeat
traffic. The banner reports offline/failed sockets, native reconnection, a
heartbeat unanswered for 15 seconds, no valid server messages for 45 seconds,
or a supported local duel command awaiting its echo for 10 seconds. Unrelated
traffic cannot acknowledge a heartbeat or duel command. Only known echoing
commands are tracked; choices such as Ready that can wait on another player
are excluded. Card instance IDs are matched where stable; draws and mills
match one response per command because queued draws can send stale top-card
IDs (as seen in the captures). Receipt acknowledges server acceptance, not
animation completion or proof of identical board state.

Timed warnings wait while the tab is hidden and get a new grace period after
resuming from suspension or returning to the tab. Native reconnection, a new
socket, a changed duel/account, or leaving a live duel clears obsolete pending
commands. The monitor never retries commands or initiates reconnects.
`DBEnhancerDiagnostics.connectionHealth()` exposes status, monotonic receive /
heartbeat timestamps, and the bounded pending-command list without retaining
raw traffic or credentials.

Each factory receives page dependencies, a settings accessor, a command sender
and its own lifecycle bindings. Feature state stays inside the factory closure.
The coordinator isolates lifecycle failures and only notifies modules whose
`settingsKeys` changed. Settings arriving before DOM readiness update state;
DOM work begins at initialization.

`extension/page/lifecycle.js` owns replaceable observers and element listeners. Features check
their native elements on recovery ticks; replacing an element disconnects its
previous binding. Features retain native selectors and hooks close to the code
that uses them. Native deck-load completion remains the normal restoration path;
polling is a fallback when that native function is unavailable.

Recovery checks avoid moving host options whose order is already correct and
skip sort-button layout while Deck Constructor is hidden. Sort layout is reused
until its native control or rail changes. Deck style/class notifications run
the same synchronization checks as recovery ticks rather than rebuilding custom
lists unconditionally; card data growth and replaced controls still trigger a
rebuild.

`extension/page/duel-events.js` provides a separate registration API for duel-reactive features.
See [duel events](duel-events.md) for event timing, filtering and action helpers.
`extension/shared/battle-damage.js` provides a separate pure calculator and ordered modifier API;
see [battle damage](battle-damage.md). It loads before the feature UI.
`extension/shared/activation-costs.js` contains the conservative, pure LP cost parser used by
`extension/page/features/activation-costs.js`; see [activation costs](activation-costs.md).
`extension/shared/card-automation.js` owns the generic card procedure runtime. Lists are validated
as data in `extension/shared/enhancer-core.js` and persist through the existing settings writer;
no page command can import or enable them. See [card automation](card-automation.md)
for optional imports, execution gates, native Deck search flow and limitations.
The runtime compiles activation costs and recursive resolution branches into an
operation plan. An operation registry assigns native executors by operation name;
card identity, timing kind and array position never choose an executor.

To add a page feature, create a factory with `initialize`, optional `tick`,
`settingsChanged`, `settingsKeys` and `diagnostics`, then load it before
`extension/page/content.js` in the MAIN script list. Use settings commands for persistence.
Do not add storage writes or another global polling interval to a feature.

## Settings transport (ISOLATED world)

`extension/bridge/bridge.js` relays page commands to `extension/shared/settings-client.js` and relays committed
storage notifications back to the page. The existing postMessage and DOM-event
transports share request IDs so duplicate deliveries execute once. This layer
does not write storage and does not accept arbitrary preference patches from
the website.

## Persistence (extension background context)

Chrome runs `extension/background/background.js` as a service worker. Firefox runs the ordered
`background.scripts` list as an event page. Dependencies load through
`importScripts` only in the worker; the event page loads them from the manifest.
Both environments use the same settings writer and command queue. Keep both
background entry points functional when changing initialization.

`extension/background/background.js` is the only storage writer. It creates a `extension/shared/settings-store.js`
command queue shared by all site tabs and options pages. Each operation reads
the latest storage after the preceding operation commits. Failed operations
reject their caller and leave the queue available for subsequent commands.
There is no uncommitted cache to restore after the worker restarts.

`extension/options/options.js` owns the settings UI. It keeps a separate saved baseline and sends
only user edits, including nested changes and removals. The worker merges those
edits into current settings, preserving newer host fields, RPS modes and deck
mappings when the user did not edit them. An explicit edit to the same field
wins in queue order. RPS mode's two stored booleans are updated together.
`extension/options/options-autosave.js` serializes automatic saves and coalesces edits made while
a write is pending. The form keeps its submitted snapshot as the baseline;
responses never rebuild controls or interrupt typing. Invalid input and storage
failures leave edits in the form, with a persistent status and a retry action.

Reset explicitly replaces editable preferences and clears deck memory when
the user confirms the reset. Ordinary options saves cannot replace deck mappings. Imported
banlist arrays and ordering arrays are treated as complete edited values.

## Validation

Run `npm test` from the repository root for self-contained checks, or
`npm run test:all` with local references installed. See [testing](testing.md)
for suite boundaries and reference setup. Tests cover core logic, native duel
dispatchers and capture fixtures, public RPS behavior, full MAIN script startup,
replaceable lifecycle bindings, native deck restoration and the real worker /
client / bridge scripts with asynchronous storage callbacks. These checks do
not replace testing an unpacked extension against the live website.

The `duelingbook/` tree is reference material rather than extension runtime code.
`extension/data/bundled-banlists.js` is generated data; its generator lives in `scripts/`.
