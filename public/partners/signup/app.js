const EDIT_SESSION_KEY = "calclaim-signup-edit";

/** @type {null | {
 *  partnerId: string,
 *  slug: string,
 *  name: string,
 *  email: string,
 *  city: string,
 *  logo: string,
 *  qrUrl: string,
 *  bannerUrl: string,
 *  editToken: string,
 * }} */
let editablePartner = null;
let editingExisting = false;

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

function persistEditSession(payload) {
  try {
    sessionStorage.setItem(EDIT_SESSION_KEY, JSON.stringify(payload));
  } catch {
    // Ignore quota / private-mode failures.
  }
}

function clearEditSession() {
  editablePartner = null;
  editingExisting = false;
  try {
    sessionStorage.removeItem(EDIT_SESSION_KEY);
  } catch {
    // ignore
  }
}

function loadEditSession() {
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

function setFormMode(isEdit) {
  editingExisting = isEdit;
  const submit = el("signup-submit");
  const cancel = el("signup-cancel-edit");
  const hint = el("signup-hint");
  if (submit) {
    submit.textContent = isEdit
      ? txt("signup.saveChanges", "Save changes")
      : txt("signup.submit", "Sign up & get my QR");
  }
  if (cancel) cancel.hidden = !isEdit;
  if (hint) {
    hint.textContent = isEdit
      ? txt(
          "signup.editHint",
          "Your partner ID and status page link stay the same — even if you change the organization name.",
        )
      : txt(
          "signup.hint",
          "You’ll get your QR code, status page, and a printable booth banner right away — and a copy by email.",
        );
  }
}

function fillFormFromPartner(partner) {
  if (el("signup-organization")) el("signup-organization").value = partner.name || "";
  if (el("signup-email")) el("signup-email").value = partner.email || "";
  if (el("signup-city")) el("signup-city").value = partner.city || "";
  const logoInput = el("signup-logo");
  if (logoInput) logoInput.value = "";
}

function showFormPanel() {
  const formPanel = el("signup-form-panel");
  const successPanel = el("signup-success-panel");
  if (formPanel) formPanel.hidden = false;
  if (successPanel) successPanel.hidden = true;
  formPanel?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function showSuccess(payload) {
  editablePartner = {
    partnerId: payload.partnerId,
    slug: payload.slug,
    name: payload.name || "",
    email: payload.email || editablePartner?.email || "",
    city: payload.city || editablePartner?.city || "",
    logo: payload.logo || "",
    qrUrl: payload.qrUrl || `/api/qr/partner/${encodeURIComponent(payload.slug)}`,
    bannerUrl:
      payload.bannerUrl ||
      `/api/partners/${encodeURIComponent(payload.slug)}/banner`,
    editToken: payload.editToken || editablePartner?.editToken || "",
  };
  persistEditSession(editablePartner);
  setFormMode(false);

  const formPanel = el("signup-form-panel");
  const successPanel = el("signup-success-panel");
  if (formPanel) formPanel.hidden = true;
  if (successPanel) successPanel.hidden = false;

  const statusLink = el("success-status-link");
  if (statusLink) {
    statusLink.href = withLang(`/partners/${encodeURIComponent(editablePartner.slug)}`);
    statusLink.textContent = withLang(`/partners/${editablePartner.slug}`);
  }

  const bannerHref = editablePartner.bannerUrl;
  const bannerLink = el("success-banner-link");
  if (bannerLink) bannerLink.href = bannerHref;
  const previewLink = el("success-banner-preview-link");
  if (previewLink) previewLink.href = bannerHref;

  const bannerName = el("success-banner-name");
  if (bannerName) bannerName.textContent = editablePartner.name || "";
  const bannerNameSolo = el("success-banner-name-solo");
  if (bannerNameSolo) bannerNameSolo.textContent = editablePartner.name || "";

  const qrHero = el("success-qr");
  if (qrHero && editablePartner.qrUrl) {
    qrHero.src = editablePartner.qrUrl;
    qrHero.alt = txt("signup.qrAlt", "Your unique partner QR code");
  }

  const bannerQr = el("success-banner-qr");
  if (bannerQr && editablePartner.qrUrl) {
    bannerQr.src = editablePartner.qrUrl;
    bannerQr.alt = "";
  }

  const logoWrap = el("success-banner-logo-wrap");
  const logoImg = el("success-banner-logo");
  if (logoWrap && logoImg) {
    if (editablePartner.logo) {
      logoImg.src = editablePartner.logo;
      logoWrap.hidden = false;
      if (bannerNameSolo) bannerNameSolo.hidden = true;
    } else {
      logoImg.removeAttribute("src");
      logoWrap.hidden = true;
      if (bannerNameSolo) bannerNameSolo.hidden = false;
    }
  }

  const editBtn = el("success-edit-btn");
  if (editBtn) editBtn.hidden = !editablePartner.editToken;

  successPanel?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function startEdit() {
  if (!editablePartner?.editToken) return;
  fillFormFromPartner(editablePartner);
  setFormMode(true);
  showStatus("", false);
  const status = el("signup-status");
  if (status) status.hidden = true;
  showFormPanel();
}

function cancelEdit() {
  if (!editablePartner) {
    setFormMode(false);
    return;
  }
  setFormMode(false);
  showSuccess(editablePartner);
}

async function submitForm(event) {
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

  const isEdit = editingExisting && editablePartner?.partnerId && editablePartner?.editToken;
  if (submit) submit.disabled = true;
  showStatus(
    isEdit
      ? txt("signup.saving", "Saving your changes…")
      : txt("signup.sending", "Creating your partner kit…"),
    false,
  );

  try {
    const body = new FormData();
    body.set("name", name);
    body.set("email", email);
    body.set("city", city);
    if (logoFile) body.set("logo", logoFile);

    let res;
    if (isEdit) {
      body.set("partnerId", editablePartner.partnerId);
      body.set("editToken", editablePartner.editToken);
      res = await fetch(
        `/api/partners/${encodeURIComponent(editablePartner.slug)}/profile`,
        { method: "POST", body },
      );
    } else {
      res = await fetch("/api/partners/signup", {
        method: "POST",
        body,
      });
    }

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
        edit_expired: txt(
          "signup.errorEditExpired",
          "This edit session expired. Sign up again isn’t needed — contact us if you need a change.",
        ),
        partner_id_mismatch: txt(
          "signup.errorEditExpired",
          "This edit session expired. Sign up again isn’t needed — contact us if you need a change.",
        ),
      };
      showStatus(
        map[code] ||
          (isEdit
            ? txt("signup.errorSave", "Could not save changes. Try again.")
            : txt("signup.error", "Could not sign up. Try again.")),
        true,
      );
      if (code === "edit_expired" || code === "partner_id_mismatch") {
        clearEditSession();
        setFormMode(false);
      }
      return;
    }

    showSuccess({
      partnerId: data.partnerId || editablePartner?.partnerId,
      slug: data.slug || editablePartner?.slug,
      name: data.name || name,
      email: data.email || email,
      city: data.city || city,
      logo: data.logo != null ? data.logo : editablePartner?.logo || "",
      qrUrl: data.qrUrl || editablePartner?.qrUrl,
      bannerUrl: data.bannerUrl || editablePartner?.bannerUrl,
      editToken: data.editToken || editablePartner?.editToken,
    });
  } catch {
    showStatus(
      isEdit
        ? txt("signup.errorSave", "Could not save changes. Try again.")
        : txt("signup.error", "Could not sign up. Try again."),
      true,
    );
  } finally {
    if (submit) submit.disabled = false;
  }
}

function bindForm() {
  const form = el("partner-signup-form");
  if (!form) return;

  form.addEventListener("submit", (event) => void submitForm(event));
  el("signup-cancel-edit")?.addEventListener("click", cancelEdit);
  el("success-edit-btn")?.addEventListener("click", startEdit);

  // Leaving the signup page ends the one-time edit session.
  document.querySelectorAll("a[href]").forEach((anchor) => {
    anchor.addEventListener("click", () => {
      const href = anchor.getAttribute("href") || "";
      if (!href || href.startsWith("#") || href.includes("/partners/signup")) return;
      clearEditSession();
    });
  });
}

function init() {
  bindForm();
  const saved = loadEditSession();
  if (saved) {
    showSuccess(saved);
  }
}

init();
