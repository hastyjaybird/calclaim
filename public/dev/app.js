/* global Chart */

const number = new Intl.NumberFormat("en-US");
const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function el(id) {
  return document.getElementById(id);
}

function isTreeHash(hash = location.hash) {
  const raw = String(hash || "").replace(/^#/, "");
  return (
    raw === "tree" ||
    raw.startsWith("tree&") ||
    raw.startsWith("tree=") ||
    raw === "a" ||
    raw.startsWith("a=")
  );
}

function treeReviewPath(actionList) {
  if (!Array.isArray(actionList) || !actionList.length) return "/dev#tree";
  const encoded = actionList.map((a) => encodeURIComponent(a)).join(",");
  return `/dev#tree&a=${encoded}`;
}

function migrateTreePath(path) {
  if (!path) return "/dev#tree";
  if (path.startsWith("/dev#tree")) return path;
  if (path.startsWith("/dev/tree#a=")) {
    return `/dev#tree&a=${path.slice("/dev/tree#a=".length)}`;
  }
  if (path === "/dev/tree" || path === "/dev/tree/") return "/dev#tree";
  return path;
}

function setTreeView(on) {
  document.documentElement.classList.toggle("dev-on-tree", on);
  if (on) {
    window.scrollTo(0, 0);
    window.__treeReview?.activate?.();
  } else {
    requestAnimationFrame(() =>
      resizeChartsIn(document.querySelector(".dev-dashboard")),
    );
  }
}

function revealSection(nodeOrId) {
  const target =
    typeof nodeOrId === "string" ? document.getElementById(nodeOrId) : nodeOrId;
  if (!target) return;
  const section = target.closest("section") || (target.matches("section") ? target : null);
  const fold =
    target.closest("details.panel-fold") ||
    section?.querySelector(":scope > details.panel-fold");
  if (fold) fold.open = true;
}

function resizeChartsIn(root) {
  if (!root || typeof Chart === "undefined") return;
  for (const canvas of root.querySelectorAll("canvas")) {
    Chart.getChart(canvas)?.resize();
  }
}

function initPanelFolds() {
  for (const fold of document.querySelectorAll("details.panel-fold")) {
    fold.addEventListener("toggle", () => {
      if (fold.open) requestAnimationFrame(() => resizeChartsIn(fold));
    });
  }
  document.addEventListener("click", (event) => {
    const link = event.target.closest("a[href^='#']");
    if (!link?.hash || isTreeHash(link.hash)) return;
    revealSection(link.hash.slice(1));
  });
  if (location.hash && !isTreeHash()) revealSection(location.hash.slice(1));
}

async function api(path, options) {
  const res = await fetch(path, options);
  if (res.status === 401) {
    location.href = `/dev/login.html?next=${encodeURIComponent(location.pathname)}`;
    throw new Error("Authentication required");
  }
  return res;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatWhen(iso) {
  if (!iso) return "–";
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

/** Compact duration for dwell / time-to-finish (ms → display). */
function formatDuration(ms) {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return "–";
  if (ms < 10_000) return `${(Math.round(ms / 100) / 10).toFixed(1)}s`;
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const r = sec % 60;
  if (m < 60) return r ? `${m}m ${r}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const mr = m % 60;
  return mr ? `${h}h ${mr}m` : `${h}h`;
}

let pollTimer = null;

const libraryWatch = {
  findingsByProgram: new Map(),
};

/** Library version dates are mm-dd-yy (YYYY-MM-DD and mm/dd/yy still format). */
function formatLibraryVersion(version) {
  const raw = String(version || "").trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (iso) return `${iso[2]}-${iso[3]}-${iso[1].slice(2)}`;
  const us = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/.exec(raw);
  if (us) {
    const yy = us[3].length === 4 ? us[3].slice(2) : us[3];
    return `${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}-${yy}`;
  }
  return raw;
}

function renderOverview(status) {
  const o = status.overview;
  el("m-version").textContent = formatLibraryVersion(o.version);
  const age =
    o.ageDays == null
      ? "Age unknown – use mm-dd-yy versions"
      : o.needsReview
        ? `${o.ageDays} days old – review due (>${o.agingRuleDays}d)`
        : `${o.ageDays} days old (within ${o.agingRuleDays}d rule)`;
  el("m-age").textContent = age;
  if (o.needsReview) el("m-age").style.color = "#8a4a10";
  else el("m-age").style.color = "";

  el("m-programs").textContent = String(o.programCount);
  el("m-bands").textContent = `Income bands: ${formatLibraryVersion(o.incomeBandsVersion)}`;
  el("m-llm").textContent = status.llmEnabled ? "On" : "Off";

  libraryWatch.findingsByProgram = new Map(
    o.programs.map((p) => [p.id, p.openFindings]),
  );
  refreshLibraryCells();

  el("checklist-items").innerHTML = o.watchChecklist
    .map(
      (item) => `<li>
        <strong>${escapeHtml(item.label)}</strong>
        <p>${escapeHtml(item.why)}</p>
        <div class="fields">${escapeHtml(item.libraryFields.join(" · "))}</div>
      </li>`,
    )
    .join("");

  renderScans(status.recentScans, status.latestScan);
  updateScanChrome(status.latestScan);
}

function renderScans(scans, latest) {
  const tbody = el("scan-rows");
  if (!scans.length) {
    tbody.innerHTML = `<tr><td colspan="6">No scans yet – run a library check.</td></tr>`;
    return;
  }
  tbody.innerHTML = scans
    .map((s) => {
      const current = latest && s.id === latest.id ? " (latest)" : "";
      return `<tr>
        <td>#${s.id}${current}</td>
        <td>${escapeHtml(s.status)}</td>
        <td>${s.programsDone}/${s.programsTotal}</td>
        <td>${s.findingsCount}</td>
        <td>${s.llmEnabled ? "yes" : "no"}</td>
        <td>${formatWhen(s.startedAt)}</td>
      </tr>`;
    })
    .join("");
}

function updateScanChrome(scan) {
  const btn = el("btn-scan");
  const status = el("scan-status");
  if (!scan) {
    status.textContent = "";
    btn.disabled = false;
    btn.textContent = "Run library check";
    return;
  }
  if (scan.status === "running" || scan.status === "queued") {
    btn.disabled = true;
    btn.textContent = "Scanning…";
    status.textContent = `Scan #${scan.id}: ${scan.programsDone}/${scan.programsTotal} programs · ${scan.findingsCount} findings so far`;
    return;
  }
  btn.disabled = false;
  btn.textContent = "Run library check";
  if (scan.status === "completed") {
    status.textContent = scan.summary || `Scan #${scan.id} completed with ${scan.findingsCount} finding(s).`;
  } else if (scan.status === "failed") {
    status.textContent = `Scan #${scan.id} failed: ${scan.error || "unknown error"}`;
  } else {
    status.textContent = "";
  }
}

function findingCardHtml(f) {
  const evidence = f.evidenceUrl
    ? `<a class="action-link" href="${escapeHtml(f.evidenceUrl)}" target="_blank" rel="noopener">Open evidence</a>`
    : "";
  const actions =
    f.status === "open"
      ? `<button type="button" data-id="${f.id}" data-status="acknowledged">Acknowledge</button>
             <button type="button" data-id="${f.id}" data-status="fixed">Mark fixed</button>
             <button type="button" data-id="${f.id}" data-status="dismissed">Dismiss</button>`
      : `<button type="button" data-id="${f.id}" data-status="open">Reopen</button>`;
  return `<article class="finding" data-finding="${f.id}">
        <div class="finding-head">
          <span class="badge badge-${escapeHtml(f.severity)}">${escapeHtml(f.severity)}</span>
          <span class="badge badge-cat">${escapeHtml(f.category)}</span>
          <span class="badge badge-source">${escapeHtml(f.source)}</span>
          <h3>${escapeHtml(f.title)}</h3>
        </div>
        <p>${escapeHtml(f.detail)}</p>
        ${f.suggestedAction ? `<p><strong>Suggested:</strong> ${escapeHtml(f.suggestedAction)}</p>` : ""}
        ${f.libraryField ? `<p><strong>Library field:</strong> ${escapeHtml(f.libraryField)}</p>` : ""}
        <div class="finding-meta">
          ${f.programId ? `<span class="cat">${escapeHtml(f.programId)}</span>` : `<span class="cat">library-wide</span>`}
          ${evidence}
          <div class="finding-actions">${actions}</div>
        </div>
      </article>`;
}

function feedbackTicketCardHtml(t) {
  const actions = [];
  if (t.status === "open") {
    actions.push(
      `<button type="button" data-feedback-id="${t.id}" data-status="done">Mark done</button>`,
    );
    actions.push(
      `<button type="button" data-feedback-id="${t.id}" data-status="disqualified">Disqualify as feedback</button>`,
    );
  } else if (t.status === "done") {
    actions.push(
      `<button type="button" data-feedback-id="${t.id}" data-status="open">Reopen</button>`,
    );
  } else {
    actions.push(
      `<button type="button" data-feedback-id="${t.id}" data-status="open">Restore as open</button>`,
    );
  }
  return feedbackCardHtml(t, actions, { fromTickets: true });
}

function renderFindings(findings, feedbackTickets = []) {
  const root = el("findings-list");
  if (!findings.length && !feedbackTickets.length) {
    root.innerHTML = `<p class="empty">No developer tickets in this filter. Run a library check, or send user feedback here with Send to dev tickets.</p>`;
    return;
  }
  const items = [
    ...feedbackTickets.map((t) => ({
      kind: "feedback",
      at: t.ticketedAt || t.createdAt,
      html: feedbackTicketCardHtml(t),
    })),
    ...findings.map((f) => ({
      kind: "finding",
      at: f.createdAt,
      html: findingCardHtml(f),
    })),
  ].sort((a, b) => String(b.at).localeCompare(String(a.at)));
  root.innerHTML = items.map((item) => item.html).join("");

  root.querySelectorAll("button[data-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      void patchFinding(Number(btn.getAttribute("data-id")), btn.getAttribute("data-status"));
    });
  });
  bindFeedbackActionButtons(root, { refreshTickets: true });
}

function findingFilterToFeedbackStatus(filter) {
  if (filter === "open") return "open";
  if (filter === "fixed") return "done";
  if (filter === "all") return "all";
  return null;
}

