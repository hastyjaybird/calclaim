const STATUS_LABELS = {
  waiting_gate: "Waiting on gate",
  info_only: "Info only",
  not_in_branch: "Not in this arm",
  current_offer: "On screen now",
  in_queue: "In this wave",
  added_to_guide: "On Application Guide",
  already_enrolled: "Already enrolled",
  skipped: "Skipped",
  snoozed: "Snoozed",
  locked: "Locked",
  eliminated: "Eliminated",
};

const FILTERS = [
  { id: "all", label: "All" },
  { id: "current_offer", label: "On screen" },
  { id: "in_queue", label: "In wave" },
  { id: "locked", label: "Locked" },
  { id: "eliminated", label: "Eliminated" },
  { id: "resolved", label: "Resolved" },
];

const RESOLVED = new Set([
  "added_to_guide",
  "already_enrolled",
  "skipped",
  "snoozed",
]);

let actions = [];
let snapshot = null;
let filter = "all";

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

function readHash() {
  const raw = location.hash.replace(/^#/, "");
  const params = new URLSearchParams(raw);
  const encoded = params.get("a");
  if (!encoded) return [];
  return encoded
    .split(",")
    .map((a) => decodeURIComponent(a).trim())
    .filter(Boolean);
}

function writeHash() {
  const encoded = actions.map((a) => encodeURIComponent(a)).join(",");
  const next = encoded ? `#a=${encoded}` : "";
  if (location.hash !== next) history.replaceState(null, "", next || location.pathname);
}

async function api(path, options) {
  const res = await fetch(path, options);
  if (res.status === 401) {
    location.href = `/dev/login.html?next=${encodeURIComponent(location.pathname + location.hash)}`;
    throw new Error("Authentication required");
  }
  return res;
}

async function loadSnapshot() {
  el("status-line").textContent = "Loading…";
  const res = await api("/api/dev/tree", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ actions }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Could not simulate tree");
  snapshot = data;
  writeHash();
  render();
  el("status-line").textContent = snapshot.notice || "";
}

function tap(action) {
  if (!action) return;
  actions = [...actions, action];
  loadSnapshot().catch((err) => {
    actions = actions.slice(0, -1);
    el("status-line").textContent = err.message;
  });
}

function requestLocation(prefix) {
  if (!navigator.geolocation) {
    el("status-line").textContent =
      "Location isn't available here – type an address instead.";
    return;
  }
  el("status-line").textContent = "Getting location…";
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      tap(`${prefix}${pos.coords.latitude},${pos.coords.longitude}`);
    },
    () => {
      el("status-line").textContent =
        "Location denied or unavailable – type an address instead.";
    },
    { enableHighAccuracy: false, timeout: 12000, maximumAge: 60000 },
  );
}

function renderPresets() {
  const host = el("presets");
  const presets = snapshot?.presets ?? [];
  host.innerHTML = presets
    .map(
      (p) =>
        `<button type="button" class="cta${p.actions.length === actions.length && p.actions.every((a, i) => a === actions[i]) ? "" : " cta-ghost"}" data-preset="${escapeHtml(p.id)}">${escapeHtml(p.label)}</button>`,
    )
    .join("");
  host.querySelectorAll("[data-preset]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const preset = presets.find((p) => p.id === btn.dataset.preset);
      if (!preset) return;
      actions = [...preset.actions];
      loadSnapshot().catch((err) => {
        el("status-line").textContent = err.message;
      });
    });
  });
}

function renderFlow() {
  const nodes = snapshot?.tree ?? [];
  el("flow-list").innerHTML = nodes
    .map((n) => {
      const cls = [
        "flow-item",
        n.active ? "is-active" : "",
        n.answered ? "is-answered" : "",
      ]
        .filter(Boolean)
        .join(" ");
      return `<li class="${cls}">
        <span class="flow-kind">${escapeHtml(n.kind)}</span>
        <span class="flow-label">${escapeHtml(n.label)}</span>
        ${n.answered ? `<span class="flow-answer">${escapeHtml(n.answered)}</span>` : ""}
        ${n.note ? `<span class="flow-note">${escapeHtml(n.note)}</span>` : ""}
      </li>`;
    })
    .join("");
}

