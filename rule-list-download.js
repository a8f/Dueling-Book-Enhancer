(function attach(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.DBEnhancerRuleListDownload = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";
  const ORIGIN = "https://raw.githubusercontent.com/*";
  const MAX_BYTES = 65536;
  function normalizeUrl(value) {
    let url;
    try { url = new URL(value); } catch (_) { throw new Error("Enter a public raw GitHub JSON URL."); }
    if (url.protocol !== "https:" || url.hostname !== "raw.githubusercontent.com" || url.port ||
        url.username || url.password || url.search || url.hash ||
        !/^\/[^/]+\/[^/]+\/[^/]+\/.+\.json$/.test(url.pathname)) {
      throw new Error("Use a public https://raw.githubusercontent.com/owner/repository/ref/list.json URL without credentials or query parameters.");
    }
    return url.href;
  }
  async function download(value, { requestPermission, fetch: fetchImpl = globalThis.fetch }) {
    const url = normalizeUrl(value);
    // Request directly from the user click, before any network/async work.
    if (!await requestPermission({ origins: [ORIGIN] })) throw new Error("GitHub download permission was not granted. You can still paste JSON or import a file.");
    return fetchText(url, fetchImpl);
  }
  function normalizeLocalUrl(value) {
    let url;
    try { url = new URL(value); } catch (_) { throw new Error("Enter a local rules URL."); }
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.username || url.password ||
        url.search || url.hash || !/^\/[a-z0-9][a-z0-9._-]*\.json$/i.test(url.pathname)) {
      throw new Error("Use http://127.0.0.1:port/list.json for local development.");
    }
    return url.href;
  }
  async function fetchText(url, fetchImpl = globalThis.fetch) {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 15000);
    try {
      const response = await fetchImpl(url, { signal: abort.signal, credentials: "omit",
        redirect: "error", referrerPolicy: "no-referrer", cache: "no-store" });
      if (!response.ok) throw new Error("Could not download the rules list (HTTP " + response.status + ").");
      if (Number(response.headers.get("content-length")) > MAX_BYTES) throw new Error("Rules list exceeds 64 KB.");
      const reader = response.body?.getReader();
      if (!reader) throw new Error("The rules download has no readable body.");
      const chunks = [];
      let total = 0;
      while (true) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        total += chunk.byteLength;
        if (total > MAX_BYTES) { await reader.cancel(); throw new Error("Rules list exceeds 64 KB."); }
        chunks.push(chunk);
      }
      const bytes = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } finally { clearTimeout(timer); }
  }
  return { normalizeUrl, normalizeLocalUrl, download, fetchText };
});