async function patchFinding(id, status) {
  const res = await api(`/api/dev/findings/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    alert(err.error || "Could not update finding");
    return;
  }
  await refreshFindings();
  await refreshStatus(false);
}

async function refreshFindings() {
  const filter = el("finding-filter").value;
  const res = await api(`/api/dev/findings?status=${encodeURIComponent(filter)}`);
  if (!res.ok) throw new Error("Failed to load findings");
  const data = await res.json();
  let tickets = [];
  const fbStatus = findingFilterToFeedbackStatus(filter);
  if (fbStatus) {
    const ticketsRes = await api(
      `/api/dev/feedback-todos?ticketed=1&status=${encodeURIComponent(fbStatus)}`,
    );
    if (ticketsRes.ok) {
      const ticketsData = await ticketsRes.json();
      tickets = ticketsData.todos || [];
    }
  }
  renderFindings(data.findings, tickets);
}

function feedbackSourceLabel(t) {
  if (t.source === "voice") {
    return `voice${t.transcriptStatus ? ` · ${t.transcriptStatus}` : ""}`;
  }
  if (t.source === "contact") return "contact form";
  if (t.source === "tree") return "message tree";
  if (t.source === "partner") return "partner page";
  return "text";
}

function feedbackWhoLabel(t) {
  if (t.source === "contact") {
    try {
      const snap = JSON.parse(t.sessionSnapshot || "{}");
      if (snap.email) return snap.email;
      if (snap.phone) return snap.phone;
    } catch {
      /* ignore */
    }
    return "Web contact";
  }
  if (t.source === "tree") {
    try {
      const snap = JSON.parse(t.sessionSnapshot || "{}");
      if (snap.screenTitle) return snap.screenTitle;
    } catch {
      /* ignore */
    }
    return "Tree review";
  }
  if (t.source === "partner" || t.partnerSlug) {
    const slug = t.partnerSlug || "partner";
    const point =
      t.groupId && Number.isFinite(t.pointIndex)
        ? ` · point ${Number(t.pointIndex) + 1}`
        : "";
    return `${slug}${point}`;
  }
  return `User ${t.telegramUserId}`;
}

function feedbackTreePath(t) {
  if (t.source !== "tree") return null;
  try {
    const snap = JSON.parse(t.sessionSnapshot || "{}");
    if (snap.treePath) return migrateTreePath(snap.treePath);
    if (Array.isArray(snap.actions) && snap.actions.length) {
      return treeReviewPath(snap.actions);
    }
  } catch {
    /* ignore */
  }
  return "/dev#tree";
}

function feedbackPartnerLink(t) {
  if (!t.partnerSlug) return null;
  return `/partners/${encodeURIComponent(t.partnerSlug)}/org`;
}

function feedbackCardHtml(t, actions, opts = {}) {
  const treePath = feedbackTreePath(t);
  const treeLink = treePath
    ? `<a class="badge badge-source" href="${escapeHtml(treePath)}">Open tree location</a>`
    : "";
  const partnerHref = feedbackPartnerLink(t);
  const partnerLink = partnerHref
    ? `<a class="badge badge-source" href="${escapeHtml(partnerHref)}">Partner page</a>`
    : "";
  const statusBadge =
    t.status === "disqualified"
      ? `<span class="badge badge-cat">disqualified</span>`
      : "";
  const ticketBadge = opts.fromTickets
    ? `<span class="badge badge-source">from feedback</span>`
    : "";
  const creditNote =
    t.campaignId && t.status !== "disqualified"
      ? `<span class="cat">Credits ${escapeHtml(t.partnerSlug || t.campaignId)}</span>`
      : t.campaignId && t.status === "disqualified"
        ? `<span class="cat">Removed from ${escapeHtml(t.partnerSlug || t.campaignId)} metrics</span>`
        : "";
  return `<article class="finding" data-feedback="${t.id}">
        <div class="finding-head">
          <span class="badge badge-cat">${escapeHtml(feedbackSourceLabel(t))}</span>
          <span class="badge badge-source">${escapeHtml(t.step)}</span>
          ${ticketBadge}
          ${statusBadge}
          ${treeLink}
          ${partnerLink}
          <h3>${escapeHtml(feedbackWhoLabel(t))}</h3>
        </div>
        <p>${escapeHtml(t.text)}</p>
        <div class="finding-meta">
          <span class="cat">${escapeHtml(formatWhen(t.createdAt))}</span>
          ${creditNote}
          <div class="finding-actions">${actions.join("")}</div>
        </div>
      </article>`;
}

function bindFeedbackActionButtons(root, opts = {}) {
  root.querySelectorAll("button[data-feedback-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = Number(btn.getAttribute("data-feedback-id"));
      if (btn.getAttribute("data-action") === "ticket") {
        void sendFeedbackToTickets(id);
        return;
      }
      void patchFeedbackTodo(id, btn.getAttribute("data-status"), {
        refreshTickets: Boolean(opts.refreshTickets),
      });
    });
  });
}

function renderFeedbackTodos(todos) {
  const root = el("feedback-list");
  if (!root) return;
  if (!todos.length) {
    root.innerHTML = `<p class="empty">No feedback in this filter yet. Testers can text, send a voice note, use the contact form, or submit on a signed-in partner organization page. Tree review requests also land here.</p>`;
    return;
  }
  root.innerHTML = todos
    .map((t) => {
      const actions = [];
      if (t.status === "open") {
        actions.push(
          `<button type="button" class="action-send-ticket" data-feedback-id="${t.id}" data-action="ticket">Send to dev tickets</button>`,
        );
        actions.push(
          `<button type="button" data-feedback-id="${t.id}" data-status="done">Mark done</button>`,
        );
        actions.push(
          `<button type="button" data-feedback-id="${t.id}" data-status="disqualified">Disqualify as feedback</button>`,
        );
      } else if (t.status === "done") {
        actions.push(
          `<button type="button" data-feedback-id="${t.id}" data-status="open">Reopen</button>`,
        );
        actions.push(
          `<button type="button" data-feedback-id="${t.id}" data-status="disqualified">Disqualify as feedback</button>`,
        );
      } else {
        actions.push(
          `<button type="button" data-feedback-id="${t.id}" data-status="open">Restore as open</button>`,
        );
      }
      return feedbackCardHtml(t, actions);
    })
    .join("");

  bindFeedbackActionButtons(root);
}

async function patchFeedbackTodo(id, status, opts = {}) {
  const res = await api(`/api/dev/feedback-todos/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    alert(err.error || "Could not update feedback todo");
    return;
  }
  await refreshFeedbackTodos();
  if (opts.refreshTickets) {
    await refreshFindings();
    await refreshOrgTickets();
  }
}

async function sendFeedbackToTickets(id) {
  const res = await api(`/api/dev/feedback-todos/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticketed: true }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    alert(err.error || "Could not send to developer tickets");
    return;
  }
  await refreshFeedbackTodos();
  await refreshFindings();
  await refreshOrgTickets();
  revealSection("org-tickets");
  el("org-tickets")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function refreshFeedbackTodos() {
  const filterEl = el("feedback-filter");
  if (!filterEl) return;
  const filter = filterEl.value;
  const res = await api(
    `/api/dev/feedback-todos?status=${encodeURIComponent(filter)}&ticketed=0`,
  );
  if (!res.ok) throw new Error("Failed to load feedback todos");
  const data = await res.json();
  renderFeedbackTodos(data.todos);
}

function renderOrgTickets(todos) {
  const root = el("org-tickets-list");
  if (!root) return;
  const attributed = (todos || []).filter((t) => t.partnerSlug || t.campaignId);
  if (!attributed.length) {
    root.innerHTML = `<p class="empty">No organization-attributed developer tickets in this filter yet. Promote partner feedback with Send to dev tickets.</p>`;
    return;
  }
  const groups = new Map();
  for (const t of attributed) {
    const key = t.partnerSlug || t.campaignId || "unknown";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  const ordered = [...groups.entries()].sort((a, b) => {
    const aOpen = a[1].filter((t) => t.status === "open").length;
    const bOpen = b[1].filter((t) => t.status === "open").length;
    if (bOpen !== aOpen) return bOpen - aOpen;
    return a[0].localeCompare(b[0]);
  });
  root.innerHTML = ordered
    .map(([key, items]) => {
      const openCount = items.filter((t) => t.status === "open").length;
      const label = items[0]?.partnerSlug || key;
      const href = items[0]?.partnerSlug
        ? `/partners/${encodeURIComponent(items[0].partnerSlug)}/org`
        : null;
      const title = href
        ? `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`
        : escapeHtml(label);
      const cards = items.map((t) => feedbackTicketCardHtml(t)).join("");
      return `<section class="org-ticket-group" data-org="${escapeHtml(key)}">
        <header class="org-ticket-group-head">
          <h3>${title}</h3>
          <p>${items.length} ticket${items.length === 1 ? "" : "s"} · ${openCount} open</p>
        </header>
        <div class="findings">${cards}</div>
      </section>`;
    })
    .join("");
  bindFeedbackActionButtons(root, { refreshTickets: true });
}

async function refreshOrgTickets() {
  const filterEl = el("org-ticket-filter");
  if (!filterEl) return;
  const filter = filterEl.value;
  const res = await api(
    `/api/dev/feedback-todos?status=${encodeURIComponent(filter)}&ticketed=1&limit=500`,
  );
  if (!res.ok) throw new Error("Failed to load organization tickets");
  const data = await res.json();
  renderOrgTickets(data.todos);
}

function formatPeriods(periods) {
  if (!periods || !periods.length) return "no dates extracted";
  return periods.map((p) => (p.start === p.end ? p.start : `${p.start} → ${p.end}`)).join(", ");
}

function renderDisasterScanState(disaster) {
  const status = el("disaster-scan-status");
  if (!status || !disaster) return;
  const names = { fns: "FNS (decides)", fema: "FEMA", cdss: "CDSS" };
  const parts = disaster.sources.map((s) => {
    const name = names[s.source] || s.source;
    if (s.lastSuccessAt == null) return `${name}: never succeeded`;
    const age = s.daysSinceSuccess === 0 ? "today" : `${s.daysSinceSuccess}d ago`;
    return `${name}: ${age}${s.lastError ? ` (last error: ${s.lastError})` : ""}`;
  });
  const stale = disaster.sources.some((s) => s.stale);
  const counts = [
    `${disaster.liveCount} open now`,
    `${disaster.upcomingCount || 0} published, not open yet`,
    `${disaster.heldCount} held`,
  ];
  status.textContent = `${parts.join(" · ")} – ${counts.join(", ")}`;
  status.style.color = stale ? "#8a4a10" : "";
}

/** Reads as a record of what the scan decided, since nothing waits on approval. */
function decisionLabel(w) {
  if (w.status === "dismissed") return "pulled by hand";
  if (w.status === "expired") return "closed";
  if (w.status === "active") {
    return w.decision === "auto_published"
      ? `live · auto${w.confidence ? ` (${w.confidence})` : ""}`
      : "live · published by hand";
  }
  return w.decision === "auto_held" ? "held · failed a check" : "not published";
}

function renderValidationChecks(w) {
  if (!Array.isArray(w.validation) || !w.validation.length) return "";
  const rows = w.validation
    .map(
      (c) =>
        `<li>${c.ok ? "✓" : "✗"} <strong>${escapeHtml(c.id)}</strong>: ${escapeHtml(c.detail || "")}</li>`,
    )
    .join("");
  const failed = w.validation.filter((c) => !c.ok).length;
  return `<details class="window-checks"${failed ? " open" : ""}>
    <summary>${failed ? `${failed} check(s) failed` : "all checks passed"}</summary>
    <ul>${rows}</ul>
  </details>`;
}

function renderDisasterWindows(windows) {
  const root = el("disaster-list");
  if (!root) return;
  if (!windows.length) {
    root.innerHTML = `<p class="empty">No disaster windows in this filter. Disaster CalFresh is dormant most of the year – this staying empty is the expected state.</p>`;
    return;
  }
  root.innerHTML = windows
    .map((w) => {
      const actions = [];
      if (w.status !== "active") {
        actions.push(`<button type="button" data-window-id="${w.id}" data-status="active">Publish anyway</button>`);
      }
      if (w.status === "active") {
        actions.push(`<button type="button" data-window-id="${w.id}" data-status="dismissed">Pull from bot</button>`);
      }
      const counties = w.counties.length ? w.counties.join(", ") : "no counties extracted";
      const zips = w.zips && w.zips.length ? `<p>ZIPs (${w.zips.length}): ${escapeHtml(w.zips.join(", "))}</p>` : "";
      const places = w.placeLabels && w.placeLabels.length ? `<p>Places: ${escapeHtml(w.placeLabels.join(", "))}</p>` : "";
      const incident = w.incidentBegin
        ? `<p>Incident period: ${escapeHtml(w.incidentBegin)}${w.incidentEnd ? ` → ${escapeHtml(w.incidentEnd)}` : ""}</p>`
        : "";
      const channel = [
        w.applyPhone ? `phone ${escapeHtml(w.applyPhone)}` : "",
        w.applyUrl ? `<a class="action-link" href="${escapeHtml(w.applyUrl)}" target="_blank" rel="noopener">apply URL</a>` : "",
      ]
        .filter(Boolean)
        .join(" · ");
      const notes = w.notes ? `<p><strong>Note:</strong> ${escapeHtml(w.notes)}</p>` : "";
      const source = w.sourceUrl
        ? `<a class="action-link" href="${escapeHtml(w.sourceUrl)}" target="_blank" rel="noopener">Open source</a>`
        : "";
      return `<article class="finding" data-window="${w.id}">
        <div class="finding-head">
          <span class="badge badge-cat">${escapeHtml(decisionLabel(w))}</span>
          <span class="badge badge-source">${escapeHtml(w.extractedBy || "unknown")}</span>
          <h3>${escapeHtml(w.label)}</h3>
        </div>
        <p>Counties: ${escapeHtml(counties)}</p>
        <p>Apply: ${escapeHtml(formatPeriods(w.applyPeriods))}</p>
        ${incident}
        ${places}
        ${zips}
        ${channel ? `<p>How to apply: ${channel}</p>` : ""}
        ${notes}
        ${renderValidationChecks(w)}
        <div class="finding-meta">
          <span class="cat">${w.femaDisasterNumber ? `DR-${w.femaDisasterNumber}-CA` : "no FEMA match"}</span>
          ${source}
          <div class="finding-actions">${actions.join("")}</div>
        </div>
      </article>`;
    })
    .join("");

  root.querySelectorAll("button[data-window-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      void patchDisasterWindow(
        Number(btn.getAttribute("data-window-id")),
        btn.getAttribute("data-status"),
      );
    });
  });
}

async function patchDisasterWindow(id, status) {
  const prompts = {
    active:
      "This window failed an automatic check. Publish it anyway? Users in these areas will start seeing the Disaster CalFresh card.",
    dismissed:
      "Pull this window from the bot? The card stops showing, and later scans will not put it back.",
  };
  if (prompts[status] && !confirm(prompts[status])) return;
  const res = await api(`/api/dev/disaster-windows/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    alert(err.error || "Could not update disaster window");
    return;
  }
  await refreshDisasterWindows();
}

