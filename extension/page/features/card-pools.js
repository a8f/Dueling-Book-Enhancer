(function attach(root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory;
  else (root.DBEnhancerFeatures ||= {})["card-pools"] = factory;
})(typeof window !== "undefined" ? window : globalThis, function createFeature(context) {
  "use strict";
  const { window, document, core, postToBridge, isVisible, lifecycle } = context;
  const state = {
    get settings() { return context.getSettings(); },
    customBanlistPreviousNativeValue: "",
    customBanlistActiveId: "",
    customSearchRegionSnapshot: null,
    lastDeckId: "",
    deckConstructorVisible: false,
    pendingCardpoolSave: null,
    restoringCardpool: false
  };
  let syncedControls = null;
  function normalizedCardName(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
  }

  function resolveCustomBanlistCards(entries, namesToIds, validIds, unresolved) {
    const result = [];
    const seen = new Set();
    (Array.isArray(entries) ? entries : []).forEach(function resolveEntry(entry) {
      const ids = typeof entry === "number"
        ? (validIds.has(entry) ? [entry] : [])
        : namesToIds.get(normalizedCardName(entry)) || [];
      if (ids.length === 0) unresolved.add(String(entry));
      ids.forEach(function addResolvedId(id) {
        const numericId = Number(id);
        if (!Number.isSafeInteger(numericId) || numericId <= 0 || seen.has(numericId)) {
          return;
        }
        seen.add(numericId);
        result.push(numericId);
      });
    });
    return result;
  }

  function selectedCustomCardpoolId(cardpool) {
    if (!cardpool || cardpool.selectedIndex < 0) return "";
    const option = cardpool.options[cardpool.selectedIndex];
    return option ? String(option.dataset.dbxBanlistId || "") : "";
  }

  function customSearchRegionInputs() {
    return {
      tcg: document.querySelector("#search .tcg_cb"),
      ocg: document.querySelector("#search .ocg_cb")
    };
  }

  function enforceCustomTcgSearch() {
    const inputs = customSearchRegionInputs();
    if (!inputs.tcg || !inputs.ocg) return false;
    if (!state.customSearchRegionSnapshot) {
      state.customSearchRegionSnapshot = {
        tcg: Boolean(inputs.tcg.checked),
        ocg: Boolean(inputs.ocg.checked)
      };
    }
    inputs.tcg.checked = core.CUSTOM_CARDPOOL_REGION_POLICY.tcg;
    inputs.ocg.checked = core.CUSTOM_CARDPOOL_REGION_POLICY.ocg;
    return true;
  }

  function restoreNativeSearchRegions() {
    const snapshot = state.customSearchRegionSnapshot;
    if (!snapshot) return;
    const inputs = customSearchRegionInputs();
    if (inputs.tcg) inputs.tcg.checked = snapshot.tcg;
    if (inputs.ocg) inputs.ocg.checked = snapshot.ocg;
    state.customSearchRegionSnapshot = null;
  }

  function guardCustomSearchRegions(event) {
    const cardpool = document.querySelector("#search .custom_cb");
    const customId = selectedCustomCardpoolId(cardpool);
    if (!customId) {
      if (state.customBanlistActiveId && event.target === cardpool) restoreNativeSearchRegions();
      return;
    }
    enforceCustomTcgSearch();
    if (
      event.type === "click" &&
      event.target &&
      event.target.matches("#search .tcg_cb, #search .ocg_cb")
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }

  function setBanlistValue(select, value) {
    if (!select || value === null || value === undefined || value === "") return false;
    const expected = String(value);
    const optionExists = Array.from(select.options).some(function optionMatches(option) {
      return String(option.value) === expected;
    });
    if (!optionExists) return false;

    if (window.$ && typeof window.$(select).selectedValue === "function") {
      window.$(select).selectedValue(expected);
    } else {
      select.value = expected;
    }
    return String(select.value) === expected;
  }

  function refreshCustomBanlistSearch() {
    if (state.customBanlistActiveId) enforceCustomTcgSearch();
    if (typeof window.updateCardLimits === "function") window.updateCardLimits();
    if (typeof window.searchCardsE === "function") {
      window.searchCardsE(false);
      return;
    }
    const searchButton = document.querySelector("#search .search_btn");
    if (searchButton) searchButton.click();
  }

  function installCustomCardpoolBridge(cardpool) {
    if (!cardpool || cardpool.dataset.dbxBanlistBridge === "true") return;
    cardpool.dataset.dbxBanlistBridge = "true";
    cardpool.addEventListener("change", function customCardpoolChanged() {
      // Dueling Book's own Cardpool handler runs first. It intentionally sees the
      // imported option as value 0 (Official Cards Only), which preserves its
      // native card-type filtering. We then select the imported legality list
      // and repeat the search against that list after the native event settles.
      window.setTimeout(function applyCustomCardpoolSelection() {
        const banlistSelect = document.querySelector("#deck_constructor #banlists");
        if (!banlistSelect) return;
        const customId = selectedCustomCardpoolId(cardpool);

        if (customId) {
          if (!/^dbx-/.test(String(banlistSelect.value))) {
            state.customBanlistPreviousNativeValue = String(banlistSelect.value || "");
          }
          state.customBanlistActiveId = customId;
          enforceCustomTcgSearch();
          if (setBanlistValue(banlistSelect, customId)) refreshCustomBanlistSearch();
          return;
        }

        if (
          state.customBanlistActiveId ||
          /^dbx-/.test(String(banlistSelect.value))
        ) {
          const restored = setBanlistValue(
            banlistSelect,
            state.customBanlistPreviousNativeValue
          );
          if (!restored) {
            const firstNative = Array.from(banlistSelect.options).find(function nativeOption(option) {
              return option.dataset.dbxBanlist !== "true";
            });
            if (firstNative) setBanlistValue(banlistSelect, firstNative.value);
          }
          state.customBanlistActiveId = "";
          restoreNativeSearchRegions();
          refreshCustomBanlistSearch();
        }
      }, 0);
    });
  }

  function normalizedPoolLabel(value) {
    return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
  }

  function nativeCardpoolIdForOption(option) {
    if (!option || option.dataset.dbxBanlistId) return "";
    const label = normalizedPoolLabel(option.textContent);
    const definition = core.NATIVE_CARDPOOL_DEFINITIONS.find(function matchPool(pool) {
      return normalizedPoolLabel(pool.label) === label;
    });
    return definition ? definition.id : "";
  }

  function cardpoolItemEnabled(id) {
    return Boolean(id && state.settings.cardPools.enabled[id]);
  }

  function syncCustomBanlists() {
    const select = document.querySelector("#deck_constructor #banlists");
    const cardpool = document.querySelector("#search .custom_cb");
    if (!select || !cardpool || !Array.isArray(window.Banlists)) {
      return false;
    }

    const enabledCustomLists = state.settings.customBanlists.filter(function enabledList(list) {
      return cardpoolItemEnabled(list.id);
    });
    const cards = Array.isArray(window.Cards) ? window.Cards : [];
    if (enabledCustomLists.length && (cards.length === 0 || window.Banlists.length === 0 || select.options.length < 2)) {
      return false;
    }

    const selectedValue = String(select.value || "");
    const selectedCardpoolCustomId = selectedCustomCardpoolId(cardpool);
    const selectedNativeValue = selectedCardpoolCustomId ? "" : String(cardpool.value || "");
    const selectedCardpoolId = selectedCardpoolCustomId || nativeCardpoolIdForOption(cardpool.options[cardpool.selectedIndex]);
    const namesToIds = new Map();
    const validIds = new Set();
    cards.forEach(function indexCard(card) {
      const name = normalizedCardName(card && card.name);
      const id = Number(card && card.id);
      if (!name || !Number.isSafeInteger(id) || id <= 0) return;
      validIds.add(id);
      if (!namesToIds.has(name)) namesToIds.set(name, []);
      namesToIds.get(name).push(id);
    });

    for (let index = window.Banlists.length - 1; index >= 0; index -= 1) {
      if (window.Banlists[index] && window.Banlists[index].dbx) window.Banlists.splice(index, 1);
    }
    select.querySelectorAll("option[data-dbx-banlist]").forEach(option => option.remove());
    cardpool.querySelectorAll("option[data-dbx-cardpool-banlist]").forEach(option => option.remove());
    installCustomCardpoolBridge(cardpool);

    Array.from(cardpool.options).forEach(function identifyNativeOption(option) {
      const id = nativeCardpoolIdForOption(option);
      if (!id) return;
      option.dataset.dbxCardpoolId = id;
      const enabled = cardpoolItemEnabled(id);
      option.hidden = !enabled;
      option.disabled = !enabled;
    });

    enabledCustomLists.forEach(function installBanlist(list) {
      const unresolved = new Set();
      const forbidden = resolveCustomBanlistCards(list.forbidden, namesToIds, validIds, unresolved);
      const limited = resolveCustomBanlistCards(list.limited, namesToIds, validIds, unresolved);
      const semiLimited = resolveCustomBanlistCards(list.semiLimited, namesToIds, validIds, unresolved);
      const installed = {
        id: list.id,
        n: list.name,
        // Dueling Book displays an unlimited badge for every ID in `u`.
        // Unlisted cards are already unrestricted, so an empty array matches
        // the native format behavior without covering cards in “3” markers.
        f: forbidden, l: limited, s: semiLimited, u: [],
        min: list.minDate || null, max: list.maxDate || null,
        tcg: core.CUSTOM_CARDPOOL_REGION_POLICY.tcg,
        ocg: core.CUSTOM_CARDPOOL_REGION_POLICY.ocg,
        dbx: true
      };
      window.Banlists.push(installed);
      if (unresolved.size) {
        console.warn("[Dueling Book Enhancer] " + list.name + " contains unmatched card names or IDs:", Array.from(unresolved));
      }

      const option = document.createElement("option");
      option.value = list.id;
      option.textContent = installed.n;
      option.dataset.dbxBanlist = "true";
      select.appendChild(option);

      const cardpoolOption = document.createElement("option");
      cardpoolOption.value = "0";
      cardpoolOption.textContent = installed.n;
      cardpoolOption.dataset.dbxCardpoolBanlist = "true";
      cardpoolOption.dataset.dbxBanlistId = list.id;
      cardpoolOption.dataset.dbxCardpoolId = list.id;
      cardpool.appendChild(cardpoolOption);
    });

    const optionById = new Map();
    Array.from(cardpool.options).forEach(function indexCardpoolOption(option) {
      const id = option.dataset.dbxBanlistId || option.dataset.dbxCardpoolId || nativeCardpoolIdForOption(option);
      if (id) optionById.set(id, option);
    });
    state.settings.cardPools.order.forEach(function orderCardpool(id) {
      const option = optionById.get(id);
      if (option) cardpool.appendChild(option);
    });

    let restored = null;
    if (selectedCardpoolCustomId && cardpoolItemEnabled(selectedCardpoolCustomId)) {
      restored = optionById.get(selectedCardpoolCustomId) || null;
    } else if (selectedNativeValue) {
      restored = Array.from(cardpool.options).find(function sameNativeValue(option) {
        return !option.disabled && !option.dataset.dbxBanlistId && String(option.value) === selectedNativeValue;
      }) || null;
    }
    if (!restored) restored = Array.from(cardpool.options).find(option => !option.disabled) || null;
    if (restored) {
      restored.selected = true;
      const restoredId = restored.dataset.dbxBanlistId || restored.dataset.dbxCardpoolId || nativeCardpoolIdForOption(restored);
      if (restoredId !== selectedCardpoolId || restored.dataset.dbxBanlistId) {
        cardpool.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }

    if (selectedCardpoolCustomId && cardpoolItemEnabled(selectedCardpoolCustomId)) {
      state.customBanlistActiveId = selectedCardpoolCustomId;
      enforceCustomTcgSearch();
    } else if (selectedCardpoolCustomId) {
      state.customBanlistActiveId = "";
      restoreNativeSearchRegions();
    } else {
      state.customBanlistActiveId = "";
      restoreNativeSearchRegions();
    }

    if (selectedValue && cardpoolItemEnabled(selectedValue)) {
      setBanlistValue(select, selectedValue);
      if (typeof window.updateCardLimits === "function") window.updateCardLimits();
    } else if (/^dbx-/.test(selectedValue)) {
      const firstNative = Array.from(select.options).find(option => option.dataset.dbxBanlist !== "true");
      if (firstNative) setBanlistValue(select, firstNative.value);
      if (typeof window.updateCardLimits === "function") window.updateCardLimits();
    }
    syncedControls = { select, cardpool, cards: window.Cards, cardCount: cards.length, banlists: window.Banlists };
    return true;
  }
  function currentDeckId() {
    const deckSelect = document.getElementById("decklist_cb");
    const selectedValue =
      deckSelect && deckSelect.selectedIndex >= 0
        ? String(deckSelect.options[deckSelect.selectedIndex].value || "")
        : "";
    if (/^\d+$/.test(selectedValue) && Number(selectedValue) > 0) {
      return selectedValue;
    }

    const globalValue = String(window.currentDeckId || "");
    return /^\d+$/.test(globalValue) && Number(globalValue) > 0
      ? globalValue
      : "";
  }

  function describeSelectedCardpool() {
    const cardpool = document.querySelector("#search .custom_cb");
    if (!cardpool || cardpool.selectedIndex < 0) return null;
    const option = cardpool.options[cardpool.selectedIndex];
    const customId = String(option.dataset.dbxBanlistId || "");
    return customId
      ? { kind: "custom", id: customId }
      : { kind: "native", value: String(option.value) };
  }

  function selectCardpoolOption(option) {
    const cardpool = document.querySelector("#search .custom_cb");
    if (!cardpool || !option) return false;
    state.restoringCardpool = true;
    option.selected = true;
    cardpool.dispatchEvent(new Event("change", { bubbles: true }));
    window.setTimeout(function cardpoolRestoreFinished() {
      state.restoringCardpool = false;
    }, 50);
    return true;
  }

  function restoreRememberedCardpool(deckId) {
    if (!state.settings.rememberCardList) return;
    const remembered = state.settings.deckCardpools[deckId];
    if (!remembered) return;
    const cardpool = document.querySelector("#search .custom_cb");
    if (!cardpool) return;
    syncCustomBanlists();
    let option = null;
    if (remembered && remembered.kind === "custom") {
      option = Array.from(cardpool.options).find(function matchingCustom(candidate) {
        return !candidate.disabled && candidate.dataset.dbxBanlistId === remembered.id;
      });
    } else if (remembered && remembered.kind === "native") {
      option = Array.from(cardpool.options).find(function matchingNative(candidate) {
        return !candidate.disabled && !candidate.dataset.dbxBanlistId &&
          String(candidate.value) === remembered.value;
      });
    }
    if (!option) {
      option = Array.from(cardpool.options).find(function firstNative(candidate) {
        return !candidate.disabled && !candidate.dataset.dbxBanlistId;
      });
    }
    selectCardpoolOption(option);
  }

  function saveDeckCardpool(deckId, descriptor) {
    if (!state.settings.rememberCardList || !deckId || !descriptor) return;
    state.settings.deckCardpools[deckId] = descriptor;
    postToBridge("save-deck-cardpool", {
      deckId: deckId,
      cardpool: descriptor
    });
  }

  function deckSaveClicked(event) {
    const target = event.target;
    const button =
      target && typeof target.closest === "function"
        ? target.closest("#deck_constructor #save_btn, #deck_constructor #save_as_btn")
        : null;
    if (!button || !state.settings.rememberCardList) return;
    const descriptor = describeSelectedCardpool();
    if (!descriptor) return;
    if (button.matches("#save_as_btn")) {
      const pending = {
        descriptor: descriptor,
        previousDeckId: currentDeckId()
      };
      state.pendingCardpoolSave = pending;
      window.setTimeout(function expireCancelledSaveAs() {
        if (state.pendingCardpoolSave === pending) {
          state.pendingCardpoolSave = null;
        }
      }, 15000);
      return;
    }
    saveDeckCardpool(currentDeckId(), descriptor);
  }

  function trackCurrentDeck() {
    if (!state.settings.rememberCardList) {
      state.lastDeckId = currentDeckId();
      state.pendingCardpoolSave = null;
      return;
    }
    const deckId = currentDeckId();
    if (!deckId || deckId === state.lastDeckId) return;
    if (!document.querySelector("#search .custom_cb")) return;
    state.lastDeckId = deckId;
    if (state.pendingCardpoolSave) {
      if (deckId !== state.pendingCardpoolSave.previousDeckId) {
        saveDeckCardpool(deckId, state.pendingCardpoolSave.descriptor);
      }
      state.pendingCardpoolSave = null;
      if (state.settings.deckCardpools[deckId]) return;
    }
    restoreRememberedCardpool(deckId);
  }

  function installDeckLoadHook() {
    const original = window.loadDeckResponse;
    if (typeof original !== "function") return false;
    if (original.dbxEnhancerWrapped === true) return true;

    function enhancedLoadDeckResponse() {
      const result = original.apply(this, arguments);
      try {
        if (isVisible(document.getElementById("deck_constructor"))) {
          // Native loading has populated the deck and enabled its controls.
          state.lastDeckId = "";
          trackCurrentDeck();
        }
      } catch (error) {
        console.error("[Dueling Book Enhancer] Could not restore deck Card Pool.", error);
      }
      return result;
    }

    Object.defineProperty(enhancedLoadDeckResponse, "dbxEnhancerWrapped", {
      value: true
    });
    Object.defineProperty(enhancedLoadDeckResponse, "dbxEnhancerOriginal", {
      value: original
    });

    try {
      window.loadDeckResponse = enhancedLoadDeckResponse;
    } catch (error) {
      console.debug(
        "[Dueling Book Enhancer] Could not install the deck-load completion hook.",
        error
      );
      return false;
    }
    return window.loadDeckResponse === enhancedLoadDeckResponse;
  }


  const diagnostics = {
    cardpool: function cardpoolDiagnostics() {
      const cardpool = document.querySelector("#search .custom_cb");
      const regions = customSearchRegionInputs();
      return {
        bridgeMarker: cardpool ? cardpool.dataset.dbxBanlistBridge || "missing" : "missing",
        activeCustomPool: selectedCustomCardpoolId(cardpool) || "none",
        tcgOnlyApplied: Boolean(
          selectedCustomCardpoolId(cardpool) &&
          regions.tcg && regions.tcg.checked &&
          regions.ocg && !regions.ocg.checked
        ),
        expectedCustomOptions: state.settings.customBanlists.filter(list => state.settings.cardPools.enabled[list.id]).length,
        visibleCustomOptions: cardpool
          ? cardpool.querySelectorAll("option[data-dbx-cardpool-banlist]").length
          : 0
      };
    },
    deckMemory: function deckMemoryDiagnostics() {
      const deckId = currentDeckId();
      const deckSelect = document.getElementById("decklist_cb");
      return {
        rememberCardList: state.settings.rememberCardList,
        deckId: deckId || "not-detected",
        deckConstructorVisible: state.deckConstructorVisible,
        loadCompletionHook: window.loadDeckResponse &&
          window.loadDeckResponse.dbxEnhancerWrapped === true,
        appliedDeckId: state.lastDeckId || "none",
        selectedDeckText:
          deckSelect && deckSelect.selectedIndex >= 0
            ? deckSelect.options[deckSelect.selectedIndex].textContent
            : "",
        selectedCardpool: describeSelectedCardpool(),
        rememberedCardpool: deckId
          ? state.settings.deckCardpools[deckId] || null
          : null
      };
    }
  };
  function apply() { state.lastDeckId = ""; syncCustomBanlists(); }
  function refresh() {
    const deckConstructor = document.getElementById("deck_constructor");
    const replaced = lifecycle.observe("deck", deckConstructor, refresh);
    const hooked = installDeckLoadHook();
    if (!isVisible(deckConstructor)) {
      state.deckConstructorVisible = false; state.lastDeckId = "";
      return;
    }
    if (replaced || !state.deckConstructorVisible) {
      state.deckConstructorVisible = true; state.lastDeckId = "";
    }
    if (!hooked) trackCurrentDeck();
    const enabled = state.settings.customBanlists.filter(list => state.settings.cardPools.enabled[list.id]).length;
    const internal = Array.isArray(window.Banlists) ? window.Banlists.filter(list => list && list.dbx).length : 0;
    const cardpool = document.querySelector("#search .custom_cb");
    const count = cardpool ? cardpool.querySelectorAll("option[data-dbx-cardpool-banlist]").length : 0;
    const nativeOutOfSync = cardpool && Array.from(cardpool.options).some(option => {
      const id = nativeCardpoolIdForOption(option);
      return id && (option.dataset.dbxCardpoolId !== id || option.disabled === cardpoolItemEnabled(id));
    });
    const select = document.querySelector("#deck_constructor #banlists");
    const selectCount = select ? select.querySelectorAll("option[data-dbx-banlist]").length : 0;
    if (!syncedControls || syncedControls.select !== select || syncedControls.cardpool !== cardpool ||
        syncedControls.cards !== window.Cards || syncedControls.banlists !== window.Banlists ||
        syncedControls.cardCount !== (Array.isArray(window.Cards) ? window.Cards.length : 0) ||
        internal !== enabled || count !== enabled || selectCount !== enabled || nativeOutOfSync) syncCustomBanlists();
  }
  return {
    initialize() {
      document.addEventListener("click", guardCustomSearchRegions, true);
      document.addEventListener("change", guardCustomSearchRegions, true);
      document.addEventListener("keydown", guardCustomSearchRegions, true);
      document.addEventListener("click", deckSaveClicked, true);
      apply(); refresh();
    },
    tick: refresh,
    settingsKeys: ["customBanlists", "cardPools", "deckCardpools", "rememberCardList"],
    settingsChanged() { if (context.isStarted()) apply(); }, diagnostics
  };

});
