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
        <div class="fields">${escapeHtml(item.corpusFields.join(" · "))}</div>
      </li>`,
    )
    .join("");

  renderScans(status.recentScans, status.latestScan);
  updateScanChrome(status.latestScan);
}

function renderScans(scans, latest) {
  const tbody = el("scan-rows");
  if (!scans.length) {
    tbody.innerHTML = `<tr><td colspan="6">No scans yet — run a corpus check.</td></tr>`;
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
    btn.textContent = "Run corpus check";
    return;
  }
  if (scan.status === "running" || scan.status === "queued") {
    btn.disabled = true;
    btn.textContent = "Scanning…";
    status.textContent = `Scan #${scan.id}: ${scan.programsDone}/${scan.programsTotal} programs · ${scan.findingsCount} findings so far`;
    return;
  }
  btn.disabled = false;
  btn.textContent = "Run corpus check";
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
    root.innerHTML = `<p class="empty">No findings in this filter. Run a corpus check to look for drift.</p>`;
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
        ${f.corpusField ? `<p><strong>Corpus field:</strong> ${escapeHtml(f.corpusField)}</p>` : ""}
        <div class="finding-meta">
          ${f.programId ? `<span class="cat">${escapeHtml(f.programId)}</span>` : `<span class="cat">corpus-wide</span>`}
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

function renderFeedbackTodos(todos) {
  const root = el("feedback-list");
  if (!root) return;
  if (!todos.length) {
    root.innerHTML = `<p class="empty">No alpha feedback in this filter yet. Testers can text or send a voice note anytime.</p>`;
    return;
  }
  root.innerHTML = todos
    .map((t) => {
      const actions =
        t.status === "open"
          ? `<button type="button" data-feedback-id="${t.id}" data-status="done">Mark done</button>`
          : `<button type="button" data-feedback-id="${t.id}" data-status="open">Reopen</button>`;
      const source =
        t.source === "voice"
          ? `voice${t.transcriptStatus ? ` · ${t.transcriptStatus}` : ""}`
          : "text";
      return `<article class="finding" data-feedback="${t.id}">
        <div class="finding-head">
          <span class="badge badge-cat">${escapeHtml(source)}</span>
          <span class="badge badge-source">${escapeHtml(t.step)}</span>
          <h3>User ${t.telegramUserId}</h3>
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

async function refreshStatus(alsoFindings = true) {
  const res = await api("/api/dev/status");
  if (!res.ok) throw new Error("Failed to load developer status");
  const status = await res.json();
  renderOverview(status);
  if (alsoFindings) {
    await refreshFindings();
    await refreshFeedbackTodos();
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
  el("scan-status").textContent = "Starting corpus check…";
  const res = await api("/api/dev/scan", { method: "POST" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    alert(data.error || "Could not start scan");
    btn.disabled = false;
    btn.textContent = "Run corpus check";
    return;
  }
  startPolling();
  await refreshStatus(true);
}

async function logout() {
  await fetch("/api/dev/logout", { method: "POST" }).catch(() => {});
  location.href = "/dev/login.html";
}

async function main() {
  el("btn-scan").addEventListener("click", () => void startScan());
  el("finding-filter").addEventListener("change", () => void refreshFindings());
  el("feedback-filter")?.addEventListener("change", () => void refreshFeedbackTodos());
  el("btn-logout")?.addEventListener("click", () => void logout());
  await refreshStatus(true);
}

main().catch((err) => {
  console.error(err);
  el("findings-list").innerHTML =
    `<p class="empty">Could not load developer status. Is the CalClaim server running?</p>`;
});