async function refreshDisasterWindows() {
  const filterEl = el("disaster-filter");
  if (!filterEl) return;
  const res = await api(`/api/dev/disaster-windows?status=${encodeURIComponent(filterEl.value)}`);
  if (!res.ok) throw new Error("Failed to load disaster windows");
  const data = await res.json();
  renderDisasterWindows(data.windows);
  renderDisasterScanState(data.disaster);
}

async function refreshStatus(alsoFindings = true) {
  const res = await api("/api/dev/status");
  if (!res.ok) throw new Error("Failed to load developer status");
  const status = await res.json();
  renderOverview(status);
  if (alsoFindings) {
    await refreshFindings();
    await refreshFeedbackTodos();
    await refreshOrgTickets();
    await refreshDisasterWindows();
  }

  if (status.latestScan && (status.latestScan.status === "running" || status.latestScan.status === "queued")) {
    startPolling();
  } else {
    stopPolling();
  }
  return status;
}

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(() => {
    void refreshStatus(true);
  }, 2000);
}

function stopPolling() {
  if (!pollTimer) return;
  clearInterval(pollTimer);
  pollTimer = null;
}

async function startScan() {
  const btn = el("btn-scan");
  btn.disabled = true;
  btn.textContent = "Starting…";
  el("scan-status").textContent = "Starting library check…";
  const res = await api("/api/dev/scan", { method: "POST" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    alert(data.error || "Could not start scan");
    btn.disabled = false;
    btn.textContent = "Run library check";
    return;
  }
  startPolling();
  await refreshStatus(true);
}

async function logout() {
  await fetch("/api/dev/logout", { method: "POST" }).catch(() => {});
  location.href = "/dev/login.html";
}

/* ---------- Program requirements matrix ---------- */

const matrix = {
  data: null,
  rowsById: new Map(),
  labels: { eligibility: new Map(), documents: new Map(), programs: new Map() },
  shortLabels: { eligibility: new Map(), documents: new Map(), programs: new Map() },
  orGroupsById: new Map(),
  activeTab: "edit",
  rankStale: false,
};

const MULTI_FIELDS = {
  eligibility: { vocab: "eligibility", empty: "none recorded" },
  documents: { vocab: "documents", empty: "none recorded" },
  unlocks: { vocab: "programs", empty: "none" },
  prerequisites: { vocab: "programs", empty: "none" },
};

const FIELD_LABELS = {
  eligibility: "eligibility requirements",
  documents: "documents",
  interview: "interview",
  unlocks: "unlocked programs",
  prerequisites: "prerequisites",
  difficultyOverride: "difficulty tier",
  availabilityOverride: "open/closed status",
  availabilityNote: "status note",
  reviewStatus: "review status",
  confidencePct: "confidence",
  reviewRefs: "references",
  notes: "notes",
};

function labelFor(vocabKey, id) {
  return matrix.labels[vocabKey].get(id) ?? id;
}

function shortLabelFor(vocabKey, id) {
  return matrix.shortLabels[vocabKey].get(id) ?? labelFor(vocabKey, id);
}

function indexMatrix(data) {
  matrix.data = data;
  matrix.rowsById = new Map(data.rows.map((r) => [r.id, r]));
  matrix.labels.eligibility = new Map(data.vocab.eligibility.map((v) => [v.id, v.label]));
  matrix.labels.documents = new Map(data.vocab.documents.map((v) => [v.id, v.label]));
  matrix.labels.programs = new Map(data.programIndex.map((p) => [p.id, p.name]));
  matrix.shortLabels.eligibility = new Map(data.vocab.eligibility.map((v) => [v.id, v.short]));
  matrix.shortLabels.documents = new Map(data.vocab.documents.map((v) => [v.id, v.short]));
  matrix.shortLabels.programs = new Map(data.programIndex.map((p) => [p.id, p.short]));
  matrix.orGroupsById = new Map((data.documentOrGroups ?? []).map((g) => [g.id, g]));
}

/** Collapse full OR-group matches the same way the server scores difficulty. */
function resolveDocuments(ids) {
  const docs = (ids ?? []).filter((d) => d !== "none");
  const orGroups = [];
  const consumed = new Set();
  for (const group of matrix.orGroupsById.values()) {
    if (group.members.every((m) => docs.includes(m))) {
      orGroups.push(group.id);
      for (const m of group.members) consumed.add(m);
    }
  }
  return {
    required: docs.filter((d) => !consumed.has(d)),
    orGroups,
  };
}

function chipsHtml(field, ids) {
  const vocabKey = MULTI_FIELDS[field].vocab;
  if (!ids.length) {
    return `<span class="chip chip-empty">${escapeHtml(MULTI_FIELDS[field].empty)}</span>`;
  }

  let displayIds = ids;
  const orChips = [];
  if (field === "documents") {
    const resolved = resolveDocuments(ids);
    displayIds = resolved.required;
    for (const groupId of resolved.orGroups) {
      const group = matrix.orGroupsById.get(groupId);
      if (!group) continue;
      orChips.push(
        `<span class="chip chip-or" title="${escapeHtml(group.label)}">${escapeHtml(
          group.short,
        )}</span>`,
      );
    }
  }

  const shown = displayIds.slice(0, orChips.length ? 3 : 4);
  const rest = displayIds.length - shown.length;
  const chips = [...orChips];
  for (const id of shown) {
    chips.push(
      `<span class="chip" title="${escapeHtml(labelFor(vocabKey, id))}">${escapeHtml(
        shortLabelFor(vocabKey, id),
      )}</span>`,
    );
  }
  if (rest > 0) chips.push(`<span class="chip chip-more">+${rest}</span>`);
  return chips.join("");
}

/** Flatten document labels for CSV/search – matched OR groups become one line. */
function documentLabelsForExport(ids) {
  if (!ids.length) return [];
  const resolved = resolveDocuments(ids);
  const out = [];
  for (const groupId of resolved.orGroups) {
    const group = matrix.orGroupsById.get(groupId);
    out.push(group?.label ?? groupId);
  }
  for (const id of resolved.required) {
    out.push(labelFor("documents", id));
  }
  return out;
}

function multiCellHtml(row, field) {
  const spec = MULTI_FIELDS[field];
  const selected = row[field] ?? [];
  const options =
    spec.vocab === "programs"
      ? matrix.data.programIndex
          .filter((p) => p.id !== row.id)
          .map((p) => ({ id: p.id, label: p.name, group: "Programs" }))
      : matrix.data.vocab[spec.vocab];

  const groups = new Map();
  for (const opt of options) {
    if (!groups.has(opt.group)) groups.set(opt.group, []);
    groups.get(opt.group).push(opt);
  }

  const menu = [...groups.entries()]
    .map(
      ([group, items]) => `<fieldset class="multi-group">
        <legend>${escapeHtml(group)}</legend>
        ${items
          .map(
            (opt) => `<label><input type="checkbox" value="${escapeHtml(opt.id)}"${
              selected.includes(opt.id) ? " checked" : ""
            } /> <span>${escapeHtml(opt.label)}</span></label>`,
          )
          .join("")}
      </fieldset>`,
    )
    .join("");

  return `<details class="multi" data-kind="multi" data-program="${escapeHtml(row.id)}" data-field="${field}">
    <summary><span class="chips" data-chips="${field}">${chipsHtml(field, selected)}</span></summary>
    <div class="multi-menu">${menu}</div>
  </details>`;
}

function selectHtml(row, field, options, { includeBlank = false, blankLabel = "" } = {}) {
  const value = row[field] ?? "";
  const opts = [
    includeBlank ? `<option value=""${value ? "" : " selected"}>${escapeHtml(blankLabel)}</option>` : "",
    ...options.map(
      (o) =>
        `<option value="${escapeHtml(o.id)}"${o.id === value ? " selected" : ""}>${escapeHtml(o.label)}</option>`,
    ),
  ].join("");
  return `<select class="cell-select" data-program="${escapeHtml(row.id)}" data-field="${field}">${opts}</select>`;
}

function hostLabel(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function refsToText(refs) {
  return refs.map((r) => `${r.label} | ${r.url}`).join("\n");
}

function parseRefLines(text) {
  return String(text)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const pipe = line.lastIndexOf("|");
      if (pipe === -1) return { label: "", url: line };
      return { label: line.slice(0, pipe).trim(), url: line.slice(pipe + 1).trim() };
    });
}

