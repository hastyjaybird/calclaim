/* global L, Chart */

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const number = new Intl.NumberFormat("en-US");

/** @type {{ slug: string, name: string, city: string, logo: string } | null} */
let currentPartner = null;
/** @type {string | null} */
let ownerToken = null;
/** @type {ReturnType<typeof lineChart>[]} */
let chartHandles = [];
/** @type {import("leaflet").Map | null} */
let mapHandle = null;

const OWNER_STORAGE_PREFIX = "calclaim-partner-owner:";
const EDIT_SESSION_KEY = "calclaim-signup-edit";

function el(id) {
  return document.getElementById(id);
}

function txt(key, fallback) {
  return window.CalClaimLang?.t?.(key) || fallback;
}

function fillName(template, name) {
  return String(template).replaceAll("{name}", name);
}

/** English possessives: Bank → Bank's, Boards → Boards' */
function englishPossessive(name) {
  return /s$/i.test(name) ? `${name}'` : `${name}'s`;
}

function qrHeadingFor(name) {
  const lang = window.CalClaimLang?.lang || "en";
  if (lang === "en") {
    return `${englishPossessive(name)} unique QR code`;
  }
  return fillName(txt("partners.qrHeading", "{name}'s unique QR code"), name);
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function partnerPathParts() {
  const path = location.pathname.replace(/^\/(es|zh)(?=\/|$)/, "") || "/";
  const m = path.match(
    /^\/partners\/([A-Za-z0-9_-]+)(?:\/events\/([A-Za-z0-9_-]+))?\/?$/,
  );
  if (!m) return { slug: null, eventSlug: null };
  return { slug: m[1], eventSlug: m[2] || null };
}

function partnerSlugFromPath() {
  return partnerPathParts().slug;
}

function eventSlugFromPath() {
  return partnerPathParts().eventSlug;
}

function withLang(path) {
  return window.CalClaimLang?.withLang?.(path) || path;
}

function ownerStorageKey(slug) {
  return `${OWNER_STORAGE_PREFIX}${slug}`;
}

function readStoredOwnerToken(slug) {
  try {
    return localStorage.getItem(ownerStorageKey(slug)) || "";
  } catch {
    return "";
  }
}

function storeOwnerToken(slug, token) {
  try {
    localStorage.setItem(ownerStorageKey(slug), token);
  } catch {
    // ignore
  }
}

function clearOwnerToken(slug) {
  try {
    localStorage.removeItem(ownerStorageKey(slug));
  } catch {
    // ignore
  }
}

function readSignupEditSession() {
  try {
    const raw = sessionStorage.getItem(EDIT_SESSION_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data?.partnerId || !data?.slug || !data?.editToken) return null;
    return data;
  } catch {
    return null;
  }
}

function ownerHeaders() {
  return ownerToken ? { "X-Partner-Owner": ownerToken } : {};
}

function chartDefaults() {
  Chart.defaults.font.family = "Figtree, system-ui, sans-serif";
  Chart.defaults.color = "#3a5550";
}

function formatChartLabel(dateStr) {
  if (!dateStr || dateStr === "–") return dateStr;
  const d = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function destroyCharts() {
  for (const chart of chartHandles) {
    try {
      chart.destroy();
    } catch {
      // ignore
    }
  }
  chartHandles = [];
}

function lineChart(canvasId, labels, values) {
  const ctx = el(canvasId);
  const existing = typeof Chart.getChart === "function" ? Chart.getChart(ctx) : null;
  if (existing) existing.destroy();
  const dense = labels.length > 40;
  const chart = new Chart(ctx, {
    type: "line",
    data: {
      labels: labels.map(formatChartLabel),
      datasets: [
        {
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
      plugins: { legend: { display: false } },
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
  chartHandles.push(chart);
  return chart;
}

// Statewide California view – keep as default for all map loads.
const CA_CENTER = [37.2, -119.5];
const CA_ZOOM = 5;
/** ~¼ mile in degrees of latitude (1° lat ≈ 69 miles). */
const QUARTER_MILE_LAT = 0.25 / 69;
/** Cap visual dots per area; weights keep cluster totals accurate. */
const MAX_VISUAL_DOTS = 48;

function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable ~¼-mile offset in a random direction (deterministic per seed). */
function jitterAround(lat, lng, seed) {
  const rnd = mulberry32(hashSeed(seed));
  const angle = rnd() * Math.PI * 2;
  const dist = QUARTER_MILE_LAT * (0.7 + rnd() * 0.6);
  const cosLat = Math.cos((lat * Math.PI) / 180);
  return [lat + dist * Math.cos(angle), lng + (dist * Math.sin(angle)) / Math.max(0.2, cosLat)];
}

function personDotIcon(ghost) {
  const ghostClass = ghost ? " map-dot--ghost" : "";
  return L.divIcon({
    className: "map-dot-wrap",
    html: `<span class="map-dot${ghostClass}"></span>`,
    iconSize: [10, 10],
    iconAnchor: [5, 5],
  });
}

function clusterDivIcon(count) {
  const size = count < 10 ? 34 : count < 50 ? 42 : count < 100 ? 50 : 58;
  return L.divIcon({
    className: "map-cluster-wrap",
    html: `<div class="map-cluster" style="--size:${size}px">${count}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function markerWeight(marker) {
  return marker.options.personWeight || 1;
}

function clusterPeopleCount(cluster) {
  return cluster.getAllChildMarkers().reduce((sum, m) => sum + markerWeight(m), 0);
}

/** Split `count` people into up to MAX_VISUAL_DOTS weighted slots. */
function weightSlots(count) {
  const n = Math.min(count, MAX_VISUAL_DOTS);
  const base = Math.floor(count / n);
  let rem = count % n;
  const slots = [];
  for (let i = 0; i < n; i++) {
    slots.push(base + (rem > 0 ? 1 : 0));
    if (rem > 0) rem -= 1;
  }
  return slots;
}

function renderMap(points) {
  if (mapHandle) {
    mapHandle.remove();
    mapHandle = null;
  }
  const mapNode = el("map");
  if (mapNode) mapNode.innerHTML = "";
  const map = L.map("map", { scrollWheelZoom: false }).setView(CA_CENTER, CA_ZOOM);
  mapHandle = map;
  L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
    maxZoom: 12,
  }).addTo(map);

  const clusters = L.markerClusterGroup({
    showCoverageOnHover: false,
    maxClusterRadius: 52,
    spiderfyOnMaxZoom: true,
    disableClusteringAtZoom: 12,
    chunkedLoading: true,
    iconCreateFunction(cluster) {
      return clusterDivIcon(clusterPeopleCount(cluster));
    },
  });

  const layers = [];
  for (const p of points) {
    const n = Math.max(0, Math.floor(p.count));
    if (n === 0) {
      const marker = L.marker([p.lat, p.lng], {
        icon: personDotIcon(true),
        personWeight: 0,
      });
      marker.bindPopup(`<strong>${escapeHtml(p.label)}</strong><br>0 awareness events`);
      layers.push(marker);
      continue;
    }
    const slots = weightSlots(n);
    for (let i = 0; i < slots.length; i++) {
      const weight = slots[i];
      const [lat, lng] = jitterAround(p.lat, p.lng, `${p.lat.toFixed(4)},${p.lng.toFixed(4)},${i}`);
      const marker = L.marker([lat, lng], {
        icon: personDotIcon(false),
        personWeight: weight,
      });
      const label =
        weight === 1
          ? "1 awareness event"
          : `${weight} awareness events`;
      marker.bindPopup(`<strong>${escapeHtml(p.label)}</strong><br>${label}`);
      layers.push(marker);
    }
  }

  clusters.addLayers(layers);
  map.addLayer(clusters);
}

function showError(message) {
  const banner = el("error-banner");
  const deck = el("deck");
  if (deck) deck.hidden = true;
  if (banner) {
    banner.hidden = false;
    banner.textContent = message;
  }
}

function applyPartnerHeader(p, eventInfo) {
  const logo = el("partner-logo");
  const logoName = el("partner-logo-name");
  if (p.logo) {
    logo.hidden = false;
    logo.src = p.logo;
    logo.alt = p.name;
    if (logoName) logoName.hidden = true;
  } else {
    logo.hidden = true;
    logo.removeAttribute("src");
    if (logoName) {
      logoName.hidden = false;
      logoName.textContent = p.name;
    }
  }

  const isEvent = Boolean(eventInfo);
  document.body.classList.toggle("is-event-view", isEvent);

  el("partner-name").textContent = isEvent ? eventInfo.name : p.name;
  el("partner-city").textContent = isEvent
    ? fillName(txt("partners.eventByline", "Event by {name}"), p.name)
    : p.city;
  el("partner-blurb").textContent = isEvent
    ? txt(
        "partners.eventBlurb",
        "Scans of this event QR still credit this partner on the public leaderboard.",
      )
    : p.blurb || txt("partners.blurbFallback", "Community outreach partner");

  const verifiedRow = el("partner-verified-row");
  const verifiedBadge = el("partner-verified-badge");
  if (verifiedRow && verifiedBadge) {
    if (p.emailVerified) {
      verifiedRow.hidden = false;
      verifiedBadge.textContent =
        p.accountType === "organization" && p.emailDomain
          ? txt("partners.verifiedOrg", "Verified · @{domain}").replace(
              "{domain}",
              p.emailDomain,
            )
          : txt("partners.verifiedIndividual", "Verified email");
    } else {
      verifiedRow.hidden = false;
      verifiedBadge.textContent = txt(
        "partners.pendingVerification",
        "Email verification pending",
      );
    }
  }

  const qrHeading = el("partner-qr-heading");
  if (qrHeading) {
    qrHeading.textContent = isEvent
      ? fillName(txt("partners.eventQrHeading", "{name} event QR code"), eventInfo.name)
      : qrHeadingFor(p.name);
  }

  const qr = el("partner-qr");
  qr.src = isEvent
    ? `/api/qr/partner/${encodeURIComponent(p.slug)}/event/${encodeURIComponent(eventInfo.slug)}`
    : `/api/qr/partner/${encodeURIComponent(p.slug)}`;
  qr.alt = isEvent
    ? fillName(txt("partners.eventQrAlt", "{name} event QR code for CalClaim"), eventInfo.name)
    : fillName(txt("partners.qrAlt", "{name} QR code for CalClaim"), p.name);

  const qrBody = el("partner-qr-body");
  if (qrBody) {
    qrBody.textContent = isEvent
      ? txt(
          "partners.eventQrBody",
          "Print or share this event code – every scan still credits this partner on the public leaderboard.",
        )
      : txt(
          "partners.qrBody",
          "Print or share this code – every scan credits this partner on the leaderboard.",
        );
  }

  const banner = el("download-banner");
  if (banner) {
    banner.href = isEvent
      ? `/api/partners/${encodeURIComponent(p.slug)}/events/${encodeURIComponent(eventInfo.slug)}/banner`
      : `/api/partners/${encodeURIComponent(p.slug)}/banner`;
    banner.textContent = isEvent
      ? txt("partners.downloadEventBanner", "Download event banner")
      : txt("partners.downloadBanner", "Download booth banner");
  }

  const back = document.querySelector(".back-link");
  if (back) {
    if (isEvent) {
      back.href = withLang(`/partners/${encodeURIComponent(p.slug)}`);
      back.textContent = fillName(
        txt("partners.backToPartner", "← Back to {name}"),
        p.name,
      );
    } else {
      back.href = withLang("/impact#partners");
      back.textContent = txt("partners.backLink", "← Back to partner leaderboard");
    }
  }

  document.title = isEvent
    ? `CalClaim × ${p.name} · ${eventInfo.name}`
    : `CalClaim × ${p.name}`;
}

function paintMetrics(stats) {
  el("m-reached").textContent = number.format(stats.peopleReached);
  el("m-starts").textContent = number.format(stats.botStarts);
  el("m-follow").textContent = number.format(stats.followThroughs);
  el("m-dollars").textContent = money.format(stats.estDollarsUnlocked);
  const msgEl = el("m-feedback-messages");
  const ticketEl = el("m-feedback-tickets");
  if (msgEl) msgEl.textContent = number.format(stats.feedbackMessages || 0);
  if (ticketEl) ticketEl.textContent = number.format(stats.feedbackTickets || 0);
  el("disclaimer").textContent = stats.disclaimer;

  destroyCharts();
  renderMap(stats.mapPoints || []);

  const series = stats.usersPerDay || [];
  const labels = series.length ? series.map((d) => d.date) : ["–"];
  const daily = series.length ? series.map((d) => d.users) : [0];
  const cum = series.length ? series.map((d) => d.cumulative) : [0];
  lineChart("chart-daily", labels, daily);
  lineChart("chart-cumulative", labels, cum);

  const dailyNote = document.querySelector('[data-i18n="partners.usersPerDayNote"]');
  const cumNote = document.querySelector('[data-i18n="partners.cumulativeNote"]');
  if (stats.event) {
    if (dailyNote) {
      dailyNote.textContent = txt(
        "partners.eventUsersPerDayNote",
        "Scans of this event QR by day",
      );
    }
    if (cumNote) {
      cumNote.textContent = txt(
        "partners.eventCumulativeNote",
        "Cumulative people reached via this event",
      );
    }
  } else {
    if (dailyNote) {
      dailyNote.textContent = txt(
        "partners.usersPerDayNote",
        "Scans of this partner’s QR by day",
      );
    }
    if (cumNote) {
      cumNote.textContent = txt(
        "partners.cumulativeNote",
        "Cumulative people reached via this partner",
      );
    }
  }
}

function renderPartner(stats) {
  const p = stats.partner;
  currentPartner = {
    slug: p.slug,
    name: p.name,
    city: p.city,
    logo: p.logo || "",
    blurb: p.blurb || "",
    accountType: p.accountType || "organization",
    emailDomain: p.emailDomain || "",
    emailVerified: Boolean(p.emailVerified),
    editable: Boolean(stats.editable),
  };

  applyPartnerHeader(currentPartner);
  paintMetrics(stats);
}

function setOwnerChrome(signedIn) {
  const loginOpen = el("partner-login-open");
  const signed = el("owner-signed-in");
  const loginPanel = el("owner-login-panel");
  const eventsPanel = el("owner-events-panel");
  const canOwn = Boolean(currentPartner?.editable);
  if (loginOpen) loginOpen.hidden = !canOwn || signedIn || eventSlugFromPath();
  if (signed) signed.hidden = !canOwn || !signedIn;
  if (loginPanel && (!canOwn || signedIn)) loginPanel.hidden = true;
  if (eventsPanel) eventsPanel.hidden = !canOwn || !signedIn || Boolean(eventSlugFromPath());
}

function setLoginStatus(message, isError) {
  const status = el("owner-login-status");
  if (!status) return;
  status.hidden = !message;
  status.textContent = message || "";
  status.classList.toggle("is-error", Boolean(isError));
}

function setEventCreateStatus(message, isError) {
  const status = el("event-create-status");
  if (!status) return;
  status.hidden = !message;
  status.textContent = message || "";
  status.classList.toggle("is-error", Boolean(isError));
}

function formatEventDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function renderEventBoard(rows) {
  const board = el("event-board");
  if (!board || !currentPartner) return;
  if (!rows?.length) {
    board.innerHTML = `<li class="event-board-empty">${escapeHtml(
      txt(
        "partners.eventsEmpty",
        "No events yet. Generate a QR for your next outreach day.",
      ),
    )}</li>`;
    return;
  }
  const slug = currentPartner.slug;
  board.innerHTML = rows
    .map((row) => {
      const href = withLang(
        `/partners/${encodeURIComponent(slug)}/events/${encodeURIComponent(row.slug)}`,
      );
      const secondary = `${number.format(row.botStarts)} ${txt(
        "impact.partnersBotStarts",
        "started",
      )} · ${number.format(row.followThroughs)} ${txt(
        "impact.partnersFollows",
        "follow-throughs",
      )}`;
      const when = formatEventDate(row.createdAt);
      return `<li>
        <a class="event-row" href="${escapeHtml(href)}" data-event-slug="${escapeHtml(row.slug)}">
          <span class="event-rank">${row.rank}</span>
          <div>
            <p class="event-name">${escapeHtml(row.name)}</p>
            <p class="event-meta">${escapeHtml(when ? `${when} · ${secondary}` : secondary)}</p>
          </div>
          <div class="event-stat">
            <p class="event-stat-value">${number.format(row.peopleReached)}</p>
            <p class="event-stat-label">${escapeHtml(
              txt("partners.peopleReached", "People reached"),
            )}</p>
          </div>
        </a>
      </li>`;
    })
    .join("");
}

async function fetchEventBoard() {
  if (!currentPartner || !ownerToken) return [];
  const res = await fetch(
    `/api/partners/${encodeURIComponent(currentPartner.slug)}/events`,
    { headers: ownerHeaders() },
  );
  if (res.status === 401) {
    ownerToken = null;
    clearOwnerToken(currentPartner.slug);
    setOwnerChrome(false);
    return [];
  }
  if (!res.ok) return [];
  const data = await res.json();
  const rows = data.events || [];
  renderEventBoard(rows);
  return rows;
}

async function loginAsOwner(payload, silent) {
  if (!currentPartner) return false;
  const res = await fetch(
    `/api/partners/${encodeURIComponent(currentPartner.slug)}/login`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ownerToken) {
    if (!silent) {
      if (data.error === "partner_id_mismatch") {
        setLoginStatus(
          txt("partners.errorPartnerIdMismatch", "That partner ID doesn’t match this page."),
          true,
        );
      } else if (data.error === "login_unavailable") {
        setLoginStatus(
          txt("partners.loginUnavailable", "This demo partner page can’t sign in."),
          true,
        );
      } else {
        setLoginStatus(
          txt(
            "partners.signInError",
            "Could not sign in. Check the partner ID from your email.",
          ),
          true,
        );
      }
    }
    return false;
  }
  ownerToken = data.ownerToken;
  storeOwnerToken(currentPartner.slug, ownerToken);
  setOwnerChrome(true);
  await fetchEventBoard();
  return true;
}

async function tryRestoreOwnerSession() {
  if (!currentPartner?.editable) {
    setOwnerChrome(false);
    return false;
  }
  const stored = readStoredOwnerToken(currentPartner.slug);
  if (stored) {
    const ok = await loginAsOwner({ ownerToken: stored }, true);
    if (ok) return true;
    clearOwnerToken(currentPartner.slug);
  }
  const edit = readSignupEditSession();
  if (edit && edit.slug === currentPartner.slug && edit.editToken) {
    return loginAsOwner(
      { editToken: edit.editToken, partnerId: edit.partnerId },
      true,
    );
  }
  setOwnerChrome(false);
  return false;
}

function eventPathFor(eventSlug) {
  if (!currentPartner) return "/partners";
  return withLang(
    `/partners/${encodeURIComponent(currentPartner.slug)}/events/${encodeURIComponent(eventSlug)}`,
  );
}

function partnerPathFor() {
  if (!currentPartner) return withLang("/impact#partners");
  return withLang(`/partners/${encodeURIComponent(currentPartner.slug)}`);
}

async function showEventView(eventSlug, push) {
  if (!currentPartner) return;
  if (!ownerToken) {
    setOwnerChrome(false);
    el("owner-login-panel").hidden = false;
    setLoginStatus(
      txt("partners.signInToViewEvent", "Sign in with your partner ID to see event stats."),
      false,
    );
    return;
  }
  const res = await fetch(
    `/api/partners/${encodeURIComponent(currentPartner.slug)}/events/${encodeURIComponent(eventSlug)}`,
    { headers: ownerHeaders() },
  );
  if (res.status === 401) {
    ownerToken = null;
    clearOwnerToken(currentPartner.slug);
    setOwnerChrome(false);
    return;
  }
  if (res.status === 404) {
    showError(txt("partners.eventNotFound", "Event not found."));
    return;
  }
  if (!res.ok) {
    showError(txt("partners.loadError", "Could not load partner stats."));
    return;
  }
  const stats = await res.json();
  const deck = el("deck");
  const banner = el("error-banner");
  if (deck) deck.hidden = false;
  if (banner) banner.hidden = true;
  applyPartnerHeader(currentPartner, stats.event);
  paintMetrics(stats);
  setOwnerChrome(true);
  if (push) {
    history.pushState({ eventSlug }, "", eventPathFor(eventSlug));
  }
}

async function showPartnerView(push) {
  if (!currentPartner) return;
  const res = await fetch(`/api/partners/${encodeURIComponent(currentPartner.slug)}`);
  if (!res.ok) {
    showError(txt("partners.loadError", "Could not load partner stats."));
    return;
  }
  const stats = await res.json();
  const deck = el("deck");
  const banner = el("error-banner");
  if (deck) deck.hidden = false;
  if (banner) banner.hidden = true;
  renderPartner(stats);
  setOwnerChrome(Boolean(ownerToken));
  if (ownerToken) await fetchEventBoard();
  if (push) history.pushState({}, "", partnerPathFor());
}

function wireOwnerUi(slug) {
  const loginOpen = el("partner-login-open");
  const loginPanel = el("owner-login-panel");
  const loginForm = el("owner-login-form");
  const loginCancel = el("owner-login-cancel");
  const signOut = el("partner-sign-out");
  const createForm = el("event-create-form");
  const board = el("event-board");

  if (loginOpen && !loginOpen.dataset.wired) {
    loginOpen.dataset.wired = "1";
    loginOpen.addEventListener("click", () => {
      if (loginPanel) loginPanel.hidden = false;
      el("owner-partner-id")?.focus();
    });
  }
  if (loginCancel && !loginCancel.dataset.wired) {
    loginCancel.dataset.wired = "1";
    loginCancel.addEventListener("click", () => {
      if (loginPanel) loginPanel.hidden = true;
      setLoginStatus("", false);
    });
  }
  if (loginForm && !loginForm.dataset.wired) {
    loginForm.dataset.wired = "1";
    loginForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const partnerId = el("owner-partner-id")?.value?.trim() ?? "";
      if (!partnerId) {
        setLoginStatus(
          txt("partners.errorPartnerId", "Enter your partner ID from the welcome email."),
          true,
        );
        return;
      }
      const submit = loginForm.querySelector('button[type="submit"]');
      if (submit) submit.disabled = true;
      setLoginStatus("", false);
      try {
        const ok = await loginAsOwner({ partnerId });
        if (ok) {
          loginForm.reset();
          if (loginPanel) loginPanel.hidden = true;
          const pendingEvent = eventSlugFromPath();
          if (pendingEvent) await showEventView(pendingEvent, false);
        }
      } finally {
        if (submit) submit.disabled = false;
      }
    });
  }
  if (signOut && !signOut.dataset.wired) {
    signOut.dataset.wired = "1";
    signOut.addEventListener("click", () => {
      ownerToken = null;
      clearOwnerToken(slug);
      setOwnerChrome(false);
      if (eventSlugFromPath()) {
        void showPartnerView(true);
      }
    });
  }
  if (createForm && !createForm.dataset.wired) {
    createForm.dataset.wired = "1";
    createForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const name = el("event-name")?.value?.trim() ?? "";
      if (!name) {
        setEventCreateStatus(
          txt("partners.eventNameRequired", "Add an event name."),
          true,
        );
        return;
      }
      const submit = createForm.querySelector('button[type="submit"]');
      if (submit) {
        submit.disabled = true;
        submit.textContent = txt("partners.eventCreating", "Generating…");
      }
      setEventCreateStatus("", false);
      try {
        const res = await fetch(`/api/partners/${encodeURIComponent(slug)}/events`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...ownerHeaders(),
          },
          body: JSON.stringify({ name, ownerToken }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (data.error === "unverified") {
            setEventCreateStatus(
              txt(
                "partners.eventUnverified",
                "Verify your email before creating event QR codes.",
              ),
              true,
            );
          } else if (data.error === "limit") {
            setEventCreateStatus(
              txt("partners.eventLimit", "You’ve reached the event limit."),
              true,
            );
          } else {
            setEventCreateStatus(
              txt("partners.eventCreateError", "Could not create this event. Try again."),
              true,
            );
          }
          return;
        }
        createForm.reset();
        renderEventBoard(data.events || []);
        if (data.event?.slug) await showEventView(data.event.slug, true);
      } catch {
        setEventCreateStatus(
          txt("partners.eventCreateError", "Could not create this event. Try again."),
          true,
        );
      } finally {
        if (submit) {
          submit.disabled = false;
          submit.textContent = txt("partners.eventCreate", "Generate event QR");
        }
      }
    });
  }
  if (board && !board.dataset.wired) {
    board.dataset.wired = "1";
    board.addEventListener("click", (event) => {
      const link = event.target.closest("a.event-row");
      if (!link) return;
      const eventSlug = link.getAttribute("data-event-slug");
      if (!eventSlug) return;
      event.preventDefault();
      void showEventView(eventSlug, true);
    });
  }

  const back = document.querySelector(".back-link");
  if (back && !back.dataset.eventWired) {
    back.dataset.eventWired = "1";
    back.addEventListener("click", (event) => {
      if (!eventSlugFromPath() || !currentPartner) return;
      event.preventDefault();
      void showPartnerView(true);
    });
  }

  window.addEventListener("popstate", () => {
    const eventSlug = eventSlugFromPath();
    if (eventSlug) void showEventView(eventSlug, false);
    else void showPartnerView(false);
  });
}

async function main() {
  chartDefaults();
  const slug = partnerSlugFromPath();
  if (!slug) {
    showError(txt("partners.notFound", "Partner not found."));
    return;
  }

  const res = await fetch(`/api/partners/${encodeURIComponent(slug)}`);
  if (res.status === 404) {
    showError(txt("partners.notFound", "Partner not found."));
    return;
  }
  if (!res.ok) {
    showError(txt("partners.loadError", "Could not load partner stats."));
    return;
  }
  const stats = await res.json();
  renderPartner(stats);
  wireFeedbackForm(slug);
  wireOwnerUi(slug);
  await tryRestoreOwnerSession();
  const eventSlug = eventSlugFromPath();
  if (eventSlug) await showEventView(eventSlug, false);
}

function setFeedbackStatus(message, isError) {
  const status = el("partner-feedback-status");
  if (!status) return;
  status.hidden = !message;
  status.textContent = message || "";
  status.classList.toggle("is-error", Boolean(isError));
}

function wireFeedbackForm(slug) {
  const form = el("partner-feedback-form");
  if (!form || form.dataset.wired) return;
  form.dataset.wired = "1";

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = el("partner-feedback-text")?.value?.trim() ?? "";
    if (!text) {
      setFeedbackStatus(
        txt("partners.feedbackEmpty", "Add a note before sending."),
        true,
      );
      return;
    }

    const submit = form.querySelector('button[type="submit"]');
    if (submit) {
      submit.disabled = true;
      submit.textContent = txt("partners.feedbackSending", "Sending…");
    }
    setFeedbackStatus("", false);

    try {
      const res = await fetch(`/api/partners/${encodeURIComponent(slug)}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.error === "empty") {
          setFeedbackStatus(
            txt("partners.feedbackEmpty", "Add a note before sending."),
            true,
          );
        } else if (data.error === "too_long") {
          setFeedbackStatus(
            txt("partners.feedbackTooLong", "Keep feedback under 4000 characters."),
            true,
          );
        } else {
          setFeedbackStatus(
            txt("partners.feedbackError", "Could not send. Try again."),
            true,
          );
        }
        return;
      }

      form.reset();
      const tickets = Number(data.ticketsCreated) || 0;
      const success =
        tickets <= 1
          ? txt(
              "partners.feedbackSuccessOne",
              "Thanks – we created a developer ticket and credited this organization.",
            )
          : txt(
              "partners.feedbackSuccessMany",
              "Thanks – we created {n} developer tickets and credited this organization.",
            ).replace("{n}", String(tickets));
      setFeedbackStatus(success, false);

      if (el("m-feedback-messages") && data.feedbackMessages != null) {
        el("m-feedback-messages").textContent = number.format(data.feedbackMessages);
      }
      if (el("m-feedback-tickets") && data.feedbackTickets != null) {
        el("m-feedback-tickets").textContent = number.format(data.feedbackTickets);
      }
    } catch {
      setFeedbackStatus(
        txt("partners.feedbackError", "Could not send. Try again."),
        true,
      );
    } finally {
      if (submit) {
        submit.disabled = false;
        submit.textContent = txt("partners.feedbackSubmit", "Send feedback");
      }
    }
  });
}

main().catch((err) => {
  console.error(err);
  showError(txt("partners.loadError", "Could not load partner stats."));
});
