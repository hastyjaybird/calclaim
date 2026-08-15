/* global L, Chart */

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const number = new Intl.NumberFormat("en-US");

/** @type {{ slug: string, name: string, city: string, logo: string } | null} */
let currentPartner = null;
/** @type {{ name: string, email: string, city: string, logo: string, accountType: string } | null} */
let currentAccount = null;
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
  const path = location.pathname.replace(/^\/(es|zh|vi|tl)(?=\/|$)/, "") || "/";
  const orgEvent = path.match(
    /^\/partners\/([A-Za-z0-9_-]+)\/org\/events\/([A-Za-z0-9_-]+)\/?$/,
  );
  if (orgEvent) {
    return { slug: orgEvent[1], eventSlug: orgEvent[2], org: true };
  }
  const orgOnly = path.match(/^\/partners\/([A-Za-z0-9_-]+)\/org\/?$/);
  if (orgOnly) {
    return { slug: orgOnly[1], eventSlug: null, org: true };
  }
  const publicPartner = path.match(
    /^\/partners\/([A-Za-z0-9_-]+)(?:\/events\/([A-Za-z0-9_-]+))?\/?$/,
  );
  if (!publicPartner) return { slug: null, eventSlug: null, org: false };
  return {
    slug: publicPartner[1],
    eventSlug: publicPartner[2] || null,
    org: false,
  };
}

function partnerSlugFromPath() {
  return partnerPathParts().slug;
}

function eventSlugFromPath() {
  return partnerPathParts().eventSlug;
}

function isOrgPage() {
  return Boolean(partnerPathParts().org);
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
      back.href = withLang(`/partners/${encodeURIComponent(p.slug)}/org`);
      back.textContent = fillName(
        txt("partners.backToPartner", "← Back to {name}"),
        p.name,
      );
    } else if (isOrgPage()) {
      back.href = withLang(`/partners/${encodeURIComponent(p.slug)}`);
      back.textContent = fillName(
        txt("partners.backToPublic", "← Back to public page"),
        p.name,
      );
    } else {
      back.href = withLang("/impact#partners");
      back.textContent = txt("partners.backLink", "← Back to partner leaderboard");
    }
  }

  document.title = isEvent
    ? `${p.name} × CalClaim · ${eventInfo.name}`
    : isOrgPage()
      ? `${p.name} × CalClaim · Organization`
      : `${p.name} × CalClaim`;
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

function syncPageMode(signedIn) {
  const org = isOrgPage();
  document.body.classList.toggle("is-org-page", org);
  document.body.classList.toggle("is-org-signed-in", Boolean(org && signedIn));

  const signInLink = el("org-sign-in-link");
  const loginPanel = el("org-login-panel");
  const privateBlock = el("org-private");
  const signed = el("owner-signed-in");
  const eventsPanel = el("owner-events-panel");
  const accountPanel = el("owner-account-panel");
  const feedbackPanel = el("partner-feedback-panel");
  const feedbackMsg = el("metric-feedback-messages");
  const feedbackPts = el("metric-feedback-points");
  const publicMetrics = el("public-metrics");
  const charts = document.querySelector(".charts");
  const mapPanel = el("map")?.closest("section.panel");
  const disclaimer = el("disclaimer");
  const downloadBanner = el("download-banner");
  const canOwn = Boolean(currentPartner?.editable);
  const onEvent = Boolean(eventSlugFromPath());

  if (signInLink && currentPartner) {
    signInLink.href = withLang(
      `/partners/${encodeURIComponent(currentPartner.slug)}/org`,
    );
    signInLink.hidden = org;
  }

  if (loginPanel) loginPanel.hidden = !org || Boolean(signedIn);
  if (privateBlock) privateBlock.hidden = !org || !signedIn;
  if (signed) signed.hidden = !org || !signedIn;
  if (eventsPanel) eventsPanel.hidden = !org || !signedIn || !canOwn || onEvent;
  if (accountPanel) accountPanel.hidden = !org || !signedIn || !canOwn || onEvent;
  if (feedbackPanel) feedbackPanel.hidden = !org || !signedIn || onEvent;
  if (feedbackMsg) feedbackMsg.hidden = !org || !signedIn;
  if (feedbackPts) feedbackPts.hidden = !org || !signedIn;

  const showPublicBlocks = !org || Boolean(signedIn);
  if (publicMetrics) publicMetrics.hidden = !showPublicBlocks;
  if (charts) charts.hidden = !showPublicBlocks;
  if (mapPanel) mapPanel.hidden = !showPublicBlocks;
  if (disclaimer) disclaimer.hidden = !showPublicBlocks;
  if (downloadBanner) downloadBanner.hidden = org && !signedIn;

  if (org && currentPartner) {
    const loginBody = el("org-login-body");
    if (loginBody && !signedIn) {
      if (currentPartner.accountType === "organization" && currentPartner.emailDomain) {
        loginBody.textContent = txt(
          "partners.orgLoginBodyDomain",
          "Enter a @{domain} work email. We’ll send a one-time link – anyone at that company domain can sign in.",
        ).replace("{domain}", currentPartner.emailDomain);
      } else {
        loginBody.textContent = txt(
          "partners.orgLoginBodyIndividual",
          "Enter the email you used to sign up. We’ll send a one-time link.",
        );
      }
    }
  }
}