function refsCellHtml(row) {
  const links = row.reviewRefs.length
    ? row.reviewRefs
        .map(
          (r) =>
            `<a href="${escapeHtml(r.url)}" target="_blank" rel="noopener">${escapeHtml(r.label)}</a>`,
        )
        .join("")
    : `<span class="chip chip-empty">No references</span>`;
  const suggestions = [row.applyUrl, ...row.librarySources].filter(Boolean);
  return `<details class="multi" data-kind="refs">
    <summary><span class="ref-links" data-refs="${escapeHtml(row.id)}">${links}</span></summary>
    <div class="multi-menu">
      <p class="multi-hint">One per line, as <code>Label | https://url</code>.</p>
      <textarea rows="4" data-program="${escapeHtml(row.id)}" data-field="reviewRefs">${escapeHtml(refsToText(row.reviewRefs))}</textarea>
      ${
        suggestions.length
          ? `<p class="multi-hint">From the library: ${suggestions
              .map(
                (u) =>
                  `<button type="button" class="ref-add" data-add-url="${escapeHtml(u)}">${escapeHtml(
                    hostLabel(u),
                  )}</button>`,
              )
              .join(" ")}</p>`
          : ""
      }
    </div>
  </details>`;
}

function notesPeek(notes) {
  if (!notes) return "No notes";
  if (notes.length <= 70) return notes;
  const cut = notes.slice(0, 70);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

function difficultyCellHtml(row) {
  return `<div class="cell-difficulty" data-difficulty="${escapeHtml(row.id)}">
    <span class="badge badge-tier-${escapeHtml(row.difficultyTier)}" title="${escapeHtml(row.difficultyBreakdown)}">${escapeHtml(
      row.difficultyTier,
    )}</span>
    <span class="score" title="${escapeHtml(row.difficultyBreakdown)}">${row.difficultyScore}</span>
    ${selectHtml(row, "difficultyOverride", matrix.data.vocab.difficulty, {
      includeBlank: true,
      blankLabel: "auto",
    })}
  </div>`;
}

function reviewCellHtml(row) {
  return `<div class="cell-review" data-review="${escapeHtml(row.id)}">
    <span class="badge badge-review-${escapeHtml(row.reviewStatus)}">${escapeHtml(
      labelForReview(row.reviewStatus),
    )}</span>
    ${selectHtml(row, "reviewStatus", matrix.data.vocab.reviewStatus)}
    <label class="conf-row">
      <input class="cell-number" type="number" min="0" max="100" step="5"
        value="${row.confidencePct == null ? "" : row.confidencePct}"
        data-program="${escapeHtml(row.id)}" data-field="confidencePct" />
      <span>% sure</span>
    </label>
    <span class="cell-meta">${row.lastReviewedAt ? escapeHtml(formatWhen(row.lastReviewedAt)) : "never reviewed"}</span>
  </div>`;
}

/**
 * Availability is computed from library deadlines and the live disaster window
 * table, so the summary shows the verdict and the menu explains where it came
 * from before offering the manual override.
 */
function statusCellHtml(row) {
  const a = row.availability;
  return `<details class="multi" data-kind="status">
    <summary>
      <span class="cell-availability" data-availability="${escapeHtml(row.id)}">
        <span class="badge badge-avail-${escapeHtml(a.status)}">${escapeHtml(a.label)}</span>
        <span class="avail-detail" title="${escapeHtml(a.detail)}">${escapeHtml(a.short)}</span>
      </span>
    </summary>
    <div class="multi-menu">
      <p class="multi-hint" data-availability-why="${escapeHtml(row.id)}">${escapeHtml(a.detail)}</p>
      <p class="multi-hint">Computed from library deadlines and live disaster windows. Override only when you know it is wrong.</p>
      ${selectHtml(row, "availabilityOverride", matrix.data.vocab.availabilityOverride, {
        includeBlank: true,
        blankLabel: "auto (computed)",
      })}
      <textarea rows="3" placeholder="Why, and who said so – e.g. funds exhausted for FY26 per CSD 7/15"
        data-program="${escapeHtml(row.id)}" data-field="availabilityNote">${escapeHtml(row.availabilityNote)}</textarea>
    </div>
  </details>`;
}

function labelForReview(id) {
  return matrix.data.vocab.reviewStatus.find((r) => r.id === id)?.label ?? id;
}

function availabilityLabel(id) {
  return matrix.data.vocab.availability.find((a) => a.id === id)?.label ?? id;
}

function unlocksCellHtml(row) {
  const reverse = row.unlockedBy.length
    ? `<p class="cell-meta" data-unlockedby="${escapeHtml(row.id)}">Reached via ${escapeHtml(
        row.unlockedBy.map((id) => shortLabelFor("programs", id)).join(", "),
      )}</p>`
    : `<p class="cell-meta" data-unlockedby="${escapeHtml(row.id)}"></p>`;
  return multiCellHtml(row, "unlocks") + reverse;
}

function openFindingsFor(programId) {
  return libraryWatch.findingsByProgram.get(programId) ?? 0;
}

function libraryCellHtml(row) {
  const sources = row.librarySources?.length ?? 0;
  const deadlineCount = row.deadlineCount ?? 0;
  const deadlines = `${deadlineCount}${row.hasNullDeadline ? "*" : ""}`;
  const deadlineTitle = row.hasNullDeadline
    ? "At least one deadline has no date in the library"
    : `${deadlineCount} deadline${deadlineCount === 1 ? "" : "s"} in the library`;
  const findings = openFindingsFor(row.id);
  const findingLabel = `${findings} open finding${findings === 1 ? "" : "s"}`;
  const findingsHtml =
    findings > 0
      ? `<a class="lib-findings" href="#dev-tickets">${escapeHtml(findingLabel)}</a>`
      : `<span class="cell-meta">${escapeHtml(findingLabel)}</span>`;
  return `<div class="cell-library" data-library="${escapeHtml(row.id)}">
    <a class="lib-apply" href="${escapeHtml(row.applyUrl)}" target="_blank" rel="noopener" title="${escapeHtml(row.applyUrl)}">${escapeHtml(hostLabel(row.applyUrl))}</a>
    <span class="cell-meta" title="${escapeHtml(deadlineTitle)}">${sources} source${sources === 1 ? "" : "s"} · ${escapeHtml(deadlines)} deadline${deadlineCount === 1 ? "" : "s"}</span>
    ${findingsHtml}
  </div>`;
}

function matrixRowHtml(row) {
  return `<tr data-matrix-row="${escapeHtml(row.id)}">
    <td class="num">${row.rank}</td>
    <td class="cell-program">
      <strong>${escapeHtml(row.name)}</strong>
      <span class="cat">${escapeHtml(row.category)}</span>
      <span class="cell-meta">${row.formFillMinutes} min form · ${row.timeToMoneyDays}d to money</span>
    </td>
    <td>${libraryCellHtml(row)}</td>
    <td class="cell-status">${statusCellHtml(row)}</td>
    <td>${difficultyCellHtml(row)}</td>
    <td>${multiCellHtml(row, "eligibility")}</td>
    <td>${multiCellHtml(row, "documents")}</td>
    <td>${selectHtml(row, "interview", matrix.data.vocab.interview)}</td>
    <td>${unlocksCellHtml(row)}</td>
    <td>${multiCellHtml(row, "prerequisites")}</td>
    <td>${reviewCellHtml(row)}</td>
    <td>${refsCellHtml(row)}</td>
    <td>
      <details class="multi">
        <summary><span class="notes-peek" data-notes="${escapeHtml(row.id)}">${escapeHtml(
          notesPeek(row.notes),
        )}</span></summary>
        <div class="multi-menu">
          <textarea rows="6" data-program="${escapeHtml(row.id)}" data-field="notes">${escapeHtml(row.notes)}</textarea>
        </div>
      </details>
    </td>
  </tr>`;
}

const OPEN_NOW_STATUSES = new Set(["open", "window_open", "deadline_soon"]);

function visibleMatrixRows() {
  const tier = el("matrix-tier").value;
  const review = el("matrix-review").value;
  const status = el("matrix-status").value;
  const q = el("matrix-search").value.trim().toLowerCase();
  return matrix.data.rows.filter((row) => {
    if (tier !== "all" && row.difficultyTier !== tier) return false;
    if (review !== "all" && row.reviewStatus !== review) return false;
    const open = OPEN_NOW_STATUSES.has(row.availability.status);
    if (status === "open" && !open) return false;
    if (status === "attention" && open) return false;
    if (status !== "all" && status !== "open" && status !== "attention") {
      if (row.availability.status !== status) return false;
    }
    if (!q) return true;
    const haystack = [
      row.name,
      row.id,
      row.category,
      row.notes,
      row.applyUrl,
      row.availability.label,
      row.availability.detail,
      ...row.eligibility.map((id) => labelFor("eligibility", id)),
      ...documentLabelsForExport(row.documents),
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(q);
  });
}

function renderMatrix() {
  const tbody = el("matrix-rows");
  if (!tbody || !matrix.data) return;
  const rows = visibleMatrixRows();
  tbody.innerHTML = rows.length
    ? rows.map(matrixRowHtml).join("")
    : `<tr><td colspan="13">No programs match this filter.</td></tr>`;
  matrix.rankStale = false;
  el("btn-matrix-resort").disabled = true;
  renderMatrixSummary();
  renderCoverageGrid();
}

function coverageColumns() {
  const showElig = el("coverage-show-eligibility")?.checked !== false;
  const showDocs = el("coverage-show-documents")?.checked !== false;
  const showInterview = el("coverage-show-interview")?.checked !== false;
  const rows = matrix.data.rows;
  const cols = [];

  if (showElig) {
    const used = new Set();
    for (const row of rows) {
      for (const id of row.eligibility) used.add(id);
    }
    for (const item of matrix.data.vocab.eligibility) {
      if (!used.has(item.id)) continue;
      cols.push({
        kind: "eligibility",
        id: item.id,
        short: item.short,
        label: item.label,
        group: "Eligibility",
        or: false,
      });
    }
  }

  if (showDocs) {
    const resolvedByProgram = new Map(
      rows.map((row) => [row.id, resolveDocuments(row.documents)]),
    );
    const usedOr = new Set();
    const usedDocs = new Set();
    for (const resolved of resolvedByProgram.values()) {
      for (const id of resolved.orGroups) usedOr.add(id);
      for (const id of resolved.required) usedDocs.add(id);
    }
    for (const group of matrix.orGroupsById.values()) {
      if (!usedOr.has(group.id)) continue;
      cols.push({
        kind: "or",
        id: group.id,
        short: group.short,
        label: group.label,
        group: "Documents (OR)",
        or: true,
      });
    }
    for (const item of matrix.data.vocab.documents) {
      if (item.id === "none" || !usedDocs.has(item.id)) continue;
      cols.push({
        kind: "document",
        id: item.id,
        short: item.short,
        label: item.label,
        group: "Documents",
        or: false,
      });
    }
  }

  if (showInterview) {
    cols.push({
      kind: "interview",
      id: "interview",
      short: "Interview",
      label: "Interview requirement",
      group: "Interview",
      or: false,
    });
  }

  return cols;
}

function coverageCellHtml(row, col) {
  if (col.kind === "eligibility") {
    return row.eligibility.includes(col.id)
      ? `<td class="coverage-yes" title="${escapeHtml(col.label)}">✓</td>`
      : "<td></td>";
  }
  if (col.kind === "or") {
    const resolved = resolveDocuments(row.documents);
    return resolved.orGroups.includes(col.id)
      ? `<td class="coverage-or-cell" title="${escapeHtml(col.label)}">OR</td>`
      : "<td></td>";
  }
  if (col.kind === "document") {
    const resolved = resolveDocuments(row.documents);
    return resolved.required.includes(col.id)
      ? `<td class="coverage-yes" title="${escapeHtml(col.label)}">✓</td>`
      : "<td></td>";
  }
  if (col.kind === "interview") {
    const label =
      matrix.data.vocab.interview.find((i) => i.id === row.interview)?.label ?? row.interview;
    if (row.interview === "none") {
      return `<td class="coverage-interview" title="No interview">—</td>`;
    }
    return `<td class="coverage-interview" title="${escapeHtml(label)}">${escapeHtml(label)}</td>`;
  }
  return "<td></td>";
}

function renderCoverageGrid() {
  const thead = el("coverage-head");
  const tbody = el("coverage-rows");
  if (!thead || !tbody || !matrix.data) return;

  const cols = coverageColumns();
  const rows = visibleMatrixRows();

  if (!cols.length) {
    thead.innerHTML = "";
    tbody.innerHTML = `<tr><td>Turn on at least one requirement group above.</td></tr>`;
    return;
  }

  const groupSpans = [];
  for (const col of cols) {
    const last = groupSpans[groupSpans.length - 1];
    if (last && last.group === col.group) last.span += 1;
    else groupSpans.push({ group: col.group, span: 1 });
  }

  thead.innerHTML = `
    <tr>
      <th class="coverage-corner" rowspan="2">Program</th>
      ${groupSpans
        .map(
          (g) =>
            `<th class="coverage-group" colspan="${g.span}">${escapeHtml(g.group)}</th>`,
        )
        .join("")}
    </tr>
    <tr>
      ${cols
        .map(
          (col) =>
            `<th class="coverage-req${col.or ? " coverage-or" : ""}" title="${escapeHtml(
              col.label,
            )}"><span>${escapeHtml(col.short)}</span></th>`,
        )
        .join("")}
    </tr>`;

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="${cols.length + 1}">No programs match this filter.</td></tr>`;
    return;
  }

  tbody.innerHTML = rows
    .map((row) => {
      const short = matrix.shortLabels.programs.get(row.id) ?? row.name;
      return `<tr>
        <th scope="row" title="${escapeHtml(row.name)}">${escapeHtml(short)}</th>
        ${cols.map((col) => coverageCellHtml(row, col)).join("")}
      </tr>`;
    })
    .join("");
}

