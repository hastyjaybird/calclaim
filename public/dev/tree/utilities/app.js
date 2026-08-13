function el(id) {
  return document.getElementById(id);
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function kindLabel(kind) {
  switch (kind) {
    case "iou":
      return "IOU";
    case "muni":
      return "Municipal";
    case "telecom":
      return "Telecom";
    case "other":
      return "Catch-all";
    default:
      return kind;
  }
}

function render(tree) {
  const head = el("util-head");
  const body = el("util-body");
  head.innerHTML = "";
  body.innerHTML = "";

  const hr = document.createElement("tr");
  hr.innerHTML = `<th class="row-head">Bill selection</th>${tree.columns
    .map((c) => `<th>${escapeHtml(c.label)}</th>`)
    .join("")}`;
  head.appendChild(hr);

  for (const row of tree.rows) {
    const tr = document.createElement("tr");
    const cells = tree.columns
      .map((col) => {
        const cell = row.cells[col.id] || { available: false };
        if (!cell.available) {
          return `<td class="util-cell-no">—</td>`;
        }
        const link = cell.applyUrl
          ? `<a href="${escapeHtml(cell.applyUrl)}" target="_blank" rel="noopener noreferrer">Apply</a>`
          : "Yes";
        const note = cell.label
          ? `<span class="util-cell-note">${escapeHtml(cell.label)}</span>`
          : "";
        return `<td class="util-cell-yes">${link}${note}</td>`;
      })
      .join("");
    tr.innerHTML = `<td class="row-head">${escapeHtml(row.label)}<span class="util-kind">${escapeHtml(kindLabel(row.kind))}</span></td>${cells}`;
    body.appendChild(tr);
  }
}

async function load() {
  const status = el("status-line");
  status.textContent = "Loading utility matrix…";
  try {
    const res = await fetch("/api/dev/tree/utilities", { credentials: "same-origin" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const tree = await res.json();
    render(tree);
    status.textContent = `${tree.rows.length} bill selections · ${tree.columns.length} program families`;
  } catch (err) {
    status.textContent = `Failed to load: ${err instanceof Error ? err.message : String(err)}`;
  }
}

el("btn-logout")?.addEventListener("click", async () => {
  await fetch("/api/dev/logout", { method: "POST", credentials: "same-origin" });
  location.href = "/dev";
});

load();
