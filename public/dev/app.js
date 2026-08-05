/* global Chart */

const number = new Intl.NumberFormat("en-US");

function el(id) {
  return document.getElementById(id);
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
  if (!iso) return "—";
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

let pollTimer = null;

function renderOverview(status) {
  const o = status.overview;
  el("m-version").textContent = o.version;
  const age =
    o.ageDays == null
      ? "Age unknown — use YYYY-MM-DD versions"
      : o.needsReview
        ? `${o.ageDays} days old — review due (>${o.agingRuleDays}d)`
        : `${o.ageDays} days old (within ${o.agingRuleDays}d rule)`;
  el("m-age").textContent = age;
  if (o.needsReview) el("m-age").style.color = "#8a4a10";
  else el("m-age").style.color = "";

  el("m-programs").textContent = String(o.programCount);
  el("m-bands").textContent = `Income bands: ${o.incomeBandsVersion}`;
  el("m-open").textContent = String(status.findingCounts.open);
  el("m-crit").textContent = String(status.findingCounts.critical);
  el("m-high").textContent = String(status.findingCounts.high);
  el("m-llm").textContent = status.llmEnabled ? "On" : "Off";

  const tbody = el("program-rows");
  tbody.innerHTML = o.programs
    .map(
      (p) => `<tr>
        <td>${escapeHtml(p.name)}</td>
        <td><span class="cat">${escapeHtml(p.category)}</span></td>
        <td class="num">${p.sourceCount}</td>
        <td class="num">${p.deadlineCount}${p.hasNullDeadline ? "*" : ""}</td>
        <td class="num">${p.openFindings}</td>
        <td class="url-cell"><a href="${escapeHtml(p.applyUrl)}" target="_blank" rel="noopener">${escapeHtml(p.applyUrl)}</a></td>
      </tr>`,
    )
    .join("");

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
    tbody.innerHTML = `<tr><td colspan="6">No scans yet — run a library check.</td></tr>`;
    return;
  }
  tbody.innerHTML = scans
    .map((s) => {
      const current = latest && s.id === latest.id ? " (latest)" : "";
      return `<tr>
        <td>#${s.id}${current}</td>
        <td>${escapeHtml(s.status)}</td>
        <td>${s.programsDone}/${s.programsTotal}</td>
        <td class="num">${s.findingsCount}</td>
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

function renderFindings(findings) {
  const root = el("findings-list");
  if (!findings.length) {
    root.innerHTML = `<p class="empty">No findings in this filter. Run a library check to look for drift.</p>`;
    return;
  }
  root.innerHTML = findings
    .map((f) => {
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
    })
    .join("");

  root.querySelectorAll("button[data-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      void patchFinding(Number(btn.getAttribute("data-id")), btn.getAttribute("data-status"));
    });
  });
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
  renderFindings(data.findings);
}

function feedbackSourceLabel(t) {
  if (t.source === "voice") {
    return `voice${t.transcriptStatus ? ` · ${t.transcriptStatus}` : ""}`;
  }
  if (t.source === "contact") return "contact form";
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
  return `User ${t.telegramUserId}`;
}

function renderFeedbackTodos(todos) {
  const root = el("feedback-list");
  if (!root) return;
  if (!todos.length) {
    root.innerHTML = `<p class="empty">No feedback in this filter yet. Testers can text, send a voice note, or use the contact form.</p>`;
    return;
  }
  root.innerHTML = todos
    .map((t) => {
      const actions =
        t.status === "open"
          ? `<button type="button" data-feedback-id="${t.id}" data-status="done">Mark done</button>`
          : `<button type="button" data-feedback-id="${t.id}" data-status="open">Reopen</button>`;
      return `<article class="finding" data-feedback="${t.id}">
        <div class="finding-head">
          <span class="badge badge-cat">${escapeHtml(feedbackSourceLabel(t))}</span>
          <span class="badge badge-source">${escapeHtml(t.step)}</span>
          <h3>${escapeHtml(feedbackWhoLabel(t))}</h3>
        </div>
        <p>${escapeHtml(t.text)}</p>
        <div class="finding-meta">
          <span class="cat">${escapeHtml(formatWhen(t.createdAt))}</span>
          <div class="finding-actions">${actions}</div>
        </div>
      </article>`;
    })
    .join("");

  root.querySelectorAll("button[data-feedback-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      void patchFeedbackTodo(
        Number(btn.getAttribute("data-feedback-id")),
        btn.getAttribute("data-status"),
      );
    });
  });
}

async function patchFeedbackTodo(id, status) {
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
}

async function refreshFeedbackTodos() {
  const filterEl = el("feedback-filter");
  if (!filterEl) return;
  const filter = filterEl.value;
  const res = await api(`/api/dev/feedback-todos?status=${encodeURIComponent(filter)}`);
  if (!res.ok) throw new Error("Failed to load feedback todos");
  const data = await res.json();
  renderFeedbackTodos(data.todos);
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
  status.textContent = `${parts.join(" · ")} — ${counts.join(", ")}`;
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
    root.innerHTML = `<p class="empty">No disaster windows in this filter. Disaster CalFresh is dormant most of the year — this staying empty is the expected state.</p>`;
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
}

function chipsHtml(field, ids) {
  const vocabKey = MULTI_FIELDS[field].vocab;
  if (!ids.length) {
    return `<span class="chip chip-empty">${escapeHtml(MULTI_FIELDS[field].empty)}</span>`;
  }

  // Documents: award letter and income proof are alternatives when both are listed.
  let displayIds = ids;
  let orPrefix = null;
  if (field === "documents" && ids.includes("categoricalProof") && ids.includes("incomeProof")) {
    orPrefix = {
      title:
        "Award letter (Medi-Cal / CalFresh / SSI / CalWORKs / WIC) OR pay stubs / benefit letter",
      short: "Award letter OR pay stubs",
    };
    displayIds = ids.filter((id) => id !== "categoricalProof" && id !== "incomeProof");
  }

  const shown = displayIds.slice(0, orPrefix ? 3 : 4);
  const rest = displayIds.length - shown.length;
  const chips = [];
  if (orPrefix) {
    chips.push(
      `<span class="chip chip-or" title="${escapeHtml(orPrefix.title)}">${escapeHtml(
        orPrefix.short,
      )}</span>`,
    );
  }
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

/** Flatten document labels for CSV/search — categorical + income become one OR line. */
function documentLabelsForExport(ids) {
  if (!ids.length) return [];
  const hasOr = ids.includes("categoricalProof") && ids.includes("incomeProof");
  const out = [];
  if (hasOr) {
    out.push(
      "Award letter (Medi-Cal / CalFresh / SSI / CalWORKs / WIC) OR pay stubs / benefit letter",
    );
  }
  for (const id of ids) {
    if (hasOr && (id === "categoricalProof" || id === "incomeProof")) continue;
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
      <textarea rows="3" placeholder="Why, and who said so — e.g. funds exhausted for FY26 per CSD 7/15"
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

function matrixRowHtml(row) {
  return `<tr data-matrix-row="${escapeHtml(row.id)}">
    <td class="num">${row.rank}</td>
    <td class="cell-program">
      <strong>${escapeHtml(row.name)}</strong>
      <span class="cat">${escapeHtml(row.category)}</span>
      <span class="cell-meta">${row.formFillMinutes} min form · ${row.timeToMoneyDays}d to money</span>
    </td>
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
    : `<tr><td colspan="12">No programs match this filter.</td></tr>`;
  matrix.rankStale = false;
  el("btn-matrix-resort").disabled = true;
  renderMatrixSummary();
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
    `matrix version ${matrix.data.version}`,
  ].join(" — ");
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

    const confidence = tr.querySelector('input[data-field="confidencePct"]');
    if (confidence && document.activeElement !== confidence) {
      confidence.value = row.confidencePct == null ? "" : String(row.confidencePct);
    }
  }
  renderMatrixSummary();
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
    setMatrixStatus("Clipboard blocked — the file on disk already has these edits.", true);
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
          : "—";
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

async function loadFunnel() {
  // Live analytics only — never the public-site demo funnel.
  const res = await api("/api/dev/stats");
  if (!res.ok) throw new Error("Failed to load funnel stats");
  const stats = await res.json();
  if (typeof Chart !== "undefined") {
    Chart.defaults.font.family = "Figtree, system-ui, sans-serif";
    Chart.defaults.color = "#3a5550";
  }
  renderFunnel(stats.funnel);
}

/** @type {Array<{ id: string, slug: string, name: string, email: string, city: string, logo: string, statusUrl: string, bannerUrl: string }> | null} */
let devPartners = null;
/** @type {{ id: string, slug: string, name: string, email: string, city: string, logo: string } | null} */
let editingDevPartner = null;

function showDevPartnerStatus(message, isError) {
  const status = el("dev-edit-status");
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

function openDevPartnerDialog(partner) {
  editingDevPartner = partner;
  const dialog = el("dev-partner-edit-dialog");
  if (!dialog) return;
  el("dev-edit-partner-id").textContent = partner.id;
  el("dev-edit-slug").textContent = partner.slug;
  el("dev-edit-organization").value = partner.name || "";
  el("dev-edit-city").value = partner.city || "";
  el("dev-edit-email").value = partner.email || "";
  const logoInput = el("dev-edit-logo");
  if (logoInput) logoInput.value = "";
  showDevPartnerStatus("", false);
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
  el("dev-edit-organization")?.focus();
}

function renderDevPartners(partners) {
  devPartners = partners;
  const tbody = el("partner-rows");
  if (!tbody) return;
  if (!partners.length) {
    tbody.innerHTML = `<tr><td colspan="6">No community partners signed up yet.</td></tr>`;
    return;
  }
  tbody.innerHTML = partners
    .map(
      (p) => `<tr data-slug="${escapeHtml(p.slug)}">
        <td>${escapeHtml(p.name)}</td>
        <td>${escapeHtml(p.city || "—")}</td>
        <td>${escapeHtml(p.email || "—")}</td>
        <td><code>${escapeHtml(p.id)}</code></td>
        <td><a href="${escapeHtml(p.statusUrl)}" target="_blank" rel="noopener">${escapeHtml(p.slug)}</a></td>
        <td>
          <div class="partner-row-actions">
            <button type="button" data-edit-slug="${escapeHtml(p.slug)}">Edit</button>
            <a href="${escapeHtml(p.bannerUrl)}" download>Banner</a>
          </div>
        </td>
      </tr>`,
    )
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

function bindDevPartnerEdit() {
  const form = el("dev-partner-edit-form");
  if (!form) return;

  el("dev-edit-dialog-close")?.addEventListener("click", closeDevPartnerDialog);
  el("dev-edit-cancel")?.addEventListener("click", closeDevPartnerDialog);
  el("dev-partner-edit-dialog")?.addEventListener("click", (event) => {
    if (event.target === el("dev-partner-edit-dialog")) closeDevPartnerDialog();
  });
  el("btn-partners-refresh")?.addEventListener("click", () => void refreshDevPartners());

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!editingDevPartner) return;

    const name = String(el("dev-edit-organization")?.value || "").trim();
    const email = String(el("dev-edit-email")?.value || "").trim();
    const city = String(el("dev-edit-city")?.value || "").trim();
    const logoFile = el("dev-edit-logo")?.files?.[0] || null;
    const submit = el("dev-edit-submit");

    if (!name) {
      showDevPartnerStatus("Add the organization name.", true);
      return;
    }
    if (!email) {
      showDevPartnerStatus("Add the work email.", true);
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
      if (logoFile) body.set("logo", logoFile);

      const res = await api(
        `/api/partners/${encodeURIComponent(editingDevPartner.slug)}/profile`,
        { method: "POST", body },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showDevPartnerStatus(
          data.error === "email_invalid"
            ? "Enter a valid email address."
            : "Could not save changes. Try again.",
          true,
        );
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

async function main() {
  el("btn-scan").addEventListener("click", () => void startScan());
  el("finding-filter").addEventListener("change", () => void refreshFindings());
  el("feedback-filter")?.addEventListener("change", () => void refreshFeedbackTodos());
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
