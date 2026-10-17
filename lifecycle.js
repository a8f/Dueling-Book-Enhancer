(function attach(root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.DBEnhancerLifecycle = factory();
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  // A feature owns its bindings. Rebuilt SPA elements replace old bindings.
  function create(page) {
    const bindings = new Map();
    function replace(key, element, attach) {
      const previous = bindings.get(key);
      if (previous && previous.element === element) return false;
      if (previous) previous.dispose();
      bindings.delete(key);
      if (element) bindings.set(key, { element, dispose: attach(element) });
      return Boolean(previous || element);
    }
    return {
      observe(key, element, callback) {
        return replace(key, element, target => {
          const observer = new page.MutationObserver(callback);
          observer.observe(target, { attributes: true, attributeFilter: ["style", "class"] });
          return () => observer.disconnect();
        });
      },
      listen(key, element, type, callback, capture = false) {
        return replace(key, element, target => {
          target.addEventListener(type, callback, capture);
          return () => target.removeEventListener(type, callback, capture);
        });
      },
      dispose() {
        for (const binding of bindings.values()) binding.dispose();
        bindings.clear();
      }
    };
  }
  return { create };
});