function setMatrixTab(tab) {
  matrix.activeTab = tab === "grid" ? "grid" : "edit";
  const editPanel = el("matrix-edit-panel");
  const gridPanel = el("matrix-grid-panel");
  const editTab = el("tab-matrix-edit");
  const gridTab = el("tab-matrix-grid");
  if (!editPanel || !gridPanel || !editTab || !gridTab) return;

  const isGrid = matrix.activeTab === "grid";
  editPanel.hidden = isGrid;
  gridPanel.hidden = !isGrid;
  editTab.setAttribute("aria-selected", String(!isGrid));
  gridTab.setAttribute("aria-selected", String(isGrid));
  if (isGrid) renderCoverageGrid();
}

function renderMatrixSummary() {
  const node = el("matrix-summary");
  if (!node || !matrix.data) return;
  const s = matrix.data.summary;
  const statusBits = Object.entries(s.byAvailability)
    .filter(([, n]) => n > 0)
    .map(([id, n]) => `${n} ${availabilityLabel(id).toLowerCase()}`)
    .join(" · ");
  node.textContent = [
    `${s.total} programs: ${s.byTier.easy} easy · ${s.byTier.moderate} moderate · ${s.byTier.hard} hard`,
    `Status: ${statusBits}`,
    `Review: ${s.byReview.needs_review} need review · ${s.byReview.verified_online} verified online · ${s.byReview.signed_off_by_program} signed off`,
    s.avgConfidence == null ? "no confidence set" : `avg confidence ${s.avgConfidence}%`,
    `matrix version ${formatLibraryVersion(matrix.data.version)}`,
  ].join(" – ");
}

/** Update only derived/summary cells so an open editor keeps its focus. */
function refreshMatrixCells() {
  for (const row of matrix.data.rows) {
    const tr = document.querySelector(`tr[data-matrix-row="${row.id}"]`);
    if (!tr) continue;

    const diff = tr.querySelector(`[data-difficulty="${row.id}"]`);
    if (diff) {
      const badge = diff.querySelector(".badge");
      badge.className = `badge badge-tier-${row.difficultyTier}`;
      badge.textContent = row.difficultyTier;
      badge.title = row.difficultyBreakdown;
      const score = diff.querySelector(".score");
      score.textContent = String(row.difficultyScore);
      score.title = row.difficultyBreakdown;
    }

    const avail = tr.querySelector(`[data-availability="${row.id}"]`);
    if (avail) {
      const badge = avail.querySelector(".badge");
      badge.className = `badge badge-avail-${row.availability.status}`;
      badge.textContent = row.availability.label;
      const short = avail.querySelector(".avail-detail");
      short.textContent = row.availability.short;
      short.title = row.availability.detail;
      const why = tr.querySelector(`[data-availability-why="${row.id}"]`);
      if (why) why.textContent = row.availability.detail;
    }

    const review = tr.querySelector(`[data-review="${row.id}"]`);
    if (review) {
      const badge = review.querySelector(".badge");
      badge.className = `badge badge-review-${row.reviewStatus}`;
      badge.textContent = labelForReview(row.reviewStatus);
      review.querySelector(".cell-meta").textContent = row.lastReviewedAt
        ? formatWhen(row.lastReviewedAt)
        : "never reviewed";
    }

    for (const field of Object.keys(MULTI_FIELDS)) {
      const chips = tr.querySelector(`[data-chips="${field}"]`);
      if (chips) chips.innerHTML = chipsHtml(field, row[field] ?? []);
    }

    const reverse = tr.querySelector(`[data-unlockedby="${row.id}"]`);
    if (reverse) {
      reverse.textContent = row.unlockedBy.length
        ? `Reached via ${row.unlockedBy.map((id) => shortLabelFor("programs", id)).join(", ")}`
        : "";
    }

    const refs = tr.querySelector(`[data-refs="${row.id}"]`);
    if (refs) {
      refs.innerHTML = row.reviewRefs.length
        ? row.reviewRefs
            .map(
              (r) =>
                `<a href="${escapeHtml(r.url)}" target="_blank" rel="noopener">${escapeHtml(r.label)}</a>`,
            )
            .join("")
        : `<span class="chip chip-empty">No references</span>`;
    }

    const peek = tr.querySelector(`[data-notes="${row.id}"]`);
    if (peek) peek.textContent = notesPeek(row.notes);

    const library = tr.querySelector(`[data-library="${row.id}"]`);
    if (library) library.outerHTML = libraryCellHtml(row);

    const confidence = tr.querySelector('input[data-field="confidencePct"]');
    if (confidence && document.activeElement !== confidence) {
      confidence.value = row.confidencePct == null ? "" : String(row.confidencePct);
    }
  }
  renderMatrixSummary();
}

function refreshLibraryCells() {
  if (!matrix.data) return;
  for (const row of matrix.data.rows) {
    const cell = document.querySelector(`[data-library="${row.id}"]`);
    if (cell) cell.outerHTML = libraryCellHtml(row);
  }
}

function setMatrixStatus(text, isError = false) {
  const node = el("matrix-save-status");
  if (!node) return;
  node.textContent = text;
  node.style.color = isError ? "#8a1f1f" : "";
}

