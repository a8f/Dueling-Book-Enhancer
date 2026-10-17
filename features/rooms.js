(function attach(root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory;
  else (root.DBEnhancerFeatures ||= {})["rooms"] = factory;
})(typeof window !== "undefined" ? window : globalThis, function createFeature(context) {
  "use strict";
  const { window, document, core, postToBridge, isVisible, lifecycle } = context;
  const state = {
    get settings() { return context.getSettings(); },
    roomPage: 0,
    roomPageCount: 1,
    duelRoomWasVisible: false,
    lastPreservedHost: ""
  };
  const ROOM_WIDTH = 1024;
  function selectedRoomIds() {
    return state.settings.roomOrder.filter(function roomIsEnabled(roomId) {
      return state.settings.visibleRooms[roomId];
    });
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


  let layoutElement = null;
  function bind() {
    const nextLayout = document.getElementById("formats_inner");
    const layoutChanged = layoutElement !== nextLayout;
    layoutElement = nextLayout;
    const roomChanged = lifecycle.observe("room", document.getElementById("duel_room"), duelRoomVisibilityChanged);
    lifecycle.observe("hosting", document.getElementById("hosting"), () => {
      if (isVisible(document.getElementById("hosting"))) preserveCurrentHostDefaults();
    });
    lifecycle.listen("formats", document.getElementById("formats"), "scroll", () => {
      window.setTimeout(() => {
        state.roomPage = Math.max(0, Math.min(Math.round(getFormatsScrollLeft() / ROOM_WIDTH), state.roomPageCount - 1));
        updateRoomArrows();
      }, 0);
    }, true);
    return layoutChanged || roomChanged;
  }
  function apply() {
    applyRoomLayout(true);
    if (isVisible(document.getElementById("duel_room"))) applyHostDefaults();
  }
  return {
    initialize() {
      document.addEventListener("click", arrowClicked, true);
      document.addEventListener("click", hostButtonFinished, false);
      bind(); apply(); duelRoomVisibilityChanged();
    },
    tick() {
      if (bind()) apply();
      duelRoomVisibilityChanged();
      if (isVisible(document.getElementById("duel_room"))) syncHostFormatOptions();
    },
    settingsKeys: ["visibleRooms", "roomOrder", "hostDefaults"],
    settingsChanged() { if (context.isStarted()) apply(); }
  };

});
