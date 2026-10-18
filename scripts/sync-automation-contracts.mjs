import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
export async function syncAutomationContracts({ check = false } = {}) {
  const coreFile = path.join(root, "extension/shared/enhancer-core.js");
  let source = (await readFile(coreFile, "utf8")).replaceAll("\r\n", "\n");
  const actionSchema = JSON.parse(await readFile(path.join(root, "schemas/card-action-v3.schema.json"), "utf8"));
  // The embedded validator deliberately implements only this closed subset.
  // Refuse schema features it cannot interpret instead of silently accepting them.
  const keywords = new Set(["$schema", "$id", "$ref", "$defs", "title", "description", "type", "properties",
    "required", "additionalProperties", "const", "enum", "allOf", "oneOf", "not", "items", "minItems",
    "maxItems", "uniqueItems", "contains", "maxLength", "pattern", "minimum", "maximum"]);
  function supportedSchema(schema) {
    for (const key of Object.keys(schema)) if (!keywords.has(key)) throw new Error("Unsupported embedded schema keyword: " + key);
    if (schema.type && !["object", "array", "integer", "string"].includes(schema.type)) throw new Error("Unsupported embedded schema type");
    if (schema.$ref && (!schema.$ref.startsWith("#/$defs/") || !Object.hasOwn(actionSchema.$defs, schema.$ref.slice(8))))
      throw new Error("Unsupported embedded schema reference: " + schema.$ref);
    if (Object.hasOwn(schema, "const") && typeof schema.const === "object") throw new Error("Object/array constants require validator support");
    if (schema.enum?.some(value => typeof value === "object")) throw new Error("Object/array enums require validator support");
    for (const key of ["properties", "$defs"]) for (const child of Object.values(schema[key] || {})) supportedSchema(child);
    if (schema.additionalProperties && typeof schema.additionalProperties === "object") supportedSchema(schema.additionalProperties);
    for (const key of ["allOf", "oneOf"]) for (const child of schema[key] || []) supportedSchema(child);
    for (const key of ["not", "items", "contains"]) if (schema[key]) supportedSchema(schema[key]);
  }
  supportedSchema(actionSchema);
  const embedded = "  const AUTOMATION_ACTION_SCHEMA = " + JSON.stringify(actionSchema) + ";";
  const updated = source.replace(/  const AUTOMATION_ACTION_SCHEMA = [^\n]+;/, embedded);
  if (check && updated !== source) throw new Error("Contract drift: embedded action schema");
  if (!check && updated !== source) { await writeFile(coreFile, updated); source = updated; }
  const formats = source.slice(source.indexOf("  const AUTOMATION_FORMATS ="), source.indexOf("  // BEGIN AUTOMATION CONTRACT"));
  const start = source.indexOf("  // BEGIN AUTOMATION CONTRACT");
  const end = source.indexOf("  // END AUTOMATION CONTRACT", start);
  const module = '// Generated from the extension contract. Run scripts/sync-automation-contracts.mjs in the extension repository.\n' +
    'const copy = value => JSON.parse(JSON.stringify(value));\n' +
    'const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);\n' +
    formats + source.slice(start, end) +
    'export default { AUTOMATION_MANUAL, banishSummonAction, summonChoiceAction, discardSendAction, validateAutomationAction, validateAutomationList, importAutomationList, exportAutomationList };\n';
  const artifacts = [["schema-4.mjs", module]];
  for (const name of ["card-action-v3.schema.json", "card-rule-list-v4.schema.json"]) {
    artifacts.push(["schemas/" + name, (await readFile(path.join(root, "schemas", name), "utf8")).replaceAll("\r\n", "\n")]);
  }
  for (const [name, content] of artifacts) {
    const target = path.join(root, "card-rule-extractor", name);
    if (check) {
      if ((await readFile(target, "utf8")).replaceAll("\r\n", "\n") !== content) throw new Error("Contract drift: card-rule-extractor/" + name);
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
