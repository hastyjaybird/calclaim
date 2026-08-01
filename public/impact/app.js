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

function renderMetrics(stats) {
  el("m-reached").textContent = number.format(stats.peopleReached);
  el("m-qr").textContent = number.format(stats.qrScans);
  el("m-links").textContent = number.format(stats.linkClicks);
  el("m-opens").textContent = number.format(stats.programOpens);
  el("m-follow").textContent = number.format(stats.followThroughs);
  el("m-dollars").textContent = money.format(stats.estDollarsUnlocked);
  el("disclaimer").textContent = stats.disclaimer;
}

function renderTable(programs) {
  const tbody = el("program-rows");
  if (!programs.length) {
    tbody.innerHTML = `<tr><td colspan="5">No program opens yet. Share a QR or open an apply link from the bot.</td></tr>`;
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

function renderMap(points) {
  const map = L.map("map", { scrollWheelZoom: false }).setView([36.7, -119.7], 6);
  L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
    maxZoom: 12,
  }).addTo(map);

  const withScans = points.filter((p) => p.count > 0);
  const bounds = [];

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
    if (p.count > 0) bounds.push([p.lat, p.lng]);
  }

  if (bounds.length >= 2) map.fitBounds(bounds, { padding: [36, 36] });
  else if (bounds.length === 1) map.setView(bounds[0], 9);
  else if (withScans.length === 0 && points.length) {
    map.fitBounds(
      points.map((p) => [p.lat, p.lng]),
      { padding: [36, 36] },
    );
  }
}

function lineChart(canvasId, labels, values, label) {
  const ctx = el(canvasId);
  return new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label,
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
      plugins: {
        legend: { display: false },
      },
      scales: {
        x: {
          grid: { display: false },
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

function renderFunnel(funnel) {
  const stages = funnel?.stages ?? [];
  const tbody = el("funnel-rows");
  const callout = el("funnel-callout");

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

  const labels = stages.map((s) => s.label);
  const values = stages.map((s) => s.count);
  const colors = stages.map((s) =>
    s.dropPct === maxDropPct && maxDropPct > 0
      ? "rgba(180, 70, 50, 0.75)"
      : "rgba(13, 122, 95, 0.75)",
  );

  new Chart(el("chart-funnel"), {
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

async function main() {
  chartDefaults();
  const res = await fetch("/api/stats");
  if (!res.ok) throw new Error("Failed to load stats");
  const stats = await res.json();
  renderMetrics(stats);
  renderFunnel(stats.funnel);
  renderTable(stats.programs);
  renderMap(stats.mapPoints);
  renderCharts(stats.usersPerDay);
}

main().catch((err) => {
  console.error(err);
  el("program-rows").innerHTML =
    `<tr><td colspan="5">Could not load stats. Is the CalClaim server running?</td></tr>`;
});
