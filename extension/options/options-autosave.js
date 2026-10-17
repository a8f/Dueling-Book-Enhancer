(function attach(root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.DBEnhancerAutosave = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function create({ baseline, read, write, store, status }) {
    let saved = baseline;
    let pending = false;
    let resetting = false;
    let operation = null;

    async function drain() {
      while (pending) {
        pending = false;
        let snapshot;
        try { snapshot = read(); }
        catch (error) {
          status("Not saved: " + error.message, "invalid");
          return;
        }
        const reset = resetting;
        const changes = reset
          ? Object.keys(snapshot).filter(key => !["deckCardpools", "schemaVersion"].includes(key)).map(key => ({ path: [key], value: snapshot[key] }))
          : store.changes(saved, snapshot);
        if (!changes.length && !reset) {
          status("All changes saved", "saved");
          continue;
        }
        status("Saving…", "saving");
        try {
          await write({ type: "update-preferences", changes, resetDeckMemory: reset });
          // Keep the form's submitted snapshot as its baseline. Re-rendering
          // would interrupt typing and turn newer site preferences into edits.
          saved = snapshot;
          if (reset) resetting = false;
          status("All changes saved", "saved");
        } catch (error) {
          pending = false;
          status("Couldn't save: " + error.message, "error");
          return;
        }
      }
    }

    function save(reset = false) {
      pending = true;
      resetting = resetting || reset;
      if (!operation) {
        // Install the promise before reading, and coalesce events from a single
        // interaction. The background owns writes after a tab is switched away.
        operation = Promise.resolve().then(drain).finally(() => { operation = null; });
      }
      return operation;
    }
    return { save, get saving() { return operation !== null; } };
  }
  return { create };
});