function setOwnerChrome(signedIn) {
  syncPageMode(signedIn);
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
        `/partners/${encodeURIComponent(slug)}/org/events/${encodeURIComponent(row.slug)}`,
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

function setAccountStatus(message, isError) {
  const status = el("owner-account-status");
  if (!status) return;
  status.hidden = !message;
  status.textContent = message || "";
  status.classList.toggle("is-error", Boolean(isError));
}

function setEditStatus(message, isError) {
  const status = el("partner-edit-status");
  if (!status) return;
  status.hidden = !message;
  status.textContent = message || "";
  status.classList.toggle("is-error", Boolean(isError));
}

function setDeleteStatus(message, isError) {
  const status = el("partner-delete-status");
  if (!status) return;
  status.hidden = !message;
  status.textContent = message || "";
  status.classList.toggle("is-error", Boolean(isError));
}

function applyEditFormLabels() {
  const isOrg = currentAccount?.accountType !== "individual";
  const nameLabel = el("edit-name-label");
  const emailLabel = el("edit-email-label");
  const emailHelp = el("edit-email-help");
  const logoLabel = el("edit-logo-label");
  if (nameLabel) {
    nameLabel.textContent = isOrg
      ? txt("signup.nameLabel", "Organization name")
      : txt("signup.nameLabelIndividual", "Your name");
  }
  if (emailLabel) {
    emailLabel.textContent = isOrg
      ? txt("signup.emailLabel", "Work email")
      : txt("signup.emailLabelIndividual", "Email");
  }
  if (emailHelp) {
    emailHelp.textContent = isOrg
      ? txt("signup.emailHelpOrg", "Use your company email, not Gmail or Yahoo.")
      : txt("signup.emailHelpIndividual", "We’ll email you a link.");
  }
  if (logoLabel) {
    logoLabel.textContent = isOrg
      ? txt("signup.logoLabel", "Organization logo (optional)")
      : txt("signup.logoLabelIndividual", "Logo (optional)");
  }
}

function fillEditForm() {
  applyEditFormLabels();
  if (el("edit-name")) el("edit-name").value = currentAccount?.name || currentPartner?.name || "";
  if (el("edit-email")) el("edit-email").value = currentAccount?.email || "";
  if (el("edit-city")) el("edit-city").value = currentAccount?.city || currentPartner?.city || "";
  if (el("edit-logo")) el("edit-logo").value = "";
}

function closeDialog(id) {
  const dialog = el(id);
  if (dialog && typeof dialog.close === "function") dialog.close();
}

function openDialog(id) {
  const dialog = el(id);
  if (dialog && typeof dialog.showModal === "function") dialog.showModal();
}

async function fetchAccount() {
  if (!currentPartner || !ownerToken) {
    currentAccount = null;
    return null;
  }
  const res = await fetch(
    `/api/partners/${encodeURIComponent(currentPartner.slug)}/account`,
    { headers: ownerHeaders() },
  );
  if (res.status === 401) {
    ownerToken = null;
    currentAccount = null;
    clearOwnerToken(currentPartner.slug);
    setOwnerChrome(false);
    return null;
  }
  if (!res.ok) return null;
  const data = await res.json();
  currentAccount = {
    name: data.name || "",
    email: data.email || "",
    city: data.city || "",
    logo: data.logo || "",
    accountType: data.accountType || "organization",
  };
  return currentAccount;
}

async function downloadPartnerData() {
  if (!currentPartner || !ownerToken) return;
  setAccountStatus(txt("partners.downloadingData", "Preparing download…"), false);
  try {
    const res = await fetch(
      `/api/partners/${encodeURIComponent(currentPartner.slug)}/export`,
      { headers: ownerHeaders() },
    );
    if (res.status === 401) {
      ownerToken = null;
      currentAccount = null;
      clearOwnerToken(currentPartner.slug);
      setOwnerChrome(false);
      setAccountStatus(
        txt("partners.signInError", "Could not sign in. Check the partner ID from your email."),
        true,
      );
      return;
    }
    if (!res.ok) {
      setAccountStatus(
        txt("partners.downloadDataError", "Could not download your data. Try again."),
        true,
      );
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `calclaim-${currentPartner.slug}-website-data.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setAccountStatus("", false);
  } catch {
    setAccountStatus(
      txt("partners.downloadDataError", "Could not download your data. Try again."),
      true,
    );
  }
}

async function submitPartnerEdit(event) {
  event.preventDefault();
  if (!currentPartner || !ownerToken) return;
  const name = el("edit-name")?.value?.trim() ?? "";
  const email = el("edit-email")?.value?.trim() ?? "";
  const city = el("edit-city")?.value?.trim() ?? "";
  const logoFile = el("edit-logo")?.files?.[0] || null;
  const isOrg = currentAccount?.accountType !== "individual";
  if (!name) {
    setEditStatus(
      isOrg
        ? txt("signup.errorName", "Add your organization name.")
        : txt("signup.errorNameIndividual", "Add your name."),
      true,
    );
    return;
  }
  if (!email) {
    setEditStatus(txt("signup.errorEmail", "Add your email."), true);
    return;
  }
  if (logoFile && logoFile.size > 2_000_000) {
    setEditStatus(txt("signup.errorLogoSize", "Logo must be 2 MB or smaller."), true);
    return;
  }

  const form = el("partner-edit-form");
  const submit = form?.querySelector('button[type="submit"]');
  if (submit) {
    submit.disabled = true;
    submit.textContent = txt("partners.editSaving", "Saving changes…");
  }
  setEditStatus("", false);

  try {
    const body = new FormData();
    body.set("name", name);
    body.set("email", email);
    body.set("city", city);
    body.set("ownerToken", ownerToken);
    if (logoFile) body.set("logo", logoFile);
    const res = await fetch(
      `/api/partners/${encodeURIComponent(currentPartner.slug)}/profile`,
      {
        method: "POST",
        headers: ownerHeaders(),
        body,
      },
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (data.error === "email_org_domain_required") {
        setEditStatus(
          txt(
            "signup.errorOrgDomain",
            "Organizations must use a work email domain (not Gmail, Yahoo, or Outlook).",
          ),
          true,
        );
      } else if (data.error === "email_invalid") {
        setEditStatus(txt("signup.errorEmailInvalid", "Enter a valid email address."), true);
      } else {
        setEditStatus(txt("partners.editError", "Could not save changes. Try again."), true);
      }
      return;
    }
    closeDialog("partner-edit-dialog");
    if (data.pendingVerification) {
      setAccountStatus(
        txt(
          "partners.editPendingVerification",
          "Saved. Check your email to verify the new address.",
        ),
        false,
      );
    }
    await showPartnerView(false);
    await fetchAccount();
  } catch {
    setEditStatus(txt("partners.editError", "Could not save changes. Try again."), true);
  } finally {
    if (submit) {
      submit.disabled = false;
      submit.textContent = txt("partners.editSave", "Save changes");
    }
  }
}

async function submitPartnerDelete(event) {
  event.preventDefault();
  if (!currentPartner || !ownerToken) return;
  const form = el("partner-delete-form");
  const submit = form?.querySelector('button[type="submit"]');
  if (submit) submit.disabled = true;
  setDeleteStatus("", false);
  try {
    const res = await fetch(
      `/api/partners/${encodeURIComponent(currentPartner.slug)}`,
      {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          ...ownerHeaders(),
        },
        body: JSON.stringify({ ownerToken, confirm: "delete" }),
      },
    );
    if (!res.ok) {
      setDeleteStatus(
        txt("partners.deleteError", "Could not delete the account. Try again."),
        true,
      );
      return;
    }
    clearOwnerToken(currentPartner.slug);
    ownerToken = null;
    currentAccount = null;
    currentPartner = null;
    closeDialog("partner-delete-dialog");
    location.href = withLang("/impact#partners");
  } catch {
    setDeleteStatus(
      txt("partners.deleteError", "Could not delete the account. Try again."),
      true,
    );
  } finally {
    if (submit) submit.disabled = false;
  }
}

async function fetchEventBoard() {
  if (!currentPartner || !ownerToken) return [];
  const res = await fetch(
    `/api/partners/${encodeURIComponent(currentPartner.slug)}/events`,
    { headers: ownerHeaders() },
  );
  if (res.status === 401) {
    ownerToken = null;
    currentAccount = null;
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

async function loginAsOwner(payload) {
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
  if (!res.ok || !data.ownerToken) return false;
  ownerToken = data.ownerToken;
  storeOwnerToken(currentPartner.slug, ownerToken);
  if (typeof data.editable === "boolean") {
    currentPartner.editable = data.editable;
  }
  setOwnerChrome(true);
  await Promise.all([
    currentPartner.editable ? fetchEventBoard() : Promise.resolve([]),
    currentPartner.editable ? fetchAccount() : Promise.resolve(null),
  ]);
  return true;
}

async function tryRestoreOwnerSession() {
  if (!isOrgPage()) {
    setOwnerChrome(false);
    return false;
  }
  const stored = readStoredOwnerToken(currentPartner.slug);
  if (stored) {
    ownerToken = stored;
    setOwnerChrome(true);
    const ok = await loginAsOwner({ ownerToken: stored });
    if (ok) return true;
    ownerToken = null;
    clearOwnerToken(currentPartner.slug);
  }
  const edit = readSignupEditSession();
  if (edit && edit.slug === currentPartner.slug && edit.editToken) {
    return loginAsOwner({ editToken: edit.editToken, partnerId: edit.partnerId });
  }
  setOwnerChrome(false);
  return false;
}

async function confirmMagicLogin(token) {
  if (!currentPartner || !token) return false;
  const res = await fetch(
    `/api/partners/${encodeURIComponent(currentPartner.slug)}/confirm-login`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ownerToken) return false;
  ownerToken = data.ownerToken;
  storeOwnerToken(currentPartner.slug, ownerToken);
  if (typeof data.editable === "boolean") {
    currentPartner.editable = data.editable;
  }
  setOwnerChrome(true);
  await Promise.all([
    currentPartner.editable ? fetchEventBoard() : Promise.resolve([]),
    currentPartner.editable ? fetchAccount() : Promise.resolve(null),
  ]);
  // Drop the token from the URL so refresh doesn't re-consume it.
  const clean = orgPathFor();
  history.replaceState({}, "", clean);
  return true;
}

function setOrgLoginStatus(message, isError) {
  const status = el("org-login-status");
  if (!status) return;
  status.hidden = !message;
  status.textContent = message || "";
  status.classList.toggle("is-error", Boolean(isError));
}

function wireOrgLogin(slug) {
  const form = el("org-login-form");
  if (!form || form.dataset.wired) return;
  form.dataset.wired = "1";
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = el("org-login-email")?.value?.trim() ?? "";
    if (!email) {
      setOrgLoginStatus(txt("signup.errorEmail", "Add your email."), true);
      return;
    }
    const submit = form.querySelector('button[type="submit"]');
    if (submit) {
      submit.disabled = true;
      submit.textContent = txt("partners.orgLoginSending", "Sending link…");
    }
    setOrgLoginStatus("", false);
    const demo = el("org-login-demo");
    if (demo) {
      demo.hidden = true;
      demo.innerHTML = "";
    }
    try {
      const res = await fetch(
        `/api/partners/${encodeURIComponent(slug)}/request-login`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.error === "email_domain_mismatch") {
          setOrgLoginStatus(
            txt(
              "partners.orgLoginDomainError",
              "Use a work email on this organization’s domain.",
            ),
            true,
          );
        } else if (data.error === "email_mismatch") {
          setOrgLoginStatus(
            txt(
              "partners.orgLoginMismatch",
              "Use the email address from your partner signup.",
            ),
            true,
          );
        } else if (data.error === "rate_limited") {
          setOrgLoginStatus(
            txt(
              "partners.orgLoginRateLimited",
              "Please wait a moment before requesting another link.",
            ),
            true,
          );
        } else if (data.error === "unverified") {
          setOrgLoginStatus(
            txt(
              "partners.orgLoginUnverified",
              "Verify your partner email before signing in.",
            ),
            true,
          );
        } else {
          setOrgLoginStatus(
            txt("partners.orgLoginError", "Could not send a sign-in link. Try again."),
            true,
          );
        }
        return;
      }
      setOrgLoginStatus(
        txt(
          "partners.orgLoginSent",
          "Check your email for a sign-in link. It expires in one hour.",
        ),
        false,
      );
      if (data.loginUrl && demo) {
        demo.hidden = false;
        demo.innerHTML = `${escapeHtml(
          txt("partners.orgLoginDemoLink", "Local demo link:"),
        )} <a href="${escapeHtml(data.loginUrl)}">${escapeHtml(data.loginUrl)}</a>`;
      }
    } catch {
      setOrgLoginStatus(
        txt("partners.orgLoginError", "Could not send a sign-in link. Try again."),
        true,
      );
    } finally {
      if (submit) {
        submit.disabled = false;
        submit.textContent = txt(
          "partners.orgLoginSubmit",
          "Email me a sign-in link",
        );
      }
    }
  });
}

function eventPathFor(eventSlug) {
  if (!currentPartner) return withLang("/impact#partners");
  return withLang(
    `/partners/${encodeURIComponent(currentPartner.slug)}/org/events/${encodeURIComponent(eventSlug)}`,
  );
}

function partnerPathFor() {
  if (!currentPartner) return withLang("/impact#partners");
  if (isOrgPage()) {
    return withLang(`/partners/${encodeURIComponent(currentPartner.slug)}/org`);
  }
  return withLang(`/partners/${encodeURIComponent(currentPartner.slug)}`);
}

function orgPathFor() {
  if (!currentPartner) return withLang("/impact#partners");
  return withLang(`/partners/${encodeURIComponent(currentPartner.slug)}/org`);
}

async function showEventView(eventSlug, push) {
  if (!currentPartner) return;
  if (!ownerToken) {
    setOwnerChrome(false);
    if (eventSlugFromPath()) history.replaceState({}, "", orgPathFor());
    return;
  }
  const res = await fetch(
    `/api/partners/${encodeURIComponent(currentPartner.slug)}/events/${encodeURIComponent(eventSlug)}`,
    { headers: ownerHeaders() },
  );
  if (res.status === 401) {
    ownerToken = null;
    currentAccount = null;
    clearOwnerToken(currentPartner.slug);
    setOwnerChrome(false);
    await showPartnerView(false);
    history.replaceState({}, "", orgPathFor());
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
  // URL must match the view before syncPageMode reads eventSlugFromPath().
  if (push) {
    history.pushState({ eventSlug }, "", eventPathFor(eventSlug));
  }
  setOwnerChrome(true);
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
  // URL must match the view before syncPageMode reads eventSlugFromPath().
  // Otherwise the events panel stays hidden after leaving an event detail.
  if (push) history.pushState({}, "", partnerPathFor());
  setOwnerChrome(Boolean(ownerToken));
  if (ownerToken) await fetchEventBoard();
}

function wireOwnerUi(slug) {
  const signOut = el("partner-sign-out");
  const createForm = el("event-create-form");
  const board = el("event-board");
  const editOpen = el("partner-edit-open");
  const editDialog = el("partner-edit-dialog");
  const editForm = el("partner-edit-form");
  const editClose = el("partner-edit-close");
  const editCancel = el("partner-edit-cancel");
  const downloadBtn = el("partner-download-data");
  const deleteOpen = el("partner-delete-open");
  const deleteDialog = el("partner-delete-dialog");
  const deleteForm = el("partner-delete-form");
  const deleteClose = el("partner-delete-close");
  const deleteCancel = el("partner-delete-cancel");

  if (signOut && !signOut.dataset.wired) {
    signOut.dataset.wired = "1";
    signOut.addEventListener("click", () => {
      ownerToken = null;
      currentAccount = null;
      clearOwnerToken(slug);
      setOwnerChrome(false);
      closeDialog("partner-edit-dialog");
      closeDialog("partner-delete-dialog");
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
  if (editOpen && !editOpen.dataset.wired) {
    editOpen.dataset.wired = "1";
    editOpen.addEventListener("click", async () => {
      if (!currentAccount) await fetchAccount();
      fillEditForm();
      setEditStatus("", false);
      openDialog("partner-edit-dialog");
      el("edit-name")?.focus();
    });
  }
  if (editClose && !editClose.dataset.wired) {
    editClose.dataset.wired = "1";
    editClose.addEventListener("click", () => closeDialog("partner-edit-dialog"));
  }
  if (editCancel && !editCancel.dataset.wired) {
    editCancel.dataset.wired = "1";
    editCancel.addEventListener("click", () => closeDialog("partner-edit-dialog"));
  }
  if (editDialog && !editDialog.dataset.wired) {
    editDialog.dataset.wired = "1";
    editDialog.addEventListener("click", (event) => {
      if (event.target === editDialog) closeDialog("partner-edit-dialog");
    });
  }
  if (editForm && !editForm.dataset.wired) {
    editForm.dataset.wired = "1";
    editForm.addEventListener("submit", (event) => void submitPartnerEdit(event));
  }
  if (downloadBtn && !downloadBtn.dataset.wired) {
    downloadBtn.dataset.wired = "1";
    downloadBtn.addEventListener("click", () => void downloadPartnerData());
  }
  if (deleteOpen && !deleteOpen.dataset.wired) {
    deleteOpen.dataset.wired = "1";
    deleteOpen.addEventListener("click", () => {
      setDeleteStatus("", false);
      openDialog("partner-delete-dialog");
    });
  }
  if (deleteClose && !deleteClose.dataset.wired) {
    deleteClose.dataset.wired = "1";
    deleteClose.addEventListener("click", () => closeDialog("partner-delete-dialog"));
  }
  if (deleteCancel && !deleteCancel.dataset.wired) {
    deleteCancel.dataset.wired = "1";
    deleteCancel.addEventListener("click", () => closeDialog("partner-delete-dialog"));
  }
  if (deleteDialog && !deleteDialog.dataset.wired) {
    deleteDialog.dataset.wired = "1";
    deleteDialog.addEventListener("click", (event) => {
      if (event.target === deleteDialog) closeDialog("partner-delete-dialog");
    });
  }
  if (deleteForm && !deleteForm.dataset.wired) {
    deleteForm.dataset.wired = "1";
    deleteForm.addEventListener("submit", (event) => void submitPartnerDelete(event));
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
    const parts = partnerPathParts();
    if (parts.eventSlug) void showEventView(parts.eventSlug, false);
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

  // Individuals have a public stats page only – no private /org dashboard.
  if (isOrgPage() && currentPartner?.accountType === "individual") {
    location.replace(withLang(`/partners/${encodeURIComponent(slug)}`));
    return;
  }

  wireFeedbackForm(slug);
  wireOwnerUi(slug);
  wireOrgLogin(slug);
  setOwnerChrome(false);

  const params = new URLSearchParams(location.search);
  const loginToken = params.get("login");
  if (isOrgPage() && loginToken) {
    const ok = await confirmMagicLogin(loginToken);
    if (!ok) {
      setOrgLoginStatus(
        txt(
          "partners.orgLoginLinkInvalid",
          "That sign-in link is invalid or expired. Request a new one.",
        ),
        true,
      );
    }
  } else if (isOrgPage()) {
    await tryRestoreOwnerSession();
  } else {
    // After signup verify, org edit token should open the private org page.
    // Individuals have no private dashboard – stay on the public status page.
    const edit = readSignupEditSession();
    if (
      edit &&
      edit.slug === slug &&
      edit.editToken &&
      currentPartner?.accountType !== "individual"
    ) {
      location.replace(withLang(`/partners/${encodeURIComponent(slug)}/org`));
      return;
    }
  }

  const eventSlug = eventSlugFromPath();
  if (eventSlug && ownerToken) await showEventView(eventSlug, false);
  else if (isOrgPage() && !ownerToken && eventSlug) {
    history.replaceState({}, "", orgPathFor());
  }
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
        headers: {
          "Content-Type": "application/json",
          ...ownerHeaders(),
        },
        body: JSON.stringify({ text, ownerToken }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.error === "unauthorized") {
          setFeedbackStatus(
            txt(
              "partners.feedbackNeedSignIn",
              "Sign in with your work email to share feedback.",
            ),
            true,
          );
          ownerToken = null;
          clearOwnerToken(slug);
          setOwnerChrome(false);
        } else if (data.error === "empty") {
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
      const points = Number(data.pointsCreated ?? data.ticketsCreated) || 0;
      const success =
        points <= 1
          ? txt(
              "partners.feedbackSuccessOne",
              "Thanks – we recorded your feedback and credited this organization.",
            )
          : txt(
              "partners.feedbackSuccessMany",
              "Thanks – we recorded {n} feedback points and credited this organization.",
            ).replace("{n}", String(points));
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
