/* global L, Chart */

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const number = new Intl.NumberFormat("en-US");

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

function lineChart(canvasId, labels, values) {
  const ctx = el(canvasId);
  return new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          data: values,
          borderColor: "#0d7a5f",
          backgroundColor: "rgba(13, 122, 95, 0.12)",
          fill: true,
          tension: 0.3,
          pointRadius: 3,
          pointBackgroundColor: "#084d3d",
        },
      ],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false } },
        y: {
          beginAtZero: true,
          ticks: { precision: 0 },
          grid: { color: "rgba(16, 36, 31, 0.08)" },
        },
      },
    },
  });
}

function renderMap(points) {
  const map = L.map("map", { scrollWheelZoom: false }).setView([36.7, -119.7], 6);
  L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
    maxZoom: 12,
  }).addTo(map);

  const bounds = [];
  for (const p of points) {
    const radius = p.count === 0 ? 10 : Math.min(30, 12 + p.count * 3);
    const marker = L.circleMarker([p.lat, p.lng], {
      radius,
      color: "#0d7a5f",
      weight: 2,
      fillColor: "#0d7a5f",
      fillOpacity: p.count === 0 ? 0.3 : 0.55,
    }).addTo(map);
    marker.bindPopup(
      `<strong>${escapeHtml(p.label)}</strong><br>${p.count} awareness event${
        p.count === 1 ? "" : "s"
      }`,
    );
    bounds.push([p.lat, p.lng]);
  }

  if (bounds.length >= 2) map.fitBounds(bounds, { padding: [40, 40] });
  else if (bounds.length === 1) map.setView(bounds[0], 10);
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

function renderPartner(stats) {
  const p = stats.partner;
  document.title = `CalClaim × ${p.name}`;

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
  el("partner-blurb").textContent = p.blurb || txt("partners.blurbFallback", "Community outreach partner");

  const qrHeading = el("partner-qr-heading");
  if (qrHeading) qrHeading.textContent = qrHeadingFor(p.name);

  const qr = el("partner-qr");
  qr.src = `/api/qr/partner/${encodeURIComponent(p.slug)}`;
  qr.alt = fillName(txt("partners.qrAlt", "{name} QR code for CalClaim"), p.name);

  el("m-reached").textContent = number.format(stats.peopleReached);
  el("m-starts").textContent = number.format(stats.botStarts);
  el("m-follow").textContent = number.format(stats.followThroughs);
  el("m-dollars").textContent = money.format(stats.estDollarsUnlocked);
  el("disclaimer").textContent = stats.disclaimer;

  renderMap(stats.mapPoints || []);

  const series = stats.usersPerDay || [];
  const labels = series.length ? series.map((d) => d.date) : ["—"];
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
