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
 *  accountType?: string,
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

function selectedAccountType() {
  const checked = document.querySelector(
    'input[name="accountType"]:checked',
  );
  return checked?.value === "individual" ? "individual" : "organization";
}

function applyAccountTypeLabels() {
  const type = selectedAccountType();
  const isOrg = type === "organization";
  const nameLabel = el("signup-name-label");
  const emailLabel = el("signup-email-label");
  const emailHelp = el("signup-email-help");
  const nameInput = el("signup-organization");
  if (nameLabel) {
    nameLabel.textContent = isOrg
      ? txt("signup.nameLabel", "Organization name")
      : txt("signup.nameLabelIndividual", "Your name");
  }
  if (emailLabel) {
    emailLabel.textContent = isOrg
      ? txt("signup.emailLabel", "Work email")
      : txt("signup.emailLabelIndividual", "Email");
  }
  if (emailHelp) {
    emailHelp.textContent = isOrg
      ? txt(
          "signup.emailHelpOrg",
          "Must be your organization’s domain (not Gmail, Yahoo, Outlook, or other free email).",
        )
      : txt(
          "signup.emailHelpIndividual",
          "Any email works. We’ll send a verification link – same steps as organizations.",
        );
  }
  const logoLabelEl = el("signup-logo")?.closest("label")?.querySelector(
    "span:first-child",
  );
  if (logoLabelEl) {
    logoLabelEl.textContent = isOrg
      ? txt("signup.logoLabel", "Organization logo (optional)")
      : txt("signup.logoLabelIndividual", "Logo (optional)");
  }
  if (nameInput) {
    nameInput.autocomplete = isOrg ? "organization" : "name";
  }
  const hint = el("signup-hint");
  if (hint && !editingExisting) {
    hint.textContent = isOrg
      ? txt(
          "signup.hint",
          "We’ll email a verification link. After you confirm, you’ll get your QR code, status page, and booth banner.",
        )
      : txt(
          "signup.hintIndividual",
          "We’ll email a verification link. After you confirm, you’ll get your QR code and private stats page (not listed on the public leaderboard).",
        );
  }
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
  const typeField = document.querySelector(".account-type");
  if (submit) {
    submit.textContent = isEdit
      ? txt("signup.saveChanges", "Save changes")
      : txt("signup.submit", "Sign up & verify email");
  }
  if (cancel) cancel.hidden = !isEdit;
  if (typeField) typeField.hidden = isEdit;
  if (hint) {
    if (isEdit) {
      hint.textContent = txt(
        "signup.editHint",
        "Your partner ID and status page link stay the same – even if you change the name.",
      );
    } else {
      applyAccountTypeLabels();
    }
  }
}

function fillFormFromPartner(partner) {
  if (el("signup-organization")) el("signup-organization").value = partner.name || "";
  if (el("signup-email")) el("signup-email").value = partner.email || "";
  if (el("signup-city")) el("signup-city").value = partner.city || "";
  const logoInput = el("signup-logo");
  if (logoInput) logoInput.value = "";
}

function hideAllPanels() {
  const formPanel = el("signup-form-panel");
  const pendingPanel = el("signup-pending-panel");
  const successPanel = el("signup-success-panel");
  if (formPanel) formPanel.hidden = true;
  if (pendingPanel) pendingPanel.hidden = true;
  if (successPanel) successPanel.hidden = true;
}