function renderPhone() {
  const screen = snapshot?.screen;
  if (!screen) return;
  el("why").textContent = snapshot.whyThisScreen || "";
  el("phone-step").textContent = screen.title;
  el("phone-text").innerHTML = escapeHtml(screen.text).replace(
    /\((\d+ programs? remaining)\)/g,
    "<i>($1)</i>",
  );
  const note = el("phone-note");
  if (screen.telegramNote) {
    note.hidden = false;
    note.textContent = screen.telegramNote;
  } else {
    note.hidden = true;
    note.textContent = "";
  }

  el("phone-buttons").innerHTML = (screen.buttons || [])
    .map((b) => {
      const disabled = !b.action || (b.kind !== "callback" && b.kind !== "geolocation");
      const kindClass = b.kind === "url" ? " is-url" : b.kind === "geolocation" ? " is-geo" : "";
      return `<button type="button" class="phone-btn${kindClass}" ${disabled ? "disabled" : ""} data-kind="${escapeHtml(b.kind || "")}" data-action="${escapeHtml(b.action || "")}">${escapeHtml(b.label)}</button>`;
    })
    .join("");
  el("phone-buttons").querySelectorAll("[data-action]").forEach((btn) => {
    if (btn.disabled) return;
    btn.addEventListener("click", () => {
      if (btn.dataset.kind === "geolocation") {
        requestLocation(btn.dataset.action || "shutoffloc:");
        return;
      }
      tap(btn.dataset.action);
    });
  });

  const zipForm = el("zip-form");
  const zipInput = el("zip-input");
  if (screen.input) {
    zipForm.hidden = false;
    zipInput.placeholder = screen.input.placeholder || "";
    const prefix = screen.input.actionPrefix || "zip:";
    zipForm.dataset.prefix = prefix;
    const isAddress = prefix.startsWith("shutoffaddr");
    zipInput.maxLength = screen.input.maxLength || (isAddress ? 200 : 10);
    zipInput.setAttribute(
      "inputmode",
      screen.input.inputMode || (isAddress ? "text" : "numeric"),
    );
    zipInput.autocomplete = isAddress ? "street-address" : "off";
    zipInput.name = isAddress ? "street-address" : "zip";
    const label = zipForm.querySelector("label");
    if (label) {
      label.textContent =
        screen.input.label ||
        (isAddress ? "Type street address and city" : "Type a 5-digit ZIP");
    }
    const submit = zipForm.querySelector('button[type="submit"]');
    if (submit) {
      submit.textContent =
        screen.input.submitLabel || (isAddress ? "Check address" : "Send ZIP");
    }
  } else {
    zipForm.hidden = true;
  }
}

function formatFact(value) {
  if (Array.isArray(value)) return value.join(", ");
  if (value === true) return "yes";
  if (value === false) return "no";
  return String(value);
}

function fact(label, value) {
  if (value == null || value === "" || (Array.isArray(value) && value.length === 0)) {
    return "";
  }
  return `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(formatFact(value))}</dd>`;
}

function renderFacts() {
  const f = snapshot?.facts;
  if (!f) return;
  const next = snapshot.nextGate
    ? snapshot.nextGate === "immigration"
      ? "immigration (last)"
      : snapshot.nextGate.replaceAll("_", " ")
    : "none – finish after this wave";
  el("facts").innerHTML = [
    fact("Step", f.step),
    fact("Arm", f.branch ? f.branch.toUpperCase() : "—"),
    fact("Household", f.householdSize),
    fact("Income", f.incomeBand),
    fact(
      "Bills in name",
      f.utilityBillsAsked
        ? f.billNotInMyName
          ? "none"
          : Array.isArray(f.billsInMyName) && f.billsInMyName.length
            ? f.billsInMyName.join(", ")
            : "none"
        : null,
    ),
    fact("Past due", f.pastDue),
    fact("CA home / work", f.residencyTie ?? f.isCaResident),
    fact("Buying EV this year", f.buyingEvThisYear),
    fact("First-time ZEV", f.firstTimeZev),
    fact("Child / pregnancy", f.hasChildInHousehold),
    fact("Foster youth", f.isFosterYouth),
    fact("Refugee / asylee", f.isRefugeeOrAsylee),
    fact("Medical energy need", f.hasMedicalDeviceOrCondition),
    fact("ABD", f.hasAgedBlindOrDisabled),
    fact("Work", f.workDisruption),
    fact("Disaster area", f.inDisasterArea),
    fact("ZIP / county", f.residenceZip ? `${f.residenceZip} · ${f.residenceCounty || "?"}` : f.residenceZip === "" ? "skipped" : null),
    fact("Immigration", f.immigrationStatus),
    fact("Docs in hand", f.docsInHand),
    fact("Already on", f.alreadyOn),
    fact("Next gate after wave", next),
    fact(
      "Queue",
      snapshot.queue.remaining.length
        ? snapshot.queue.remaining.join(" → ")
        : "(empty)",
    ),
  ].join("");
}

