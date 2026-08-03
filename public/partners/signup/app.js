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

  const idEl = el("success-partner-id");
  if (idEl) idEl.textContent = payload.partnerId;

  const statusLink = el("success-status-link");
  if (statusLink) {
    statusLink.href = withLang(`/partners/${encodeURIComponent(payload.slug)}`);
    statusLink.textContent = withLang(`/partners/${payload.slug}`);
  }

  const bannerLink = el("success-banner-link");
  if (bannerLink) bannerLink.href = payload.bannerUrl;

  const qrLink = el("success-qr-link");
  if (qrLink) qrLink.href = payload.qrUrl;

  const outbox = el("success-outbox-note");
  if (outbox) outbox.hidden = payload.emailMode !== "outbox";

  successPanel?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function bindForm() {
  const form = el("partner-signup-form");
  if (!form) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = el("signup-submit");
    const name = String(el("signup-name")?.value || "").trim();
    const email = String(el("signup-email")?.value || "").trim();
    const city = String(el("signup-city")?.value || "").trim();

    if (!name) {
      showStatus(txt("signup.errorName", "Add your organization name."), true);
      return;
    }
    if (!email) {
      showStatus(txt("signup.errorEmail", "Add your work email."), true);
      return;
    }

    if (submit) submit.disabled = true;
    showStatus(txt("signup.sending", "Creating your partner kit…"), false);

    try {
      const res = await fetch("/api/partners/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, city }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const code = data.error || "signup_failed";
        const map = {
          name_required: txt("signup.errorName", "Add your organization name."),
          email_required: txt("signup.errorEmail", "Add your work email."),
          email_invalid: txt("signup.errorEmailInvalid", "Enter a valid email address."),
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
