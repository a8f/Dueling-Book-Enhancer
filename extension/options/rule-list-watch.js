(function attach(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.DBEnhancerRuleListWatch = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";
  function create({ core, read, apply, status, schedule = callback => setTimeout(callback, 1000), cancel = clearTimeout }) {
    let generation = 0, timer, boundId, lastDefinition, active = false, failed = false;
    function stop() {
      active = false;
      generation++;
      if (timer !== undefined) cancel(timer);
      timer = undefined;
    }
    async function poll(epoch) {
      try {
        const text = await read();
        if (!active || generation !== epoch) return;
        const list = core.importAutomationList(text);
        if (boundId && list.id !== boundId) throw new Error("Local list ID changed. Stop watching and start again to select a different list.");
        const definition = core.exportAutomationList(list);
        if (definition !== lastDefinition) {
          // apply must persist through the extension's existing settings writer.
          await apply(list, () => active && generation === epoch);
          if (!active || generation !== epoch) return;
          boundId = list.id;
          lastDefinition = definition;
          status("Watching " + list.name + ". Local changes applied at " + new Date().toLocaleTimeString() + ".", "updated");
        } else if (failed) {
          status("Watching " + list.name + ". The local file is valid again; saved rules are current.", "updated");
        }
        failed = false;
      } catch (error) {
        failed = true;
        if (active && generation === epoch) status("Local update failed: " + error.message + " Keeping the last saved rules; retrying.", "error");
      } finally {
        if (active && generation === epoch) timer = schedule(() => poll(epoch));
      }
    }
    function start() {
      stop();
      active = true;
      boundId = undefined;
      lastDefinition = undefined;
      failed = false;
      const epoch = generation;
      status("Reading local rules…", "reading");
      return poll(epoch);
    }
    return { start, stop, get active() { return active; } };
  }
  function mergeList(lists, list) {
    const existing = lists.find(item => item.id === list.id);
    if (!existing && lists.length >= 50) throw new Error("At most 50 rules lists can be installed.");
    const candidate = { ...list, enabled: existing ? existing.enabled : true,
      formats: existing ? existing.formats.slice() : list.formats.slice() };
    return existing ? lists.map(item => item.id === list.id ? candidate : item) : [...lists, candidate];
  }
  return { create, mergeList };
});
