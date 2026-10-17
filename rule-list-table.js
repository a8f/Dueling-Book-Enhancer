(function attach(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.DBEnhancerRuleListTable = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";
  function cardPage(rules, { search = "", page = 0, pageSize = 10 } = {}) {
    const cards = new Map();
    for (const rule of rules) {
      if (!cards.has(rule.card.name)) cards.set(rule.card.name, { name: rule.card.name, rules: [] });
      cards.get(rule.card.name).rules.push(rule);
    }
    const query = search.trim().toLowerCase();
    const filtered = [...cards.values()].filter(card =>
      (card.name + " " + card.rules.map(rule => rule.label).join(" ")).toLowerCase().includes(query))
      .sort((a, b) => a.name.localeCompare(b.name));
    const size = [10, 25, 50].includes(Number(pageSize)) ? Number(pageSize) : 10;
    const pages = Math.max(1, Math.ceil(filtered.length / size));
    const current = Math.max(0, Math.min(pages - 1, Number.isInteger(page) ? page : 0));
    return { cards: filtered.slice(current * size, (current + 1) * size), page: current, pages,
      pageSize: size, total: filtered.length, all: cards.size,
      start: filtered.length ? current * size + 1 : 0, end: Math.min((current + 1) * size, filtered.length) };
  }
  function create({ document, container, core, onChange, onExport }) {
    const views = new Map();
    let preferences = new Map();
    const phaseNames = { DP: "Draw", SP: "Standby", M1: "Main 1", BP: "Battle", M2: "Main 2", EP: "End" };
    const formatName = value => value === "ar" ? "Advanced (Ranked)" : value === "er" ? "Edison (Ranked)" : value === "gr" ? "Goat (Ranked)" :
      core.HOST_FORMAT_OPTIONS.find(item => item.value === value)?.label || value;
    function element(tag, text, className) {
      const node = document.createElement(tag);
      if (text !== undefined) node.textContent = text;
      if (className) node.className = className;
      return node;
    }
    function button(text, action, className = "rules-small-button") {
      const node = element("button", text, className);
      node.type = "button";
      node.addEventListener("click", action);
      return node;
    }
    function header(table, labels) {
      const head = element("thead"), row = element("tr");
      for (const label of labels) {
        const cell = element("th", label);
        cell.scope = "col";
        row.appendChild(cell);
      }
      head.appendChild(row);
      table.appendChild(head);
    }
    function read(lists) {
      return lists.map(list => {
        const edited = preferences.get(list.id);
        return core.validateAutomationList({ ...list, enabled: edited ? edited.enabled : list.enabled,
          formats: edited ? [...edited.formats] : list.formats });
      });
    }
    function renderCards(list, host, view) {
      const controls = element("div", undefined, "rules-card-controls");
      const search = element("input");
      search.type = "search";
      search.placeholder = "Search cards or effects…";
      search.value = view.search;
      search.setAttribute("aria-label", "Search cards in " + list.name);
      const sizeLabel = element("label", "Rows ", "rules-page-size");
      const size = element("select");
      size.setAttribute("aria-label", "Cards per page for " + list.name);
      for (const count of [10, 25, 50]) {
        const option = element("option", String(count));
        option.value = String(count);
        size.appendChild(option);
      }
      size.value = String(view.pageSize);
      sizeLabel.appendChild(size);
      controls.append(search, sizeLabel);
      const table = element("table", undefined, "rules-cards-table");
      table.setAttribute("aria-label", list.name + " cards");
      header(table, ["Card", "Effect", "Activates from", "Phases", "Summon position"]);
      const body = element("tbody");
      table.appendChild(body);
      const footer = element("div", undefined, "rules-pagination");
      const status = element("span");
      status.setAttribute("role", "status");
      const navigation = element("div", undefined, "rules-page-buttons");
      const previous = button("Previous", () => { view.page--; update(); });
      const next = button("Next", () => { view.page++; update(); });
      previous.setAttribute("aria-label", "Previous card page for " + list.name);
      next.setAttribute("aria-label", "Next card page for " + list.name);
      navigation.append(previous, next);
      footer.append(status, navigation);
      host.append(controls, table, footer);
      function update() {
        const result = cardPage(list.rules, view);
        view.page = result.page;
        body.replaceChildren();
        for (const card of result.cards) {
          const row = element("tr");
          row.appendChild(element("td", card.name, "rules-card-name"));
          const labels = card.rules.map(rule => rule.label);
          const zones = [...new Set(card.rules.map(rule => rule.requires.sourceZone))];
          const phases = [...new Set(card.rules.flatMap(rule => rule.requires.phases))].map(phase => phaseNames[phase]);
          const positions = [...new Set(card.rules.flatMap(rule => rule.resolution.flatMap(step => step.positions || [])))];
          for (const text of [labels.join(" · "), zones.map(zone => zone === "graveyard" ? "Graveyard" : zone).join(", "),
            phases.join(", "), positions.join(" / ")]) row.appendChild(element("td", text));
          body.appendChild(row);
        }
        if (!result.cards.length) {
          const row = element("tr"), cell = element("td", "No cards match your search.", "rules-empty");
          cell.colSpan = 5;
          row.appendChild(cell);
          body.appendChild(row);
        }
        status.textContent = `${result.start}–${result.end} of ${result.total} cards · Page ${result.page + 1} of ${result.pages}`;
        previous.disabled = result.page === 0;
        next.disabled = result.page + 1 >= result.pages;
      }
      search.addEventListener("input", () => { view.search = search.value; view.page = 0; update(); });
      size.addEventListener("change", () => { view.pageSize = Number(size.value); view.page = 0; update(); });
      update();
    }
    function render(lists) {
      preferences = new Map(lists.map(list => [list.id, { enabled: list.enabled, formats: new Set(list.formats) }]));
      for (const id of views.keys()) if (!preferences.has(id)) views.delete(id);
      container.replaceChildren();
      const table = element("table", undefined, "rules-sets-table");
      table.setAttribute("aria-label", "Card rule sets");
      header(table, ["Rule set", "Enabled", "Cards", "Loads in", "Actions"]);
      const body = element("tbody");
      table.appendChild(body);
      if (!lists.length) {
        const row = element("tr"), cell = element("td", "No rule sets yet. Import a list or watch a local file to get started.", "rules-empty");
        cell.colSpan = 5;
        row.appendChild(cell);
        body.appendChild(row);
      }
      lists.forEach((list, index) => {
        const edited = preferences.get(list.id);
        if (!views.has(list.id)) views.set(list.id, { expanded: false, search: "", page: 0, pageSize: 10 });
        const view = views.get(list.id);
        const row = element("tr", undefined, "rules-set-row");
        const name = element("td");
        const childRow = element("tr", undefined, "rules-expanded-row");
        const childCell = element("td");
        childCell.colSpan = 5;
        const host = element("div", undefined, "rules-card-browser");
        host.id = "rules-card-browser-" + index;
        const toggle = button("", () => {
          view.expanded = !view.expanded;
          syncToggle();
          if (view.expanded && !host.children.length) renderCards(list, host, view);
        }, "rules-set-toggle");
        function syncToggle() {
          toggle.textContent = (view.expanded ? "▾ " : "▸ ") + list.name;
          toggle.setAttribute("aria-expanded", String(view.expanded));
          childRow.hidden = !view.expanded;
        }
        toggle.setAttribute("aria-controls", host.id);
        syncToggle();
        name.append(toggle, element("span", "v" + list.version, "rules-version"));
        row.appendChild(name);
        const enabledCell = element("td");
        const enabled = element("input");
        enabled.type = "checkbox";
        enabled.checked = list.enabled;
        enabled.setAttribute("role", "switch");
        enabled.setAttribute("aria-label", "Enable " + list.name);
        enabled.addEventListener("change", () => { edited.enabled = enabled.checked; onChange(); });
        enabledCell.appendChild(enabled);
        row.append(enabledCell, element("td", String(cardPage(list.rules).all), "rules-count"));
        const formatCell = element("td");
        const formats = element("details", undefined, "rules-formats");
        const summary = element("summary");
        summary.setAttribute("aria-label", "Formats for " + list.name);
        const options = element("div", undefined, "rules-format-options");
        const inputs = [];
        function syncFormats() {
          const names = [...edited.formats].map(formatName);
          summary.textContent = names.length <= 2 ? names.join(" · ") : names[0] + " +" + (names.length - 1);
          summary.title = names.join(", ");
          for (const input of inputs) input.disabled = edited.formats.size === 1 && input.checked;
        }
        for (const value of core.AUTOMATION_FORMATS) {
          const label = element("label");
          const input = element("input");
          input.type = "checkbox";
          input.checked = edited.formats.has(value);
          input.value = value;
          inputs.push(input);
          input.addEventListener("change", () => {
            if (input.checked) edited.formats.add(value);
            else edited.formats.delete(value);
            syncFormats();
            onChange();
          });
          label.append(input, element("span", formatName(value)));
          options.appendChild(label);
        }
        syncFormats();
        formats.append(summary, options);
        formatCell.appendChild(formats);
        row.appendChild(formatCell);
        const actions = element("td");
        actions.appendChild(button("Export", () => onExport(list.id)));
        row.appendChild(actions);
        body.append(row, childRow);
        childCell.appendChild(host);
        childRow.appendChild(childCell);
        if (view.expanded) renderCards(list, host, view);
      });
      container.appendChild(table);
    }
    return { render, read };
  }
  return { create, cardPage };
});
