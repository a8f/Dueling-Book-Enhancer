# Optional simulator extractor

The extractor lives in [`a8f/dbe-sim-extractor`](https://github.com/a8f/dbe-sim-extractor),
checked out as the optional `card-rule-extractor/` submodule. Its generic implementation,
format/source profiles and synthetic checks are independent of the extension.
Actual card reviews live exclusively in the separate card-rules repository. Normal
extension builds, regression tests and runtime do not require it.

Initialize only when wanted (Node.js 22.13+):

```powershell
git submodule update --init card-rule-extractor
```

Preview installed simulator behavior:

```powershell
node card-rule-extractor/extract-card-rules.mjs 09411399
```

Choose a target ruleset and any existing destination list:

```powershell
node card-rule-extractor/extract-card-rules.mjs 09411399 --ruleset edison --write personal-rules/edison.json
```

There is no hardcoded destination. Multiple IDs can be space- or comma-separated.
You can also supply a quoted card name or repeat `--name "card name"`, including
in commands that write a list. Names are resolved from the simulator's local
`cards.cdb`: full names ignore case and spacing, and unique partial names work.
Quote each name separately when mixing names and IDs. Ambiguous names return
candidate names/passcodes and prevent the batch write; no card is chosen silently.
The optional personal-rules checkout must also exist for the example above.
Full usage and review policy: [extractor README](../card-rule-extractor/README.md).

Card-specific historical facts and corrections live in
`personal-rules/edison.reviews.json` in db-auto-card-rules. Writes infer that sidecar
beside `personal-rules/edison.json`; previews select it with `--reviews`. The generic
compiler can correct/reconstruct historical effects independently of modern Lua.
It validates the external review again before writing.

Edison runs automatically fetch missing source data from the card-specific
historical sections and the public JSON used by edisonformat.net. The ignored
`card-rule-extractor/.cache/rulings/` directory retains this data indefinitely,
without automatic expiry. `--refresh-rulings` fetches new copies; `--clear-cache`
(or manually deleting the cache) clears it. Third-party source JSON/HTML is never
bundled or committed. Simulator previews can request lookup with `--research`.

Reports separate historical/revised policies and suggest recognized corrections.
Unknown clauses remain available for review and new generic adapters. Card
identities, reviewed exceptions and comparison notes belong in db-auto-card-rules,
not in extractor code or its format profiles.

Reload the extension after adding these JavaScript adapters, then use the local
watcher for subsequent JSON changes. Old extension versions reject the new fields.

The `edison` profile targets the original Master Rule era and April 2010 TCG
rulings and requires per-card historical review. Switching master rules does not
restore old card errata. `simulator` extracts installed behavior without a
historical claim and cannot write lists containing Edison formats (`er`/`eu`).
Neither profile changes simulator configuration or enforces global timing,
first-turn draw or Field Spell rules. Native Edison mode and manual adjudication
remain responsible for those rules.

Successful writes can flow through the existing
[local watcher](card-automation.md#local-development-without-publishing):

```powershell
node scripts/serve-rule-lists.mjs personal-rules
```

The extractor's checks run separately from the extension's `node --test`:

```powershell
node --test card-rule-extractor/checks/*.check.mjs
```
