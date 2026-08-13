let chart = null;
let branch = "yes";
/** @type {string[]} */
let orderIds = [];
/** @type {string[]} */
let savedOrderIds = [];
/** @type {string[]} */
let columnIds = [];
/** @type {string[]} */
let libraryColumnIds = [];
/** @type {string | null} */
let activeGate = null;
let feedersFirst = false;
/** @type {"row" | "col" | null} */
let dragKind = null;
/** @type {string | null} */
let dragId = null;
let suppressColClick = false;
/** @type {{ key: string, dir: "asc" | "desc" } | null} */
let sortState = null;

/** Browser layout memory so refresh keeps row/column order. */
const LAYOUT_KEY = "calclaim.dev.tree.chart.layout.v2";

function el(id) {
  return document.getElementById(id);
}

function readLayout() {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return data && typeof data === "object" ? data : null;
  } catch {
    return null;
  }
}

function writeLayout() {
  const prev = readLayout() || {};
  const next = {
    branch,
    feedersFirst,
    columnIds: [...columnIds],
    sortState: sortState ? { ...sortState } : null,
    activeGate,
    orders: {
      ...(prev.orders && typeof prev.orders === "object" ? prev.orders : {}),
      [branch]: [...orderIds],
    },
  };
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(next));
  } catch {
    // Quota / private mode — layout still works for this session.
  }
}

