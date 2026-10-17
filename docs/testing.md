# Testing

Use Node.js 22 or newer. No npm dependencies or install step are required.
Run commands from the repository root:

```sh
npm test
npm run test:integration
npm run test:all
```

The same commands work without npm as `node scripts/test.mjs`,
`node scripts/test.mjs --integration`, and `node scripts/test.mjs --all`.
The runner selects this repository's test files explicitly so it does not
discover tests in independent nested checkouts.

## Self-contained tests

`tests/*.test.js` covers shared logic, settings persistence and transport,
page startup, lifecycle handling, diagnostics, deck memory, and packaged file
references. This suite runs on a fresh clone without Duelingbook reference data.

## Reference integration tests

`tests/integration/*.test.js` exercises native Duelingbook functions and recorded
network messages. Some files also contain related synthetic regression cases;
the full suite runs all of these checks.

These tests require the following local files:

```text
duelingbook/
  main.js
  duel.js
  network-captures/
    first_real_game.har
    lots_of_actions.har
    duel_unranked_onegame.har
```

Restore these files from your existing local reference collection, preserving
the paths above. They are ignored and are not distributed with the extension.
There is no automatic download or capture-generation step. The integration
runner reports missing files before starting tests; it does not silently skip
them. The self-contained suite remains available when references are absent.

These checks do not replace loading `extension/` unpacked and testing against
the live site in Chrome and Firefox. Chrome uses the background worker; Firefox
uses the manifest's ordered background scripts.