function renderFilters() {
  const counts = snapshot?.counts ?? {};
  el("filters").innerHTML = FILTERS.map((f) => {
    const n =
      f.id === "all"
        ? Object.values(counts).reduce((a, b) => a + b, 0)
        : f.id === "resolved"
          ? [...RESOLVED].reduce((a, id) => a + (counts[id] || 0), 0)
          : counts[f.id] || 0;
    return `<button type="button" class="filter-btn${filter === f.id ? " is-on" : ""}" data-filter="${f.id}">${escapeHtml(f.label)} (${n})</button>`;
  }).join("");
  el("filters").querySelectorAll("[data-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      filter = btn.dataset.filter;
      renderPrograms();
      renderFilters();
    });
  });
}

function chipClass(state) {
  if (state === "met") return "req-met";
  if (state === "unmet") return "req-unmet";
  if (state === "unknown") return "req-unknown";
  return "req-na";
}

function renderPrograms() {
  const rows = snapshot?.programs ?? [];
  const visible = rows.filter((p) => {
    if (filter === "all") return true;
    if (filter === "resolved") return RESOLVED.has(p.status);
    return p.status === filter;
  });
  const counts = snapshot?.counts ?? {};
  el("counts").textContent =
    `${counts.current_offer || 0} on screen · ${counts.in_queue || 0} in wave · ${counts.locked || 0} locked · ${counts.eliminated || 0} eliminated. Docs change rank, not eligibility.`;

  el("programs").innerHTML = visible
    .map((p) => {
      const reqs = p.requirements
        .filter((r) => r.needed || r.state !== "na")
        .map(
          (r) =>
            `<span class="req-chip ${chipClass(r.state)}" title="${escapeHtml(r.detail)}">${escapeHtml(r.label)}: ${escapeHtml(r.state)}${r.state === "na" ? "" : ""}</span>`,
        )
        .join("");
      const docs = (p.docs || [])
        .map(
          (d) =>
            `<span class="doc-chip ${d.inHand ? "is-have" : "is-need"}">${escapeHtml(d.label)}${d.inHand ? " · in hand" : " · still needed"}</span>`,
        )
        .join("");
      return `<article class="program-card${p.status === "current_offer" ? " is-current" : ""}">
        <div class="program-top">
          <div>
            <div class="program-name">${escapeHtml(p.name)}</div>
            <div class="program-meta">${escapeHtml(p.category)} · ${p.remainingQuestions} q left · ${p.newDocs} new docs · ${p.timeToMoneyDays}d to money</div>
          </div>
          <span class="status-pill status-${escapeHtml(p.status)}">${escapeHtml(STATUS_LABELS[p.status] || p.status)}</span>
        </div>
        <p class="program-reason">${escapeHtml(p.reason)}</p>
        <div class="req-chips">${reqs}</div>
        ${docs ? `<div class="doc-chips" style="margin-top:0.4rem">${docs}</div>` : ""}
      </article>`;
    })
    .join("");
}

function render() {
  renderPresets();
  renderFlow();
  renderPhone();
  renderFacts();
  renderFilters();
  renderPrograms();
  if (el("request-dialog")?.open) {
    updateRequestLocation();
  }
}

function treePathFor(actionList) {
  const encoded = actionList.map((a) => encodeURIComponent(a)).join(",");
  return encoded ? `/dev/tree#a=${encoded}` : "/dev/tree";
}

function currentTreeLocation() {
  const screen = snapshot?.screen;
  const step = screen?.step || snapshot?.facts?.step || "tree_review";
  const screenTitle = screen?.title || "Message tree";
  const path = treePathFor(actions);
  return {
    step,
    screenTitle,
    whyThisScreen: snapshot?.whyThisScreen || "",
    path,
    actions: [...actions],
  };
}

function updateRequestLocation() {
  const loc = currentTreeLocation();
  const host = el("request-location");
  if (!host) return;
  host.innerHTML = `<strong>${escapeHtml(loc.screenTitle)}</strong>
    Step <code>${escapeHtml(loc.step)}</code> ·
    <a href="${escapeHtml(loc.path)}">${escapeHtml(loc.path)}</a>`;
}

