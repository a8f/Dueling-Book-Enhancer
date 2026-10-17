# Dueling Book Enhancer

An unofficial browser extension for customizing Dueling Book's interface, deck tools, and duel controls.

## Features

- Hide and reorder Duel Room panels, and save hosting defaults.
- Create custom deck-sorting rules, including grouped rules and per-deck copy counts.
- Manage Card Pools, use bundled historical TCG formats, import custom banlists, and remember each deck's pool.
- Customize colors, backgrounds, and the background grid.
- Automate intro skipping, rock-paper-scissors, turn-order selection, and hand shuffling.
- Get battle damage confirmation prompts and optionally pay supported spell/trap activation costs automatically.
- See connection warnings when the site stops responding.

## Install in Chrome

Requires Chrome 121 or newer. No build step is needed.

1. Download and unzip a release, or clone this repository.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the folder containing `manifest.json`: `extension/` in this repository, or the unpacked extension folder from a release.
5. Open or refresh Dueling Book.

Click the extension's toolbar button for quick settings, or **All settings** for the full page. Settings save automatically. Use **Customize** in the popup to pin your most-used controls.

To update, replace the extension files, click **Reload** on its card in `chrome://extensions`, and refresh any open Dueling Book tabs.

## Run locally in Firefox

From the repository root:

```sh
npx web-ext run
```

On Windows PowerShell, use `npx.cmd` in place of `npx`. The root `package.json` configures `web-ext` to load `extension/`.

## Development

- `extension/` contains the installable extension.
- `tests/` contains unit and integration checks.
- `scripts/` contains test runners and asset generators.
- `docs/` contains feature references and development notes.
- `duelingbook/` contains ignored local site sources and network captures used by integration tests.

With Node.js 22 or newer, run `npm test` for self-contained checks. Use `npm run test:all` to include checks that require local site references. See [testing](docs/testing.md) for fixture setup and [architecture](docs/architecture.md) for code organization.

To package a release, archive the contents of `extension/` with `manifest.json` at the archive root.

## Documentation

- [Custom banlist JSON](docs/custom-banlists.md)
- [Battle damage](docs/battle-damage.md)
- [Activation costs](docs/activation-costs.md)
- [Duel event framework](docs/duel-events.md)
- [Diagnostics and interaction debugging](docs/interaction-debugging.md)
- [Privacy policy](PRIVACY.md)

If game controls stop responding, press **Ctrl+Alt+Shift+D** in the Dueling Book tab before refreshing to download a debug report. Reports stay local unless you share them; review the file before sharing, since error text can include page content.