async function saveMatrixField(programId, field, value) {
  const name = labelFor("programs", programId);
  setMatrixStatus(`Saving ${FIELD_LABELS[field] ?? field} for ${name}…`);
  const res = await api(`/api/dev/program-matrix/${encodeURIComponent(programId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ [field]: value }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    setMatrixStatus(
      `Could not save ${FIELD_LABELS[field] ?? field} for ${name}: ${data.error || "unknown error"}`,
      true,
    );
    return;
  }
  matrix.data.rows = data.rows;
  matrix.data.summary = data.summary;
  matrix.rowsById = new Map(data.rows.map((r) => [r.id, r]));
  refreshMatrixCells();
  renderCoverageGrid();
  matrix.rankStale = true;
  el("btn-matrix-resort").disabled = false;
  setMatrixStatus(
    `Saved ${FIELD_LABELS[field] ?? field} for ${name} to library/program-requirements.json.`,
  );
}

function onMatrixChange(event) {
  const target = event.target;
  if (target.matches('.multi[data-kind="multi"] input[type="checkbox"]')) {
    const cell = target.closest(".multi[data-kind='multi']");
    const values = [...cell.querySelectorAll('input[type="checkbox"]:checked')].map(
      (cb) => cb.value,
    );
    void saveMatrixField(cell.dataset.program, cell.dataset.field, values);
    return;
  }
  const field = target.dataset?.field;
  if (!field || !target.dataset.program) return;
  if (field === "reviewRefs") {
    void saveMatrixField(target.dataset.program, field, parseRefLines(target.value));
    return;
  }
  if (field === "confidencePct") {
    void saveMatrixField(
      target.dataset.program,
      field,
      target.value === "" ? null : Number(target.value),
    );
    return;
  }
  void saveMatrixField(target.dataset.program, field, target.value);
}

function onMatrixClick(event) {
  const addBtn = event.target.closest("button[data-add-url]");
  if (!addBtn) return;
  const menu = addBtn.closest(".multi-menu");
  const textarea = menu?.querySelector('textarea[data-field="reviewRefs"]');
  if (!textarea) return;
  const url = addBtn.dataset.addUrl;
  if (textarea.value.includes(url)) return;
  const existing = textarea.value.trim();
  textarea.value = `${existing}${existing ? "\n" : ""}${hostLabel(url)} | ${url}`;
  void saveMatrixField(
    textarea.dataset.program,
    "reviewRefs",
    parseRefLines(textarea.value),
  );
}

function matrixCsv() {
  const header = [
    "rank",
    "program",
    "id",
    "category",
    "apply url",
    "sources",
    "deadlines",
    "open findings",
    "status",
    "status detail",
    "difficulty",
    "score",
    "eligibility",
    "documents",
    "interview",
    "also qualifies you for",
    "needs first",
    "reached via",
    "review status",
    "confidence %",
    "last reviewed",
    "references",
    "notes",
  ];
  const cell = (v) => `"${String(v ?? "").replaceAll('"', '""')}"`;
  const lines = [header.map(cell).join(",")];
  for (const row of matrix.data.rows) {
    lines.push(
      [
        row.rank,
        row.name,
        row.id,
        row.category,
        row.applyUrl,
        row.librarySources?.length ?? 0,
        `${row.deadlineCount ?? 0}${row.hasNullDeadline ? "*" : ""}`,
        openFindingsFor(row.id),
        row.availability.label,
        row.availability.detail,
        row.difficultyTier,
        row.difficultyScore,
        row.eligibility.map((id) => labelFor("eligibility", id)).join("; "),
        documentLabelsForExport(row.documents).join("; "),
        matrix.data.vocab.interview.find((i) => i.id === row.interview)?.label ?? row.interview,
        row.unlocks.map((id) => labelFor("programs", id)).join("; "),
        row.prerequisites.map((id) => labelFor("programs", id)).join("; "),
        row.unlockedBy.map((id) => labelFor("programs", id)).join("; "),
        labelForReview(row.reviewStatus),
        row.confidencePct ?? "",
        row.lastReviewedAt ?? "",
        row.reviewRefs.map((r) => `${r.label}: ${r.url}`).join("; "),
        row.notes,
      ]
        .map(cell)
        .join(","),
    );
  }
  return lines.join("\n");
}

function downloadMatrixCsv() {
  const blob = new Blob([matrixCsv()], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `calclaim-program-requirements-${matrix.data.version}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  setMatrixStatus("Downloaded the matrix as CSV.");
}

async function copyMatrixJson() {
  const programs = {};
  for (const p of matrix.data.programIndex) {
    const row = matrix.rowsById.get(p.id);
    if (!row) continue;
    programs[p.id] = {
      eligibility: row.eligibility,
      documents: row.documents,
      interview: row.interview,
      unlocks: row.unlocks,
      prerequisites: row.prerequisites,
      difficultyOverride: row.difficultyOverride,
      availabilityOverride: row.availabilityOverride,
      availabilityNote: row.availabilityNote,
      reviewStatus: row.reviewStatus,
      confidencePct: row.confidencePct,
      reviewRefs: row.reviewRefs,
      notes: row.notes,
      lastReviewedAt: row.lastReviewedAt,
      reviewedBy: row.reviewedBy,
    };
  }
  const json = JSON.stringify(
    { version: matrix.data.version, notes: matrix.data.notes, programs },
    null,
    2,
  );
  try {
    await navigator.clipboard.writeText(json);
    setMatrixStatus("Copied the matrix JSON to the clipboard.");
  } catch {
    setMatrixStatus("Clipboard blocked – the file on disk already has these edits.", true);
  }
}

async function loadMatrix() {
  const res = await api("/api/dev/program-matrix");
  if (!res.ok) throw new Error("Failed to load program matrix");
  indexMatrix(await res.json());
  renderMatrix();
  setMatrixStatus("");
}

function wireMatrix() {
  const tbody = el("matrix-rows");
  if (!tbody) return;
  tbody.addEventListener("change", onMatrixChange);
  tbody.addEventListener("click", onMatrixClick);
  el("matrix-tier").addEventListener("change", renderMatrix);
  el("matrix-review").addEventListener("change", renderMatrix);
  el("matrix-status").addEventListener("change", renderMatrix);
  el("matrix-search").addEventListener("input", renderMatrix);
  el("btn-matrix-resort").addEventListener("click", renderMatrix);
  el("btn-matrix-csv").addEventListener("click", downloadMatrixCsv);
  el("btn-matrix-json").addEventListener("click", () => void copyMatrixJson());
  el("btn-matrix-resort").disabled = true;

  for (const tab of document.querySelectorAll("[data-matrix-tab]")) {
    tab.addEventListener("click", () => setMatrixTab(tab.getAttribute("data-matrix-tab")));
  }
  for (const id of [
    "coverage-show-eligibility",
    "coverage-show-documents",
    "coverage-show-interview",
  ]) {
    el(id)?.addEventListener("change", renderCoverageGrid);
  }

  if (location.hash === "#coverage" || location.hash === "#matrix-grid") {
    setMatrixTab("grid");
  } else if (location.hash === "#matrix" || location.hash === "#programs") {
    setMatrixTab("edit");
  }
}

function renderFunnel(funnel) {
  const stages = funnel?.stages ?? [];
  const tbody = el("funnel-rows");
  const callout = el("funnel-callout");
  if (!tbody || !callout) return;

  if (!stages.length) {
    tbody.innerHTML = `<tr><td colspan="4">No funnel data yet.</td></tr>`;
    return;
  }

  const maxDropPct = Math.max(...stages.map((s) => s.dropPct), 0);

  tbody.innerHTML = stages
    .map((s) => {
      const dropCell =
        s.dropOff > 0
          ? `<span class="${s.dropPct === maxDropPct && maxDropPct > 0 ? "drop-bad" : ""}">−${number.format(s.dropOff)} (${s.dropPct}%)</span>`
          : "–";
      return `<tr>
        <td>${escapeHtml(s.label)}<span class="stage-detail">${escapeHtml(s.detail)}</span></td>
        <td class="num">${number.format(s.count)}</td>
        <td class="num">${dropCell}</td>
        <td class="num">${s.retentionPct}%</td>
      </tr>`;
    })
    .join("");

  if (funnel.biggestDropFrom && funnel.biggestDropTo && funnel.biggestDropCount > 0) {
    const from = stages.find((s) => s.id === funnel.biggestDropFrom);
    const to = stages.find((s) => s.id === funnel.biggestDropTo);
    callout.hidden = false;
    callout.textContent = `Largest drop: ${from?.label ?? funnel.biggestDropFrom} → ${to?.label ?? funnel.biggestDropTo} (−${number.format(funnel.biggestDropCount)} users, ${funnel.biggestDropPct}%).`;
  } else {
    callout.hidden = true;
  }

  const canvas = el("chart-funnel");
  if (!canvas || typeof Chart === "undefined") return;

  if (canvas._funnelChart) {
    canvas._funnelChart.destroy();
  }

  const labels = stages.map((s) => s.label);
  const values = stages.map((s) => s.count);
  const colors = stages.map((s) =>
    s.dropPct === maxDropPct && maxDropPct > 0
      ? "rgba(180, 70, 50, 0.75)"
      : "rgba(13, 122, 95, 0.75)",
  );

  canvas._funnelChart = new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Users at stage",
          data: values,
          backgroundColor: colors,
          borderRadius: 6,
          maxBarThickness: 42,
        },
      ],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            afterLabel(ctx) {
              const s = stages[ctx.dataIndex];
              if (!s || s.dropOff <= 0) return `Still in: ${s?.retentionPct ?? 0}% of reach`;
              return [
                `Drop from prior: −${s.dropOff} (${s.dropPct}%)`,
                `Still in: ${s.retentionPct}% of reach`,
              ];
            },
          },
        },
      },
      scales: {
        x: {
          beginAtZero: true,
          ticks: { precision: 0 },
          grid: { color: "rgba(16, 36, 31, 0.08)" },
        },
        y: {
          grid: { display: false },
        },
      },
    },
  });
}

function renderScreenDropout(screenDropout) {
  const tbody = el("screen-dropout-rows");
  const callout = el("screen-dropout-callout");
  if (!tbody || !callout) return;

  const screens = (screenDropout?.screens ?? []).filter((s) => s.reached > 0);
  if (!screens.length) {
    tbody.innerHTML = `<tr><td colspan="5">No per-screen data yet.</td></tr>`;
    callout.hidden = true;
    return;
  }

  const maxDrop = Math.max(...screens.map((s) => s.dropPct), 0);
  tbody.innerHTML = screens
    .map((s) => {
      const dropClass =
        s.dropPct === maxDrop && maxDrop > 0 && s.id !== "finish" ? "drop-bad" : "";
      return `<tr>
        <td>${escapeHtml(s.label)}<span class="stage-detail">${escapeHtml(s.detail)}</span></td>
        <td class="num">${number.format(s.reached)}</td>
        <td class="num">${s.dropped > 0 ? `−${number.format(s.dropped)}` : "–"}</td>
        <td class="num"><span class="${dropClass}">${s.dropPct}%</span></td>
        <td class="num">${s.avgLeft}</td>
      </tr>`;
    })
    .join("");

  if (screenDropout.biggestDropId && screenDropout.biggestDropPct > 0) {
    const row = screens.find((s) => s.id === screenDropout.biggestDropId);
    callout.hidden = false;
    callout.textContent = `Highest drop rate: ${row?.label ?? screenDropout.biggestDropId} (${screenDropout.biggestDropPct}% of people who reached it left there).`;
  } else {
    callout.hidden = true;
  }

  const canvas = el("chart-screen-dropout");
  if (!canvas || typeof Chart === "undefined") return;
  if (canvas._screenChart) canvas._screenChart.destroy();

  const labels = screens.map((s) => s.label);
  canvas._screenChart = new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Reached",
          data: screens.map((s) => s.reached),
          backgroundColor: "rgba(13, 122, 95, 0.7)",
          borderRadius: 5,
          maxBarThickness: 28,
        },
        {
          label: "Dropped here",
          data: screens.map((s) => s.dropped),
          backgroundColor: "rgba(180, 70, 50, 0.7)",
          borderRadius: 5,
          maxBarThickness: 28,
        },
      ],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      plugins: {
        legend: { position: "bottom", labels: { boxWidth: 12 } },
        tooltip: {
          callbacks: {
            afterLabel(ctx) {
              const s = screens[ctx.dataIndex];
              if (!s) return "";
              return [
                `Drop rate: ${s.dropPct}%`,
                `Avg screens left when shown: ${s.avgLeft}`,
                `Avg % through: ${s.avgPct}%`,
              ];
            },
          },
        },
      },
      scales: {
        x: {
          beginAtZero: true,
          ticks: { precision: 0 },
          grid: { color: "rgba(16, 36, 31, 0.08)" },
        },
        y: { grid: { display: false } },
      },
    },
  });
}

function renderScreenTiming(screenTiming) {
  const summary = el("screen-timing-summary");
  const tbody = el("screen-timing-rows");
  const callout = el("screen-timing-callout");
  const finishEl = el("m-finish-time");
  const finishNote = el("m-finish-time-note");
  if (!summary || !tbody || !callout) return;

  const journey = screenTiming?.journey;
  const screens = (screenTiming?.screens ?? []).filter((s) => s.samples > 0);

  if (!screens.length && !(journey?.samples)) {
    summary.textContent =
      "No timing yet – appears after people move from one bot screen to the next (uses existing screen timestamps, including sessions from before this panel shipped).";
    tbody.innerHTML = `<tr><td colspan="5">No timing data yet.</td></tr>`;
    callout.hidden = true;
    if (finishEl) finishEl.textContent = "–";
    if (finishNote) finishNote.textContent = "Active answering time";
    const emptyCanvas = el("chart-screen-timing");
    if (emptyCanvas?._timingChart) {
      emptyCanvas._timingChart.destroy();
      emptyCanvas._timingChart = null;
    }
    return;
  }

  const finishers = journey?.samples ?? 0;
  if (finishEl) {
    finishEl.textContent = finishers ? formatDuration(journey.meanMs) : "–";
  }
  if (finishNote) {
    finishNote.textContent = finishers
      ? `${number.format(finishers)} finished · p90 ${formatDuration(journey.p90Ms)}`
      : "No finishers with timing yet";
  }

  summary.innerHTML = finishers
    ? `<strong>${number.format(finishers)}</strong> finished with timing ·
       median <strong>${formatDuration(journey.medianMs)}</strong> ·
       p90 <strong>${formatDuration(journey.p90Ms)}</strong> ·
       mean <strong>${formatDuration(journey.meanMs)}</strong>
       <span class="stage-detail">Active time only (pauses over 30 minutes omitted)</span>`
    : `Per-screen times below are from people who answered and moved on. No one has finished with countable timing yet.`;

  tbody.innerHTML = screens
    .map((s) => {
      const slow =
        s.id === screenTiming.slowestId && s.samples >= 3 ? "timing-slow" : "";
      return `<tr>
        <td>${escapeHtml(s.label)}<span class="stage-detail">${escapeHtml(s.detail)}</span></td>
        <td class="num">${number.format(s.samples)}</td>
        <td class="num"><span class="${slow}">${formatDuration(s.medianMs)}</span></td>
        <td class="num">${formatDuration(s.p90Ms)}</td>
        <td class="num">${formatDuration(s.meanMs)}</td>
      </tr>`;
    })
    .join("");

  if (screenTiming.slowestId && screenTiming.slowestMedianMs > 0) {
    const row = screens.find((s) => s.id === screenTiming.slowestId);
    callout.hidden = false;
    callout.textContent = `Slowest median: ${row?.label ?? screenTiming.slowestId} (${formatDuration(screenTiming.slowestMedianMs)}). Worth a copy / keyboard pass if that stays high.`;
  } else {
    callout.hidden = true;
  }

  const canvas = el("chart-screen-timing");
  if (!canvas || typeof Chart === "undefined") return;
  if (canvas._timingChart) canvas._timingChart.destroy();

  const toSec = (ms) => Math.round((ms / 1000) * 10) / 10;
  canvas._timingChart = new Chart(canvas, {
    type: "bar",
    data: {
      labels: screens.map((s) => s.label),
      datasets: [
        {
          label: "Median (sec)",
          data: screens.map((s) => toSec(s.medianMs)),
          backgroundColor: "rgba(13, 122, 95, 0.75)",
          borderRadius: 5,
          maxBarThickness: 28,
        },
        {
          label: "P90 (sec)",
          data: screens.map((s) => toSec(s.p90Ms)),
          backgroundColor: "rgba(180, 130, 20, 0.55)",
          borderRadius: 5,
          maxBarThickness: 28,
        },
      ],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      plugins: {
        legend: { position: "bottom", labels: { boxWidth: 12 } },
        tooltip: {
          callbacks: {
            afterLabel(ctx) {
              const s = screens[ctx.dataIndex];
              if (!s) return "";
              return [
                `Answers: ${s.samples}`,
                `Median: ${formatDuration(s.medianMs)}`,
                `P90: ${formatDuration(s.p90Ms)}`,
                `Mean: ${formatDuration(s.meanMs)}`,
              ];
            },
          },
        },
      },
      scales: {
        x: {
          beginAtZero: true,
          title: { display: true, text: "Seconds" },
          grid: { color: "rgba(16, 36, 31, 0.08)" },
        },
        y: { grid: { display: false } },
      },
    },
  });
}

function channelPct(part, whole) {
  if (!whole) return 0;
  return Math.round((part / whole) * 1000) / 10;
}

function formatChartLabel(dateStr) {
  if (!dateStr || dateStr === "–") return dateStr;
  const d = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function lineChart(canvasId, labels, values, label) {
  const canvas = el(canvasId);
  if (!canvas || typeof Chart === "undefined") return;
  if (canvas._lineChart) {
    canvas._lineChart.destroy();
  }
  const dense = labels.length > 40;
  canvas._lineChart = new Chart(canvas, {
    type: "line",
    data: {
      labels: labels.map(formatChartLabel),
      datasets: [
        {
          label,
          data: values,
          borderColor: "#0d7a5f",
          backgroundColor: "rgba(13, 122, 95, 0.12)",
          fill: true,
          tension: 0.3,
          pointRadius: dense ? 0 : 3,
          pointHoverRadius: 4,
          pointBackgroundColor: "#084d3d",
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            maxTicksLimit: dense ? 8 : 12,
            maxRotation: 0,
            autoSkip: true,
          },
        },
        y: {
          beginAtZero: true,
          ticks: { precision: 0 },
          grid: { color: "rgba(16, 36, 31, 0.08)" },
        },
      },
    },
  });
}

function renderUsageCharts(series) {
  const rows = Array.isArray(series) ? series : [];
  const labels = rows.map((d) => d.date);
  if (!labels.length) {
    lineChart("chart-daily", ["–"], [0], "Users / day");
    lineChart("chart-cumulative", ["–"], [0], "Cumulative");
    return;
  }
  lineChart(
    "chart-daily",
    labels,
    rows.map((d) => d.users),
    "Users / day",
  );
  lineChart(
    "chart-cumulative",
    labels,
    rows.map((d) => d.cumulative),
    "Cumulative",
  );
}

function renderProgramOpens(programs) {
  const tbody = el("program-open-rows");
  if (!tbody) return;
  const rows = Array.isArray(programs) ? programs : [];
  if (!rows.length) {
    tbody.innerHTML =
      "<tr><td colspan=\"5\">No program opens yet. Share a QR or open an apply link from CalClaim.</td></tr>";
    return;
  }
  tbody.innerHTML = rows
    .map(
      (p) => `<tr>
        <td>${escapeHtml(p.name)}</td>
        <td><span class="cat">${escapeHtml(p.category)}</span></td>
        <td class="num">${number.format(p.opens)}</td>
        <td class="num">${number.format(p.followThroughs)}</td>
        <td class="num">${money.format(p.estDollarsUnlocked)}</td>
      </tr>`,
    )
    .join("");
}

function renderSharing(stats) {
  const sharing = stats.sharing;
  if (!sharing) return;

  const org = sharing.organizations || {};
  const friends = sharing.friends || {};
  const website = sharing.website || {};
  const orgN = org.peopleReached || 0;
  const friendN = friends.peopleReached || 0;
  const webN = website.peopleReached || 0;
  const total = orgN + friendN + webN || stats.peopleReached || 0;

  el("m-org-reached").textContent = number.format(orgN);
  el("m-friend-reached").textContent = number.format(friendN);
  el("m-org-detail").textContent = `${number.format(org.botStarts || 0)} started · ${number.format(org.followThroughs || 0)} follow-throughs · ${channelPct(orgN, total)}%`;
  el("m-friend-detail").textContent = `${number.format(friends.botStarts || 0)} started · ${number.format(friends.followThroughs || 0)} follow-throughs · ${channelPct(friendN, total)}%`;

  const orgCard = el("spread-org");
  const friendCard = el("spread-friends");
  orgCard?.classList.toggle("is-ahead", orgN > friendN);
  friendCard?.classList.toggle("is-ahead", friendN > orgN);

  const verdict = el("spread-verdict");
  if (verdict) {
    if (!total) {
      verdict.hidden = true;
      verdict.textContent = "";
    } else {
      verdict.hidden = false;
      const orgPct = channelPct(orgN, total);
      const friendPct = channelPct(friendN, total);
      verdict.textContent =
        friendN > orgN
          ? `Friend-to-friend sharing is reaching more people than organization QR codes (${friendPct}% vs ${orgPct}%).`
          : `Organizations still account for most reach (${orgPct}%). Friend shares are ${friendPct}% – the signal for word-of-mouth growth.`;
    }
  }

  el("m-sharers").textContent = number.format(sharing.peopleWhoShared || 0);
  el("m-friend-clicks").textContent = number.format(sharing.friendClicks || 0);
  el("m-viral").textContent = number.format(sharing.clicksPerSharer || 0);

  const webNote = el("spread-website");
  if (webNote) {
    if (webN > 0) {
      webNote.hidden = false;
      webNote.textContent = `Also: ${number.format(webN)} people found CalClaim from the website.`;
    } else {
      webNote.hidden = true;
      webNote.textContent = "";
    }
  }
}

async function loadFunnel() {
  // Live analytics only – never the public-site demo funnel.
  const res = await api("/api/dev/stats");
  if (!res.ok) throw new Error("Failed to load funnel stats");
  const stats = await res.json();
  if (typeof Chart !== "undefined") {
    Chart.defaults.font.family = "Figtree, system-ui, sans-serif";
    Chart.defaults.color = "#3a5550";
  }
  const reportsEl = el("m-reports");
  const reportPeopleEl = el("m-report-people");
  if (reportsEl) reportsEl.textContent = number.format(stats.reportsCreated ?? 0);
  if (reportPeopleEl) {
    reportPeopleEl.textContent = number.format(stats.reportRecipients ?? 0);
  }
  renderSharing(stats);
  renderUsageCharts(stats.usersPerDay);
  renderProgramOpens(stats.programs);
  renderFunnel(stats.funnel);
  renderScreenDropout(stats.screenDropout);
  renderScreenTiming(stats.screenTiming);
}

/** @type {Array<{ id: string, slug: string, name: string, email: string, city: string, logo: string, statusUrl: string, bannerUrl: string }> | null} */
let devPartners = null;
/** @type {{ id: string, slug: string, name: string, email: string, city: string, logo: string } | null} */
let editingDevPartner = null;

function showDevPartnerStatus(message, isError, which = "edit") {
  const status = el(which === "create" ? "dev-create-status" : "dev-edit-status");
  if (!status) return;
  status.hidden = !message;
  status.textContent = message || "";
  status.classList.toggle("is-error", Boolean(isError));
}

function closeDevPartnerDialog() {
  const dialog = el("dev-partner-edit-dialog");
  if (!dialog) return;
  if (typeof dialog.close === "function") dialog.close();
  else dialog.removeAttribute("open");
  editingDevPartner = null;
}

function closeDevPartnerCreateDialog() {
  const dialog = el("dev-partner-create-dialog");
  if (!dialog) return;
  if (typeof dialog.close === "function") dialog.close();
  else dialog.removeAttribute("open");
}

function openDevPartnerCreateDialog() {
  const dialog = el("dev-partner-create-dialog");
  if (!dialog) return;
  const form = el("dev-partner-create-form");
  if (form) form.reset();
  const showBox = el("dev-create-show-leaderboard");
  if (showBox) showBox.checked = false;
  showDevPartnerStatus("", false, "create");
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
  el("dev-create-organization")?.focus();
}

function openDevPartnerDialog(partner) {
  editingDevPartner = partner;
  const dialog = el("dev-partner-edit-dialog");
  if (!dialog) return;
  el("dev-edit-partner-id").textContent = partner.id;
  el("dev-edit-slug").textContent = partner.slug;
  el("dev-edit-organization").value = partner.name || "";
  el("dev-edit-city").value = partner.city || "";
  el("dev-edit-email").value = partner.email || "";
  const domainInput = el("dev-edit-email-domain");
  const domainField = el("dev-edit-email-domain-field");
  const isOrg = (partner.accountType || "organization") === "organization";
  if (domainInput) {
    domainInput.value = partner.emailDomain || "";
    domainInput.required = isOrg;
  }
  if (domainField) domainField.hidden = !isOrg;
  const showBox = el("dev-edit-show-leaderboard");
  if (showBox) showBox.checked = partner.showOnLeaderboard !== false;
  const logoInput = el("dev-edit-logo");
  if (logoInput) logoInput.value = "";
  showDevPartnerStatus("", false);
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
  el("dev-edit-organization")?.focus();
}

function renderPartnerMetric(partners) {
  const countEl = el("m-partners");
  const noteEl = el("m-partners-note");
  if (countEl) countEl.textContent = number.format(partners.length);
  if (!noteEl) return;
  if (!partners.length) {
    noteEl.textContent = "None signed up yet";
    return;
  }
  const verified = partners.filter((p) => p.emailVerified && !p.canceledAt).length;
  const canceled = partners.filter((p) => p.canceledAt).length;
  const pending = partners.length - verified - canceled;
  const hidden = partners.filter(
    (p) => p.emailVerified && !p.canceledAt && p.showOnLeaderboard === false,
  ).length;
  const parts = [`${number.format(verified)} active`];
  if (pending) parts.push(`${number.format(pending)} pending`);
  if (hidden) parts.push(`${number.format(hidden)} off leaderboard`);
  if (canceled) parts.push(`${number.format(canceled)} canceled`);
  noteEl.textContent = parts.join(" · ");
}

function renderDevPartners(partners) {
  devPartners = partners;
  renderPartnerMetric(partners);
  const tbody = el("partner-rows");
  if (!tbody) return;
  if (!partners.length) {
    tbody.innerHTML = `<tr><td colspan="6">No community partners signed up yet.</td></tr>`;
    return;
  }
  tbody.innerHTML = partners
    .map((p) => {
      const board =
        p.canceledAt || !p.emailVerified
          ? null
          : p.showOnLeaderboard === false
            ? "Hidden from leaderboard"
            : "On leaderboard";
      const status = p.canceledAt
        ? "Canceled"
        : p.emailVerified
          ? p.accountType === "organization" && p.emailDomain
            ? `Verified · @${p.emailDomain}`
            : "Verified email"
          : "Pending verification";
      const statusBits = [status, board].filter(Boolean).join(" · ");
      const dates = [
        `Signed up ${formatWhen(p.createdAt)}`,
        p.canceledAt ? `Canceled ${formatWhen(p.canceledAt)}` : null,
      ]
        .filter(Boolean)
        .join("<br>");
      const actions = p.canceledAt
        ? `<span class="muted">Canceled</span>`
        : `<div class="partner-row-actions">
            <button type="button" data-edit-slug="${escapeHtml(p.slug)}">Edit</button>
            <a href="${escapeHtml(p.bannerUrl)}" download>Banner</a>
          </div>`;
      return `<tr data-slug="${escapeHtml(p.slug)}" class="${p.canceledAt ? "is-canceled" : ""}">
        <td>${escapeHtml(p.name)}<br><small>${escapeHtml(p.accountType || "organization")}</small></td>
        <td>${escapeHtml(p.city || "–")}</td>
        <td>${escapeHtml(p.email || "–")}<br><small>${escapeHtml(statusBits)}</small></td>
        <td><code>${escapeHtml(p.id)}</code><br><small><a href="${escapeHtml(p.statusUrl)}" target="_blank" rel="noopener">${escapeHtml(p.slug)}</a></small></td>
        <td><small>${dates}</small></td>
        <td>${actions}</td>
      </tr>`;
    })
    .join("");

  tbody.querySelectorAll("[data-edit-slug]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const slug = btn.getAttribute("data-edit-slug");
      const partner = (devPartners || []).find((p) => p.slug === slug);
      if (partner) openDevPartnerDialog(partner);
    });
  });
}

async function refreshDevPartners() {
  const status = el("partners-status");
  if (status) status.textContent = "Loading partners…";
  try {
    const res = await api("/api/dev/partners");
    if (!res.ok) throw new Error("Failed to load partners");
    const data = await res.json();
    renderDevPartners(data.partners || []);
    if (status) status.textContent = `${(data.partners || []).length} partner(s)`;
  } catch (err) {
    console.error(err);
    if (status) status.textContent = "Could not load partners.";
    const tbody = el("partner-rows");
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="6">Could not load partners.</td></tr>`;
    }
  }
}

