"use strict";
const $ = (id) => document.getElementById(id);
const sample = [
  ["Sol Ring", "CMM · 396", 8, "C", "Nonfoil"],
  ["Arcane Signet", "ELD · 331", 9, "C", "Nonfoil"],
  ["Counterspell", "DMR · 45", 4, "U", "Nonfoil"],
  ["Cultivate", "M21 · 177", 3, "G", "Foil"],
  ["Opt", "ELD · 59", 6, "U", "Nonfoil"],
  ["Llanowar Elves", "M19 · 314", 2, "G", "Nonfoil"],
  ["Mind Stone", "WTH · 153", 5, "C", "Foil"],
  ["Rampant Growth", "M10 · 196", 7, "G", "Nonfoil"],
];
let rows,
  occupancy,
  selected,
  criteria,
  currentScreen,
  storage,
  anchor,
  allMatching;
const homes = {
  Overview:
    "Keep the dashboard as a task launch point with a clear Commander League entry. Existing dashboard URL remains valid.",
  Decks:
    "Deck library with folders, tags, search and views. Builder keeps Add card and paste/import close to the card list; Analysis, Sample Hands and Playtest retain their tool navigation.",
  Wishlist:
    "Keep manual and deck-derived needs, printing choices, quantity explanations and trade pairing. Help belongs near Need / Ready / Get, with results visible early.",
  Trades:
    "Partner overview, proposal comparison, active trades, physical confirmation and history retain their own scopes. Both sides stay visible during review.",
  Pricing:
    "Keep collection value, trends, movers, provider/currency and data status in a dedicated workspace. Worker maintenance remains in Administration.",
  "Public browsing":
    "Public home, inventory and decks retain their visibility rules. Signed-in users can still add eligible other-owner cards to their trade wishlist; public browsing is not permission to edit inventory.",
  "Commander League":
    "Open the separate League workspace: standings, monthly rounds, submitted decks, games and statistics. Organizer setup remains distinct; locked/public League decks never commit physical inventory.",
  "Add / Import / Export":
    "One collection entry, with clear Capture, Review, Export and History destinations. Keep manual add, CSV resolution/retry/skip, location assignment, explicit commit, undo and maintenance. No direct Moxfield fetching.",
  Notifications:
    "Keep unread count, recent activity, history, deep links and mark-read controls. Preferences and delivery history live under Account & settings.",
  "Account & settings":
    "One discoverable utility home for appearance, identity, sharing, pricing, notification categories, email, webhooks and password change. Preserve existing URLs, explicit save scopes, logout and authorized admin-mode entry/exit.",
  "Create location":
    "Contextual create form: owner when authorized, name, type, parent, visibility and applicable default sections. Creation must not displace the storage browser.",
  "Storage management":
    "Keep type management and deck-managed locations accessible as named secondary destinations. Preserve deck-location restrictions; do not mix them with ordinary storage moves.",
  "Location actions":
    "Rename/edit, reparent, visibility, move entire contents and export for this location. Delete contents/location are separate danger actions with their existing confirmation and ownership rules.",
  "Inventory item actions":
    "Retain per-stack editing, printing/finish/condition/language/notes, partial split, movement and audit history under existing capability checks. Deletion stays separate and explicitly confirmed.",
  "Add to deck":
    "Retain the existing authorized add-to-deck flow from card details. The prototype does not create or commit a deck card.",
  "Selection actions":
    "Export selected/all-matching in MTG Archives or Moxfield CSV. Authorized bulk delete remains separate from Move and requires confirmation. No export or deletion is simulated here.",
};
function showInfo(name) {
  $("info-title").textContent = name;
  $("info-content").textContent =
    homes[name] || "Retain this capability in the mapped workspace.";
  $("info-dialog").showModal();
}
function matching() {
  return rows.filter(
    (r) =>
      r.qty > 0 &&
      (!criteria.name ||
        r.name.toLowerCase().includes(criteria.name.toLowerCase())) &&
      (!criteria.finish || r.finish === criteria.finish) &&
      (!criteria.location || r.location === criteria.location) &&
      (!criteria.color || r.color === criteria.color) &&
      (!criteria.section || r.section === criteria.section),
  );
}
function selectedRows() {
  return rows.filter((r) => selected.has(r.id) && r.qty > 0);
}
function selectedCount() {
  return selectedRows().reduce((n, r) => n + r.qty, 0);
}
function textElement(tag, text, className) {
  const el = document.createElement(tag);
  el.textContent = text;
  if (className) el.className = className;
  return el;
}
function setScreen(screen, push = true) {
  currentScreen = screen;
  $("inventory-screen").hidden = screen !== "inventory";
  $("locations-screen").hidden = screen !== "locations";
  document.querySelectorAll("[data-screen]").forEach((el) => {
    if (el.dataset.screen === screen) el.setAttribute("aria-current", "page");
    else el.removeAttribute("aria-current");
  });
  $("primary-nav").classList.remove("mobile-open");
  $("mobile-menu").setAttribute("aria-expanded", "false");
  if (push) history.pushState({ screen }, "", `#${screen}`);
  render();
}
function reset() {
  rows = sample.map((r, id) => ({
    id,
    name: r[0],
    printing: r[1],
    qty: r[2],
    color: r[3],
    finish: r[4],
    location: "Intake",
    section: "",
  }));
  occupancy = [85, 68, 0, 93, 24, 51];
  [...occupancy, 3, 2].forEach((qty, i) =>
    rows.push({
      id: rows.length,
      name: [
        "Plains",
        "Island",
        "Swamp",
        "Mountain",
        "Forest",
        "Wastes",
        "Evolving Wilds",
        "Terramorphic Expanse",
      ][i],
      printing: "Synthetic storage lot",
      qty,
      color: "C",
      finish: "Nonfoil",
      location: "Vault A",
      section: i < 6 ? `Sect ${i}` : i === 6 ? "Unsectioned" : "Sect 10",
    }),
  );
  selected = new Set();
  criteria = {};
  anchor = null;
  allMatching = false;
  storage = "Vault A";
  $("card-search").value = "";
  $("finish-filter").value = "";
  $("location-filter").value = "";
  $("color-filter").value = "";
  $("storage-search").value = "";
  $("status").textContent = "";
  toggleFilters(false);
  setScreen("inventory", false);
  renderTree();
}
function toggleFilters(open) {
  $("filter-panel").hidden = !open;
  $("filter-toggle").setAttribute("aria-expanded", String(open));
  document
    .querySelector(".inventory-workspace")
    .classList.toggle("filters-open", open);
  if (open) $("finish-filter").focus();
}
function selectRow(id, event) {
  const visible = matching();
  if (event.shiftKey && anchor !== null) {
    const a = visible.findIndex((r) => r.id === anchor),
      b = visible.findIndex((r) => r.id === id);
    if (a >= 0 && b >= 0) {
      if (!event.ctrlKey && !event.metaKey) selected.clear();
      visible
        .slice(Math.min(a, b), Math.max(a, b) + 1)
        .forEach((r) => selected.add(r.id));
    }
  } else if (
    event.ctrlKey ||
    event.metaKey ||
    event.target.type === "checkbox"
  ) {
    selected.has(id) ? selected.delete(id) : selected.add(id);
    anchor = id;
  } else {
    selected = new Set([id]);
    anchor = id;
  }
  allMatching = false;
  render();
}
function render() {
  const visible = matching();
  $("result-count").textContent =
    `${visible.length} entries · ${visible.reduce((n, r) => n + r.qty, 0)} physical copies`;
  $("empty-results").hidden = visible.length > 0;
  $("card-rows").replaceChildren();
  visible.forEach((r) => {
    const tr = document.createElement("tr");
    tr.setAttribute("aria-selected", String(selected.has(r.id)));
    tr.dataset.row = String(r.id);
    const checkTd = document.createElement("td"),
      checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = selected.has(r.id);
    checkbox.setAttribute("aria-label", `Select ${r.name}`);
    checkbox.addEventListener("click", (e) => {
      e.stopPropagation();
      selectRow(r.id, e);
      $("card-rows").querySelector(`[data-row="${r.id}"] input`)?.focus();
    });
    checkTd.append(checkbox);
    tr.append(checkTd);
    const nameTd = document.createElement("td"),
      name = textElement("button", r.name, "card-name");
    name.addEventListener("click", (e) => {
      e.stopPropagation();
      openDetail(r);
    });
    nameTd.append(name, textElement("span", r.printing, "printing"));
    tr.append(
      nameTd,
      textElement("td", String(r.qty), "number"),
      textElement("td", r.location + (r.section ? " / " + r.section : "")),
      textElement("td", r.finish),
    );
    const actionTd = document.createElement("td"),
      action = textElement("button", "Details", "row-action");
    action.setAttribute("aria-label", `Details for ${r.name}`);
    action.onclick = (e) => {
      e.stopPropagation();
      openDetail(r);
    };
    actionTd.append(action);
    tr.append(actionTd);
    tr.onclick = (e) => selectRow(r.id, e);
    $("card-rows").append(tr);
  });
  const count = selectedCount();
  $("selection-bar").hidden = count === 0;
  $("selection-count").textContent =
    `${selectedRows().length} entries · ${count} copies selected`;
  const hiddenCount = selectedRows().filter(
    (r) => !visible.some((v) => v.id === r.id),
  ).length;
  $("selection-scope").textContent =
    (allMatching ? "All matching sample entries. " : "Explicit selection. ") +
    (hiddenCount
      ? `${hiddenCount} selected entries outside current filters.`
      : "Loaded rows only.");
  $("active-filters").replaceChildren();
  Object.entries(criteria).forEach(([key, value]) => {
    if (!value) return;
    const button = textElement("button", `${key}: ${value} ×`);
    button.setAttribute("aria-label", `Remove ${key} filter`);
    button.onclick = () => {
      delete criteria[key];
      syncFilters();
      allMatching = false;
      render();
    };
    $("active-filters").append(button);
  });
  $("inventory-vault").hidden = criteria.location !== "Vault A";
  renderSections($("inventory-sections"), true);
  renderSections($("location-sections"), false);
  renderStorage();
}
function syncFilters() {
  $("card-search").value = criteria.name || "";
  $("finish-filter").value = criteria.finish || "";
  $("location-filter").value = criteria.location || "";
  $("color-filter").value = criteria.color || "";
}
function openDetail(r) {
  $("detail-title").textContent = r.name;
  $("detail-content").replaceChildren();
  const dl = document.createElement("dl");
  [
    ["Printing", r.printing],
    ["Finish", r.finish],
    ["Condition / language", "Near mint / English"],
    ["Physical copies", String(r.qty)],
    ["Location", r.location + (r.section ? " / " + r.section : "")],
    ["Availability", "Unreserved sample"],
  ].forEach(([k, v]) => dl.append(textElement("dt", k), textElement("dd", v)));
  $("detail-content").append(
    dl,
    textElement(
      "p",
      "Rules text, all faces, related cards, legalities, prices and complete location breakdown retain their place in this detail view.",
      "muted small",
    ),
  );
  $("detail-dialog").showModal();
}
function renderSections(container, inventory) {
  container.replaceChildren();
  occupancy.forEach((n, i) => {
    const button = document.createElement("button");
    button.className = "vault-section";
    button.setAttribute(
      "aria-label",
      `Browse Sect ${i}: ${n} copies, ${n > 85 ? `${n - 85} over capacity` : `${85 - n} spaces available`}`,
    );
    button.setAttribute(
      "aria-pressed",
      String(inventory && criteria.section === `Sect ${i}`),
    );
    button.append(
      textElement("strong", `Sect ${i}`),
      textElement("span", `${n} / 85`, "occupancy"),
    );
    const progress = document.createElement("progress");
    progress.max = 85;
    progress.value = Math.min(n, 85);
    progress.setAttribute("aria-label", `Sect ${i} occupancy`);
    button.append(
      progress,
      textElement(
        "small",
        n > 85 ? `${n - 85} over capacity` : `${85 - n} spaces left`,
        n > 85 ? "over" : "",
      ),
    );
    button.onclick = () => browseSection(`Sect ${i}`);
    container.append(button);
  });
}
function browseSection(section) {
  criteria.location = "Vault A";
  criteria.section = section;
  syncFilters();
  setScreen("inventory");
}
function renderTree() {
  const paths = [
    ["Shelf A / Vault A", "Vault A"],
    ["Shelf A / Intake", "Intake"],
    ["Shelf B / Box 02", "Box 02"],
  ];
  $("storage-tree").replaceChildren();
  paths
    .filter(([p]) =>
      p.toLowerCase().includes($("storage-search").value.toLowerCase()),
    )
    .forEach(([path, name]) => {
      const b = textElement("button", path);
      b.setAttribute("aria-current", String(storage === name));
      b.onclick = () => {
        storage = name;
        renderTree();
        renderStorage();
      };
      $("storage-tree").append(b);
    });
  if (!$("storage-tree").children.length)
    $("storage-tree").append(
      textElement("p", "No matching locations.", "muted"),
    );
}
function renderStorage() {
  const vault = storage === "Vault A";
  $("storage-title").textContent = storage;
  $("storage-path").textContent =
    storage === "Box 02" ? "Collection / Shelf B" : "Collection / Shelf A";
  $("location-sections").hidden = !vault;
  $("other-sections").hidden = !vault;
  for (const [section, label] of [
    ["Unsectioned", "Unsectioned"],
    ["Sect 10", "Other labels · Sect 10"],
  ]) {
    const quantity = rows
      .filter((r) => r.location === "Vault A" && r.section === section)
      .reduce((n, r) => n + r.qty, 0);
    document.querySelector(`[data-section="${section}"]`).textContent =
      `${label} · ${quantity}`;
  }
  document.querySelector(".storage-next").hidden = !vault;
  $("storage-description").textContent = vault
    ? "Six sections · advisory capacity 85 copies each"
    : storage === "Intake"
      ? `${rows.filter((r) => r.location === "Intake").reduce((n, r) => n + r.qty, 0)} physical copies · waiting to be placed`
      : "Empty location · ready for your next batch";
  if (vault)
    document.querySelector(".storage-next p").textContent =
      `Sect 1 has ${Math.max(0, 85 - occupancy[1])} spaces available. Occupancy counts physical copies in this location.`;
}
function updateMove() {
  const section = Number($("move-section").value),
    qty = Number($("move-quantity").value),
    n = occupancy[section];
  const same = selectedRows()
    .filter((r) => r.location === "Vault A" && r.section === `Sect ${section}`)
    .reduce((sum, r) => sum + r.qty, 0);
  const movable = selectedCount() - same;
  const projected = n + Math.min(Math.max(0, qty || 0), movable);
  $("move-quantity").max = String(movable);
  $("move-projection").textContent =
    `Sect ${section}: ${n} → ${projected} / 85 copies. ${projected > 85 ? `${projected - 85} over capacity — may not fit. This is advisory.` : `${85 - projected} spaces remain.`}`;
  $("move-selected").textContent =
    `${selectedCount()} selected copies · ${movable} outside this destination section`;
  $("fill-space").disabled = movable === 0 || n >= 85;
}
function openMove() {
  $("move-quantity").value = String(selectedCount());
  $("move-error").textContent = "";
  updateMove();
  $("move-dialog").showModal();
}
$("search-form").onsubmit = (e) => {
  e.preventDefault();
  criteria.name = $("card-search").value.trim();
  allMatching = false;
  render();
};
$("filter-toggle").onclick = () => toggleFilters($("filter-panel").hidden);
$("close-filters").onclick = () => {
  toggleFilters(false);
  $("filter-toggle").focus();
};
$("filters-form").onsubmit = (e) => {
  e.preventDefault();
  criteria.finish = $("finish-filter").value;
  criteria.location = $("location-filter").value;
  criteria.color = $("color-filter").value;
  delete criteria.section;
  allMatching = false;
  render();
  if (matchMedia("(max-width:700px)").matches) {
    toggleFilters(false);
    $("filter-toggle").focus();
  }
};
$("clear-filters").onclick = () => {
  criteria = {};
  syncFilters();
  allMatching = false;
  render();
};
$("select-all").onclick = () => {
  selected = new Set(matching().map((r) => r.id));
  allMatching = true;
  render();
};
$("clear-selection").onclick = () => {
  selected.clear();
  allMatching = false;
  render();
};
$("move-open").onclick = openMove;
$("move-cancel").onclick = () => $("move-dialog").close();
$("move-section").onchange = () => {
  $("move-error").textContent = "";
  updateMove();
};
$("move-quantity").oninput = updateMove;
$("fill-space").onclick = () => {
  $("move-quantity").value = String(
    Math.min(
      Number($("move-quantity").max),
      Math.max(0, 85 - occupancy[Number($("move-section").value)]),
    ),
  );
  updateMove();
};
$("move-form").onsubmit = (e) => {
  e.preventDefault();
  const qty = Number($("move-quantity").value),
    section = Number($("move-section").value);
  if (
    !Number.isInteger(qty) ||
    qty < 1 ||
    qty > Number($("move-quantity").max)
  ) {
    $("move-error").textContent =
      "Choose a whole number within the movable selection.";
    return;
  }
  let left = qty;
  const moving = selectedRows().filter(
    (r) => !(r.location === "Vault A" && r.section === `Sect ${section}`),
  );
  for (const r of moving) {
    const amount = Math.min(left, r.qty);
    if (!amount) break;
    if (r.location === "Vault A" && /^Sect [0-5]$/.test(r.section))
      occupancy[Number(r.section.slice(-1))] -= amount;
    r.qty -= amount;
    rows.push({
      ...r,
      id: rows.length,
      qty: amount,
      location: "Vault A",
      section: `Sect ${section}`,
    });
    left -= amount;
  }
  occupancy[section] += qty;
  selected.clear();
  allMatching = false;
  $("move-dialog").close();
  render();
  $("status").textContent =
    `Simulated move: ${qty} copies to Vault A / Sect ${section}. No real collection data changed.`;
  $("select-all").focus();
};
$("selection-more").onclick = () => showInfo("Selection actions");
$("view-options").onclick = () => $("view-dialog").showModal();
$("reset").onclick = () => {
  reset();
  history.replaceState({ screen: "inventory" }, "", "#inventory");
};
$("layout").onchange = (e) =>
  (document.documentElement.dataset.layout = e.target.value);
$("theme").onchange = (e) =>
  (document.documentElement.dataset.theme = e.target.value);
$("storage-search").oninput = renderTree;
$("browse-storage").onclick = () => {
  criteria.location = "Vault A";
  delete criteria.section;
  syncFilters();
  setScreen("inventory");
};
$("mobile-menu").onclick = () => {
  const open = $("primary-nav").classList.toggle("mobile-open");
  $("mobile-menu").setAttribute("aria-expanded", String(open));
};
document
  .querySelectorAll("[data-screen]")
  .forEach((b) => (b.onclick = () => setScreen(b.dataset.screen)));
document
  .querySelectorAll("[data-home]")
  .forEach((b) => (b.onclick = () => showInfo(b.dataset.home)));
document
  .querySelectorAll("[data-section]")
  .forEach((b) => (b.onclick = () => browseSection(b.dataset.section)));
window.addEventListener("popstate", () =>
  setScreen(location.hash === "#locations" ? "locations" : "inventory", false),
);
reset();
setScreen(location.hash === "#locations" ? "locations" : "inventory", false);
