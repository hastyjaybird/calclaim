const EDIT_SESSION_KEY = "calclaim-signup-edit";

function el(id) {
  return document.getElementById(id);
}

function txt(key, fallback) {
  return window.CalClaimLang?.t?.(key) || fallback;
}

function withLang(path) {
  return window.CalClaimLang?.withLang?.(path) || path;
}

function tokenFromQuery() {
  try {
    return new URLSearchParams(window.location.search).get("token") || "";
  } catch {
    return "";
  }
}

function persistEditSession(payload) {
  try {
    sessionStorage.setItem(EDIT_SESSION_KEY, JSON.stringify(payload));
  } catch {
    // ignore
  }
}

function showError() {
  el("verify-loading").hidden = true;
  el("verify-success").hidden = true;
  el("verify-error").hidden = false;
}

function showSuccess(data) {
  el("verify-loading").hidden = true;
  el("verify-error").hidden = true;
  el("verify-success").hidden = false;

  const body = el("verify-success-body");
  if (body) {
    if (data.alreadyVerified) {
      body.textContent = txt(
        "verify.alreadyBody",
        "Already verified. Here’s your QR.",
      );
    } else if (data.accountType === "individual") {
      body.textContent = txt(
        "verify.successBodyIndividual",
        "Print this QR. Scans credit you on the public leaderboard.",
      );
    } else {
      body.textContent = txt(
        "verify.successBody",
        "Print this QR at your next event.",
      );
    }
  }

  const badgeRow = el("verify-badge-row");
  const badge = el("verify-badge");
  if (badgeRow && badge) {
    if (data.emailDomain) {
      badgeRow.hidden = false;
      badge.textContent =
        data.accountType === "organization"
          ? txt("partners.verifiedOrg", "Verified · @{domain}").replace(
              "{domain}",
              data.emailDomain,
            )
          : txt("partners.verifiedIndividual", "Verified email");
    } else {
      badgeRow.hidden = false;
      badge.textContent = txt("partners.verifiedIndividual", "Verified email");
    }
  }

  const statusPath = withLang(`/partners/${encodeURIComponent(data.slug)}`);
  const statusLink = el("verify-status-link");
  if (statusLink) {
    statusLink.href = statusPath;
    statusLink.textContent = statusPath;
  }
  const statusCta = el("verify-status-cta");
  if (statusCta) statusCta.href = statusPath;

  const banner = el("verify-banner-link");
  if (banner) banner.href = data.bannerUrl || `#`;

  const qr = el("verify-qr");
  if (qr && data.qrUrl) {
    qr.src = data.qrUrl;
    qr.alt = txt("signup.qrAlt", "Your unique partner QR code");
  }

  // Organizations get a short-lived edit session that opens /org.
  // Individuals only have a public status page (cancel via welcome email).
  if (
    data.hasPrivateDashboard !== false &&
    data.accountType !== "individual" &&
    data.editToken &&
    data.partnerId &&
    data.slug
  ) {
    persistEditSession({
      partnerId: data.partnerId,
      slug: data.slug,
      name: data.name || "",
      email: data.email || "",
      city: data.city || "",
      logo: data.logo || "",
      qrUrl: data.qrUrl || "",
      bannerUrl: data.bannerUrl || "",
      editToken: data.editToken,
    });
  }
}

async function main() {
  const token = tokenFromQuery();
  if (!token) {
    showError();
    return;
  }

  try {
    const res = await fetch("/api/partners/verify-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      showError();
      return;
    }
    showSuccess(data);
  } catch {
    showError();
  }
}

main();
