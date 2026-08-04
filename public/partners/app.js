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
  if (!dateStr || dateStr === "—") return dateStr;
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

// Statewide California view — keep as default for all map loads.
const CA_CENTER = [37.2, -119.5];
const CA_ZOOM = 6;

function renderMap(points) {
  const map = L.map("map", { scrollWheelZoom: false }).setView(CA_CENTER, CA_ZOOM);
  L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
    maxZoom: 12,
  }).addTo(map);

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
  }
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
  };

  applyPartnerHeader(currentPartner);

  const banner = el("download-banner");
  if (banner) {
    banner.href = `/api/partners/${encodeURIComponent(p.slug)}/banner`;
  }

  const editBtn = el("edit-partner");
  if (editBtn) editBtn.hidden = !stats.editable;

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

function showEditStatus(message, isError) {
  const status = el("edit-status");
  if (!status) return;
  status.hidden = !message;
  status.textContent = message || "";
  status.classList.toggle("is-error", Boolean(isError));
}

function openEditDialog() {
  if (!currentPartner) return;
  const dialog = el("partner-edit-dialog");
  if (!dialog) return;

  el("edit-name").value = currentPartner.name || "";
  el("edit-city").value = currentPartner.city || "";
  el("edit-email").value = "";
  let storedId = "";
  try {
    storedId = localStorage.getItem(`calclaim-partner-id:${currentPartner.slug}`) || "";
  } catch {
    storedId = "";
  }
  el("edit-partner-id").value = storedId;
  const logoInput = el("edit-logo");
  if (logoInput) logoInput.value = "";
  showEditStatus("", false);

  if (typeof dialog.showModal === "function") {
    dialog.showModal();
  } else {
    dialog.setAttribute("open", "");
  }
  el("edit-name")?.focus();
}

function closeEditDialog() {
  const dialog = el("partner-edit-dialog");
  if (!dialog) return;
  if (typeof dialog.close === "function") {
    dialog.close();
  } else {
    dialog.removeAttribute("open");
  }
}

function bindEditUi() {
  const editBtn = el("edit-partner");
  const dialog = el("partner-edit-dialog");
  const form = el("partner-edit-form");
  if (!editBtn || !dialog || !form) return;

  editBtn.addEventListener("click", openEditDialog);
  el("edit-dialog-close")?.addEventListener("click", closeEditDialog);
  el("edit-cancel")?.addEventListener("click", closeEditDialog);

  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) closeEditDialog();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!currentPartner) return;

    const name = String(el("edit-name")?.value || "").trim();
    const email = String(el("edit-email")?.value || "").trim();
    const city = String(el("edit-city")?.value || "").trim();
    const partnerId = String(el("edit-partner-id")?.value || "").trim();
    const logoFile = el("edit-logo")?.files?.[0] || null;
    const submit = el("edit-submit");

    if (!name) {
      showEditStatus(txt("signup.errorName", "Add your organization name."), true);
      return;
    }
    if (!email) {
      showEditStatus(txt("signup.errorEmail", "Add your work email."), true);
      return;
    }
    if (!partnerId) {
      showEditStatus(
        txt("partners.errorPartnerId", "Enter your partner ID from the welcome email."),
        true,
      );
      return;
    }
    if (logoFile && logoFile.size > 2_000_000) {
      showEditStatus(
        txt("signup.errorLogoSize", "Logo must be 2 MB or smaller."),
        true,
      );
      return;
    }

    if (submit) submit.disabled = true;
    showEditStatus(txt("partners.editSaving", "Saving changes…"), false);

    try {
      const body = new FormData();
      body.set("name", name);
      body.set("email", email);
      body.set("city", city);
      body.set("partnerId", partnerId);
      if (logoFile) body.set("logo", logoFile);

      const res = await fetch(
        `/api/partners/${encodeURIComponent(currentPartner.slug)}/profile`,
        { method: "POST", body },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const code = data.error || "update_failed";
        const map = {
          name_required: txt("signup.errorName", "Add your organization name."),
          email_required: txt("signup.errorEmail", "Add your work email."),
          email_invalid: txt(
            "signup.errorEmailInvalid",
            "Enter a valid email address.",
          ),
          partner_id_required: txt(
            "partners.errorPartnerId",
            "Enter your partner ID from the welcome email.",
          ),
          partner_id_mismatch: txt(
            "partners.errorPartnerIdMismatch",
            "That partner ID doesn’t match this page.",
          ),
          logo_type: txt(
            "signup.errorLogoType",
            "Use a PNG, JPG, WebP, or GIF logo.",
          ),
          logo_too_large: txt(
            "signup.errorLogoSize",
            "Logo must be 2 MB or smaller.",
          ),
          not_found: txt("partners.notFound", "Partner not found."),
        };
        showEditStatus(
          map[code] || txt("partners.editError", "Could not save changes. Try again."),
          true,
        );
        return;
      }

      currentPartner = {
        ...currentPartner,
        name: data.name || name,
        city: data.city || city || currentPartner.city,
        logo: data.logo != null ? data.logo : currentPartner.logo,
      };
      try {
        localStorage.setItem(
          `calclaim-partner-id:${currentPartner.slug}`,
          partnerId,
        );
      } catch {
        // Ignore quota / private-mode failures.
      }
      applyPartnerHeader(currentPartner);
      closeEditDialog();
    } catch {
      showEditStatus(
        txt("partners.editError", "Could not save changes. Try again."),
        true,
      );
    } finally {
      if (submit) submit.disabled = false;
    }
  });
}

async function main() {
  chartDefaults();
  bindEditUi();
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
