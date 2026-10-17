(function startDuelingBookEnhancer() {
  "use strict";

  const core = window.DBEnhancerCore;
  const CHANNEL = "dueling-book-enhancer-v1";
  const COMMAND_EVENT = "dueling-book-enhancer-v1-command";
  const SETTINGS_EVENT = "dueling-book-enhancer-v1-settings";
  const ENHANCER_VERSION = "1.1.5";
  const seenSettingsDeliveries = new Set();
  let commandSequence = 0;
  const ROOM_WIDTH = 1024;
  const state = {
    settings: core ? core.createDefaultSettings() : null,
    roomPage: 0,
    roomPageCount: 1,
    duelRoomWasVisible: false,
    lastPreservedHost: "",
    domReady: false,
    appliedColors: [],
    customSortInstallAttempts: 0,
    customBanlistInstallAttempts: 0,
    customBanlistPreviousNativeValue: "",
    customBanlistActiveId: "",
    customSearchRegionSnapshot: null,
    lastDeckId: "",
    deckConstructorVisible: false,
    pendingCardpoolSave: null,
    restoringCardpool: false,
    rpsAutoStarted: false,
    rpsFirstPickMade: false,
    rpsWaitForManualPick: false,
    rpsSettingsReceived: false,
    rpsWasReady: false,
    rpsCard: null
  };

  if (!core) {
    console.error("[Dueling Book Enhancer] Core did not load.");
    return;
  }

  function postToBridge(type, payload) {
    const message = Object.assign(
      {
        channel: CHANNEL,
        source: "page-main",
        type: type,
        requestId: "command-" + Date.now() + "-" + ++commandSequence
      },
      payload || {}
    );

    window.postMessage(message, "*");

    try {
      document.dispatchEvent(
        new CustomEvent(COMMAND_EVENT, {
          detail: JSON.stringify(message)
        })
      );
    } catch (error) {
      console.debug(
        "[Dueling Book Enhancer] DOM command relay was unavailable.",
        error
      );
    }
  }

  function isVisible(element) {
    return Boolean(element && window.getComputedStyle(element).display !== "none");
  }

  function selectedRoomIds() {
    return state.settings.roomOrder.filter(function roomIsEnabled(roomId) {
      return state.settings.visibleRooms[roomId];
    });
  }

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

  function syncHostFormatOptions() {
    const select = document.querySelector("#host .format_cb");
    if (!select) return;
    const previous = String(select.value || "");
    const enabled = new Set(selectedRoomIds().filter(id => id !== "ar"));
    const byValue = new Map(Array.from(select.options).map(option => [String(option.value), option]));
    state.settings.roomOrder.forEach(function orderFormat(roomId) {
      if (roomId === "ar") return;
      const option = byValue.get(roomId);
      if (!option) return;
      option.hidden = !enabled.has(roomId);
      option.disabled = !enabled.has(roomId);
      select.appendChild(option);
    });
    const solo = byValue.get("so");
    if (solo) {
      solo.hidden = false;
      solo.disabled = false;
      select.appendChild(solo);
    }
    if (previous === "so" || enabled.has(previous)) select.value = previous;
    else if (enabled.size) select.value = state.settings.roomOrder.find(id => enabled.has(id));
    else if (solo) select.value = "so";
  }

  function getFormatsScrollLeft() {
    try {
      if (window.$) return Number(window.$("#formats").scrollLeft()) || 0;
    } catch (error) {
      console.debug("[Dueling Book Enhancer] Could not read room scroll.", error);
    }

    const formats = document.getElementById("formats");
    return formats ? formats.scrollLeft : 0;
  }

  function setFormatsScrollLeft(left, animate) {
    const safeLeft = Math.max(0, Number(left) || 0);

    try {
      if (window.$ && typeof window.tweenScrollbar === "function") {
        window.tweenScrollbar(window.$("#formats"), animate ? 0.3 : 0, {
          scrollLeft: safeLeft
        });
        return;
      }

      if (window.$) {
        window.$("#formats").scrollLeft(safeLeft);
        return;
      }
    } catch (error) {
      console.debug("[Dueling Book Enhancer] Room scroll fallback used.", error);
    }

    const formats = document.getElementById("formats");
    if (formats) formats.scrollLeft = safeLeft;
  }

  function setButtonVisible(button, visible) {
    if (!button) return;
    button.style.display = visible ? "block" : "none";
  }

  function updateRoomArrows() {
    const previous = document.getElementById("pools_prev_btn");
    const next = document.getElementById("pools_next_btn");
    setButtonVisible(previous, state.roomPage > 0);
    setButtonVisible(next, state.roomPage < state.roomPageCount - 1);
  }

  function goToRoomPage(page, animate) {
    state.roomPage = Math.max(
      0,
      Math.min(Number(page) || 0, state.roomPageCount - 1)
    );
    setFormatsScrollLeft(state.roomPage * ROOM_WIDTH, animate);
    updateRoomArrows();
    window.setTimeout(updateRoomArrows, animate ? 360 : 0);
  }

  function ensureNoRoomsMessage(formatsInner) {
    let message = document.getElementById("dbx-no-rooms-message");

    if (!message) {
      message = document.createElement("div");
      message.id = "dbx-no-rooms-message";
      message.textContent =
        "No rooms are selected. Open Dueling Book Enhancer settings to choose visible rooms.";
      formatsInner.appendChild(message);
    }

    return message;
  }

  function applyRoomLayout(resetPage) {
    try {
      const formatsInner = document.getElementById("formats_inner");
      if (!formatsInner) return;

      const visibleIds = selectedRoomIds();
      const visibleSet = new Set(visibleIds);
      const layout = core.getRoomLayout(visibleIds);
      const placementById = new Map(
        layout.placements.map(function mapPlacement(placement) {
          return [placement.id, placement];
        })
      );

      core.ROOM_DEFINITIONS.forEach(function positionRoom(room) {
        const element = document.getElementById(room.id);
        if (!element) return;

        if (!visibleSet.has(room.id)) {
          element.style.display = "none";
          return;
        }

        element.style.display = "block";
        element.style.left = placementById.get(room.id).left + "px";
      });

      formatsInner.style.width = layout.width + "px";
      state.roomPageCount = layout.pageCount;

      const noRoomsMessage = ensureNoRoomsMessage(formatsInner);
      noRoomsMessage.style.display = visibleIds.length === 0 ? "flex" : "none";

      if (resetPage) state.roomPage = 0;
      goToRoomPage(state.roomPage, false);
      syncHostFormatOptions();
    } catch (error) {
      console.error(
        "[Dueling Book Enhancer] Room layout failed; Dueling Book rooms were left usable.",
        error
      );
    }
  }

  function setSelectValue(selector, value) {
    const element = document.querySelector(selector);
    if (!element || !Array.from(element.options).some(option => option.value === value)) {
      return;
    }

    try {
      if (window.$) {
        window.$(element).val(value).trigger("change");
        return;
      }
    } catch (error) {
      console.debug("[Dueling Book Enhancer] Select fallback used.", error);
    }

    element.value = value;
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function setInputValue(selector, value) {
    const element = document.querySelector(selector);
    if (!element) return;

    try {
      if (window.$) {
        window.$(element).val(value);
        return;
      }
    } catch (error) {
      console.debug("[Dueling Book Enhancer] Input fallback used.", error);
    }

    element.value = value;
  }

  function setCheckboxValue(selector, checked) {
    const element = document.querySelector(selector);
    if (!element) return;

    try {
      if (window.$ && typeof window.$(element).checked === "function") {
        window.$(element).checked(Boolean(checked));
        window.$(element).trigger("change");
        return;
      }
    } catch (error) {
      console.debug("[Dueling Book Enhancer] Checkbox fallback used.", error);
    }

    element.checked = Boolean(checked);
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function applyHostDefaults() {
    try {
      const host = document.getElementById("host");
      if (!host) return;

      const defaults = state.settings.hostDefaults;
      setSelectValue("#host .format_cb", defaults.format);
      setSelectValue("#host .type_cb", defaults.type);
      setSelectValue("#host .rules_cb", defaults.rules);
      setInputValue("#host .duel_note_txt", defaults.duelNote);
      setInputValue("#host .duel_password_txt", defaults.duelPassword);
      setCheckboxValue("#host .watching_cb", defaults.watching);
      setCheckboxValue("#host .classic_cb", defaults.classic);
      setCheckboxValue("#host .tag_duel_cb", defaults.tagDuel);
      setInputValue("#host .watch_note_txt", defaults.watchNote);
      setInputValue("#host .watch_password_txt", defaults.watchPassword);
    } catch (error) {
      console.error(
        "[Dueling Book Enhancer] Host defaults could not be applied; Dueling Book defaults remain available.",
        error
      );
    }
  }

  function readHostForm() {
    function value(selector) {
      const element = document.querySelector(selector);
      return element ? element.value : "";
    }

    function checked(selector) {
      const element = document.querySelector(selector);
      return Boolean(element && element.checked);
    }

    return {
      format: value("#host .format_cb"),
      type: value("#host .type_cb"),
      rules: value("#host .rules_cb"),
      duelNote: value("#host .duel_note_txt"),
      duelPassword: value("#host .duel_password_txt"),
      watching: checked("#host .watching_cb"),
      classic: checked("#host .classic_cb"),
      tagDuel: checked("#host .tag_duel_cb"),
      watchNote: value("#host .watch_note_txt"),
      watchPassword: value("#host .watch_password_txt")
    };
  }

  function preserveCurrentHostDefaults() {
    if (!state.settings.hostDefaults.preserveLastUsed) return;

    const hostDefaults = readHostForm();
    const signature = JSON.stringify(hostDefaults);
    if (signature === state.lastPreservedHost) return;

    state.lastPreservedHost = signature;
    postToBridge("save-host-defaults", { hostDefaults: hostDefaults });
  }

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
      state.customBanlistInstallAttempts += 1;
      if (state.customBanlistInstallAttempts < 240) window.setTimeout(syncCustomBanlists, 250);
      return false;
    }

    const enabledCustomLists = state.settings.customBanlists.filter(function enabledList(list) {
      return cardpoolItemEnabled(list.id);
    });
    const cards = Array.isArray(window.Cards) ? window.Cards : [];
    if (enabledCustomLists.length && (cards.length === 0 || window.Banlists.length === 0 || select.options.length < 2)) {
      state.customBanlistInstallAttempts += 1;
      if (state.customBanlistInstallAttempts < 240) window.setTimeout(syncCustomBanlists, 250);
      return false;
    }

    state.customBanlistInstallAttempts = 0;
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
      if (isVisible(document.getElementById("deck_constructor"))) {
        // Dueling Book has now finished populating the deck, updating limits,
        // enabling its controls, and dismissing its loading overlay.
        state.lastDeckId = "";
        trackCurrentDeck();
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
    const name = normalizedCardName(core.readCardValue(card, "name"));
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

    rail
      .querySelectorAll(
        ":scope > .info_btn, :scope > .locked_btn, " +
          ":scope > .unlocked_btn, :scope > .skill_btn"
      )
      .forEach(function shiftLowerRailButton(railButton) {
        const originalTop = Number.parseFloat(
          railButton.dataset.dbxOriginalTop || numericStyle(railButton, "top")
        );
        if (!Number.isFinite(originalTop)) return;
        railButton.dataset.dbxOriginalTop = String(originalTop);
        railButton.style.top = originalTop + rowGap + "px";
      });

    document
      .querySelectorAll("#randomize_tooltip, #lock_tooltip, #skill_tooltip")
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

  function duelRoomVisibilityChanged() {
    const duelRoom = document.getElementById("duel_room");
    const visible = isVisible(duelRoom);

    if (visible && !state.duelRoomWasVisible) {
      state.roomPage = 0;
      state.lastPreservedHost = "";
      applyRoomLayout(true);
      applyHostDefaults();
    }

    state.duelRoomWasVisible = visible;
  }

  function arrowClicked(event) {
    const target = event.target;
    const previous =
      target && typeof target.closest === "function"
        ? target.closest("#pools_prev_btn")
        : null;
    const next =
      target && typeof target.closest === "function"
        ? target.closest("#pools_next_btn")
        : null;

    if (!previous && !next) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    goToRoomPage(state.roomPage + (next ? 1 : -1), true);
  }

  function correctHostRoomPage(format) {
    const index = selectedRoomIds().indexOf(format);
    if (index < 0) return;
    goToRoomPage(Math.floor(index / 3), false);
  }

  function scheduleHostRoomCorrection(format) {
    if (selectedRoomIds().indexOf(format) < 0) return;
    // Dueling Book schedules its native page jump in several short stages.
    // A few idempotent corrections keep the final page aligned to the user's
    // compacted room order without replacing the site's hosting workflow.
    [0, 90, 240, 500, 850].forEach(function scheduleCorrection(delay) {
      window.setTimeout(function correctAfterNativeJump() {
        correctHostRoomPage(format);
      }, delay);
    });
  }

  function hostButtonFinished(event) {
    const target = event.target;
    const hostButton =
      target && typeof target.closest === "function"
        ? target.closest("#host .host_btn")
        : null;
    if (!hostButton) return;
    const format = document.querySelector("#host .format_cb");
    scheduleHostRoomCorrection(format ? format.value : "");
    if (!state.settings.hostDefaults.preserveLastUsed) return;

    window.setTimeout(function saveIfHostingStarted() {
      if (window.hosting === true || isVisible(document.getElementById("hosting"))) {
        preserveCurrentHostDefaults();
      }
    }, 50);
  }

  function randomRpsCards() {
    if (state.settings.rpsEnhancements === false) return [];
    const panel = document.getElementById("rps_start");
    if (!panel || !isVisible(panel)) return [];
    // Only the local player's selectable cards receive this native class.
    // Use the DOM rather than globals or jQuery's private event registry.
    const cards = Array.from(panel.querySelectorAll(".rps_card"));
    if (cards.length !== 3) return [];
    if (cards.some(function cardIsUnavailable(card) {
      const content = card.querySelector(".content");
      // Native selection disables the contents immediately. The lower row's
      // center is 478 (478.1 after the initial reveal); wait for it to settle.
      const top = parseFloat(card.style.top);
      return !content || !Number.isFinite(top) || Math.abs(top - 478) > 0.2 ||
        window.getComputedStyle(content).pointerEvents === "none";
    })) return [];
    return cards;
  }

  function pickRandomRps() {
    const cards = randomRpsCards();
    if (!cards.length) return;
    // Use the same content surface and native handler as a manual card pick.
    cards[Math.floor(Math.random() * cards.length)].querySelector(".content").click();
    syncRpsControls(false);
  }

  function syncRpsControls(allowAutoPick) {
    const panel = document.getElementById("rps_start");
    if (!panel) return;
    if (state.settings.rpsEnhancements === false) {
      const control = document.getElementById("dbx-auto-rps-control");
      if (control) control.hidden = true;
      state.rpsAutoStarted = false;
      state.rpsFirstPickMade = false;
      state.rpsWaitForManualPick = false;
      state.rpsWasReady = false;
      state.rpsCard = null;
      return;
    }
    let control = document.getElementById("dbx-auto-rps-control");
    if (!control) {
      control = document.createElement("div");
      control.id = "dbx-auto-rps-control";
      const shadow = control.attachShadow({ mode: "open" });
      const style = document.createElement("style");
      style.textContent = `
        .modes { display:flex; height:30px; border:1px solid #637982;
          border-radius:4px; overflow:hidden; box-sizing:border-box;
          background:linear-gradient(#303c43,#141b20); }
        button { appearance:none; border:0; border-right:1px solid #637982;
          margin:0; padding:0 11px; flex:1; background:transparent;
          color:#b8c7cf; font:600 13px/1 Arial,sans-serif; white-space:nowrap;
          cursor:pointer; pointer-events:auto; }
        button:last-child { border-right:0; }
        button:hover { background:#344b58; color:#fff; }
        button[aria-pressed="true"] { background:linear-gradient(#376273,#1d3b49);
          color:#d9f8ff; box-shadow:inset 0 2px 0 #58cce9; }
        button:focus-visible { outline:2px solid #65dfff; outline-offset:-3px; }
      `;
      shadow.appendChild(style);
      const modes = document.createElement("div");
      modes.className = "modes";
      modes.setAttribute("role", "group");
      modes.setAttribute("aria-label", "RPS automation");
      [
        ["manual", "Manual", "Choose each round yourself."],
        ["repeat", "Random on tie", "Choose your first card manually; after a tie, pick randomly for you."],
        ["automatic", "Automatic", "Pick randomly now, repeat after ties, and start automatically in future duels."]
      ].forEach(function createRpsMode(option) {
        const segment = document.createElement("button");
        segment.id = "dbx-rps-mode-" + option[0];
        segment.type = "button";
        segment.textContent = option[1];
        segment.title = option[2];
        segment.addEventListener("click", function changeRpsMode() {
          const current = state.settings.autoStartRps ? "automatic" : state.settings.autoPickRps ? "repeat" : "manual";
          if (state.settings.rpsEnhancements === false) return;
          if (current !== option[0]) {
            state.settings.autoStartRps = option[0] === "automatic";
            state.settings.autoPickRps = option[0] !== "manual";
            state.rpsWaitForManualPick = true;
            state.rpsAutoStarted = false;
            state.rpsWasReady = randomRpsCards().length === 3;
            postToBridge("save-rps-mode", { mode: option[0] });
          }
          if (option[0] === "automatic") {
            // Automatic is both a saved mode and the action to start now.
            state.rpsWaitForManualPick = false;
            state.rpsAutoStarted = true;
            pickRandomRps();
          }
          syncRpsControls(false);
        });
        modes.appendChild(segment);
      });
      shadow.appendChild(modes);
      panel.appendChild(control);
    }
    const mode = state.settings.autoStartRps ? "automatic" : state.settings.autoPickRps ? "repeat" : "manual";
    ["manual", "repeat", "automatic"].forEach(function highlightRpsMode(value) {
      control.shadowRoot.getElementById("dbx-rps-mode-" + value).setAttribute("aria-pressed", String(mode === value));
    });
    const localCards = panel.querySelectorAll(".rps_card");
    control.hidden = localCards.length !== 3;
    if (!isVisible(panel) || control.hidden || state.rpsCard !== localCards[0]) {
      state.rpsAutoStarted = false;
      state.rpsFirstPickMade = false;
      state.rpsWaitForManualPick = false;
      state.rpsWasReady = false;
    }
    state.rpsCard = localCards[0];
    const automatic = state.settings.autoPickRps;
    const disabled = randomRpsCards().length !== 3;
    // Native picks disable the cards immediately. Start repeating only after
    // that first manual selection, never merely from checking the preference.
    if (state.rpsWasReady && disabled && isVisible(panel) && !control.hidden) {
      state.rpsAutoStarted = true;
      state.rpsFirstPickMade = true;
      state.rpsWaitForManualPick = false;
    }
    state.rpsWasReady = !disabled;
    // The existing health check retries only once the native cards are ready.
    // A click's refresh must not recursively attempt another pick.
    const startAutomatically = state.settings.autoStartRps && !state.rpsFirstPickMade;
    const repeatTie = automatic && state.rpsAutoStarted;
    if (allowAutoPick !== false && !state.rpsWaitForManualPick && !disabled && (startAutomatically || repeatTie)) pickRandomRps();
  }

  function installObservers() {
    const duelRoom = document.getElementById("duel_room");
    const deckConstructor = document.getElementById("deck_constructor");
    const hostingPanel = document.getElementById("hosting");
    const formats = document.getElementById("formats");

    if (duelRoom) {
      new MutationObserver(duelRoomVisibilityChanged).observe(duelRoom, {
        attributes: true,
        attributeFilter: ["style", "class"]
      });
    }

    if (deckConstructor) {
      new MutationObserver(function deckConstructorVisibilityChanged() {
        ensureCustomSortButton();
        updateCustomSortButtonVisibility();
        if (isVisible(deckConstructor)) syncCustomBanlists();
      }).observe(
        deckConstructor,
        { attributes: true, attributeFilter: ["style", "class"] }
      );
    }

    if (hostingPanel) {
      new MutationObserver(function hostingVisibilityChanged() {
        if (isVisible(hostingPanel)) preserveCurrentHostDefaults();
      }).observe(hostingPanel, {
        attributes: true,
        attributeFilter: ["style", "class"]
      });
    }

    if (formats) {
      formats.addEventListener(
        "scroll",
        function roomCarouselScrolled() {
          window.setTimeout(function syncRoomPage() {
            state.roomPage = Math.max(
              0,
              Math.min(
                Math.round(getFormatsScrollLeft() / ROOM_WIDTH),
                state.roomPageCount - 1
              )
            );
            updateRoomArrows();
          }, 0);
        },
        true
      );
    }
  }

  function initializeDomFeatures() {
    if (state.domReady) return;
    state.domReady = true;
    ensureCustomSortButton();
    syncRpsControls();
    installDeckLoadHook();
    if (window.DBEnhancerDuelEvents) window.DBEnhancerDuelEvents.install();
    installObservers();
    applyRoomLayout(true);
    applyCustomColors();
    applyGridLineVisibility();
    duelRoomVisibilityChanged();
    updateCustomSortButtonVisibility();
    syncCustomBanlists();
    window.setInterval(function verifyDeckConstructorEnhancements() {
      // Dueling Book is an asynchronous single-page app and may rebuild this
      // rail well after DOMContentLoaded. This inexpensive health check makes
      // Custom Sort self-healing instead of abandoning installation after a
      // fixed startup window.
      ensureCustomSortButton();
      syncRpsControls();
      const deckLoadHookInstalled = installDeckLoadHook();
      if (window.DBEnhancerDuelEvents) window.DBEnhancerDuelEvents.install();
      const deckConstructor = document.getElementById("deck_constructor");
      const deckConstructorVisible = isVisible(deckConstructor);
      if (!deckConstructorVisible) {
        state.deckConstructorVisible = false;
        state.lastDeckId = "";
      } else {
        if (!state.deckConstructorVisible) {
          state.deckConstructorVisible = true;
          state.lastDeckId = "";
        }
        // The completion hook is the normal path. Polling remains only as a
        // compatibility fallback if Dueling Book ever stops exposing the loader.
        if (!deckLoadHookInstalled) trackCurrentDeck();
        const enabledCustomCount = state.settings.customBanlists.filter(list => state.settings.cardPools.enabled[list.id]).length;
        const internalCount = Array.isArray(window.Banlists)
          ? window.Banlists.filter(list => list && list.dbx).length
          : 0;
        const cardpool = document.querySelector("#search .custom_cb");
        const visibleCount = cardpool
          ? cardpool.querySelectorAll("option[data-dbx-cardpool-banlist]").length
          : 0;
        const nativeOutOfSync = cardpool && Array.from(cardpool.options).some(function poolOptionOutOfSync(option) {
          const id = nativeCardpoolIdForOption(option);
          return id && (option.dataset.dbxCardpoolId !== id || option.disabled === cardpoolItemEnabled(id));
        });
        if (internalCount !== enabledCustomCount || visibleCount !== enabledCustomCount || nativeOutOfSync) {
          syncCustomBanlists();
        }
      }
      if (isVisible(document.getElementById("duel_room"))) syncHostFormatOptions();
    }, 500);
  }

  function receiveBridgeSettings(message) {
    if (
      !message ||
      message.channel !== CHANNEL ||
      message.source !== "extension-bridge" ||
      message.type !== "settings"
    ) {
      return;
    }

    if (message.deliveryId) {
      if (seenSettingsDeliveries.has(message.deliveryId)) return;
      if (seenSettingsDeliveries.size > 200) seenSettingsDeliveries.clear();
      seenSettingsDeliveries.add(message.deliveryId);
    }

    const previousRpsMode = state.settings.autoStartRps ? "automatic" : state.settings.autoPickRps ? "repeat" : "manual";
    state.settings = core.sanitizeSettings(message.settings);
    const nextRpsMode = state.settings.autoStartRps ? "automatic" : state.settings.autoPickRps ? "repeat" : "manual";
    if (state.rpsSettingsReceived && previousRpsMode !== nextRpsMode) {
      state.rpsWaitForManualPick = true;
      state.rpsAutoStarted = false;
      state.rpsWasReady = randomRpsCards().length === 3;
    }
    state.rpsSettingsReceived = true;
    state.lastDeckId = "";

    if (state.domReady) {
      syncRpsControls(false);
      applyRoomLayout(true);
      applyCustomColors();
      applyGridLineVisibility();
      syncCustomBanlists();
      syncHostFormatOptions();
      if (isVisible(document.getElementById("duel_room"))) applyHostDefaults();
    }
    console.debug(
      "[Dueling Book Enhancer] Settings received:",
      message.reason || "unknown"
    );
  }

  window.addEventListener("message", function receiveBridgeMessage(event) {
    receiveBridgeSettings(event.data);
  });

  document.addEventListener(SETTINGS_EVENT, function receiveRelayedSettings(event) {
    try {
      receiveBridgeSettings(JSON.parse(event.detail));
    } catch (error) {
      console.debug(
        "[Dueling Book Enhancer] Ignored an invalid DOM settings relay.",
        error
      );
    }
  });

  document.addEventListener("click", arrowClicked, true);
  document.addEventListener("click", guardCustomSearchRegions, true);
  document.addEventListener("change", guardCustomSearchRegions, true);
  document.addEventListener("keydown", guardCustomSearchRegions, true);
  document.addEventListener("click", hostButtonFinished, false);
  document.addEventListener("click", deckSaveClicked, true);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeDomFeatures, {
      once: true
    });
  } else {
    initializeDomFeatures();
  }

  postToBridge("request-settings");
  window.DBEnhancerDiagnostics = {
    version: ENHANCER_VERSION,
    duelEvents: function duelEventsDiagnostics() {
      return window.DBEnhancerDuelEvents ? window.DBEnhancerDuelEvents.diagnostics() : null;
    },
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
  console.debug("[Dueling Book Enhancer] Enabled.");
})();
