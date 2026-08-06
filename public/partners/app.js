/* global L, Chart */

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const number = new Intl.NumberFormat("en-US");

/** @type {{ slug: string, name: string, city: string, logo: string } | null} */
let currentPartner = null;

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

function partnerSlugFromPath() {
  const path = location.pathname.replace(/^\/(es|zh)(?=\/|$)/, "") || "/";
  const m = path.match(/^\/partners\/([A-Za-z0-9_-]+)\/?$/);
  return m ? m[1] : null;
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

function lineChart(canvasId, labels, values) {
  const ctx = el(canvasId);
  const dense = labels.length > 40;
  return new Chart(ctx, {
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
  const map = L.map("map", { scrollWheelZoom: false }).setView(CA_CENTER, CA_ZOOM);
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

function applyPartnerHeader(p) {
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

  el("partner-name").textContent = p.name;
  el("partner-city").textContent = p.city;
  el("partner-blurb").textContent =
    p.blurb || txt("partners.blurbFallback", "Community outreach partner");

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
  if (qrHeading) qrHeading.textContent = qrHeadingFor(p.name);

  const qr = el("partner-qr");
  qr.src = `/api/qr/partner/${encodeURIComponent(p.slug)}`;
  qr.alt = fillName(txt("partners.qrAlt", "{name} QR code for CalClaim"), p.name);

  document.title = `CalClaim × ${p.name}`;
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
  };

  applyPartnerHeader(currentPartner);

  const banner = el("download-banner");
  if (banner) {
    banner.href = `/api/partners/${encodeURIComponent(p.slug)}/banner`;
  }

  el("m-reached").textContent = number.format(stats.peopleReached);
  el("m-starts").textContent = number.format(stats.botStarts);
  el("m-follow").textContent = number.format(stats.followThroughs);
  el("m-dollars").textContent = money.format(stats.estDollarsUnlocked);
  el("disclaimer").textContent = stats.disclaimer;

  renderMap(stats.mapPoints || []);

  const series = stats.usersPerDay || [];
  const labels = series.length ? series.map((d) => d.date) : ["–"];
  const daily = series.length ? series.map((d) => d.users) : [0];
  const cum = series.length ? series.map((d) => d.cumulative) : [0];
  lineChart("chart-daily", labels, daily);
  lineChart("chart-cumulative", labels, cum);
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
}

main().catch((err) => {
  console.error(err);
  showError(txt("partners.loadError", "Could not load partner stats."));
});
