import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const mode = process.argv[2];
if (process.argv.length > 3 || (mode && !["--integration", "--all"].includes(mode))) {
  console.error("Usage: node scripts/test.mjs [--integration|--all]");
  process.exit(1);
}

const directories = mode === "--all" ? ["tests", "tests/integration"]
  : mode === "--integration" ? ["tests/integration"] : ["tests"];
if (mode) {
  const required = [
    "duelingbook/main.js",
    "duelingbook/duel.js",
    "duelingbook/network-captures/first_real_game.har",
    "duelingbook/network-captures/lots_of_actions.har",
    "duelingbook/network-captures/duel_unranked_onegame.har"
  ];
  const missing = required.filter(path => !existsSync(resolve(root, path)));
  if (missing.length) {
    console.error("Integration tests require local reference files:\n" + missing.map(path => "  " + path).join("\n"));
    console.error("See docs/testing.md for setup. Run npm test for the self-contained suite.");
    process.exit(1);
  }
}

// Select only this project's suites, excluding independent nested repositories.
const files = directories.flatMap(directory => readdirSync(resolve(root, directory))
  .filter(name => name.endsWith(".test.js")).sort().map(name => resolve(root, directory, name)));
const result = spawnSync(process.execPath, ["--test", ...files], { cwd: root, stdio: "inherit" });
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
