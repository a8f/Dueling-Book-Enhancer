import http from "node:http";
import path from "node:path";
import { realpath, readdir, open } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export async function serveRuleLists(directory, port = 8765) {
  const root = await realpath(directory);
  const server = http.createServer(async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    const fail = (status, message) => { response.writeHead(status, { "Content-Type": "text/plain" }); response.end(message); };
    // Limit browser access to extension origins; ordinary websites cannot read
    // or write these local files. No Access-Control-Allow-Origin for web origins.
    const origin = request.headers.origin;
    if (origin && /^(chrome|moz)-extension:\/\/[a-z0-9-]+$/i.test(origin)) response.setHeader("Access-Control-Allow-Origin", origin);
    else if (origin) { fail(403, "Extension origin required"); return; }
    const expectedHost = "127.0.0.1:" + server.address().port;
    if (request.headers.host !== expectedHost) { fail(403, "Loopback host required"); return; }
    if (request.method !== "GET") { fail(405, "Read-only server"); return; }
    const filename = request.url?.slice(1);
    if (!filename || !/^[a-z0-9][a-z0-9._-]*\.json$/i.test(filename)) { fail(404, "Select a top-level JSON file"); return; }
    let handle;
    try {
      const file = await realpath(path.join(root, filename));
      const relative = path.relative(root, file);
      if (path.isAbsolute(relative) || relative.startsWith("..") || relative.includes(path.sep)) { fail(403, "File outside rules directory"); return; }
      handle = await open(file, "r");
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > 65536) { fail(413, "Rules list exceeds 64 KB"); return; }
      // Bounded read also protects against a file growing after stat().
      const bytes = Buffer.alloc(65537);
      let count = 0;
      while (count < bytes.length) {
        const result = await handle.read(bytes, count, bytes.length - count, count);
        if (!result.bytesRead) break;
        count += result.bytesRead;
      }
      if (count > 65536) { fail(413, "Rules list exceeds 64 KB"); return; }
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(bytes.subarray(0, count));
    } catch (_) { fail(404, "JSON file unavailable"); }
    finally { if (handle) await handle.close(); }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error("Usage: node scripts/serve-rule-lists.mjs <rules-directory> [port]");
  const server = await serveRuleLists(process.argv[2], Number(process.argv[3] || 8765));
  for (const file of await readdir(process.argv[2])) {
    if (/^[a-z0-9][a-z0-9._-]*\.json$/i.test(file)) console.log("http://127.0.0.1:" + server.address().port + "/" + file);
  }
  console.log("Local rules server running. Save JSON edits; the extension reads them on its next poll. Ctrl+C to stop.");
}
