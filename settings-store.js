(function attach(root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.DBEnhancerSettingsStore = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const copy = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const forbidden = new Set(["__proto__", "constructor", "prototype"]);

  // Only editable preferences are diffed. Runtime deck mappings belong to the
  // deck-memory command, even when an options page has an old copy of them.
  function changes(baseline, candidate) {
    const result = [];
    function visit(before, after, path) {
      if (equal(before, after)) return;
      if (object(after) && (before === undefined || object(before))) {
        for (const key of new Set([...Object.keys(before || {}), ...Object.keys(after)])) {
          if (!forbidden.has(key)) visit(before && before[key], after[key], [...path, key]);
        }
      } else result.push(after === undefined ? { path, remove: true } : { path, value: copy(after) });
    }
    for (const key of Object.keys(candidate)) {
      if (!["schemaVersion", "deckCardpools", "autoStartRps", "autoPickRps"].includes(key) && !forbidden.has(key)) {
        visit(baseline[key], candidate[key], [key]);
      }
    }
    // These booleans encode one mode and must be changed together.
    if (baseline.autoStartRps !== candidate.autoStartRps || baseline.autoPickRps !== candidate.autoPickRps) {
      result.push({ path: ["autoStartRps"], value: candidate.autoStartRps });
      result.push({ path: ["autoPickRps"], value: candidate.autoPickRps });
    }
    return result;
  }

  function applyChanges(settings, updates) {
    const result = copy(settings);
    if (!Array.isArray(updates) || updates.length > 10000) throw new Error("Invalid settings changes.");
    for (const update of updates) {
      const path = update && update.path;
      if (!Array.isArray(path) || !path.length || path.length > 8 ||
          path.some(key => typeof key !== "string" || forbidden.has(key)) ||
          !Object.hasOwn(result, path[0]) || ["deckCardpools", "schemaVersion"].includes(path[0])) {
        throw new Error("Invalid settings path.");
      }
      let target = result;
      for (const key of path.slice(0, -1)) {
        if (!object(target[key])) target[key] = {};
        target = target[key];
      }
      if (update.remove) delete target[path.at(-1)];
      else target[path.at(-1)] = copy(update.value);
    }
    return result;
  }

  function reduce(core, stored, command, allowOptions) {
    const settings = core.sanitizeSettings(stored);
    switch (command.type) {
      case "update-preferences":
        if (!allowOptions) throw new Error("Preferences must come from the extension settings page.");
        if (command.resetDeckMemory === true) settings.deckCardpools = {};
        return core.sanitizeSettings(applyChanges(settings, command.changes));
      case "save-host-defaults":
        if (settings.hostDefaults.preserveLastUsed && object(command.hostDefaults)) {
          settings.hostDefaults = { ...settings.hostDefaults, ...command.hostDefaults, preserveLastUsed: true };
        }
        break;
      case "save-deck-cardpool": {
        const id = String(command.deckId || "");
        const descriptor = core.sanitizeCardpoolDescriptor(command.cardpool);
        if (settings.rememberCardList && /^\d+$/.test(id) && descriptor) settings.deckCardpools[id] = descriptor;
        break;
      }
      case "save-rps-mode":
        if (!["manual", "repeat", "automatic"].includes(command.mode)) throw new Error("Invalid RPS mode.");
        settings.autoStartRps = command.mode === "automatic";
        settings.autoPickRps = command.mode !== "manual";
        break;
      case "save-auto-pick-rps":
      case "save-auto-start-rps":
        if (typeof command.enabled !== "boolean") throw new Error("Invalid RPS preference.");
        settings[command.type === "save-auto-start-rps" ? "autoStartRps" : "autoPickRps"] = command.enabled;
        if (command.type === "save-auto-pick-rps" && !command.enabled) settings.autoStartRps = false;
        break;
      default: throw new Error("Unknown settings command.");
    }
    return core.sanitizeSettings(settings);
  }

  function create({ core, read, write }) {
    let queue = Promise.resolve();
    function execute(command, allowOptions = false) {
      // Read only after preceding writes finish. The queue owns reads as well,
      // so a request after a command sees its committed result.
      const operation = queue.then(async () => {
        const stored = await read();
        if (command.type === "get-settings") return core.sanitizeSettings(stored);
        const settings = reduce(core, stored, command, allowOptions);
        await write(settings);
        return settings;
      });
      queue = operation.catch(() => {});
      return operation;
    }
    return { execute };
  }
  return { create, changes, applyChanges };
});
