function el(id) {
  return document.getElementById(id);
}

function txt(key, fallback) {
  return window.CalClaimLang?.t?.(key) || fallback;
}

function withLang(path) {
  return window.CalClaimLang?.withLang?.(path) || path;
}

function showStatus(message, isError) {
  const status = el("signup-status");
  if (!status) return;
  status.hidden = false;
  status.textContent = message;
  status.classList.toggle("is-error", Boolean(isError));
}

function showSuccess(payload) {
  const formPanel = el("signup-form-panel");
  const successPanel = el("signup-success-panel");
  if (formPanel) formPanel.hidden = true;
  if (successPanel) successPanel.hidden = false;

  if (payload.partnerId && payload.slug) {
    try {
      localStorage.setItem(
        `calclaim-partner-id:${payload.slug}`,
        payload.partnerId,
      );
    } catch {
      // Ignore quota / private-mode failures.
    }
  }

  const statusLink = el("success-status-link");
  if (statusLink) {
    statusLink.href = withLang(`/partners/${encodeURIComponent(payload.slug)}`);
    statusLink.textContent = withLang(`/partners/${payload.slug}`);
  }

  const bannerLink = el("success-banner-link");
  if (bannerLink) bannerLink.href = payload.bannerUrl;

  const bannerName = el("success-banner-name");
  if (bannerName) bannerName.textContent = payload.name || "";
  const bannerNameSolo = el("success-banner-name-solo");
  if (bannerNameSolo) bannerNameSolo.textContent = payload.name || "";

  const qrHero = el("success-qr");
  if (qrHero && payload.qrUrl) {
    qrHero.src = payload.qrUrl;
    qrHero.alt = txt("signup.qrAlt", "Your unique partner QR code");
  }

  const bannerQr = el("success-banner-qr");
  if (bannerQr && payload.qrUrl) {
    bannerQr.src = payload.qrUrl;
    bannerQr.alt = "";
  }

  const logoWrap = el("success-banner-logo-wrap");
  const logoImg = el("success-banner-logo");
  if (logoWrap && logoImg) {
    if (payload.logo) {
      logoImg.src = payload.logo;
      logoWrap.hidden = false;
      if (bannerNameSolo) bannerNameSolo.hidden = true;
    } else {
      logoImg.removeAttribute("src");
      logoWrap.hidden = true;
      if (bannerNameSolo) bannerNameSolo.hidden = false;
    }
  }

  successPanel?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function bindForm() {
  const form = el("partner-signup-form");
  if (!form) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = el("signup-submit");
    const name = String(el("signup-organization")?.value || "").trim();
    const email = String(el("signup-email")?.value || "").trim();
    const city = String(el("signup-city")?.value || "").trim();
    const logoInput = el("signup-logo");
    const logoFile = logoInput?.files?.[0] || null;

    if (!name) {
      showStatus(txt("signup.errorName", "Add your organization name."), true);
      return;
    }
    if (!email) {
      showStatus(txt("signup.errorEmail", "Add your work email."), true);
      return;
    }
    if (logoFile && logoFile.size > 2_000_000) {
      showStatus(
        txt("signup.errorLogoSize", "Logo must be 2 MB or smaller."),
        true,
      );
      return;
    }

    if (submit) submit.disabled = true;
    showStatus(txt("signup.sending", "Creating your partner kit…"), false);

    try {
      const body = new FormData();
      body.set("name", name);
      body.set("email", email);
      body.set("city", city);
      if (logoFile) body.set("logo", logoFile);

      const res = await fetch("/api/partners/signup", {
        method: "POST",
        body,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const code = data.error || "signup_failed";
        const map = {
          name_required: txt("signup.errorName", "Add your organization name."),
          email_required: txt("signup.errorEmail", "Add your work email."),
          email_invalid: txt(
            "signup.errorEmailInvalid",
            "Enter a valid email address.",
          ),
          logo_type: txt(
            "signup.errorLogoType",
            "Use a PNG, JPG, WebP, or GIF logo.",
          ),
          logo_too_large: txt(
            "signup.errorLogoSize",
            "Logo must be 2 MB or smaller.",
          ),
        };
        showStatus(
          map[code] || txt("signup.error", "Could not sign up. Try again."),
          true,
        );
        return;
      }
      showSuccess(data);
    } catch {
      showStatus(txt("signup.error", "Could not sign up. Try again."), true);
    } finally {
      if (submit) submit.disabled = false;
    }
  });
}

bindForm();