/** Keep preferred order; drop unknown ids; append any new library ids. */
function mergeIdOrder(preferred, available) {
  const avail = new Set(available);
  const out = [];
  for (const id of preferred || []) {
    if (avail.has(id) && !out.includes(id)) out.push(id);
  }
  for (const id of available) {
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function api(path, options) {
  const res = await fetch(path, options);
  if (res.status === 401) {
    location.href = `/dev/login.html?next=${encodeURIComponent(location.pathname + location.hash)}`;
    throw new Error("Authentication required");
  }
  return res;
}

function programById(id) {
  return chart.programs.find((p) => p.id === id);
}

function columnById(id) {
  return chart.columns.find((c) => c.id === id);
}

function visibleColumns() {
  return columnIds.map(columnById).filter(Boolean);
}

function libraryOrderIds() {
  return chart.programs
    .filter((p) => p.branches.includes(branch))
    .sort((a, b) => {
      const ao = branch === "yes" ? a.yesOrder : a.noOrder;
      const bo = branch === "yes" ? b.yesOrder : b.noOrder;
      if (ao !== bo) return ao - bo;
      return a.name.localeCompare(b.name);
    })
    .map((p) => p.id);
}

function applyFeedersFirst(ids) {
  if (!feedersFirst || sortState) return ids;
  const feeders = [];
  const rest = [];
  for (const id of ids) {
    const p = programById(id);
    if (p?.gateFeeder) feeders.push(id);
    else rest.push(id);
  }
  return [...feeders, ...rest];
}

function cellSortValue(program, gateId) {
  const cell = program.cells[gateId];
  if (!cell?.needed) return { needed: 0, detail: "" };
  return { needed: 1, detail: cell.detail || "" };
}

function comparePrograms(a, b, key, dir) {
  const mult = dir === "asc" ? 1 : -1;
  if (key === "program") {
    const byName = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    if (byName) return byName * mult;
    return a.id.localeCompare(b.id);
  }
  const va = cellSortValue(a, key);
  const vb = cellSortValue(b, key);
  if (va.needed !== vb.needed) return (va.needed - vb.needed) * mult;
  const byDetail = va.detail.localeCompare(vb.detail, undefined, {
    sensitivity: "base",
    numeric: true,
  });
  if (byDetail) return byDetail * mult;
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

function applyColumnSort(ids) {
  if (!sortState) return ids;
  const { key, dir } = sortState;
  const rows = ids.map(programById).filter(Boolean);
  rows.sort((a, b) => comparePrograms(a, b, key, dir));
  return rows.map((p) => p.id);
}

function sortIndicator(key) {
  if (!sortState || sortState.key !== key) {
    return `<span class="col-sort-mark" aria-hidden="true">⇅</span>`;
  }
  return `<span class="col-sort-mark is-active" aria-hidden="true">${
    sortState.dir === "asc" ? "▲" : "▼"
  }</span>`;
}

function sortAria(key) {
  if (!sortState || sortState.key !== key) return "none";
  return sortState.dir === "asc" ? "ascending" : "descending";
}

function toggleSort(key) {
  const startDir = key === "program" ? "asc" : "desc";
  if (!sortState || sortState.key !== key) {
    // Gate cols: needed-first first (desc). Program: A→Z.
    sortState = { key, dir: startDir };
  } else if (sortState.dir === startDir) {
    sortState = { key, dir: startDir === "asc" ? "desc" : "asc" };
  } else {
    sortState = null;
  }
  orderIds = applyFeedersFirst(applyColumnSort(orderIds));
  writeLayout();
  render();
}

function orderDirty() {
  if (orderIds.length !== savedOrderIds.length) return true;
  return orderIds.some((id, i) => id !== savedOrderIds[i]);
}

function columnsDirty() {
  if (columnIds.length !== libraryColumnIds.length) return true;
  return columnIds.some((id, i) => id !== libraryColumnIds[i]);
}

function setStatus(msg) {
  el("status-line").textContent = msg || "";
}

function syncSaveButton() {
  el("btn-save").disabled = !orderDirty();
}

function renderFeeders() {
  el("feeders-banner").textContent = chart.banner;
  const host = el("feeder-grid");
  if (!chart.feeders.length) {
    host.innerHTML = `<p class="feeder-empty">No gate-feeder programs flagged.</p>`;
    return;
  }
  host.innerHTML = chart.feeders
    .map((f) => {
      const unlocks = f.unlocks.length
        ? `<ul>${f.unlocks.map((u) => `<li>${escapeHtml(u.name)}</li>`).join("")}</ul>`
        : `<p class="feeder-empty">No unlock edges recorded yet.</p>`;
      return `<article class="feeder-card">
        <h3>${escapeHtml(f.name)}</h3>
        ${unlocks}
      </article>`;
    })
    .join("");
}

function showQuestion(col) {
  const panel = el("question-panel");
  if (!col) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  el("question-label").textContent = col.label;
  el("question-text").textContent = col.question;
  el("question-note").textContent = col.note;
}

function renderHead() {
  const cols = visibleColumns()
    .map((c) => {
      const active = activeGate === c.id ? " is-active" : "";
      const sorted = sortState?.key === c.id ? " is-sorted" : "";
      return `<th scope="col" class="col-gate${active}${sorted}" draggable="true" data-gate="${escapeHtml(c.id)}" aria-sort="${sortAria(c.id)}" title="${escapeHtml(c.question)} · drag to reorder · sort button for rows">
        <div class="col-btn" role="button" tabindex="0" data-gate="${escapeHtml(c.id)}">
          <span class="col-drag" aria-hidden="true">⠿</span>
          <span class="col-short">${escapeHtml(c.short)}</span>
          <button type="button" class="col-sort" data-sort="${escapeHtml(c.id)}" title="Sort rows by this column" aria-label="Sort by ${escapeHtml(c.short)}">
            ${sortIndicator(c.id)}
          </button>
        </div>
      </th>`;
    })
    .join("");
  const programSorted = sortState?.key === "program" ? " is-sorted" : "";
  el("chart-head").innerHTML = `<tr>
    <th scope="col" class="col-program${programSorted}" aria-sort="${sortAria("program")}">
      <button type="button" class="col-program-sort" data-sort="program" title="Sort by program name">
        <span class="col-short">Program</span>
        ${sortIndicator("program")}
      </button>
    </th>
    ${cols}
  </tr>`;
  bindColDrag();
}

function cellHtml(program, col) {
  const cell = program.cells[col.id];
  const active = activeGate === col.id ? " is-col-active" : "";
  if (!cell?.needed) {
    return `<td class="gate-cell${active}"><span class="gate-dot is-off" aria-hidden="true">·</span></td>`;
  }
  const label = cell.detail || "✓";
  const title = cell.detail
    ? `${col.label}: ${cell.detail}`
    : col.label;
  return `<td class="gate-cell${active}">
    <span class="gate-dot is-on" title="${escapeHtml(title)}">${escapeHtml(label)}</span>
  </td>`;
}

function jurisdictionTag(jurisdiction) {
  if (jurisdiction === "federal") {
    return `<span class="tag tag-federal" title="Federal program">Federal</span>`;
  }
  if (jurisdiction === "both") {
    return `<span class="tag tag-both" title="Federally funded / jointly authorized, state-administered">Fed · State</span>`;
  }
  return `<span class="tag tag-state" title="California state, county, or regulated-utility program">State</span>`;
}

function rowHtml(program, visualIndex) {
  const libOrder = branch === "yes" ? program.yesOrder : program.noOrder;
  const tags = [
    jurisdictionTag(program.jurisdiction),
    `<span class="tag tag-order">#${visualIndex + 1}</span>`,
    `<span class="tag" title="Library ${branch}Order">lib ${libOrder}</span>`,
  ];
  if (program.gateFeeder) tags.push(`<span class="tag tag-feeder">gate feeder</span>`);
  if (program.gateCount) tags.push(`<span class="tag">${program.gateCount} Q</span>`);

  const cells = visibleColumns().map((c) => cellHtml(program, c)).join("");
  return `<tr data-program="${escapeHtml(program.id)}" class="${program.gateFeeder ? "is-feeder" : ""}">
    <th scope="row" class="col-program">
      <div class="program-cell">
        <button type="button" class="drag-handle" draggable="true" aria-label="Drag to reorder ${escapeHtml(program.name)}" title="Drag to reorder">⠿</button>
        <div class="program-meta">
          <span class="program-name">${escapeHtml(program.name)}</span>
          <div class="program-tags">${tags.join("")}</div>
        </div>
      </div>
    </th>
    ${cells}
  </tr>`;
}

function renderBody() {
  const rows = orderIds
    .map((id) => programById(id))
    .filter(Boolean)
    .map((p, i) => rowHtml(p, i));
  el("chart-body").innerHTML = rows.join("");
  bindRowDrag();
}

function render() {
  renderFeeders();
  renderHead();
  renderBody();
  if (activeGate) {
    showQuestion(columnById(activeGate));
  } else {
    showQuestion(null);
  }
  syncSaveButton();
  const dirtyBits = [];
  if (orderDirty()) dirtyBits.push("unsaved program order");
  if (columnsDirty()) dirtyBits.push("column order (review only)");
  if (sortState) {
    const label =
      sortState.key === "program"
        ? "Program"
        : columnById(sortState.key)?.short || sortState.key;
    dirtyBits.push(`sorted by ${label} ${sortState.dir === "asc" ? "↑" : "↓"}`);
  }
  const dirty = dirtyBits.length ? ` · ${dirtyBits.join(" · ")}` : "";
  setStatus(
    `${orderIds.length} programs on ${branch.toUpperCase()} · library ${chart.version}${dirty}`,
  );
}

function syncBranchButtons() {
  el("btn-branch-yes").classList.toggle("cta-ghost", branch !== "yes");
  el("btn-branch-no").classList.toggle("cta-ghost", branch !== "no");
  el("btn-branch-yes").setAttribute("aria-pressed", String(branch === "yes"));
  el("btn-branch-no").setAttribute("aria-pressed", String(branch === "no"));
}

function loadBranchOrder(preferredIds) {
  const libOrder = libraryOrderIds();
  const base = applyFeedersFirst(libOrder);
  savedOrderIds = [...base];
  orderIds = mergeIdOrder(preferredIds || base, libOrder);
  if (!preferredIds) {
    orderIds = applyFeedersFirst(orderIds);
    savedOrderIds = [...orderIds];
  }
}

function setBranch(next) {
  branch = next;
  syncBranchButtons();
  sortState = null;
  const stored = readLayout();
  const preferred = stored?.orders?.[branch];
  loadBranchOrder(Array.isArray(preferred) ? preferred : null);
  writeLayout();
  render();
}

function moveInList(list, fromId, toId) {
  if (!fromId || !toId || fromId === toId) return list;
  const from = list.indexOf(fromId);
  const to = list.indexOf(toId);
  if (from < 0 || to < 0) return list;
  const next = [...list];
  next.splice(from, 1);
  next.splice(to, 0, fromId);
  return next;
}

function moveProgram(fromId, toId) {
  sortState = null;
  orderIds = applyFeedersFirst(moveInList(orderIds, fromId, toId));
  writeLayout();
  render();
}

function moveColumn(fromId, toId) {
  columnIds = moveInList(columnIds, fromId, toId);
  writeLayout();
  render();
}

function clearDragMarks(selector) {
  for (const node of document.querySelectorAll(selector)) {
    node.classList.remove("is-dragging", "drag-over", "drag-over-col");
  }
}

function bindRowDrag() {
  const rows = el("chart-body").querySelectorAll("tr[data-program]");
  for (const row of rows) {
    const id = row.getAttribute("data-program");
    const handle = row.querySelector(".drag-handle");
    if (!handle) continue;

    handle.addEventListener("dragstart", (ev) => {
      dragKind = "row";
      dragId = id;
      row.classList.add("is-dragging");
      ev.dataTransfer.effectAllowed = "move";
      ev.dataTransfer.setData("text/plain", `row:${id}`);
    });
    handle.addEventListener("dragend", () => {
      dragKind = null;
      dragId = null;
      clearDragMarks("tr[data-program]");
    });

    row.addEventListener("dragover", (ev) => {
      if (dragKind !== "row") return;
      ev.preventDefault();
      ev.dataTransfer.dropEffect = "move";
      row.classList.add("drag-over");
    });
    row.addEventListener("dragleave", () => row.classList.remove("drag-over"));
    row.addEventListener("drop", (ev) => {
      if (dragKind !== "row") return;
      ev.preventDefault();
      row.classList.remove("drag-over");
      const raw = dragId || ev.dataTransfer.getData("text/plain").replace(/^row:/, "");
      moveProgram(raw, id);
    });
  }
}

function bindColDrag() {
  const headers = el("chart-head").querySelectorAll("th.col-gate[data-gate]");
  for (const th of headers) {
    const id = th.getAttribute("data-gate");

    th.addEventListener("dragstart", (ev) => {
      if (ev.target.closest("[data-sort]")) {
        ev.preventDefault();
        return;
      }
      dragKind = "col";
      dragId = id;
      suppressColClick = false;
      th.classList.add("is-dragging");
      ev.dataTransfer.effectAllowed = "move";
      ev.dataTransfer.setData("text/plain", `col:${id}`);
    });
    th.addEventListener("drag", () => {
      // Any actual drag should not also toggle the pin highlight.
      suppressColClick = true;
    });
    th.addEventListener("dragend", () => {
      dragKind = null;
      dragId = null;
      clearDragMarks("th.col-gate");
      // Click fires after dragend in some browsers; keep suppress for a tick.
      setTimeout(() => {
        suppressColClick = false;
      }, 0);
    });

    th.addEventListener("dragover", (ev) => {
      if (dragKind !== "col") return;
      ev.preventDefault();
      ev.dataTransfer.dropEffect = "move";
      th.classList.add("drag-over-col");
    });
    th.addEventListener("dragleave", () => th.classList.remove("drag-over-col"));
    th.addEventListener("drop", (ev) => {
      if (dragKind !== "col") return;
      ev.preventDefault();
      th.classList.remove("drag-over-col");
      const raw = dragId || ev.dataTransfer.getData("text/plain").replace(/^col:/, "");
      moveColumn(raw, id);
    });
  }
}

async function saveOrder() {
  setStatus("Saving order…");
  el("btn-save").disabled = true;
  const res = await api("/api/dev/tree/chart/order", {
    method: "PUT",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ branch, order: orderIds }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    setStatus(data.error || "Could not save order");
    syncSaveButton();
    return;
  }
  chart = data;
  libraryColumnIds = chart.columns.map((c) => c.id);
  // Keep the reviewer's current column arrangement after a program-order save.
  columnIds = mergeIdOrder(columnIds, libraryColumnIds);
  orderIds = applyFeedersFirst(applyColumnSort(libraryOrderIds()));
  savedOrderIds = [...orderIds];
  writeLayout();
  render();
  setStatus(`Saved ${branch}Order to library/programs.json.`);
}

function applyStoredLayout(stored) {
  if (!stored) {
    columnIds = [...libraryColumnIds];
    loadBranchOrder(null);
    return;
  }
  if (stored.branch === "yes" || stored.branch === "no") {
    branch = stored.branch;
  }
  if (typeof stored.feedersFirst === "boolean") {
    feedersFirst = stored.feedersFirst;
    el("chk-feeders-first").checked = feedersFirst;
  }
  if (stored.sortState?.key && (stored.sortState.dir === "asc" || stored.sortState.dir === "desc")) {
    sortState = { key: stored.sortState.key, dir: stored.sortState.dir };
  } else {
    sortState = null;
  }
  if (typeof stored.activeGate === "string" || stored.activeGate === null) {
    activeGate = stored.activeGate;
  }
  columnIds = mergeIdOrder(
    Array.isArray(stored.columnIds) ? stored.columnIds : libraryColumnIds,
    libraryColumnIds,
  );
  syncBranchButtons();
  const preferred = stored.orders?.[branch];
  loadBranchOrder(Array.isArray(preferred) ? preferred : null);
  if (sortState) {
    orderIds = applyFeedersFirst(applyColumnSort(orderIds));
  }
}

async function loadChart() {
  setStatus("Loading…");
  const res = await api("/api/dev/tree/chart", {
    headers: { Accept: "application/json" },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Could not load chart");
  chart = data;
  libraryColumnIds = chart.columns.map((c) => c.id);
  applyStoredLayout(readLayout());
  writeLayout();
  render();
}

el("btn-branch-yes").addEventListener("click", () => setBranch("yes"));
el("btn-branch-no").addEventListener("click", () => setBranch("no"));
el("btn-reset").addEventListener("click", () => {
  sortState = null;
  activeGate = null;
  columnIds = [...libraryColumnIds];
  loadBranchOrder(null);
  writeLayout();
  render();
});
el("btn-save").addEventListener("click", () => {
  void saveOrder().catch((err) => setStatus(err.message));
});
el("chk-feeders-first").addEventListener("change", (ev) => {
  feedersFirst = Boolean(ev.target.checked);
  orderIds = applyFeedersFirst(applyColumnSort(orderIds));
  writeLayout();
  render();
});

el("chart-head").addEventListener("click", (ev) => {
  const sortBtn = ev.target.closest("[data-sort]");
  if (sortBtn) {
    ev.preventDefault();
    ev.stopPropagation();
    toggleSort(sortBtn.getAttribute("data-sort"));
    return;
  }
  if (suppressColClick) return;
  const btn = ev.target.closest(".col-btn[data-gate], th.col-gate[data-gate]");
  if (!btn) return;
  const id = btn.getAttribute("data-gate") || btn.closest("[data-gate]")?.getAttribute("data-gate");
  if (!id) return;
  activeGate = activeGate === id ? null : id;
  writeLayout();
  render();
});

el("chart-head").addEventListener("keydown", (ev) => {
  if (ev.key !== "Enter" && ev.key !== " ") return;
  const sortBtn = ev.target.closest("[data-sort]");
  if (sortBtn) {
    ev.preventDefault();
    toggleSort(sortBtn.getAttribute("data-sort"));
    return;
  }
  const btn = ev.target.closest(".col-btn[data-gate]");
  if (!btn) return;
  ev.preventDefault();
  const id = btn.getAttribute("data-gate");
  activeGate = activeGate === id ? null : id;
  writeLayout();
  render();
});

el("btn-logout").addEventListener("click", async () => {
  await api("/api/dev/logout", { method: "POST" });
  location.href = "/dev/login.html";
});

loadChart().catch((err) => {
  setStatus(err.message);
});
