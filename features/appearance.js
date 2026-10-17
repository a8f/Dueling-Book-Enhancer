(function attach(root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory;
  else (root.DBEnhancerFeatures ||= {})["appearance"] = factory;
})(typeof window !== "undefined" ? window : globalThis, function createFeature(context) {
  "use strict";
  const { window, document, core, postToBridge, isVisible, lifecycle } = context;
  const state = {
    get settings() { return context.getSettings(); },
    appliedColors: []
  };
  function restoreAppliedColors() {
    state.appliedColors.forEach(function restoreColor(record) {
      if (!record.element || !record.element.style) return;
      record.element.style.setProperty(
        record.property,
        record.originalValue,
        record.originalPriority
      );
      if (!record.originalValue) {
        record.element.style.removeProperty(record.property);
      }
    });
    state.appliedColors = [];
  }

  function applyCustomColors() {
    restoreAppliedColors();

    core.COLOR_DEFINITIONS.forEach(function applyDefinition(definition) {
      const override = state.settings.customColors[definition.key];
      if (!override) return;
      const defaults = core.splitColorValue(definition.defaultValue);
      const color = override.color || defaults.color;
      const opacity =
        override.opacity === undefined ? defaults.opacity : override.opacity;
      const value = core.composeColor(color, opacity);
      if (window.CSS && !window.CSS.supports("color", value)) return;

      document.querySelectorAll(definition.selector).forEach(function colorElement(
        element
      ) {
        state.appliedColors.push({
          element: element,
          property: definition.property,
          originalValue: element.style.getPropertyValue(definition.property),
          originalPriority: element.style.getPropertyPriority(definition.property)
        });
        element.style.setProperty(definition.property, value, "important");
        if (override.imageData && definition.imageAspect) {
          ["background-image", "background-size", "background-position", "background-repeat"].forEach(function rememberImageProperty(property) {
            state.appliedColors.push({
              element: element,
              property: property,
              originalValue: element.style.getPropertyValue(property),
              originalPriority: element.style.getPropertyPriority(property)
            });
          });
          const tint = "linear-gradient(" + value + ", " + value + ")";
          element.style.setProperty("background-image", tint + ", url(\"" + override.imageData + "\")", "important");
          element.style.setProperty("background-size", "cover", "important");
          element.style.setProperty("background-position", "center", "important");
          element.style.setProperty("background-repeat", "no-repeat", "important");
        }
      });
    });
  }

  function applyGridLineVisibility() {
    document.documentElement.classList.toggle(
      "dbx-hide-greenlines",
      !state.settings.showGridLines
    );
  }


  function apply() { applyCustomColors(); applyGridLineVisibility(); }
  return {
    initialize: apply,
    settingsKeys: ["customColors", "showGridLines"],
    settingsChanged() { if (context.isStarted()) apply(); }
  };

});
