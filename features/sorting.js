(function attach(root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory;
  else (root.DBEnhancerFeatures ||= {})["sorting"] = factory;
})(typeof window !== "undefined" ? window : globalThis, function createFeature(context) {
  "use strict";
  const { window, document, core, postToBridge, isVisible, lifecycle } = context;
  const state = {
    get settings() { return context.getSettings(); },

  };
  function dBDeckSortIsReady() {
    return (
      Array.isArray(window.deck_filled_arr) &&
      Array.isArray(window.side_filled_arr) &&
      Array.isArray(window.extra_filled_arr) &&
      typeof window.sortCards2 === "function" &&
      typeof window.initializeDeckCards === "function" &&
      typeof window.setUnsavedChanges === "function"
    );
  }

  function setCurrentLimitedStatuses(cards) {
    if (typeof window.getLimit !== "function") return;
    const ocg = Boolean(
      document.querySelector("#deck_constructor .ocg_limit_rb:checked")
    );
    cards.forEach(function setCardLimit(card) {
      const id = core.readCardValue(card, "id");
      const baseLimit = core.readCardValue(card, ocg ? "ocg_limit" : "tcg_limit");
      const rush = core.readCardValue(card, "rush");
      let limit = window.getLimit(id, baseLimit, rush);
      if (limit === null || limit === undefined) limit = 3;
      if (card && typeof card.data === "function") card.data("dbx_limit", limit);
      else if (card) card.dbx_limit = limit;
    });
  }

  function copyCountKey(card) {
    const name = String(core.readCardValue(card, "name") || "")
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
    if (name) return "name:" + name;
    const id = core.readCardValue(card, "id");
    if (id !== undefined && id !== null && String(id) !== "") {
      return "id:" + String(id);
    }
    return "unknown";
  }

  function setCurrentCopyCounts(cards) {
    const counts = new Map();
    cards.forEach(function countCard(card) {
      const key = copyCountKey(card);
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    cards.forEach(function assignCopyCount(card) {
      const count = counts.get(copyCountKey(card)) || 1;
      if (card && typeof card.data === "function") {
        card.data("dbx_copy_count", count);
      } else if (card) {
        card.dbx_copy_count = count;
      }
    });
  }

  function runCustomSort() {
    if (!dBDeckSortIsReady()) {
      throw new Error("Dueling Book deck data is not ready.");
    }

    const originalComparator = window.sortCards2;
    const customSort = state.settings.customSort;
    const allDeckCards = window.deck_filled_arr.concat(
      window.side_filled_arr,
      window.extra_filled_arr
    );
    setCurrentLimitedStatuses(allDeckCards);
    if (core.customSortUsesDefaults(customSort)) {
      window.deck_filled_arr.sort(originalComparator);
      window.side_filled_arr.sort(originalComparator);
      window.extra_filled_arr.sort(originalComparator);
    } else {
      const comparator = function configuredComparator(firstCard, secondCard) {
        return core.compareCards(
          firstCard,
          secondCard,
          customSort,
          originalComparator
        );
      };
      setCurrentCopyCounts(window.deck_filled_arr);
      window.deck_filled_arr.sort(comparator);
      setCurrentCopyCounts(window.side_filled_arr);
      window.side_filled_arr.sort(comparator);
      setCurrentCopyCounts(window.extra_filled_arr);
      window.extra_filled_arr.sort(comparator);
    }

    window.initializeDeckCards();
    window.setUnsavedChanges();
  }

  function customSortClicked(event) {
    event.preventDefault();
    event.stopPropagation();

    try {
      runCustomSort();
    } catch (error) {
      window.DBEnhancerDebug?.error("custom-sort-error", error);
      console.error(
        "[Dueling Book Enhancer] Custom sort failed; using Dueling Book's original sort.",
        error
      );

      if (typeof window.sortDeck === "function") window.sortDeck();
    }
  }

  function numericStyle(element, property) {
    if (!element) return NaN;
    return Number.parseFloat(window.getComputedStyle(element)[property]);
  }

  function findDeckRailControl(deckConstructor, className, imageAlt) {
    if (!deckConstructor) return null;

    const classMatch = deckConstructor.querySelector(
      ".deck_bg > ." + className + ", .deck_bg ." + className
    );
    if (classMatch) return classMatch;

    const images = deckConstructor.querySelectorAll(".deck_bg img[alt]");
    for (let index = 0; index < images.length; index += 1) {
      if (
        String(images[index].getAttribute("alt") || "").toLowerCase() ===
        String(imageAlt || "").toLowerCase()
      ) {
        return images[index].closest("div");
      }
    }

    return null;
  }

  let positionedLayout = null;
  function positionCustomSortInStack(button) {
    const deckConstructor = document.getElementById("deck_constructor");
    const sortButton = findDeckRailControl(deckConstructor, "sort_btn", "Sort");
    const randomizeButton = findDeckRailControl(
      deckConstructor,
      "info_btn",
      "Randomize"
    );
    if (!button || !sortButton) return false;

    const rail = sortButton.parentElement;
    if (!rail) return false;
    const lowerButtons = Array.from(rail.querySelectorAll(
      ":scope > .info_btn, :scope > .locked_btn, :scope > .unlocked_btn, :scope > .skill_btn"
    ));
    const tooltips = Array.from(document.querySelectorAll("#randomize_tooltip, #lock_tooltip, #skill_tooltip"));
    const layout = [button, rail, sortButton, sortButton.style.cssText, randomizeButton, ...lowerButtons, ...tooltips];
    if (button.parentElement === rail && positionedLayout &&
        layout.length === positionedLayout.length && layout.every((value, index) => value === positionedLayout[index])) return true;
    if (button.parentElement !== rail) rail.appendChild(button);

    const sortTop = numericStyle(sortButton, "top");
    const randomizeTop = randomizeButton
      ? Number.parseFloat(
          randomizeButton.dataset.dbxOriginalTop || numericStyle(randomizeButton, "top")
        )
      : NaN;
    const sortHeight = numericStyle(sortButton, "height");
    const rowGap =
      Number.isFinite(randomizeTop - sortTop) && randomizeTop > sortTop
        ? randomizeTop - sortTop
        : (Number.isFinite(sortHeight) ? sortHeight : 27) + 5;
    const customTop = Number.isFinite(randomizeTop) ? randomizeTop : sortTop + rowGap;

    lowerButtons
      .forEach(function shiftLowerRailButton(railButton) {
        const originalTop = Number.parseFloat(
          railButton.dataset.dbxOriginalTop || numericStyle(railButton, "top")
        );
        if (!Number.isFinite(originalTop)) return;
        railButton.dataset.dbxOriginalTop = String(originalTop);
        railButton.style.top = originalTop + rowGap + "px";
      });

    tooltips
      .forEach(function shiftLowerRailTooltip(tooltip) {
        const originalTop = Number.parseFloat(
          tooltip.dataset.dbxOriginalTop || numericStyle(tooltip, "top")
        );
        if (!Number.isFinite(originalTop)) return;
        tooltip.dataset.dbxOriginalTop = String(originalTop);
        tooltip.style.top = originalTop + rowGap + "px";
      });

    const sortStyle = window.getComputedStyle(sortButton);
    button.style.position = "absolute";
    button.style.left = sortStyle.left;
    button.style.top = customTop + "px";
    button.style.width = sortStyle.width;
    button.style.height = sortStyle.height;
    button.style.display = "flex";
    positionedLayout = layout;
    return true;
  }

  function ensureCustomSortButton() {
    const existing = document.getElementById("dbx-custom-sort-button");
    if (existing) {
      positionCustomSortInStack(existing);
      updateCustomSortButtonVisibility();
      return;
    }

    const deckConstructor = document.getElementById("deck_constructor");
    const sortButton = findDeckRailControl(deckConstructor, "sort_btn", "Sort");
    if (!deckConstructor || !sortButton) {
      return;
    }

    const button = document.createElement("div");
    button.id = "dbx-custom-sort-button";
    button.className = "dbx-custom-sort-rail-button";
    button.textContent = "⇅";
    button.title = "Custom Sort";
    button.setAttribute("aria-label", "Custom Sort");
    button.setAttribute("role", "button");
    button.tabIndex = 0;
    button.addEventListener("click", customSortClicked);
    button.addEventListener("keydown", function customSortKeyPressed(event) {
      if (event.key !== "Enter" && event.key !== " ") return;
      customSortClicked(event);
    });
    sortButton.parentElement.appendChild(button);
    positionCustomSortInStack(button);
    updateCustomSortButtonVisibility();
  }

  function updateCustomSortButtonVisibility() {
    const button = document.getElementById("dbx-custom-sort-button");
    const deckConstructor = document.getElementById("deck_constructor");
    if (!button) return;
    // The button lives inside Deck Constructor, so its parent naturally hides it.
    // Keeping the child itself enabled avoids a race where Dueling Book reveals an
    // ancestor without mutating #deck_constructor and our old observer never fires.
    button.style.display = deckConstructor && deckConstructor.contains(button)
      ? "flex"
      : "none";
  }


  function refresh() {
    if (!isVisible(document.getElementById("deck_constructor"))) return;
    ensureCustomSortButton();
    updateCustomSortButtonVisibility();
  }
  return { initialize: refresh, tick: refresh };

});
