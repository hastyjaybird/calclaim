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

async function api(path, options) {
  const res = await fetch(path, options);
  if (res.status === 401) {
    location.href = `/dev/login.html?next=${encodeURIComponent(location.pathname + location.hash)}`;
    throw new Error("Authentication required");
  }
  return res;
}

function branchPrograms(chart, branch) {
  return chart.programs
    .filter((p) => p.branches.includes(branch))
    .sort((a, b) => {
      const ao = branch === "yes" ? a.yesOrder : a.noOrder;
      const bo = branch === "yes" ? b.yesOrder : b.noOrder;
      if (ao !== bo) return ao - bo;
      return a.name.localeCompare(b.name);
    });
}

function listHtml(programs) {
  return programs
    .map((p) => {
      const tags = [];
      if (p.gateFeeder) tags.push(`<span class="tag">feeder</span>`);
      if (p.heldFromOffer) tags.push(`<span class="tag tag-held">held</span>`);
      const cls = p.heldFromOffer ? ' class="is-held"' : "";
      return `<li${cls}><span>${escapeHtml(p.name)}</span>${tags.join("")}</li>`;
    })
    .join("");
}

async function loadOrders() {
  const res = await api("/api/dev/tree/chart", {
    headers: { Accept: "application/json" },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Could not load programs");

  const yes = branchPrograms(data, "yes");
  const no = branchPrograms(data, "no");
  el("yes-order").innerHTML = listHtml(yes);
  el("no-order").innerHTML = listHtml(no);
  el("orders-lede").textContent =
    `${yes.length} YES · ${no.length} NO · library ${data.version}. Same order as the gate chart rows.`;
  el("status-line").textContent = "";
}

el("btn-logout").addEventListener("click", async () => {
  await api("/api/dev/logout", { method: "POST" });
  location.href = "/dev/login.html";
});

loadOrders().catch((err) => {
  el("status-line").textContent = err.message;
  el("orders-lede").textContent = err.message;
});