function partnerFormErrorMessage(error) {
  switch (error) {
    case "name_required":
      return "Add the organization name.";
    case "email_required":
      return "Add a contact email.";
    case "email_invalid":
      return "Enter a valid email address.";
    case "email_domain_required":
      return "Add the organization email domain.";
    case "email_domain_invalid":
      return "Enter a valid email domain (for example example.org).";
    case "email_org_domain_required":
      return "Use a work email domain (not Gmail, Yahoo, or Outlook).";
    case "email_domain_mismatch":
      return "Contact email must use the organization domain.";
    case "website_invalid":
      return "Enter a valid website URL.";
    default:
      return "Could not save. Try again.";
  }
}

function bindDevPartnerEdit() {
  const form = el("dev-partner-edit-form");
  const createForm = el("dev-partner-create-form");

  el("dev-edit-dialog-close")?.addEventListener("click", closeDevPartnerDialog);
  el("dev-edit-cancel")?.addEventListener("click", closeDevPartnerDialog);
  el("dev-partner-edit-dialog")?.addEventListener("click", (event) => {
    if (event.target === el("dev-partner-edit-dialog")) closeDevPartnerDialog();
  });
  el("btn-partners-refresh")?.addEventListener("click", () => void refreshDevPartners());
  el("btn-partners-create")?.addEventListener("click", openDevPartnerCreateDialog);
  el("dev-create-dialog-close")?.addEventListener("click", closeDevPartnerCreateDialog);
  el("dev-create-cancel")?.addEventListener("click", closeDevPartnerCreateDialog);
  el("dev-partner-create-dialog")?.addEventListener("click", (event) => {
    if (event.target === el("dev-partner-create-dialog")) closeDevPartnerCreateDialog();
  });

  createForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = String(el("dev-create-organization")?.value || "").trim();
    const emailDomain = String(el("dev-create-email-domain")?.value || "").trim();
    const email = String(el("dev-create-email")?.value || "").trim();
    const city = String(el("dev-create-city")?.value || "").trim();
    const showOnLeaderboard = Boolean(el("dev-create-show-leaderboard")?.checked);
    const submit = el("dev-create-submit");

    if (!name) {
      showDevPartnerStatus("Add the organization name.", true, "create");
      return;
    }
    if (!emailDomain) {
      showDevPartnerStatus("Add the organization email domain.", true, "create");
      return;
    }

    if (submit) submit.disabled = true;
    showDevPartnerStatus("Creating partner…", false, "create");

    try {
      const res = await api("/api/dev/partners", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          emailDomain,
          email: email || undefined,
          city: city || undefined,
          showOnLeaderboard,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showDevPartnerStatus(partnerFormErrorMessage(data.error), true, "create");
        return;
      }
      closeDevPartnerCreateDialog();
      await refreshDevPartners();
    } catch (err) {
      console.error(err);
      showDevPartnerStatus("Could not create partner. Try again.", true, "create");
    } finally {
      if (submit) submit.disabled = false;
    }
  });

  if (!form) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!editingDevPartner) return;

    const name = String(el("dev-edit-organization")?.value || "").trim();
    const email = String(el("dev-edit-email")?.value || "").trim();
    const city = String(el("dev-edit-city")?.value || "").trim();
    const emailDomain = String(el("dev-edit-email-domain")?.value || "").trim();
    const showOnLeaderboard = Boolean(el("dev-edit-show-leaderboard")?.checked);
    const logoFile = el("dev-edit-logo")?.files?.[0] || null;
    const submit = el("dev-edit-submit");
    const isOrg = (editingDevPartner.accountType || "organization") === "organization";

    if (!name) {
      showDevPartnerStatus("Add the organization name.", true);
      return;
    }
    if (!email) {
      showDevPartnerStatus("Add the work email.", true);
      return;
    }
    if (isOrg && !emailDomain) {
      showDevPartnerStatus("Add the organization email domain.", true);
      return;
    }
    if (logoFile && logoFile.size > 2_000_000) {
      showDevPartnerStatus("Logo must be 2 MB or smaller.", true);
      return;
    }

    if (submit) submit.disabled = true;
    showDevPartnerStatus("Saving changes…", false);

    try {
      const body = new FormData();
      body.set("name", name);
      body.set("email", email);
      body.set("city", city);
      if (isOrg) body.set("emailDomain", emailDomain);
      body.set("showOnLeaderboard", showOnLeaderboard ? "1" : "0");
      if (logoFile) body.set("logo", logoFile);

      const res = await api(
        `/api/partners/${encodeURIComponent(editingDevPartner.slug)}/profile`,
        { method: "POST", body },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showDevPartnerStatus(partnerFormErrorMessage(data.error), true);
        return;
      }
      closeDevPartnerDialog();
      await refreshDevPartners();
    } catch (err) {
      console.error(err);
      showDevPartnerStatus("Could not save changes. Try again.", true);
    } finally {
      if (submit) submit.disabled = false;
    }
  });
}