function showFormPanel() {
  hideAllPanels();
  const formPanel = el("signup-form-panel");
  if (formPanel) formPanel.hidden = false;
  formPanel?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function showPending(payload) {
  hideAllPanels();
  const pendingPanel = el("signup-pending-panel");
  if (pendingPanel) pendingPanel.hidden = false;

  const body = el("signup-pending-body");
  if (body) {
    const template = txt(
      "signup.pendingBody",
      "We sent a verification link to {email}. Click it to confirm this is a verified account.",
    );
    body.textContent = template.replace("{email}", payload.email || "");
  }

  const domainEl = el("signup-pending-domain");
  if (domainEl) {
    if (payload.accountType === "organization" && payload.emailDomain) {
      domainEl.hidden = false;
      domainEl.textContent = txt(
        "signup.pendingDomain",
        "Organization domain to verify: @{domain}",
      ).replace("{domain}", payload.emailDomain);
    } else {
      domainEl.hidden = true;
      domainEl.textContent = "";
    }
  }

  const pendingHint = document.querySelector("#signup-pending-panel .signup-hint");
  if (pendingHint) {
    pendingHint.textContent =
      payload.accountType === "individual"
        ? txt(
            "signup.pendingHintIndividual",
            "The link expires in 48 hours. After verification you’ll get a private stats page and QR kit – individuals are not listed on the public leaderboard.",
          )
        : txt(
            "signup.pendingHint",
            "The link expires in 48 hours. Your QR kit unlocks after verification. Organizations then appear on the public leaderboard.",
          );
  }

  const demo = el("signup-pending-demo");
  if (demo) {
    if (payload.verifyUrl) {
      demo.hidden = false;
      demo.innerHTML = "";
      const note = document.createElement("span");
      note.textContent = txt(
        "signup.pendingDemoLink",
        "Local demo (SMTP unset) – open verification link: ",
      );
      const link = document.createElement("a");
      link.href = payload.verifyUrl;
      link.textContent = payload.verifyUrl;
      demo.append(note, link);
    } else {
      demo.hidden = true;
      demo.textContent = "";
    }
  }

  pendingPanel?.scrollIntoView({ behavior: "smooth", block: "start" });
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
    accountType: payload.accountType || editablePartner?.accountType || "organization",
  };
  persistEditSession(editablePartner);
  setFormMode(false);

  hideAllPanels();
  const successPanel = el("signup-success-panel");
  if (successPanel) successPanel.hidden = false;

  const successBody = document.querySelector("#signup-success-panel .signup-lede");
  if (successBody) {
    successBody.textContent =
      editablePartner.accountType === "individual"
        ? txt(
            "signup.successBodyIndividual",
            "Here is your unique QR code and private stats page. Individuals are not shown on the public leaderboard – bookmark your status link from the email.",
          )
        : txt(
            "signup.successBody",
            "Here is your unique QR code. Print out the booth banner for your next event. Your organization is eligible for the public leaderboard.",
          );
  }

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

function errorMessageFor(code, isEdit) {
  const map = {
    name_required: txt("signup.errorName", "Add your organization name."),
    name_required_individual: txt(
      "signup.errorNameIndividual",
      "Add your name.",
    ),
    email_required: txt("signup.errorEmail", "Add your email."),
    email_invalid: txt(
      "signup.errorEmailInvalid",
      "Enter a valid email address.",
    ),
    email_org_domain_required: txt(
      "signup.errorOrgDomain",
      "Organizations must use a work email domain (not Gmail, Yahoo, or Outlook).",
    ),
    account_type_required: txt(
      "signup.errorAccountType",
      "Choose organization or individual.",
    ),
    account_type_invalid: txt(
      "signup.errorAccountType",
      "Choose organization or individual.",
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
      "This edit session expired. Sign up again isn’t needed – contact us if you need a change.",
    ),
    partner_id_mismatch: txt(
      "signup.errorEditExpired",
      "This edit session expired. Sign up again isn’t needed – contact us if you need a change.",
    ),
  };
  return (
    map[code] ||
    (isEdit
      ? txt("signup.errorSave", "Could not save changes. Try again.")
      : txt("signup.error", "Could not sign up. Try again."))
  );
}

async function submitForm(event) {
  event.preventDefault();
  const submit = el("signup-submit");
  const name = String(el("signup-organization")?.value || "").trim();
  const email = String(el("signup-email")?.value || "").trim();
  const city = String(el("signup-city")?.value || "").trim();
  const accountType = selectedAccountType();
  const logoInput = el("signup-logo");
  const logoFile = logoInput?.files?.[0] || null;

  if (!name) {
    showStatus(
      accountType === "individual"
        ? txt("signup.errorNameIndividual", "Add your name.")
        : txt("signup.errorName", "Add your organization name."),
      true,
    );
    return;
  }
  if (!email) {
    showStatus(txt("signup.errorEmail", "Add your email."), true);
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
      : txt("signup.sending", "Sending verification email…"),
    false,
  );

  try {
    const body = new FormData();
    body.set("name", name);
    body.set("email", email);
    body.set("city", city);
    body.set("accountType", accountType);
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
      showStatus(errorMessageFor(code, isEdit), true);
      if (code === "edit_expired" || code === "partner_id_mismatch") {
        clearEditSession();
        setFormMode(false);
      }
      return;
    }

    if (data.pendingVerification) {
      clearEditSession();
      showPending({
        email: data.email || email,
        emailDomain: data.emailDomain || "",
        accountType: data.accountType || accountType,
        verifyUrl: data.verifyUrl || "",
      });
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
      accountType: data.accountType || accountType,
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
  document.querySelectorAll('input[name="accountType"]').forEach((input) => {
    input.addEventListener("change", applyAccountTypeLabels);
  });

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
  applyAccountTypeLabels();
  const saved = loadEditSession();
  if (saved) {
    showSuccess(saved);
  }
}

init();
