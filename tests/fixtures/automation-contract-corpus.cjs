// Synthetic schema/validator parity corpus. Also consumed by the optional Python check.
const core = require("../../extension/shared/enhancer-core.js");
const card = { passcode: "09000002", name: "Example Result" };
const banish = core.banishSummonAction({ card, absentFaceUpCards: [{ id: 9, name: "Example Blocker" }], onNoMonsterZone: "destroy" });
const trigger = core.summonChoiceAction({ monsterCards: [card], destructionMinimum: 1 });
const prefix = structuredClone(trigger);
delete prefix.filters.monsters.cards;
prefix.filters.monsters.namePrefixes = ["Example "];
const list = action => ({ schemaVersion: 4, id: "example", name: "Example list", version: "1.0.0", formats: ["so"], enabled: false,
  rules: [{ id: "effect", card: { id: 8, name: "Example Source" }, label: "Example effect", action }] });

function corpus() {
  const cases = [];
  const add = (kind, value, path) => {
    let valid = true;
    try { core[kind === "action" ? "validateAutomationAction" : "validateAutomationList"](value); }
    catch { valid = false; }
    cases.push({ kind, value, valid, path });
  };
  for (const action of [banish, trigger, prefix]) {
    for (const [kind, original] of [["action", action], ["list", list(action)]]) {
      add(kind, original, "baseline");
      function visit(value, path = []) {
        if (value && typeof value === "object") {
          if (!Array.isArray(value)) {
            const extra = structuredClone(original);
            let node = extra; for (const key of path) node = node[key];
            node.unsupported = true; add(kind, extra, [...path, "unsupported"]);
          }
          for (const key of Object.keys(value)) {
            const missing = structuredClone(original);
            let node = missing; for (const segment of path) node = node[segment];
            if (Array.isArray(node)) node.splice(Number(key), 1); else delete node[key];
            add(kind, missing, [...path, key, "missing"]);
            visit(value[key], [...path, key]);
          }
        }
        for (const replacement of [null, false, true, 0, 1, -1, 4, "", "unknown", {}, []]) {
          if (!path.length) { add(kind, replacement, ["root"]); continue; }
          const changed = structuredClone(original);
          let node = changed; for (const segment of path.slice(0, -1)) node = node[segment];
          node[path.at(-1)] = replacement; add(kind, changed, path);
        }
      }
      visit(original);
    }
  }
  return cases;
}
module.exports = { corpus };
if (require.main === module) process.stdout.write(JSON.stringify(corpus()));