function initSectionNav() {
  const chrome = document.querySelector(".dev-chrome");
  const nav = document.querySelector(".dev-section-nav");
  if (!nav) return;

  const links = [...nav.querySelectorAll("a[href^='#']")];
  const treeLink = links.find((link) => link.getAttribute("href") === "#tree");
  const sectionLinks = links.filter((link) => link !== treeLink);
  const sections = sectionLinks
    .map((link) => document.getElementById(link.hash.slice(1)))
    .filter(Boolean);
  if (!sections.length) return;

  function syncChromeHeight() {
    if (!chrome) return;
    document.documentElement.style.setProperty(
      "--dev-chrome-height",
      `${chrome.offsetHeight}px`,
    );
  }

  let activeId = "";
  const navInner = nav.querySelector(".dev-section-nav-inner") || nav;

  function setActive(id) {
    if (id === activeId) return;
    activeId = id;
    for (const link of links) {
      const on = link.hash.slice(1) === id;
      if (on) {
        link.setAttribute("aria-current", "true");
        const linkRect = link.getBoundingClientRect();
        const innerRect = navInner.getBoundingClientRect();
        const left =
          navInner.scrollLeft +
          (linkRect.left - innerRect.left) -
          innerRect.width / 2 +
          linkRect.width / 2;
        navInner.scrollTo({ left: Math.max(0, left), behavior: "smooth" });
      } else {
        link.removeAttribute("aria-current");
      }
    }
  }

  function update() {
    syncChromeHeight();
    if (isTreeHash() || document.documentElement.classList.contains("dev-on-tree")) {
      setActive("tree");
      return;
    }
    const offset = (chrome?.offsetHeight ?? 64) + 8;
    const probe = window.scrollY + offset;
    let current = sections[0].id;
    for (const section of sections) {
      const top = section.getBoundingClientRect().top + window.scrollY;
      if (probe >= top) current = section.id;
    }
    const atBottom =
      window.innerHeight + window.scrollY >=
      document.documentElement.scrollHeight - 4;
    if (atBottom) current = sections[sections.length - 1].id;
    setActive(current);
  }

  nav.addEventListener("click", (event) => {
    const link = event.target.closest("a[href^='#']");
    if (!link || !nav.contains(link)) return;
    const href = link.getAttribute("href") || "";
    event.preventDefault();
    syncChromeHeight();
    if (href === "#tree") {
      setTreeView(true);
      setActive("tree");
      return;
    }
    const target = document.getElementById(link.hash.slice(1));
    if (!target) return;
    setTreeView(false);
    revealSection(target);
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    history.replaceState(null, "", link.hash);
    setActive(target.id);
  });

  let ticking = false;
  window.addEventListener(
    "scroll",
    () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        update();
        ticking = false;
      });
    },
    { passive: true },
  );
  window.addEventListener("resize", update);
  window.addEventListener("hashchange", () => {
    if (isTreeHash()) {
      setTreeView(true);
      setActive("tree");
      return;
    }
    setTreeView(false);
    if (location.hash) revealSection(location.hash.slice(1));
    update();
  });
  if (typeof ResizeObserver !== "undefined" && chrome) {
    new ResizeObserver(syncChromeHeight).observe(chrome);
  }
  syncChromeHeight();
  if (isTreeHash()) {
    setTreeView(true);
    setActive("tree");
  } else {
    update();
  }
}

async function main() {
  initPanelFolds();
  initSectionNav();
  el("btn-scan").addEventListener("click", () => void startScan());
  el("finding-filter").addEventListener("change", () => void refreshFindings());
  el("feedback-filter")?.addEventListener("change", () => void refreshFeedbackTodos());
  el("org-ticket-filter")?.addEventListener("change", () => void refreshOrgTickets());
  el("disaster-filter")?.addEventListener("change", () => void refreshDisasterWindows());
  el("btn-logout")?.addEventListener("click", () => void logout());
  wireMatrix();
  bindDevPartnerEdit();
  await Promise.all([
    refreshStatus(true),
    loadFunnel(),
    loadMatrix(),
    refreshDevPartners(),
  ]);
}

main().catch((err) => {
  console.error(err);
  el("findings-list").innerHTML =
    `<p class="empty">Could not load developer status. Is the CalClaim server running?</p>`;
});