function parseTreeSnapshot(todo) {
  try {
    return JSON.parse(todo.sessionSnapshot || "{}");
  } catch {
    return {};
  }
}

function formatWhen(iso) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

async function refreshRequestList() {
  const list = el("request-list");
  if (!list) return;
  list.innerHTML = `<p class="tree-request-empty">Loading…</p>`;
  try {
    const res = await api("/api/dev/feedback-todos?status=open&source=tree");
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Could not load requests");
    const todos = data.todos || [];
    if (!todos.length) {
      list.innerHTML = `<p class="tree-request-empty">No open tree requests yet.</p>`;
      return;
    }
    list.innerHTML = todos
      .map((t) => {
        const snap = parseTreeSnapshot(t);
        const path = snap.treePath || treePathFor(snap.actions || []);
        const title = snap.screenTitle || t.step;
        return `<article class="tree-request-item">
          <div class="tree-request-item-meta">
            <span>${escapeHtml(formatWhen(t.createdAt))}</span>
            <span>${escapeHtml(title)}</span>
            <a href="${escapeHtml(path)}">Open location</a>
            <button type="button" class="cta cta-ghost" data-done-id="${t.id}">Mark done</button>
          </div>
          <p>${escapeHtml(t.text)}</p>
        </article>`;
      })
      .join("");
    list.querySelectorAll("[data-done-id]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = Number(btn.dataset.doneId);
        const res = await api(`/api/dev/feedback-todos/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "done" }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          el("request-status").textContent = err.error || "Could not update request";
          return;
        }
        await refreshRequestList();
      });
    });
  } catch (err) {
    list.innerHTML = `<p class="tree-request-empty">${escapeHtml(err.message || "Could not load requests")}</p>`;
  }
}

function openRequestDialog() {
  const dialog = el("request-dialog");
  if (!dialog) return;
  updateRequestLocation();
  el("request-text").value = "";
  el("request-status").textContent = "";
  void refreshRequestList();
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
  el("request-text").focus();
}

function closeRequestDialog() {
  const dialog = el("request-dialog");
  if (!dialog) return;
  if (typeof dialog.close === "function") dialog.close();
  else dialog.removeAttribute("open");
}

el("btn-undo").addEventListener("click", () => {
  if (!actions.length) return;
  actions = actions.slice(0, -1);
  loadSnapshot().catch((err) => {
    el("status-line").textContent = err.message;
  });
});

el("btn-skip-rest").addEventListener("click", () => tap("review:skip_rest"));
el("btn-add-rest").addEventListener("click", () => tap("review:add_rest"));

el("btn-copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(location.href);
    el("status-line").textContent = "Link copied.";
  } catch {
    el("status-line").textContent = location.href;
  }
});

el("btn-request").addEventListener("click", () => openRequestDialog());
el("request-dialog-close").addEventListener("click", () => closeRequestDialog());
el("request-cancel").addEventListener("click", () => closeRequestDialog());
el("request-dialog").addEventListener("click", (event) => {
  if (event.target === el("request-dialog")) closeRequestDialog();
});

el("request-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = el("request-text").value.trim();
  if (!text) return;
  const loc = currentTreeLocation();
  el("request-status").textContent = "Saving…";
  el("request-save").disabled = true;
  try {
    const res = await api("/api/dev/feedback-todos", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        source: "tree",
        text,
        actions: loc.actions,
        step: loc.step,
        screenTitle: loc.screenTitle,
        whyThisScreen: loc.whyThisScreen,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Could not save request");
    el("request-text").value = "";
    el("request-status").textContent = "Saved and pinned to this tree location.";
    el("status-line").textContent = "Developer request saved.";
    await refreshRequestList();
  } catch (err) {
    el("request-status").textContent = err.message;
  } finally {
    el("request-save").disabled = false;
  }
});

el("zip-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const prefix = el("zip-form").dataset.prefix || "zip:";
  const value = el("zip-input").value.trim();
  if (!value) return;
  tap(`${prefix}${value}`);
  el("zip-input").value = "";
});

el("btn-logout").addEventListener("click", async () => {
  await fetch("/api/dev/logout", { method: "POST" }).catch(() => {});
  location.href = "/dev/login.html";
});

window.addEventListener("hashchange", () => {
  actions = readHash();
  loadSnapshot().catch((err) => {
    el("status-line").textContent = err.message;
  });
});

actions = readHash();
loadSnapshot().catch((err) => {
  el("status-line").textContent = err.message;
});
