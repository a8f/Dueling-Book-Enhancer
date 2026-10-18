"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFile, mkdir, writeFile, mkdtemp } = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");

test("runtime build uses only manifest dependencies, excluding optional repos and captures", async () => {
  const { buildExtension } = await import("../scripts/build-extension.mjs");
  const root = await mkdtemp(path.join(os.tmpdir(), "dbx-build-test-"));
  const result = await buildExtension(path.resolve(__dirname, "../extension"), root);
  assert.ok(result.files.includes("manifest.json"));
  assert.ok(result.files.includes("shared/card-automation.js"));
  assert.ok(result.files.includes("options/rule-list-download.js"));
  assert.ok(result.files.includes("options/rule-list-watch.js"));
  assert.ok(result.files.includes("options/rule-list-table.js"));
  assert.ok(result.files.includes("options/rule-card-validation.js"));
  assert.ok(!result.files.includes("card-identities.js"), "card catalog must not be bundled");
  assert.ok(result.files.includes("shared/settings-store.js"));
  assert.ok(!result.files.some(file => /^(card-rule-extractor|personal-rules|rules|duelingbook|tests|docs|\.git)\//.test(file)));
  const core = await readFile(path.join(result.output, "shared/enhancer-core.js"), "utf8");
  assert.match(core, /automationLists: \[\]/);
});

test("build needs no optional list repository or network", async () => {
  const { buildExtension } = await import("../scripts/build-extension.mjs");
  const source = await mkdtemp(path.join(os.tmpdir(), "dbx-source-test-"));
  await writeFile(path.join(source, "manifest.json"), JSON.stringify({ manifest_version: 3,
    options_ui: { page: "options.html" }, content_scripts: [{ js: ["main.js"] }] }));
  await writeFile(path.join(source, "main.js"), "// no lists required\n");
  await writeFile(path.join(source, "options.html"), '<script src="main.js"></script>');
  await mkdir(path.join(source, "personal-rules"));
  await writeFile(path.join(source, "personal-rules", "private.json"), "must not be packaged");
  await mkdir(path.join(source, "card-rule-extractor"));
  await writeFile(path.join(source, "card-rule-extractor", "extract-card-rules.mjs"), "throw new Error('optional tool must not run');");
  const result = await buildExtension(source, path.join(source, "output"));
  assert.deepEqual(result.files, ["main.js", "manifest.json", "options.html"]);
});
