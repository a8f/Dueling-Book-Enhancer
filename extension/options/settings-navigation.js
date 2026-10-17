(function () {
  "use strict";
  const sections = Array.from(document.querySelectorAll("section.settings-section"));
  const links = Array.from(document.querySelectorAll(".toc a"));
  const search = document.getElementById("settings-search");
  const status = document.getElementById("search-status");
  let selected = sections[0].getAttribute("aria-labelledby");

  function show(id, focus = false) {
    const section = sections.find(section => section.getAttribute("aria-labelledby") === id);
    if (!section) return false;
    selected = id;
    sections.forEach(item => { item.hidden = item !== section; });
    links.forEach(link => {
      if (link.hash === "#" + id) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
    if (focus) {
      const heading = document.getElementById(id);
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: "instant" });
    }
    return true;
  }
  function filter() {
    const words = search.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const matching = sections.filter((section, index) => {
      const text = section.textContent.toLowerCase();
      const matches = words.every(word => text.includes(word));
      links[index].hidden = !matches;
      if (words.length) section.querySelectorAll(".color-group").forEach(group => {
        group.open = words.every(word => group.textContent.toLowerCase().includes(word));
      });
      return matches;
    });
    status.hidden = !words.length;
    status.textContent = matching.length + (matching.length === 1 ? " section matches" : " sections match");
    document.getElementById("search-empty").hidden = matching.length > 0;
    if (!matching.length) sections.forEach(section => { section.hidden = true; });
    else {
      const current = matching.find(section => section.getAttribute("aria-labelledby") === selected) || matching[0];
      show(current.getAttribute("aria-labelledby"));
    }
  }
  links.forEach(link => link.addEventListener("click", event => {
    event.preventDefault();
    history.pushState(null, "", link.hash);
    show(link.hash.slice(1), true);
  }));
  search.addEventListener("input", filter);
  search.addEventListener("keydown", event => {
    if (event.key === "Escape") { search.value = ""; filter(); }
    if (event.key === "Enter") {
      event.preventDefault();
      const link = links.find(link => !link.hidden);
      if (link) link.click();
    }
  });
  window.addEventListener("hashchange", () => {
    search.value = "";
    filter();
    show(location.hash.slice(1) || sections[0].getAttribute("aria-labelledby"), true);
  });
  show(location.hash.slice(1)) || show(selected);
})();
