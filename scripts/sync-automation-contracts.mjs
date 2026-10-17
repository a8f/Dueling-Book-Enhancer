import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
export async function syncAutomationContracts({ check = false } = {}) {
  const source = await readFile(path.join(root, "extension/shared/enhancer-core.js"), "utf8");
  const formats = source.slice(source.indexOf("  const AUTOMATION_FORMATS ="), source.indexOf("  // BEGIN AUTOMATION CONTRACT"));
  const start = source.indexOf("  // BEGIN AUTOMATION CONTRACT");
  const end = source.indexOf("  // END AUTOMATION CONTRACT", start);
  const module = '// Generated from the extension contract. Run scripts/sync-automation-contracts.mjs in the extension repository.\n' +
    'const copy = value => JSON.parse(JSON.stringify(value));\n' +
    'const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);\n' +
    formats + source.slice(start, end) +
    'export default { validateAutomationAction, validateAutomationList, importAutomationList, exportAutomationList };\n';
  const artifacts = [["schema-4.mjs", module]];
  for (const name of ["card-action-v1.schema.json", "card-rule-list-v4.schema.json"]) {
    artifacts.push(["schemas/" + name, await readFile(path.join(root, "schemas", name), "utf8")]);
  }
  for (const [name, content] of artifacts) {
    const target = path.join(root, "card-rule-extractor", name);
    if (check) {
      if (await readFile(target, "utf8") !== content) throw new Error("Contract drift: card-rule-extractor/" + name);
    } else {
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, content);
    }
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).some(arg => arg !== "--check")) throw new Error("Usage: node scripts/sync-automation-contracts.mjs [--check]");
  await syncAutomationContracts({ check: process.argv.includes("--check") });
}
