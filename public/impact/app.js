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

function renderTable(programs) {
  const tbody = el("program-rows");
  if (!programs.length) {
    tbody.innerHTML = `<tr><td colspan="5">${escapeHtml(
      txt(
        "impact.emptyPrograms",
        "No program opens yet. Share a QR or open an apply link from CalClaim.",
      ),
    )}</td></tr>`;
    return;
  }
  tbody.innerHTML = programs
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

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// Statewide California view — keep as default for all map loads.
const CA_CENTER = [37.2, -119.5];
const CA_ZOOM = 6;

function renderMap(points) {
  const map = L.map("map", { scrollWheelZoom: false }).setView(CA_CENTER, CA_ZOOM);
  L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
    maxZoom: 12,
  }).addTo(map);

  for (const p of points) {
    const radius = p.count === 0 ? 8 : Math.min(28, 10 + p.count * 3);
    const color = p.kind === "qr" ? "#0d7a5f" : p.kind === "link" ? "#2a6f8f" : "#4a6b63";
    const marker = L.circleMarker([p.lat, p.lng], {
      radius,
      color,
      weight: 2,
      fillColor: color,
      fillOpacity: p.count === 0 ? 0.25 : 0.55,
    }).addTo(map);
    marker.bindPopup(
      `<strong>${escapeHtml(p.label)}</strong><br>${p.count} awareness event${p.count === 1 ? "" : "s"}`,
    );
  }
}

function formatChartLabel(dateStr) {
  if (!dateStr || dateStr === "—") return dateStr;
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
    labels.push("—");
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

// Bold star (not a cup) — reads clearly at leaderboard size
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

function renderPartnerBoard(partners) {
  const board = el("partner-board");
  if (!board) return;
  if (!partners?.length) {
    board.innerHTML = `<li class="partner-row partner-row-empty">${escapeHtml(
      txt("impact.partnersEmpty", "No partner outreach yet."),
    )}</li>`;
    return;
  }
  board.innerHTML = partners
    .map((p) => {
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
            <p class="partner-name">${escapeHtml(p.name)}</p>
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
    })
    .join("");
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
    const phone = el("contact-phone")?.value?.trim() ?? "";
    const email = el("contact-email")?.value?.trim() ?? "";
    const comments = el("contact-comments")?.value?.trim() ?? "";
    if (!phone && !email && !comments) {
      setContactStatus(
        txt("contact.empty", "Add a phone, email, or comment before sending."),
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
        body: JSON.stringify({ phone, email, comments }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data.error === "empty") {
          setContactStatus(
            txt("contact.empty", "Add a phone, email, or comment before sending."),
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
        txt("contact.success", "Thanks — we got your message."),
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
