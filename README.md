# Dueling Book Enhancer

Version 1.1.5 is a local Chrome extension for customizing Dueling Book without replacing its native duel, matchmaking, or deck-saving workflows.

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
- Disable all RPS controls and automatic picks from the Rock Paper Scissors section in settings.

Replay controls are intentionally not modified in this release.

An internal [duel event framework](docs/duel-events.md) supports future features
that react to all incoming duel messages, including card activations, attacks,
thumbs up, thinking, typing, and lifecycle events. It includes arrival/execution
stages, card/player filters, and a guarded native life-point action helper. No gameplay
automation rules are enabled by default.

## Install in Chrome

1. Unzip the download.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select the unzipped `dueling-book-enhancer` folder.
6. Open the extension menu and choose **Open settings**.
7. Reload Dueling Book after saving settings.

For later updates, replace the folder contents, then click **Reload** on the extension card in `chrome://extensions`.

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
