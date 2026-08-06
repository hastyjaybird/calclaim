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

function chartDefaults() {
  Chart.defaults.font.family = "Figtree, system-ui, sans-serif";
  Chart.defaults.color = "#3a5550";
}

function txt(key, fallback) {
  return window.CalClaimLang?.t?.(key) || fallback;
}

function renderMetrics(stats) {
  el("m-reached").textContent = number.format(stats.peopleReached);
  el("m-qr").textContent = number.format(stats.qrScans);
  el("m-links").textContent = number.format(stats.linkClicks);
  el("m-opens").textContent = number.format(stats.programOpens);
  el("m-follow").textContent = number.format(stats.followThroughs);
  el("m-dollars").textContent = money.format(stats.estDollarsUnlocked);
  el("disclaimer").textContent = txt("impact.disclaimer", stats.disclaimer);
}

const PROGRAMS_PREVIEW = 10;
const PARTNERS_PREVIEW = 8;

function renderTable(programs) {
  const tbody = el("program-rows");
  const expandBtn = el("programs-expand");
  if (!programs.length) {
    tbody.innerHTML = `<tr><td colspan="5">${escapeHtml(
      txt(
        "impact.emptyPrograms",
        "No program opens yet. Share a QR or open an apply link from CalClaim.",
      ),
    )}</td></tr>`;
    if (expandBtn) expandBtn.hidden = true;
    return;
  }

  let expanded = false;

  function paint() {
    const visible =
      expanded || programs.length <= PROGRAMS_PREVIEW
        ? programs
        : programs.slice(0, PROGRAMS_PREVIEW);
    tbody.innerHTML = visible
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

    if (!expandBtn) return;
    if (programs.length <= PROGRAMS_PREVIEW) {
      expandBtn.hidden = true;
      return;
    }
    expandBtn.hidden = false;
    expandBtn.textContent = expanded
      ? txt("impact.showLess", "Show less")
      : txt("impact.showAllPrograms", "Show all");
    expandBtn.setAttribute("aria-expanded", expanded ? "true" : "false");
  }

  if (expandBtn && !expandBtn.dataset.wired) {
    expandBtn.dataset.wired = "1";
    expandBtn.addEventListener("click", () => {
      expanded = !expanded;
      paint();
    });
  }
  paint();
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
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

function kindColor(kind) {
  if (kind === "qr") return "#0d7a5f";
  if (kind === "link") return "#2a6f8f";
  if (kind === "mixed") return "#3d6b5c";
  return "#4a6b63";
}

/** Stable ~¼-mile offset in a random direction (deterministic per seed). */
function jitterAround(lat, lng, seed) {
  const rnd = mulberry32(hashSeed(seed));
  const angle = rnd() * Math.PI * 2;
  const dist = QUARTER_MILE_LAT * (0.7 + rnd() * 0.6);
  const cosLat = Math.cos((lat * Math.PI) / 180);
  return [lat + dist * Math.cos(angle), lng + (dist * Math.sin(angle)) / Math.max(0.2, cosLat)];
}

function personDotIcon(color, ghost) {
  const ghostClass = ghost ? " map-dot--ghost" : "";
  return L.divIcon({
    className: "map-dot-wrap",
    html: `<span class="map-dot${ghostClass}" style="--dot:${color}"></span>`,
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
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
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
    const color = kindColor(p.kind);
    const n = Math.max(0, Math.floor(p.count));
    if (n === 0) {
      const marker = L.marker([p.lat, p.lng], {
        icon: personDotIcon(color, true),
        personWeight: 0,
      });
      marker.bindPopup(`<strong>${escapeHtml(p.label)}</strong><br>0 awareness events`);
      layers.push(marker);
      continue;
    }
    const slots = weightSlots(n);
    for (let i = 0; i < slots.length; i++) {
      const weight = slots[i];
      const [lat, lng] = jitterAround(p.lat, p.lng, `${p.lat.toFixed(4)},${p.lng.toFixed(4)},${p.kind},${i}`);
      const marker = L.marker([lat, lng], {
        icon: personDotIcon(color, false),
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

function formatChartLabel(dateStr) {
  if (!dateStr || dateStr === "–") return dateStr;
  const d = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function lineChart(canvasId, labels, values, label) {
  const ctx = el(canvasId);
  const dense = labels.length > 40;
  return new Chart(ctx, {
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

function renderCharts(series) {
  const labels = series.map((d) => d.date);
  if (!labels.length) {
    labels.push("–");
    lineChart("chart-daily", labels, [0], "Users / day");
    lineChart("chart-cumulative", labels, [0], "Cumulative");
    return;
  }
  lineChart(
    "chart-daily",
    labels,
    series.map((d) => d.users),
    "Users / day",
  );
  lineChart(
    "chart-cumulative",
    labels,
    series.map((d) => d.cumulative),
    "Cumulative",
  );
}

// Bold star (not a cup) – reads clearly at leaderboard size
const TROPHY_SVG = `<svg class="partner-trophy" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
  <defs>
    <linearGradient id="trophy-shine" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#fff1b0"/>
      <stop offset="55%" stop-color="#e8b923"/>
      <stop offset="100%" stop-color="#9a6b08"/>
    </linearGradient>
  </defs>
  <path fill="url(#trophy-shine)" stroke="#8a5f06" stroke-width="0.6" stroke-linejoin="round"
    d="M12 2.2l2.6 5.4 5.9.8-4.3 4.1 1.1 5.9L12 15.4 6.7 18.4l1.1-5.9-4.3-4.1 5.9-.8z"/>
</svg>`;

function withLangPath(path) {
  return window.CalClaimLang?.withLang?.(path) || path;
}

function verifiedBadgeHtml(p) {
  if (!p.emailVerified) return "";
  const label =
    p.accountType === "organization" && p.emailDomain
      ? txt("partners.verifiedOrg", "Verified · @{domain}").replace(
          "{domain}",
          p.emailDomain,
        )
      : txt("partners.verifiedIndividual", "Verified email");
  return `<span class="verified-badge" title="${escapeHtml(label)}">${escapeHtml(label)}</span>`;
}

function partnerRowHtml(p) {
  const href = withLangPath(`/partners/${encodeURIComponent(p.slug)}`);
  const trophy =
    p.rank === 1
      ? TROPHY_SVG
      : `<span class="partner-trophy-spacer" aria-hidden="true"></span>`;
  const secondary = `${number.format(p.botStarts)} ${txt(
    "impact.partnersBotStarts",
    "started",
  )} · ${number.format(p.followThroughs)} ${txt(
    "impact.partnersFollows",
    "follow-throughs",
  )}`;
  return `<li>
    <a class="partner-row" href="${escapeHtml(href)}">
      <span class="partner-trophy-slot">${trophy}</span>
      <span class="partner-rank">${p.rank}</span>
      <img class="partner-logo" src="${escapeHtml(p.logo)}" alt="" width="48" height="48" />
      <div class="partner-meta">
        <div class="partner-name-row">
          <p class="partner-name">${escapeHtml(p.name)}</p>
          ${verifiedBadgeHtml(p)}
        </div>
        <p class="partner-city">${escapeHtml(p.city)} · ${escapeHtml(secondary)}</p>
      </div>
      <div class="partner-stat">
        <p class="partner-stat-value">${number.format(p.peopleReached)}</p>
        <p class="partner-stat-label">${escapeHtml(
          txt("impact.partnersReached", "People reached"),
        )}</p>
      </div>
      <span class="partner-link">${escapeHtml(
        txt("impact.partnersViewStats", "View stats →"),
      )}</span>
    </a>
  </li>`;
}

function renderPartnerBoard(partners) {
  const board = el("partner-board");
  const expandBtn = el("partners-expand");
  if (!board) return;
  if (!partners?.length) {
    board.innerHTML = `<li class="partner-row partner-row-empty">${escapeHtml(
      txt("impact.partnersEmpty", "No partner outreach yet."),
    )}</li>`;
    if (expandBtn) expandBtn.hidden = true;
    return;
  }

  let expanded = false;

  function paint() {
    const visible =
      expanded || partners.length <= PARTNERS_PREVIEW
        ? partners
        : partners.slice(0, PARTNERS_PREVIEW);
    board.innerHTML = visible.map(partnerRowHtml).join("");

    if (!expandBtn) return;
    if (partners.length <= PARTNERS_PREVIEW) {
      expandBtn.hidden = true;
      return;
    }
    expandBtn.hidden = false;
    expandBtn.textContent = expanded
      ? txt("impact.showLess", "Show less")
      : txt("impact.showMorePartners", "Show more");
    expandBtn.setAttribute("aria-expanded", expanded ? "true" : "false");
  }

  if (expandBtn && !expandBtn.dataset.wired) {
    expandBtn.dataset.wired = "1";
    expandBtn.addEventListener("click", () => {
      expanded = !expanded;
      paint();
    });
  }
  paint();
}

function setContactStatus(message, isError) {
  const status = el("contact-status");
  if (!status) return;
  status.hidden = !message;
  status.textContent = message || "";
  status.classList.toggle("is-error", Boolean(isError));
}

function wireContactForm() {
  const form = el("contact-form");
  if (!form) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = el("contact-email")?.value?.trim() ?? "";
    const comments = el("contact-comments")?.value?.trim() ?? "";
    if (!email && !comments) {
      setContactStatus(
        txt("contact.empty", "Add an email or comment before sending."),
        true,
      );
      return;
    }

    const submit = form.querySelector('button[type="submit"]');
    if (submit) submit.disabled = true;
    setContactStatus("", false);

    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, comments }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data.error === "empty") {
          setContactStatus(
            txt("contact.empty", "Add an email or comment before sending."),
            true,
          );
        } else {
          setContactStatus(
            txt("contact.error", "Could not send. Try again."),
            true,
          );
        }
        return;
      }
      form.reset();
      setContactStatus(
        txt("contact.success", "Thanks – we got your message."),
        false,
      );
    } catch {
      setContactStatus(
        txt("contact.error", "Could not send. Try again."),
        true,
      );
    } finally {
      if (submit) submit.disabled = false;
    }
  });
}

function initNavScrollSpy() {
  const nav = document.querySelector(".site-nav");
  if (!nav) return;

  const sectionIds = ["impact", "partners", "about", "contact", "privacy"];
  const sections = sectionIds
    .map((id) => document.getElementById(id))
    .filter(Boolean);
  if (!sections.length) return;

  const linksById = new Map(
    sectionIds.map((id) => [id, nav.querySelector(`a[href="#${id}"]`)]),
  );

  let activeId = "";

  function setActive(id) {
    if (id === activeId) return;
    activeId = id;
    for (const [sectionId, link] of linksById) {
      if (!link) continue;
      if (sectionId === id) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    }
  }

  function update() {
    const banner = document.querySelector(".banner");
    const offset = (banner?.offsetHeight ?? 64) + 12;
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
  window.addEventListener("hashchange", update);
  update();
}

async function main() {
  chartDefaults();
  wireContactForm();
  initNavScrollSpy();
  const [statsRes, partnersRes] = await Promise.all([
    fetch("/api/stats"),
    fetch("/api/partners"),
  ]);
  if (!statsRes.ok) throw new Error("Failed to load stats");
  const stats = await statsRes.json();
  renderMetrics(stats);
  renderTable(stats.programs);
  renderMap(stats.mapPoints);
  renderCharts(stats.usersPerDay);
  if (partnersRes.ok) {
    const data = await partnersRes.json();
    renderPartnerBoard(data.partners);
  } else {
    renderPartnerBoard([]);
  }
}

main().catch((err) => {
  console.error(err);
  el("program-rows").innerHTML = `<tr><td colspan="5">${escapeHtml(
    txt(
      "impact.loadError",
      "Could not load stats. Is the CalClaim server running?",
    ),
  )}</td></tr>`;
});
