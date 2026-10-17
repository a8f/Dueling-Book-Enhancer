(function initializeOptionsPage() {
  "use strict";

  const core = window.DBEnhancerCore;
  const form = document.getElementById("settings-form");
  const roomsGrid = document.getElementById("rooms-grid");
  const categoryContainer = document.getElementById("sort-categories");
  const customBanlistInput = document.getElementById("custom-banlist-file");
  const cardPoolList = document.getElementById("card-pool-list");
  const colorGroups = document.getElementById("color-groups");
  const saveStatus = document.getElementById("save-status");
  const settingsClient = window.DBEnhancerSettingsClient;
  let autosave;
  let currentSettings = core.createDefaultSettings();
  let draggedRow = null;
  let draggedRoom = null;
  let draggedGroup = null;
  let draggedCardPool = null;
  const activeReorderAnimations = new WeakMap();

  function visibilityIcon(enabled) {
    return enabled
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="2.8" fill="currentColor"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4.5 21 19.5M5.2 7.1C3.5 8.5 2.5 10.3 2.5 12c0 0 3.5 6 9.5 6 1.4 0 2.6-.3 3.7-.7M9.7 6.3A10 10 0 0 1 12 6c6 0 9.5 6 9.5 6a11 11 0 0 1-2.2 3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  }

  function setVisibilityButton(button, enabled, label) {
    button.dataset.enabled = String(enabled);
    button.innerHTML = visibilityIcon(enabled);
    button.setAttribute("aria-pressed", String(enabled));
    button.setAttribute("aria-label", (enabled ? "Hide " : "Show ") + label);
    button.title = enabled ? "Visible" : "Hidden";
    button.closest(".room-control, .card-pool-card")?.classList.toggle("is-disabled", !enabled);
  }

  function setPasswordVisibility(button, input, reveal) {
    input.type = reveal ? "text" : "password";
    button.innerHTML = visibilityIcon(reveal);
    button.setAttribute("aria-pressed", String(reveal));
    button.setAttribute("aria-label", (reveal ? "Hide " : "Show ") + input.dataset.fieldLabel);
    button.title = reveal ? "Hide password" : "Show password";
  }

  function smoothInsert(container, dragged, reference, selector) {
    if (!dragged || reference === dragged || reference === dragged.nextSibling) {
      return;
    }
    const elements = Array.from(container.querySelectorAll(":scope > " + selector));
    const before = new Map(
      elements.map(function rememberPosition(element) {
        return [element, element.getBoundingClientRect()];
      })
    );
    container.insertBefore(dragged, reference);

    elements.forEach(function animateMovedElement(element) {
      if (element === dragged || typeof element.animate !== "function") return;
      const first = before.get(element);
      const last = element.getBoundingClientRect();
      const deltaX = first.left - last.left;
      const deltaY = first.top - last.top;
      if (!deltaX && !deltaY) return;
      const previous = activeReorderAnimations.get(element);
      if (previous) previous.cancel();
      const animation = element.animate(
        [
          { transform: "translate(" + deltaX + "px, " + deltaY + "px)" },
          { transform: "translate(0, 0)" }
        ],
        {
          duration: 180,
          easing: "cubic-bezier(0.2, 0.8, 0.2, 1)"
        }
      );
      activeReorderAnimations.set(element, animation);
      animation.onfinish = function clearFinishedAnimation() {
        if (activeReorderAnimations.get(element) === animation) {
          activeReorderAnimations.delete(element);
        }
      };
    });
  }

  function fillSelect(select, options) {
    options.forEach(function addOption(option) {
      const element = document.createElement("option");
      element.value = option.value;
      element.textContent = option.label;
      select.appendChild(element);
    });
  }

  function customBanlistId(index) {
    return (
      "dbx-" +
      Date.now().toString(36) +
      "-" +
      index.toString(36) +
      "-" +
      Math.random().toString(36).slice(2, 8)
    );
  }

  function splitStatusMap(cards) {
    const buckets = { forbidden: [], limited: [], semiLimited: [], unlimited: [] };
    if (!cards || typeof cards !== "object" || Array.isArray(cards)) return buckets;
    Object.keys(cards).forEach(function splitCard(card) {
      const rawStatus = cards[card];
      const status = typeof rawStatus === "string"
        ? rawStatus.toLowerCase().replace(/[ _-]/g, "")
        : Number(rawStatus);
      if (status === 0 || status === "forbidden" || status === "banned") {
        buckets.forbidden.push(card);
      } else if (status === 1 || status === "limited") {
        buckets.limited.push(card);
      } else if (status === 2 || status === "semilimited") {
        buckets.semiLimited.push(card);
      } else if (status === 3 || status === "unlimited") {
        buckets.unlimited.push(card);
      }
    });
    return buckets;
  }

  function normalizeUploadedBanlist(candidate, fileName, index) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new Error(fileName + " does not contain a banlist object.");
    }
    const mapped = splitStatusMap(candidate.cards);
    const fallbackName = fileName.replace(/\.json$/i, "");
    const name = String(candidate.name || candidate.n || fallbackName).trim();
    if (name.length > 23) {
      throw new Error(fileName + " has a banlist name longer than 23 characters.");
    }
    return {
      id: customBanlistId(index),
      name: name,
      forbidden:
        candidate.forbidden || candidate.banned || candidate.f || mapped.forbidden,
      limited: candidate.limited || candidate.l || mapped.limited,
      semiLimited:
        candidate.semiLimited ||
        candidate.semi_limited ||
        candidate["semi-limited"] ||
        candidate.s ||
        mapped.semiLimited,
      unlimited: candidate.unlimited || candidate.u || mapped.unlimited,
      minDate: candidate.minDate || candidate.min || "",
      maxDate: candidate.maxDate || candidate.max || "",
      source: "uploaded"
    };
  }

  function cardPoolDefinitions() {
    const native = core.NATIVE_CARDPOOL_DEFINITIONS.map(pool => ({
      id: pool.id, label: pool.label, kind: "native"
    }));
    const custom = currentSettings.customBanlists.map(list => ({
      id: list.id, label: list.name, kind: "custom", source: list.source, maxDate: list.maxDate
    }));
    const byId = new Map(native.concat(custom).map(item => [item.id, item]));
    return currentSettings.cardPools.order.map(id => byId.get(id)).filter(Boolean);
  }

  function formatPoolDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return "";
    return new Date(value + "T00:00:00Z").toLocaleDateString(undefined, {
      month: "short",
      timeZone: "UTC",
      year: "numeric"
    });
  }

  function syncHostFormatSelect(preferredValue) {
    const select = document.getElementById("host-format");
    if (!select) return;
    const previousValues = Array.from(select.options).map(option => option.value);
    const currentValue = preferredValue || select.value;
    const roomOrder = Array.from(roomsGrid.querySelectorAll(".room-control")).map(card => card.dataset.roomId);
    const visibleRooms = {};
    roomsGrid.querySelectorAll(".room-control").forEach(card => {
      visibleRooms[card.dataset.roomId] = card.querySelector(".visibility-button").dataset.enabled === "true";
    });
    const available = core.getAvailableHostFormats(roomOrder, visibleRooms);
    select.textContent = "";
    fillSelect(select, available);
    select.value = core.selectAvailableHostFormat(previousValues, currentValue, available);
  }

  function moveListCard(container, card, direction) {
    const cards = Array.from(container.children);
    const index = cards.indexOf(card);
    const target = index + direction;
    if (target < 0 || target >= cards.length) return;
    if (direction < 0) container.insertBefore(card, cards[target]);
    else container.insertBefore(cards[target], card);
    if (container === roomsGrid) syncHostFormatSelect();
  }

  function createListMoveButton(container, label, symbol, direction) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "card-move-button";
    button.textContent = symbol;
    button.setAttribute("aria-label", label);
    button.addEventListener("click", event => moveListCard(container, event.currentTarget.closest(".room-control, .card-pool-card"), direction));
    return button;
  }

  function renderCardPools() {
    cardPoolList.textContent = "";
    cardPoolDefinitions().forEach(function renderPool(pool) {
      const card = document.createElement("article");
      card.className = "card-pool-card";
      card.dataset.poolId = pool.id;
      card.dataset.poolKind = pool.kind;

      const handle = document.createElement("span");
      handle.className = "drag-handle vertical-handle";
      handle.textContent = "⠿";
      handle.draggable = true;
      handle.title = "Drag to reorder";

      const visibility = document.createElement("button");
      visibility.type = "button";
      visibility.className = "visibility-button";
      setVisibilityButton(visibility, currentSettings.cardPools.enabled[pool.id] !== false, pool.label);
      visibility.addEventListener("click", function togglePool() {
        const enabled = visibility.dataset.enabled !== "true";
        setVisibilityButton(visibility, enabled, pool.label);
        currentSettings.cardPools.enabled[pool.id] = enabled;
        saveChanges();
      });

      const name = document.createElement("strong");
      name.className = "list-card-name";
      name.textContent = pool.label;
      const badge = document.createElement("span");
      badge.className = "pool-badge";
      badge.textContent = pool.kind === "native"
        ? "Dueling Book"
        : pool.source === "bundled"
          ? "Included · " + formatPoolDate(pool.maxDate)
          : "Custom";

      const moves = document.createElement("div");
      moves.className = "vertical-moves";
      moves.append(
        createListMoveButton(cardPoolList, "Move " + pool.label + " up", "↑", -1),
        createListMoveButton(cardPoolList, "Move " + pool.label + " down", "↓", 1)
      );

      const actions = document.createElement("div");
      actions.className = "list-card-actions";
      actions.append(visibility, moves);
      if (pool.kind === "custom") {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "delete-button";
        remove.textContent = "Delete";
        remove.addEventListener("click", function deletePool() {
          currentSettings.cardPools.order = Array.from(cardPoolList.querySelectorAll(".card-pool-card")).map(card => card.dataset.poolId);
          if (pool.source === "bundled" && !currentSettings.deletedBundledBanlists.includes(pool.id)) {
            currentSettings.deletedBundledBanlists.push(pool.id);
          }
          currentSettings.customBanlists = currentSettings.customBanlists.filter(list => list.id !== pool.id);
          currentSettings.cardPools.order = currentSettings.cardPools.order.filter(id => id !== pool.id);
          delete currentSettings.cardPools.enabled[pool.id];
          renderCardPools();
          saveChanges();
        });
        actions.appendChild(remove);
      }

      card.append(handle, name, badge, actions);
      cardPoolList.appendChild(card);

      handle.addEventListener("dragstart", function poolDragStarted(event) {
        draggedCardPool = card;
        card.classList.add("dragging");
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", pool.id);
      });
      handle.addEventListener("dragend", function poolDragEnded() {
        card.classList.remove("dragging");
        draggedCardPool = null;
      });
    });

    cardPoolList.ondragover = function poolDragOver(event) {
      if (!draggedCardPool) return;
      event.preventDefault();
      const target = event.target.closest(".card-pool-card");
      if (!target || target === draggedCardPool) return;
      const rectangle = target.getBoundingClientRect();
      smoothInsert(cardPoolList, draggedCardPool, event.clientY > rectangle.top + rectangle.height / 2 ? target.nextSibling : target, ".card-pool-card");
    };
  }
  function buildRooms() {
    core.ROOM_DEFINITIONS.forEach(function addRoom(room) {
      const card = document.createElement("article");
      card.className = "room-control";
      card.dataset.roomId = room.id;

      const handle = document.createElement("span");
      handle.className = "drag-handle vertical-handle";
      handle.textContent = "⠿";
      handle.draggable = true;
      handle.title = "Drag to reorder";

      const name = document.createElement("strong");
      name.className = "list-card-name";
      name.textContent = room.label;

      const visibility = document.createElement("button");
      visibility.type = "button";
      visibility.className = "visibility-button";
      visibility.addEventListener("click", function toggleRoom() {
        setVisibilityButton(visibility, visibility.dataset.enabled !== "true", room.label);
        syncHostFormatSelect();
      });

      const controls = document.createElement("div");
      controls.className = "vertical-moves";
      controls.append(
        createListMoveButton(roomsGrid, "Move " + room.label + " up", "↑", -1),
        createListMoveButton(roomsGrid, "Move " + room.label + " down", "↓", 1)
      );
      const actions = document.createElement("div");
      actions.className = "list-card-actions";
      actions.append(visibility, controls);
      card.append(handle, name, actions);
      roomsGrid.appendChild(card);

      handle.addEventListener("dragstart", function roomDragStarted(event) {
        draggedRoom = card;
        card.classList.add("dragging");
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", room.id);
      });
      handle.addEventListener("dragend", function roomDragEnded() {
        card.classList.remove("dragging");
        draggedRoom = null;
        syncHostFormatSelect();
      });
    });

    roomsGrid.addEventListener("dragover", function roomDragOver(event) {
      if (!draggedRoom) return;
      event.preventDefault();
      const target = event.target.closest(".room-control");
      if (!target || target === draggedRoom) return;
      const rectangle = target.getBoundingClientRect();
      smoothInsert(roomsGrid, draggedRoom, event.clientY > rectangle.top + rectangle.height / 2 ? target.nextSibling : target, ".room-control");
    });
  }
  function colorToHex(value, fallback) {
    const direct = /^#([0-9a-f]{6})$/i.exec(value || "");
    if (direct) return "#" + direct[1];
    const short = /^#([0-9a-f]{3})$/i.exec(value || "");
    if (short) {
      return (
        "#" +
        short[1]
          .split("")
          .map(function doubleHex(character) {
            return character + character;
          })
          .join("")
      );
    }
    const rgb = /rgba?\(\s*(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)/i.exec(
      value || ""
    );
    if (rgb) {
      return (
        "#" +
        rgb
          .slice(1, 4)
          .map(function channelToHex(channel) {
            return Math.max(0, Math.min(255, Math.round(Number(channel))))
              .toString(16)
              .padStart(2, "0");
          })
          .join("")
      );
    }
    return fallback || "#000000";
  }

  function validCssColor(value) {
    return Boolean(value && CSS.supports("color", value));
  }

  function resizeImageFile(file, width, height) {
    return new Promise(function resizePromise(resolve, reject) {
      if (!file || !file.type.startsWith("image/")) {
        reject(new Error("Choose a PNG, JPEG, or WebP image."));
        return;
      }
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("The image could not be read."));
      reader.onload = function imageRead() {
        const image = new Image();
        image.onerror = () => reject(new Error("The image could not be decoded."));
        image.onload = function imageLoaded() {
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext("2d");
          const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
          const sourceWidth = width / scale;
          const sourceHeight = height / scale;
          context.drawImage(image, (image.naturalWidth - sourceWidth) / 2, (image.naturalHeight - sourceHeight) / 2, sourceWidth, sourceHeight, 0, 0, width, height);
          const data = canvas.toDataURL("image/webp", 0.82);
          if (data.length > 2500000) reject(new Error("The resized image is still too large."));
          else resolve(data);
        };
        image.src = String(reader.result);
      };
      reader.readAsDataURL(file);
    });
  }

  function buildColorGroups(settings) {
    colorGroups.textContent = "";
    const groups = new Map();

    core.COLOR_DEFINITIONS.forEach(function addColorDefinition(definition) {
      if (!groups.has(definition.group)) groups.set(definition.group, []);
      groups.get(definition.group).push(definition);
    });

    groups.forEach(function buildGroup(definitions, groupName) {
      const section = document.createElement("section");
      section.className = "color-group panel";
      const heading = document.createElement("h3");
      heading.textContent = groupName;
      const list = document.createElement("div");
      list.className = "color-list";

      definitions.forEach(function buildColorControl(definition) {
        const defaults = core.splitColorValue(definition.defaultValue);
        const override = settings.customColors[definition.key] || {};
        const displayedColor = override.color || defaults.color;
        const displayedOpacity =
          override.opacity === undefined ? defaults.opacity : override.opacity;
        const row = document.createElement("div");
        row.className = "color-control";
        row.dataset.colorKey = definition.key;
        row.dataset.colorOverridden = override.color ? "true" : "false";
        row.dataset.opacityOverridden =
          override.opacity === undefined ? "false" : "true";
        row._dbxImageData = override.imageData || "";
        row._dbxImageName = override.imageName || "";

        const label = document.createElement("label");
        label.className = "color-label";
        const name = document.createElement("strong");
        name.textContent = definition.label;
        label.append(name);

        const picker = document.createElement("input");
        picker.type = "color";
        picker.className = "color-picker";
        picker.value = colorToHex(displayedColor, "#000000");
        picker.setAttribute("aria-label", definition.label + " color picker");

        const valueInput = document.createElement("input");
        valueInput.type = "text";
        valueInput.className = "color-value";
        valueInput.value = displayedColor;
        valueInput.maxLength = 64;
        valueInput.spellcheck = false;
        valueInput.setAttribute("aria-label", definition.label + " color value");

        const colorEditor = document.createElement("div");
        colorEditor.className = "color-editor";
        colorEditor.append(picker, valueInput);

        const opacityEditor = document.createElement("div");
        opacityEditor.className = "opacity-editor";
        const opacityLabel = document.createElement("span");
        opacityLabel.textContent = "Opacity";
        const opacityRange = document.createElement("input");
        opacityRange.type = "range";
        opacityRange.className = "opacity-range";
        opacityRange.min = "0";
        opacityRange.max = "100";
        opacityRange.step = "1";
        opacityRange.value = String(Math.round(displayedOpacity * 100));
        const opacityNumber = document.createElement("input");
        opacityNumber.type = "number";
        opacityNumber.className = "opacity-number";
        opacityNumber.min = "0";
        opacityNumber.max = "100";
        opacityNumber.step = "1";
        opacityNumber.value = opacityRange.value;
        opacityNumber.setAttribute("aria-label", definition.label + " opacity percent");
        const percent = document.createElement("span");
        percent.textContent = "%";
        opacityEditor.append(opacityLabel, opacityRange, opacityNumber, percent);

        const reset = document.createElement("button");
        reset.type = "button";
        reset.className = "color-reset";
        reset.textContent = "Reset";

        const imageEditor = document.createElement("div");
        imageEditor.className = "image-editor";
        if (definition.imageAspect) {
          const imageButton = document.createElement("label");
          imageButton.className = "image-button";
          const imageButtonText = document.createElement("span");
          imageButtonText.textContent = "Load image · " + definition.imageAspect;
          const imageInput = document.createElement("input");
          imageInput.type = "file";
          imageInput.accept = "image/png,image/jpeg,image/webp";
          const imageName = document.createElement("span");
          imageName.className = "image-name";
          imageName.textContent = override.imageName || "";
          imageButton.append(imageButtonText, imageInput);
          imageEditor.append(imageButton, imageName);
          imageInput.addEventListener("change", async function imageChanged() {
            const file = imageInput.files && imageInput.files[0];
            if (!file) return;
            try {
              row._dbxImageData = await resizeImageFile(file, definition.imageWidth, definition.imageHeight);
              row._dbxImageName = file.name.slice(0, 100);
              imageName.textContent = row._dbxImageName;
              saveChanges();
            } catch (error) {
              showSavedStatus(error.message);
            } finally {
              imageInput.value = "";
            }
          });
        }

        picker.addEventListener("input", function pickerChanged() {
          valueInput.value = picker.value;
          valueInput.setCustomValidity("");
          row.dataset.colorOverridden = "true";
        });
        valueInput.addEventListener("input", function colorTextChanged() {
          const value = valueInput.value.trim();
          const valid = validCssColor(value);
          valueInput.setCustomValidity(valid ? "" : "Enter a valid CSS color.");
          if (valid) {
            picker.value = colorToHex(value, picker.value);
            row.dataset.colorOverridden = "true";
          }
        });
        function opacityChanged(source, target) {
          const bounded = Math.max(0, Math.min(100, Number(source.value) || 0));
          source.value = String(bounded);
          target.value = String(bounded);
          row.dataset.opacityOverridden = "true";
        }
        opacityRange.addEventListener("input", function rangeChanged() {
          opacityChanged(opacityRange, opacityNumber);
        });
        opacityNumber.addEventListener("input", function numberChanged() {
          opacityChanged(opacityNumber, opacityRange);
        });
        reset.addEventListener("click", function resetColor() {
          valueInput.value = defaults.color;
          valueInput.setCustomValidity("");
          picker.value = colorToHex(defaults.color, "#000000");
          opacityRange.value = String(Math.round(defaults.opacity * 100));
          opacityNumber.value = opacityRange.value;
          row.dataset.colorOverridden = "false";
          row.dataset.opacityOverridden = "false";
          row._dbxImageData = "";
          row._dbxImageName = "";
          const imageName = row.querySelector(".image-name");
          if (imageName) imageName.textContent = "";
        });

        label.htmlFor = "color-" + definition.key;
        valueInput.id = "color-" + definition.key;
        row.append(label, colorEditor, opacityEditor);
        if (definition.imageAspect) row.append(imageEditor);
        row.append(reset);
        list.appendChild(row);
      });

      section.append(heading, list);
      colorGroups.appendChild(section);
    });
  }

  function updateRowState(row) {
    const checkbox = row.querySelector(".field-checkbox");
    const direction = row.querySelector(".direction-select");
    row.classList.toggle("disabled-field", !checkbox.checked);
    direction.disabled = !checkbox.checked;
  }

  function moveRow(row, direction) {
    const list = row.parentElement;
    const rows = Array.from(list.querySelectorAll(".sort-row"));
    const index = rows.indexOf(row);
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= rows.length) return;

    if (direction < 0) {
      list.insertBefore(row, rows[targetIndex]);
    } else {
      list.insertBefore(rows[targetIndex], row);
    }
  }

  function createMoveButton(label, symbol, direction) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "move-button";
    button.textContent = symbol;
    button.setAttribute("aria-label", label);
    button.addEventListener("click", function moveClicked(event) {
      moveRow(event.currentTarget.closest(".sort-row"), direction);
    });
    return button;
  }

  function createSortRow(rowSettings) {
    const row = document.createElement("li");
    row.className = "sort-row";
    row.dataset.fieldKey = rowSettings.key;

    const handle = document.createElement("span");
    handle.className = "drag-handle";
    handle.textContent = "⋮⋮";
    handle.setAttribute("aria-hidden", "true");
    handle.draggable = true;

    const toggle = document.createElement("label");
    toggle.className = "field-toggle";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "field-checkbox";
    checkbox.checked = rowSettings.enabled;
    checkbox.addEventListener("change", function toggleChanged() {
      updateRowState(row);
    });
    const labelText = document.createElement("span");
    labelText.textContent = core.FIELD_LIBRARY[rowSettings.key].label;
    toggle.append(checkbox, labelText);

    const direction = document.createElement("select");
    direction.className = "direction-select";
    direction.setAttribute("aria-label", labelText.textContent + " direction");
    fillSelect(direction, [
      { value: "asc", label: "Ascending" },
      { value: "desc", label: "Descending" }
    ]);
    direction.value = rowSettings.direction;

    const moveControls = document.createElement("div");
    moveControls.className = "move-controls";
    moveControls.append(
      createMoveButton("Move " + labelText.textContent + " up", "↑", -1),
      createMoveButton("Move " + labelText.textContent + " down", "↓", 1)
    );

    row.append(handle, toggle, direction, moveControls);
    updateRowState(row);

    handle.addEventListener("dragstart", function dragStarted(event) {
      event.stopPropagation();
      draggedRow = row;
      row.classList.add("dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", rowSettings.key);
    });
    handle.addEventListener("dragend", function dragEnded() {
      row.classList.remove("dragging");
      draggedRow = null;
    });

    return row;
  }

  function readSortGroupsFromDom() {
    return Array.from(categoryContainer.querySelectorAll(".sort-card")).map(
      function readGroup(card) {
        return {
          id: card.dataset.groupId,
          types: Array.from(card.querySelectorAll(".type-chip")).map(
            chip => chip.dataset.typeKey
          ),
          rows: Array.from(card.querySelectorAll(".sort-row")).map(function readRow(row) {
            return {
              key: row.dataset.fieldKey,
              enabled: row.querySelector(".field-checkbox").checked,
              direction: row.querySelector(".direction-select").value
            };
          })
        };
      }
    );
  }

  function mutateGroups(mutator) {
    const groups = readSortGroupsFromDom();
    mutator(groups);
    groups.forEach(group => {
      group.types.sort(
        (first, second) =>
          core.TYPE_ORDER.indexOf(first) - core.TYPE_ORDER.indexOf(second)
      );
      group.rows = core.normalizeGroupRows(group.types, group.rows);
    });
    currentSettings.customSort.groups = groups;
    buildSortCategories(currentSettings);
    saveChanges();
  }

  function moveGroup(card, direction) {
    mutateGroups(function reorder(groups) {
      const index = Array.from(categoryContainer.querySelectorAll(".sort-card")).indexOf(card);
      const target = index + direction;
      if (target < 0 || target >= groups.length) return;
      const moved = groups.splice(index, 1)[0];
      groups.splice(target, 0, moved);
    });
  }

  function moveType(typeKey, groupIndex, mode) {
    mutateGroups(function changeMembership(groups) {
      const source = groups[groupIndex];
      const typeIndex = source.types.indexOf(typeKey);
      if (typeIndex < 0) return;
      source.types.splice(typeIndex, 1);
      if (mode === "separate") {
        groups.splice(groupIndex + 1, 0, {
          id: "group-new",
          types: [typeKey],
          rows: core.defaultRowsForTypes([typeKey])
        });
      } else {
        const targetIndex = mode === "previous" ? groupIndex - 1 : groupIndex + 1;
        if (targetIndex < 0 || targetIndex >= groups.length) {
          source.types.splice(typeIndex, 0, typeKey);
          return;
        }
        if (mode === "previous") groups[targetIndex].types.push(typeKey);
        else groups[targetIndex].types.unshift(typeKey);
      }
      if (!source.types.length) groups.splice(groupIndex, 1);
    });
  }

  function createTypeChip(typeKey, groupIndex, groupCount, groupSize) {
    const chip = document.createElement("div");
    chip.className = "type-chip";
    chip.dataset.typeKey = typeKey;
    const label = document.createElement("strong");
    label.textContent = core.TYPE_DEFINITIONS[typeKey].label;
    const controls = document.createElement("span");
    controls.className = "type-chip-controls";
    [
      { mode: "previous", text: "←", label: "Join previous group", disabled: groupIndex === 0 },
      { mode: "separate", text: "◇", label: "Separate into its own group", disabled: groupSize === 1 },
      { mode: "next", text: "→", label: "Join next group", disabled: groupIndex === groupCount - 1 }
    ].forEach(config => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = config.text;
      button.title = config.label;
      button.setAttribute("aria-label", config.label + ": " + core.TYPE_DEFINITIONS[typeKey].label);
      button.disabled = config.disabled;
      button.addEventListener("click", () => moveType(typeKey, groupIndex, config.mode));
      controls.appendChild(button);
    });
    chip.append(label, controls);
    return chip;
  }

  function buildSortCategories(settings) {
    categoryContainer.textContent = "";

    settings.customSort.groups.forEach(function addGroup(group, groupIndex) {
      const card = document.createElement("section");
      card.className = "sort-card";
      card.dataset.groupId = group.id;

      const header = document.createElement("div");
      header.className = "sort-card-header";
      const headerTitle = document.createElement("div");
      headerTitle.className = "group-title";
      const handle = document.createElement("span");
      handle.className = "drag-handle";
      handle.textContent = "⋮⋮";
      handle.draggable = true;
      const heading = document.createElement("h3");
      heading.textContent = "Sort group " + (groupIndex + 1);
      headerTitle.append(handle, heading);
      const groupMoves = document.createElement("div");
      groupMoves.className = "group-move-controls";
      [-1, 1].forEach(direction => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "room-move-button";
        button.textContent = direction < 0 ? "↑" : "↓";
        button.setAttribute("aria-label", "Move group " + (direction < 0 ? "up" : "down"));
        button.addEventListener("click", () => moveGroup(card, direction));
        groupMoves.appendChild(button);
      });
      header.append(headerTitle, groupMoves);

      const chips = document.createElement("div");
      chips.className = "type-chips";
      group.types.forEach(typeKey => {
        chips.appendChild(createTypeChip(typeKey, groupIndex, settings.customSort.groups.length, group.types.length));
      });

      const list = document.createElement("ol");
      list.className = "sort-list";
      list.setAttribute("aria-label", "Sort group " + (groupIndex + 1) + " hierarchy");

      const pinned = document.createElement("li");
      pinned.className = "pinned-row";
      pinned.innerHTML =
        '<span class="pin-icon" aria-hidden="true">●</span>' +
        '<strong>Group position</strong><span>Primary sort</span><span></span>';
      list.appendChild(pinned);

      group.rows.forEach(function addField(row) {
        list.appendChild(createSortRow(row));
      });

      list.addEventListener("dragover", function dragOver(event) {
        if (!draggedRow || draggedRow.parentElement !== list) return;
        event.preventDefault();
        const target = event.target.closest(".sort-row");
        if (!target || target === draggedRow) return;
        const rectangle = target.getBoundingClientRect();
        const after = event.clientY > rectangle.top + rectangle.height / 2;
        smoothInsert(
          list,
          draggedRow,
          after ? target.nextSibling : target,
          ".sort-row"
        );
      });

      handle.addEventListener("dragstart", function groupDragStarted(event) {
        draggedGroup = card;
        card.classList.add("dragging");
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", group.id);
      });
      handle.addEventListener("dragend", function groupDragEnded() {
        card.classList.remove("dragging");
        draggedGroup = null;
      });

      card.append(header, chips, list);
      categoryContainer.appendChild(card);
    });

    categoryContainer.ondragover = function groupDragOver(event) {
      if (!draggedGroup) return;
      event.preventDefault();
      const target = event.target.closest(".sort-card");
      if (!target || target === draggedGroup) return;
      const rectangle = target.getBoundingClientRect();
      const nearSameRow =
        Math.abs(event.clientY - (rectangle.top + rectangle.height / 2)) <
        rectangle.height * 0.3;
      const after = nearSameRow
        ? event.clientX > rectangle.left + rectangle.width / 2
        : event.clientY > rectangle.top + rectangle.height / 2;
      smoothInsert(
        categoryContainer,
        draggedGroup,
        after ? target.nextSibling : target,
        ".sort-card"
      );
    };
  }

  function syncRpsSettingsAvailability() {
    const disabled = !document.getElementById("rps-enhancements").checked;
    ["manual", "repeat", "automatic"].forEach(mode => {
      document.getElementById("rps-mode-" + mode).disabled = disabled;
    });
  }

  document.getElementById("rps-enhancements").addEventListener("change", syncRpsSettingsAvailability);

  function renderSettings(settings) {
    currentSettings = core.sanitizeSettings(settings);

    currentSettings.roomOrder.forEach(function orderRoom(roomId) {
      const row = roomsGrid.querySelector(
        '.room-control[data-room-id="' + roomId + '"]'
      );
      if (row) roomsGrid.appendChild(row);
    });

    roomsGrid.querySelectorAll("[data-room-id]").forEach(function setRoom(input) {
      if (!input.matches(".room-control")) return;
      setVisibilityButton(input.querySelector(".visibility-button"), currentSettings.visibleRooms[input.dataset.roomId], core.ROOM_DEFINITIONS.find(room => room.id === input.dataset.roomId).label);
    });

    syncHostFormatSelect(currentSettings.hostDefaults.format);
    document.getElementById("host-type").value = currentSettings.hostDefaults.type;
    document.getElementById("host-rules").value =
      currentSettings.hostDefaults.rules;
    document.getElementById("duel-note").value =
      currentSettings.hostDefaults.duelNote;
    document.getElementById("duel-password").value =
      currentSettings.hostDefaults.duelPassword;
    document.getElementById("watching").checked =
      currentSettings.hostDefaults.watching;
    document.getElementById("classic").checked =
      currentSettings.hostDefaults.classic;
    document.getElementById("tag-duel").checked =
      currentSettings.hostDefaults.tagDuel;
    document.getElementById("watch-note").value =
      currentSettings.hostDefaults.watchNote;
    document.getElementById("watch-password").value =
      currentSettings.hostDefaults.watchPassword;
    document.getElementById("preserve-last-used").checked =
      currentSettings.hostDefaults.preserveLastUsed;
    document.getElementById("remember-card-list").checked =
      currentSettings.rememberCardList;
    document.getElementById("show-grid-lines").checked =
      currentSettings.showGridLines;
    document.getElementById("rps-enhancements").checked = currentSettings.rpsEnhancements;
    document.getElementById("auto-go-first").checked = currentSettings.autoGoFirst;
    document.getElementById("auto-pay-activation-costs").checked = currentSettings.autoPayActivationCosts;
    document.getElementById("automation-confirm-selections").checked = currentSettings.automationConfirmSelections;
    renderAutomationLists();
    document.getElementById("battle-damage-confirmation").checked = currentSettings.battleDamageConfirmation;
    document.getElementById("auto-shuffle-hand").checked = currentSettings.autoShuffleHand;
    document.getElementById("auto-shuffle-after-draw").checked = currentSettings.autoShuffleAfterDraw;
    document.getElementById("hand-shuffle-aggressiveness").value = currentSettings.handShuffleAggressiveness;
    renderShuffleTiming();
    const rpsMode = currentSettings.autoStartRps ? "automatic" : currentSettings.autoPickRps ? "repeat" : "manual";
    ["manual", "repeat", "automatic"].forEach(mode => {
      document.getElementById("rps-mode-" + mode).checked = mode === rpsMode;
    });
    syncRpsSettingsAvailability();

    buildSortCategories(currentSettings);
    renderCardPools();
    buildColorGroups(currentSettings);
    applyAppearance();
  }

  function readSettingsFromForm() {
    const candidate = core.copy(currentSettings);

    roomsGrid.querySelectorAll("[data-room-id]").forEach(function readRoom(input) {
      if (input.matches(".room-control")) candidate.visibleRooms[input.dataset.roomId] = input.querySelector(".visibility-button").dataset.enabled === "true";
    });
    candidate.roomOrder = Array.from(
      roomsGrid.querySelectorAll(".room-control")
    ).map(function readRoomOrder(row) {
      return row.dataset.roomId;
    });

    candidate.hostDefaults = {
      format: document.getElementById("host-format").value,
      type: document.getElementById("host-type").value,
      rules: document.getElementById("host-rules").value,
      duelNote: document.getElementById("duel-note").value,
      duelPassword: document.getElementById("duel-password").value,
      watching: document.getElementById("watching").checked,
      classic: document.getElementById("classic").checked,
      tagDuel: document.getElementById("tag-duel").checked,
      watchNote: document.getElementById("watch-note").value,
      watchPassword: document.getElementById("watch-password").value,
      preserveLastUsed: document.getElementById("preserve-last-used").checked
    };

    candidate.rememberCardList =
      document.getElementById("remember-card-list").checked;
    candidate.showGridLines =
      document.getElementById("show-grid-lines").checked;
    candidate.rpsEnhancements = document.getElementById("rps-enhancements").checked;
    candidate.autoGoFirst = document.getElementById("auto-go-first").checked;
    candidate.autoPayActivationCosts = document.getElementById("auto-pay-activation-costs").checked;
    candidate.automationConfirmSelections = document.getElementById("automation-confirm-selections").checked;
    candidate.automationLists = readAutomationLists();
    candidate.battleDamageConfirmation = document.getElementById("battle-damage-confirmation").checked;
    candidate.autoShuffleHand = document.getElementById("auto-shuffle-hand").checked;
    candidate.autoShuffleAfterDraw = document.getElementById("auto-shuffle-after-draw").checked;
    candidate.handShuffleAggressiveness = Number(document.getElementById("hand-shuffle-aggressiveness").value);
    candidate.autoStartRps = document.getElementById("rps-mode-automatic").checked;
    candidate.autoPickRps = candidate.autoStartRps || document.getElementById("rps-mode-repeat").checked;
    candidate.customSort.groups = readSortGroupsFromDom();
    candidate.cardPools.order = Array.from(cardPoolList.querySelectorAll(".card-pool-card")).map(card => card.dataset.poolId);
    candidate.cardPools.enabled = {};
    cardPoolList.querySelectorAll(".card-pool-card").forEach(function readPool(card) {
      candidate.cardPools.enabled[card.dataset.poolId] = card.querySelector(".visibility-button").dataset.enabled === "true";
    });

    if (candidate.hostDefaults.format !== "so" && candidate.visibleRooms[candidate.hostDefaults.format] === false) {
      const selected = core.HOST_FORMAT_OPTIONS.find(option => option.value === candidate.hostDefaults.format);
      throw new Error((selected ? selected.label : "The selected Host format") + " must be enabled under Visible Rooms.");
    }

    candidate.customColors = {};
    colorGroups.querySelectorAll(".color-control").forEach(function readColor(row) {
      const override = {};
      if (row.dataset.colorOverridden === "true") {
        const value = row.querySelector(".color-value").value.trim();
        if (!validCssColor(value)) {
          throw new Error("Please correct the highlighted color value.");
        }
        override.color = value;
      }
      if (row.dataset.opacityOverridden === "true") {
        override.opacity =
          Number(row.querySelector(".opacity-number").value) / 100;
      }
      if (row._dbxImageData) {
        override.imageData = row._dbxImageData;
        override.imageName = row._dbxImageName || "";
      }
      if (Object.keys(override).length) {
        candidate.customColors[row.dataset.colorKey] = override;
      }
    });

    return core.sanitizeSettings(candidate);
  }

  function showSavedStatus(message, state = "error") {
    saveStatus.textContent = message;
    saveStatus.dataset.state = state;
    document.getElementById("retry-save").hidden = state !== "error";
  }

  function saveChanges() {
    if (autosave) return autosave.save();
  }

  function applyAppearance() {
    document.documentElement.dataset.mode = currentSettings.appearance.mode;
    document.documentElement.dataset.theme = currentSettings.appearance.theme;
    document.getElementById("mode-toggle").textContent = currentSettings.appearance.mode === "dark" ? "Light mode" : "Dark mode";
    document.querySelectorAll("[data-theme-choice]").forEach(button => {
      button.setAttribute("aria-pressed", String(button.dataset.themeChoice === currentSettings.appearance.theme));
    });
  }

  buildRooms();
  fillSelect(document.getElementById("host-format"), core.HOST_FORMAT_OPTIONS);
  fillSelect(document.getElementById("host-type"), core.HOST_TYPE_OPTIONS);
  fillSelect(document.getElementById("host-rules"), core.HOST_RULE_OPTIONS);

  document.querySelectorAll(".password-toggle").forEach(function installPasswordToggle(button) {
    const input = document.getElementById(button.dataset.passwordTarget);
    if (!input) return;
    setPasswordVisibility(button, input, false);
    button.addEventListener("click", function togglePassword() {
      const reveal = input.type === "password";
      setPasswordVisibility(button, input, reveal);
    });
  });

  customBanlistInput.addEventListener("change", async function importBanlists() {
    const files = Array.from(customBanlistInput.files || []);
    if (!files.length) return;
    try {
      currentSettings.cardPools.order = Array.from(cardPoolList.querySelectorAll(".card-pool-card")).map(card => card.dataset.poolId);
      const imported = [];
      for (const file of files) {
        const parsed = JSON.parse(await file.text());
        const candidates = Array.isArray(parsed)
          ? parsed
          : Array.isArray(parsed.banlists)
            ? parsed.banlists
            : [parsed];
        candidates.forEach(function normalizeCandidate(candidate, index) {
          imported.push(
            normalizeUploadedBanlist(candidate, file.name, imported.length + index)
          );
        });
      }
      currentSettings = core.sanitizeSettings({
        ...currentSettings,
        customBanlists: currentSettings.customBanlists.concat(imported),
        cardPools: {
          order: currentSettings.cardPools.order.concat(imported.map(list => list.id)),
          enabled: Object.assign({}, currentSettings.cardPools.enabled, Object.fromEntries(imported.map(list => [list.id, true])))
        }
      });
      renderCardPools();
      saveChanges();
    } catch (error) {
      showSavedStatus("Import failed: " + error.message);
    } finally {
      customBanlistInput.value = "";
    }
  });

  document.getElementById("mode-toggle").addEventListener("click", function toggleMode() {
    currentSettings.appearance.mode = currentSettings.appearance.mode === "dark" ? "light" : "dark";
    applyAppearance();
    saveChanges();
  });

  document.querySelectorAll("[data-theme-choice]").forEach(function installTheme(button) {
    button.addEventListener("click", function chooseTheme() {
      currentSettings.appearance.theme = button.dataset.themeChoice;
      applyAppearance();
      saveChanges();
    });
  });

  let pendingRuleImport = null;
  let ruleImportGeneration = 0;
  let localWatchGeneration = 0;
  let localWatcher = null;
  const ruleTools = ["rules-import-tools", "rules-local-tools"].map(id => document.getElementById(id));
  for (const tool of ruleTools) tool.addEventListener("toggle", () => {
    if (tool.open) for (const other of ruleTools) if (other !== tool) other.open = false;
  });
  document.addEventListener("pointerdown", event => {
    for (const tool of ruleTools) if (tool.open && !tool.contains(event.target)) tool.open = false;
  });
  document.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    for (const tool of ruleTools) if (tool.open) { tool.open = false; tool.querySelector("summary").focus(); }
  });
  function requestRulesPermission(permissions) {
    return new Promise((resolve, reject) => {
      chrome.permissions.request(permissions, granted => {
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message));
        else resolve(granted);
      });
    });
  }
  function stopLocalWatch(message = "Stopped watching. The last saved rules remain installed.") {
    localWatchGeneration++;
    if (localWatcher) localWatcher.stop();
    localWatcher = null;
    document.getElementById("automation-list-local-url").disabled = false;
    document.getElementById("automation-list-watch").disabled = false;
    document.getElementById("automation-list-watch-stop").hidden = true;
    document.getElementById("automation-list-watch-status").textContent = message;
  }
  document.getElementById("automation-list-watch-stop").addEventListener("click", () => stopLocalWatch());
  document.getElementById("automation-list-local-url").addEventListener("change", event => {
    try { event.target.value = window.DBEnhancerRuleListDownload.normalizeLocalUrl(event.target.value); }
    catch (_) { /* Keep incomplete input editable; Watch reports validation errors. */ }
  });
  document.getElementById("automation-list-watch").addEventListener("click", async () => {
    stopLocalWatch("Starting local development…");
    const generation = localWatchGeneration;
    const start = document.getElementById("automation-list-watch");
    const input = document.getElementById("automation-list-local-url");
    start.disabled = true;
    input.disabled = true;
    document.getElementById("automation-list-watch-stop").hidden = false;
    try {
      const url = window.DBEnhancerRuleListDownload.normalizeLocalUrl(input.value);
      input.value = url;
      const granted = await requestRulesPermission({ origins: ["http://127.0.0.1/*"] });
      if (generation !== localWatchGeneration) return;
      if (!granted) throw new Error("Local development permission was not granted.");
      localWatcher = window.DBEnhancerRuleListWatch.create({
        core,
        read: () => window.DBEnhancerRuleListDownload.fetchText(url),
        async apply(list, isCurrent) {
          if (!isCurrent()) return;
          ruleCardValidation.check(list);
          const latest = readSettingsFromForm();
          latest.automationLists = window.DBEnhancerRuleListWatch.mergeList(latest.automationLists, list);
          const candidate = latest.automationLists.find(item => item.id === list.id);
          currentSettings = latest;
          renderAutomationLists();
          await saveChanges();
          const committed = await settingsClient.execute({ type: "get-settings" });
          const saved = committed.automationLists.find(item => item.id === list.id);
          if (!saved || core.exportAutomationList(saved) !== core.exportAutomationList(candidate) || saved.enabled !== candidate.enabled) {
            throw new Error("The updated list was not saved. Check the settings save status.");
          }
        },
        status(message) { document.getElementById("automation-list-watch-status").textContent = message; }
      });
      await localWatcher.start();
    } catch (error) {
      if (generation === localWatchGeneration) stopLocalWatch("Could not start local development: " + error.message);
    }
  });
  window.addEventListener("pagehide", () => { if (localWatcher) stopLocalWatch("Local development stopped when settings navigated away."); });
  let ruleListTable = null;
  function readAutomationLists() {
    return ruleListTable ? ruleListTable.read(currentSettings.automationLists) : core.copy(currentSettings.automationLists);
  }
  function exportRuleList(id) {
    try {
      ruleImportGeneration++;
      const current = readAutomationLists().find(item => item.id === id);
      const text = document.getElementById("automation-list-json");
      text.value = core.exportAutomationList(current);
      text.closest("details").open = true;
      text.focus();
      text.select();
      pendingRuleImport = null;
      document.getElementById("automation-list-install").hidden = true;
      document.getElementById("automation-list-status").textContent = "Copy this JSON to share the list. Local enablement is not exported.";
    } catch (error) { showSavedStatus(error.message); }
  }
  function renderAutomationLists() {
    if (!ruleListTable) ruleListTable = window.DBEnhancerRuleListTable.create({
      document, container: document.getElementById("automation-list-rows"), core,
      onChange: saveChanges, onExport: exportRuleList
    });
    ruleListTable.render(currentSettings.automationLists);
  }
  const ruleCardValidation = window.DBEnhancerRuleCardValidation.create({ requestPermission: requestRulesPermission });
  document.getElementById("automation-list-json").addEventListener("input", () => {
    ruleImportGeneration++;
    pendingRuleImport = null;
    document.getElementById("automation-list-install").hidden = true;
    document.getElementById("automation-list-status").textContent = "List changed. Preview or validate again.";
  });
  document.getElementById("automation-list-url").addEventListener("input", () => {
    ruleImportGeneration++;
    pendingRuleImport = null;
    document.getElementById("automation-list-install").hidden = true;
  });
  function previewRuleImport() {
    const install = document.getElementById("automation-list-install");
    install.hidden = true;
    pendingRuleImport = null;
    try {
      const list = core.importAutomationList(document.getElementById("automation-list-json").value);
      ruleCardValidation.check(list);
      const existing = currentSettings.automationLists.find(item => item.id === list.id);
      pendingRuleImport = list;
      document.getElementById("automation-list-status").textContent =
        `${list.name} ${list.version}: ${list.rules.length} rule(s); formats: ${list.formats.join(", ")}. ` +
        (existing ? `Replaces ${existing.name} ${existing.version}. ` : "Adds a new list. ") + "Installs disabled. No actions run during import.";
      install.hidden = false;
    } catch (error) { document.getElementById("automation-list-status").textContent = "Import failed: " + error.message; }
  }
  document.getElementById("automation-list-preview").addEventListener("click", () => {
    ruleImportGeneration++;
    previewRuleImport();
  });
  document.getElementById("automation-list-validate").addEventListener("click", async event => {
    const button = event.currentTarget;
    const generation = ++ruleImportGeneration;
    pendingRuleImport = null;
    document.getElementById("automation-list-install").hidden = true;
    button.disabled = true;
    const status = document.getElementById("automation-list-status");
    try {
      const list = core.importAutomationList(document.getElementById("automation-list-json").value);
      status.textContent = "Downloading card catalog to check passcodes and names…";
      const result = await ruleCardValidation.downloadAndCheck(list);
      if (generation !== ruleImportGeneration) return;
      previewRuleImport();
      status.textContent += " Checked " + result.checked + " card identifier(s). " +
        (result.unknown.length ? "Unknown identifiers (names unverified): " + result.unknown.join(", ") + "." : "All identifiers and names match Duelingbook’s catalog.");
    } catch (error) {
      if (generation === ruleImportGeneration) status.textContent = "Validation failed: " + error.message;
    } finally { button.disabled = false; }
  });
  document.getElementById("automation-list-file").addEventListener("change", async event => {
    const file = event.target.files[0];
    if (!file) return;
    const generation = ++ruleImportGeneration;
    pendingRuleImport = null;
    document.getElementById("automation-list-install").hidden = true;
    try {
      if (file.size > 65536) throw new Error("Rules list exceeds 64 KB.");
      const text = await file.text();
      if (generation !== ruleImportGeneration) return;
      document.getElementById("automation-list-json").value = text;
      previewRuleImport();
    } catch (error) {
      if (generation === ruleImportGeneration) document.getElementById("automation-list-status").textContent = "Import failed: " + error.message;
    } finally { event.target.value = ""; }
  });
  document.getElementById("automation-list-fetch").addEventListener("click", async event => {
    const button = event.currentTarget;
    const generation = ++ruleImportGeneration;
    pendingRuleImport = null;
    document.getElementById("automation-list-install").hidden = true;
    button.disabled = true;
    document.getElementById("automation-list-status").textContent = "Loading rules list…";
    try {
      const text = await window.DBEnhancerRuleListDownload.download(document.getElementById("automation-list-url").value, {
        requestPermission: requestRulesPermission
      });
      if (generation !== ruleImportGeneration) return;
      document.getElementById("automation-list-json").value = text;
      previewRuleImport();
    } catch (error) {
      if (generation === ruleImportGeneration) document.getElementById("automation-list-status").textContent = "Download failed: " + error.message;
    } finally { button.disabled = false; }
  });
  document.getElementById("automation-list-install").addEventListener("click", () => {
    if (!pendingRuleImport) return;
    try {
      ruleCardValidation.check(pendingRuleImport);
      const latest = readSettingsFromForm();
      const others = latest.automationLists.filter(list => list.id !== pendingRuleImport.id);
      if (others.length >= 50) throw new Error("At most 50 rules lists can be installed.");
      currentSettings = { ...latest, automationLists: [...others, pendingRuleImport] };
      pendingRuleImport = null;
      renderAutomationLists();
      document.getElementById("automation-list-install").hidden = true;
      document.getElementById("automation-list-status").textContent = "Installed disabled. Review its formats, then enable it above.";
      saveChanges();
    } catch (error) { document.getElementById("automation-list-status").textContent = "Import failed: " + error.message; }
  });

  // Keep controls unavailable until the real settings have loaded.
  document.getElementById("settings-controls").disabled = true;
  document.querySelectorAll(".appearance-controls button").forEach(button => { button.disabled = true; });
  settingsClient.execute({ type: "get-settings" }).then(settings => {
    renderSettings(settings);
    autosave = window.DBEnhancerAutosave.create({
      baseline: core.copy(settings),
      read() {
        if (!form.checkValidity()) throw new Error("Correct the highlighted fields to save your changes.");
        return readSettingsFromForm();
      },
      write: command => settingsClient.execute(command),
      store: window.DBEnhancerSettingsStore,
      status: showSavedStatus
    });
    document.getElementById("settings-controls").disabled = false;
    document.querySelectorAll(".appearance-controls button").forEach(button => { button.disabled = false; });
    showSavedStatus("All changes saved", "saved");
  }).catch(error => showSavedStatus("Load failed: " + error.message, "load-error"));

  function renderShuffleTiming() {
    const slider = document.getElementById("hand-shuffle-aggressiveness");
    const timing = core.handShuffleTiming(Number(slider.value));
    const text = `Wait ${(timing.idleMs / 1000).toFixed(2)}s after drawing; pointer ${timing.distance}px away for ${(timing.awayMs / 1000).toFixed(2)}s.`;
    document.getElementById("hand-shuffle-timing").textContent = text;
    slider.setAttribute("aria-valuetext", text);
  }
  document.getElementById("hand-shuffle-aggressiveness").addEventListener("input", renderShuffleTiming);

  form.addEventListener("submit", function saveSettings(event) {
    event.preventDefault();
    saveChanges();
  });
  ["input", "change"].forEach(type => form.addEventListener(type, event => {
    if (event.target.type !== "file" && !event.target.closest(".rules-card-browser")) saveChanges();
  }));
  form.addEventListener("click", event => {
    if (event.target.closest(".visibility-button, .card-move-button, .move-button, .room-move-button, .type-chip-controls button, .color-reset, .delete-button")) saveChanges();
  });
  form.addEventListener("dragend", saveChanges);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") saveChanges();
  });

  document.getElementById("reset-settings").addEventListener("click", function reset() {
    if (!autosave || autosave.saving) return;
    const confirmed = window.confirm(
      "Reset rooms, host defaults, automation, Card Pools, Custom Sort, colors, and appearance?"
    );
    if (!confirmed) return;
    stopLocalWatch("Local development stopped by settings reset.");
    renderSettings(core.createDefaultSettings());
    autosave.save(true);
  });
})();
