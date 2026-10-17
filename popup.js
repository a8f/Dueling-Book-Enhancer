(function () {
  "use strict";
  const core = window.DBEnhancerCore;
  const client = window.DBEnhancerSettingsClient;
  const definitions = core.QUICK_SETTING_DEFINITIONS;
  const status = document.getElementById("popup-status");
  const controls = document.getElementById("quick-controls");
  const retry = document.getElementById("retry-load");
  const customize = document.getElementById("customize-shortcuts");
  const editor = document.getElementById("shortcut-editor");
  const editorControls = document.getElementById("editor-controls");
  let settings;
  let draft = [];

  function showStatus(message, error = false) {
    status.textContent = message;
    status.dataset.state = error ? "error" : "saved";
  }
  function valueOf(definition) {
    return definition.path.reduce((value, key) => value[key], settings);
  }
  function renderShortcuts() {
    const list = document.getElementById("quick-settings-list");
    list.replaceChildren();
    for (const id of settings.popupShortcuts) {
      const definition = definitions.find(item => item.id === id);
      const label = document.createElement("label");
      label.className = "quick-setting";
      const text = document.createElement("span");
      const title = document.createElement("strong");
      title.id = "quick-title-" + id;
      title.textContent = definition.label;
      const description = document.createElement("small");
      description.id = "quick-description-" + id;
      const input = document.createElement("input");
      input.type = "checkbox";
      input.dataset.setting = id;
      input.setAttribute("role", "switch");
      input.setAttribute("aria-labelledby", title.id);
      input.setAttribute("aria-describedby", description.id);
      input.checked = valueOf(definition);
      description.textContent = input.checked ? definition.on : definition.off;
      text.append(title, description);
      label.append(text, input);
      list.append(label);
    }
    document.getElementById("no-shortcuts").hidden = settings.popupShortcuts.length > 0;
  }
  function setEditing(editing) {
    editor.hidden = !editing;
    controls.hidden = editing;
    document.querySelector(".quick-heading").hidden = editing;
    document.getElementById("popup-navigation").hidden = editing;
    document.getElementById("no-shortcuts").hidden = editing || settings.popupShortcuts.length > 0;
  }
  async function load() {
    controls.disabled = true;
    customize.disabled = true;
    retry.hidden = true;
    showStatus("Loading settings...");
    try {
      settings = await client.execute({ type: "get-settings" });
      settings.popupShortcuts = core.sanitizePopupShortcuts(settings.popupShortcuts);
      document.documentElement.dataset.mode = settings.appearance.mode;
      document.documentElement.dataset.theme = settings.appearance.theme;
      renderShortcuts();
      controls.disabled = false;
      customize.disabled = false;
      showStatus("Changes save automatically");
    } catch (error) {
      showStatus("Couldn't load settings. " + error.message, true);
      retry.hidden = false;
    }
  }
  retry.addEventListener("click", load);
  controls.addEventListener("change", async event => {
    const input = event.target;
    const definition = definitions.find(item => item.id === input.dataset.setting);
    if (!definition) return;
    const previous = !input.checked;
    controls.disabled = true;
    customize.disabled = true;
    showStatus("Saving...");
    try {
      settings = await client.execute({ type: "update-preferences", changes: [{ path: [...definition.path], value: input.checked }] });
      showStatus("All changes saved");
    } catch (error) {
      input.checked = previous;
      showStatus("Couldn't save. Try the switch again. " + error.message, true);
    } finally {
      document.getElementById("quick-description-" + definition.id).textContent = input.checked ? definition.on : definition.off;
      controls.disabled = false;
      customize.disabled = false;
    }
  });
  function updateSelection() {
    const full = draft.length >= 4;
    document.querySelectorAll("[data-shortcut]").forEach(input => {
      input.disabled = full && !input.checked;
    });
    document.getElementById("shortcut-count").textContent = draft.length + " of 4 shortcuts selected";
  }
  customize.addEventListener("click", () => {
    draft = [...settings.popupShortcuts];
    const options = document.getElementById("shortcut-options");
    options.replaceChildren();
    for (const definition of definitions) {
      const label = document.createElement("label");
      label.className = "shortcut-choice";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.dataset.shortcut = definition.id;
      input.checked = draft.includes(definition.id);
      const title = document.createElement("span");
      title.textContent = definition.label;
      label.append(input, title);
      options.append(label);
    }
    setEditing(true);
    updateSelection();
    options.querySelector("input").focus();
    showStatus("Choose controls to show in this popup");
  });
  document.getElementById("shortcut-options").addEventListener("change", event => {
    const input = event.target;
    if (!input.dataset.shortcut) return;
    draft = input.checked ? [...draft, input.dataset.shortcut] : draft.filter(id => id !== input.dataset.shortcut);
    updateSelection();
  });
  document.getElementById("cancel-customization").addEventListener("click", () => {
    setEditing(false);
    customize.focus();
    showStatus("Shortcut changes discarded");
  });
  document.getElementById("save-shortcuts").addEventListener("click", async () => {
    editorControls.disabled = true;
    showStatus("Saving shortcuts...");
    try {
      settings = await client.execute({ type: "update-preferences", changes: [{ path: ["popupShortcuts"], value: [...draft] }] });
      renderShortcuts();
      setEditing(false);
      customize.focus();
      showStatus("Shortcuts saved");
    } catch (error) { showStatus("Couldn't save shortcuts. Try Save shortcuts again. " + error.message, true); }
    finally { editorControls.disabled = false; }
  });
  async function openSettings(section) {
    try {
      await client.execute({ type: "open-settings", section });
      window.close();
    } catch (error) { showStatus("Couldn't open settings. " + error.message, true); }
  }
  document.getElementById("open-settings").addEventListener("click", () => openSettings());
  document.querySelectorAll("[data-section]").forEach(button => {
    button.addEventListener("click", () => openSettings(button.dataset.section));
  });
  load();
})();
