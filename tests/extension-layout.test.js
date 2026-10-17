"use strict";
const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "../extension");
const manifest = require("../extension/manifest.json");

function resource(relative, base = root) {
  const absolute = path.resolve(base, relative);
  assert.ok(absolute.startsWith(root + path.sep), "Resource stays inside extension: " + relative);
  assert.ok(fs.statSync(absolute).isFile(), "Resource exists: " + relative);
  return absolute;
}

test("all manifest entry points, icons, page resources and worker imports are packaged", () => {
  const pages = [manifest.action.default_popup, manifest.options_ui.page];
  const files = [
    ...pages, manifest.background.service_worker, ...manifest.background.scripts,
    ...Object.values(manifest.icons), ...Object.values(manifest.action.default_icon),
    ...manifest.content_scripts.flatMap(script => [...(script.js || []), ...(script.css || [])])
  ];
  files.forEach(file => resource(file));
  for (const page of pages) {
    const absolute = resource(page);
    const html = fs.readFileSync(absolute, "utf8");
    for (const match of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
      resource(match[1], path.dirname(absolute));
    }
  }
  const worker = resource(manifest.background.service_worker);
  const source = fs.readFileSync(worker, "utf8");
  for (const imports of source.matchAll(/importScripts\(([^)]+)\)/g)) {
    for (const match of imports[1].matchAll(/"([^"]+)"/g)) resource(match[1], path.dirname(worker));
  }
});
