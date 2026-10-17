import { mkdir, mkdtemp, readFile, copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Copy the manifest's runtime dependency graph, never the whole working tree.
// Optional repositories, reference captures, tests and credentials cannot enter
// a distribution merely because they exist beside the extension source.
export async function buildExtension(source = path.join(repository, "extension"), outputRoot = path.join(repository, "dist")) {
  const manifest = JSON.parse(await readFile(path.join(source, "manifest.json"), "utf8"));
  const pending = ["manifest.json", manifest.options_ui?.page, manifest.action?.default_popup,
    manifest.background?.service_worker, ...(manifest.background?.scripts || []),
    ...Object.values(manifest.icons || {}), ...Object.values(manifest.action?.default_icon || {}),
    ...(manifest.content_scripts || []).flatMap(script => [...(script.js || []), ...(script.css || [])])].filter(Boolean);
  const files = new Set();
  while (pending.length) {
    const file = pending.pop();
    const normalized = path.posix.normalize(file);
    if (normalized.startsWith("../") || path.isAbsolute(normalized) || normalized.includes(":")) {
      throw new Error("Invalid runtime asset path: " + file);
    }
    if (files.has(normalized)) continue;
    const content = await readFile(path.join(source, normalized));
    files.add(normalized);
    if (/\.html$/.test(normalized)) {
      for (const match of content.toString("utf8").matchAll(/\b(?:src|href)=["']([^"']+)["']/g)) {
        const asset = match[1].split(/[?#]/)[0];
        if (asset && !/^(?:[a-z]+:|\/\/)/i.test(asset)) pending.push(path.posix.join(path.posix.dirname(normalized), asset));
      }
    }
  }
  await mkdir(outputRoot, { recursive: true });
  const output = await mkdtemp(path.join(outputRoot, "extension-"));
  for (const file of files) {
    const target = path.join(output, file);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(path.join(source, file), target);
  }
  return { output, files: [...files].sort() };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await buildExtension();
  console.log(result.output);
}
