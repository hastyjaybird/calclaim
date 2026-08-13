/* global Stripe */

(function () {
  const AMOUNTS = [1000, 2500, 5000, 10000];
  const DEFAULT_CENTS = 2500;
  const MIN_CENTS = 500;
  const MAX_CENTS = 1_000_000;

  const money = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });

  function t(key, fallback) {
    return window.CalClaimLang?.t?.(key) || fallback;
  }

  function formatAmount(cents) {
    return money.format(cents / 100);
  }

  function dollarsToCents(raw) {
    const n = Number(String(raw).replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(n)) return null;
    return Math.round(n * 100);
  }

  const state = {
    cents: DEFAULT_CENTS,
    custom: false,
    monthly: false,
    config: null,
    stripe: null,
    elements: null,
    paymentElement: null,
    clientSecret: null,
    intentToken: 0,
  };

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }

  function applyI18n(root) {
    root.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      if (!key) return;
      const value = t(key, el.textContent);
      if (value) el.textContent = value;
    });
    root.querySelectorAll("[data-i18n-aria]").forEach((el) => {
      const key = el.getAttribute("data-i18n-aria");
      const value = t(key, el.getAttribute("aria-label") || "");
      if (value) el.setAttribute("aria-label", value);
    });
    root.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
      const key = el.getAttribute("data-i18n-placeholder");
      const value = t(key, el.getAttribute("placeholder") || "");
      if (value) el.setAttribute("placeholder", value);
    });
  }

  function ensureDialog() {
    let dialog = document.getElementById("donate-dialog");
    if (dialog) return dialog;
    dialog = document.createElement("dialog");
    dialog.id = "donate-dialog";
    dialog.className = "donate-dialog";
    dialog.setAttribute("aria-labelledby", "donate-title");
    dialog.innerHTML = `
      <div class="donate-dialog-inner">
        <div class="donate-dialog-head">
          <h2 id="donate-title" data-i18n="donate.title">Support CalClaim</h2>
          <button type="button" class="donate-close" data-donate-close data-i18n-aria="donate.closeAria" aria-label="Close donation form">×</button>
        </div>
        <div class="donate-panel" id="donate-form-panel">
          <p class="donate-lede" data-i18n="donate.lede">
            A personal gift to Jay to keep CalClaim going. Not tax-deductible.
          </p>
          <span class="donate-amount-label" data-i18n="donate.amountLabel">Amount</span>
          <div class="donate-amounts" id="donate-amounts"></div>
          <label class="donate-monthly-row">
            <input type="checkbox" id="donate-monthly" />
            <span class="donate-monthly-copy">
              <span data-i18n="donate.monthlyLabel">Make this a monthly gift</span>
              <p class="donate-monthly-help" data-i18n="donate.monthlyHelp">
                Billed every month until you cancel. Stripe’s receipt email is how you cancel. Not tax-deductible.
              </p>
            </span>
          </label>
          <div id="donate-payment" class="donate-payment" data-i18n-aria="donate.paymentAria" aria-label="Payment details"></div>
          <p id="donate-status" class="donate-status" role="status" aria-live="polite" hidden></p>
          <button type="button" class="cta donate-give" id="donate-give" data-i18n="donate.giveOnce">Give $25</button>
        </div>
        <div class="donate-success" id="donate-success" hidden>
          <p id="donate-success-copy"></p>
          <button type="button" class="cta donate-give" data-donate-close data-i18n="donate.close">Close</button>
        </div>
      </div>
    `;
    document.body.appendChild(dialog);
    mountAmountChips(dialog);
    bindDialog(dialog);
    applyI18n(dialog);
    return dialog;
  }

  function mountAmountChips(dialog) {
    const host = $("#donate-amounts", dialog);
    host.innerHTML = "";
    for (const cents of AMOUNTS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "donate-chip";
      btn.dataset.cents = String(cents);
      btn.textContent = formatAmount(cents);
      host.appendChild(btn);
    }
    const custom = document.createElement("label");
    custom.className = "donate-chip donate-custom";
    custom.innerHTML = `<span data-i18n="donate.customLabel">Other</span>
      <input id="donate-custom" type="number" min="5" max="10000" step="1" inputmode="decimal" data-i18n-placeholder="donate.customPlaceholder" placeholder="Amount" />`;
    host.appendChild(custom);
    paintAmountChips(dialog);
  }

  function paintAmountChips(dialog) {
    dialog.querySelectorAll(".donate-chip[data-cents]").forEach((btn) => {
      btn.classList.toggle(
        "is-active",
        !state.custom && Number(btn.dataset.cents) === state.cents,
      );
    });
    $(".donate-custom", dialog)?.classList.toggle("is-active", state.custom);
  }

  function setStatus(dialog, message, isError) {
    const el = $("#donate-status", dialog);
    if (!message) {
      el.hidden = true;
      el.textContent = "";
      el.classList.remove("is-error");
      return;
    }
    el.hidden = false;
    el.textContent = message;
    el.classList.toggle("is-error", Boolean(isError));
  }

  function updateGiveLabel(dialog) {
    const btn = $("#donate-give", dialog);
    if (!btn) return;
    const amount = formatAmount(state.cents);
    const template = state.monthly
      ? t("donate.giveMonthly", "Give {amount} monthly")
      : t("donate.giveOnce", "Give {amount}");
    btn.textContent = template.replace("{amount}", amount);
  }

  function showForm(dialog) {
    $("#donate-form-panel", dialog).hidden = false;
    $("#donate-success", dialog).hidden = true;
  }

  function showSuccess(dialog, kind) {
    const copy =
      kind === "monthly"
        ? t(
            "donate.successMonthly",
            "Thank you. Your monthly gift helps keep CalClaim going. Stripe’s receipt email is how you cancel.",
          )
        : kind === "processing"
          ? t(
              "donate.successProcessing",
              "Thank you. Bank gifts can take a few days to clear.",
            )
          : t(
              "donate.successOnce",
              "Thank you. Your gift helps keep CalClaim going.",
            );
    $("#donate-success-copy", dialog).textContent = copy;
    $("#donate-form-panel", dialog).hidden = true;
    $("#donate-success", dialog).hidden = false;
  }

  function destroyElements() {
    try {
      state.paymentElement?.unmount();
    } catch {
      /* already gone */
    }
    state.paymentElement = null;
    state.elements = null;
    state.clientSecret = null;
  }

  function loadStripeJs() {
    if (window.Stripe) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const existing = document.querySelector('script[src="https://js.stripe.com/v3/"]');
      if (existing) {
        existing.addEventListener("load", () => resolve());
        existing.addEventListener("error", () => reject(new Error("stripe_js")));
        return;
      }
      const script = document.createElement("script");
      script.src = "https://js.stripe.com/v3/";
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("stripe_js"));
      document.head.appendChild(script);
    });
  }

  async function loadConfig() {
    if (state.config) return state.config;
    const res = await fetch("/api/donate/config");
    state.config = await res.json();
    return state.config;
  }

  async function refreshIntent(dialog) {
    const token = ++state.intentToken;
    const give = $("#donate-give", dialog);
    if (state.cents < MIN_CENTS) {
      destroyElements();
      setStatus(dialog, t("donate.minError", "Minimum gift is $5."), true);
      if (give) give.disabled = true;
      return;
    }
    if (state.cents > MAX_CENTS) {
      destroyElements();
      setStatus(dialog, t("donate.maxError", "Maximum gift is $10,000."), true);
      if (give) give.disabled = true;
      return;
    }
    if (give) give.disabled = true;
    setStatus(dialog, "");
    try {
      const config = await loadConfig();
      if (token !== state.intentToken) return;
      if (!config.enabled || !config.publishableKey) {
        destroyElements();
        setStatus(
          dialog,
          t("donate.unconfigured", "Donations aren’t set up on this server yet."),
          true,
        );
        return;
      }
      await loadStripeJs();
      if (token !== state.intentToken) return;
      if (!state.stripe) state.stripe = window.Stripe(config.publishableKey);
      const res = await fetch("/api/donate/intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amountCents: state.cents,
          monthly: state.monthly,
        }),
      });
      const data = await res.json();
      if (token !== state.intentToken) return;
      if (!res.ok || !data.clientSecret) {
        throw new Error(data.error || "intent_failed");
      }
      destroyElements();
      state.clientSecret = data.clientSecret;
      state.elements = state.stripe.elements({
        clientSecret: data.clientSecret,
        appearance: {
          theme: "stripe",
          variables: {
            colorPrimary: "#084d3d",
            colorBackground: "#f7f3ea",
            colorText: "#10241f",
            colorDanger: "#8a2f2f",
            fontFamily: "Figtree, system-ui, sans-serif",
            borderRadius: "8px",
          },
        },
      });
      state.paymentElement = state.elements.create("payment", {
        layout: "tabs",
      });
      state.paymentElement.mount("#donate-payment");
      if (give) give.disabled = false;
    } catch (err) {
      if (token !== state.intentToken) return;
      console.error(err);
      destroyElements();
      setStatus(
        dialog,
        t("donate.error", "Could not start checkout. Try again."),
        true,
      );
    }
  }

  let intentTimer = 0;
  function scheduleIntent(dialog) {
    updateGiveLabel(dialog);
    paintAmountChips(dialog);
    clearTimeout(intentTimer);
    intentTimer = window.setTimeout(() => {
      void refreshIntent(dialog);
    }, 250);
  }

  function bindDialog(dialog) {
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
    dialog.addEventListener("close", () => {
      destroyElements();
    });
    dialog.addEventListener("click", (event) => {
      const close = event.target.closest("[data-donate-close]");
      if (close) dialog.close();
    });
    $("#donate-amounts", dialog).addEventListener("click", (event) => {
      const chip = event.target.closest(".donate-chip[data-cents]");
      if (!chip) return;
      state.custom = false;
      state.cents = Number(chip.dataset.cents);
      const customInput = $("#donate-custom", dialog);
      if (customInput) customInput.value = "";
      scheduleIntent(dialog);
    });
    $("#donate-custom", dialog).addEventListener("input", (event) => {
      const cents = dollarsToCents(event.target.value);
      state.custom = true;
      state.cents = cents || 0;
      scheduleIntent(dialog);
    });
    $("#donate-custom", dialog).addEventListener("focus", () => {
      state.custom = true;
      paintAmountChips(dialog);
    });
    $("#donate-monthly", dialog).addEventListener("change", (event) => {
      state.monthly = event.target.checked;
      scheduleIntent(dialog);
    });
    $("#donate-give", dialog).addEventListener("click", () => {
      void confirmGift(dialog);
    });
  }

  async function confirmGift(dialog) {
    if (!state.stripe || !state.elements || !state.clientSecret) return;
    const give = $("#donate-give", dialog);
    give.disabled = true;
    give.textContent = t("donate.processing", "Processing…");
    setStatus(dialog, "");
    try {
      const { error, paymentIntent } = await state.stripe.confirmPayment({
        elements: state.elements,
        clientSecret: state.clientSecret,
        confirmParams: {
          return_url: `${location.origin}${location.pathname}${location.search}`,
        },
        redirect: "if_required",
      });
      if (error) {
        setStatus(
          dialog,
          error.message ||
            t("donate.errorConfirm", "Payment didn’t go through. Try another method."),
          true,
        );
        updateGiveLabel(dialog);
        give.disabled = false;
        return;
      }
      const status = paymentIntent?.status;
      if (status === "processing" || status === "requires_capture") {
        showSuccess(dialog, "processing");
      } else {
        showSuccess(dialog, state.monthly ? "monthly" : "once");
      }
    } catch (err) {
      console.error(err);
      setStatus(
        dialog,
        t("donate.errorConfirm", "Payment didn’t go through. Try another method."),
        true,
      );
      updateGiveLabel(dialog);
      give.disabled = false;
    }
  }

  function openDonate() {
    const dialog = ensureDialog();
    showForm(dialog);
    applyI18n(dialog);
    updateGiveLabel(dialog);
    if (!dialog.open) dialog.showModal();
    scheduleIntent(dialog);
  }

  function maybeReturnFromRedirect() {
    const params = new URLSearchParams(location.search);
    const status = params.get("redirect_status");
    if (status !== "succeeded" && status !== "processing") return;
    const dialog = ensureDialog();
    applyI18n(dialog);
    showSuccess(
      dialog,
      status === "processing" ? "processing" : "once",
    );
    if (!dialog.open) dialog.showModal();
    params.delete("redirect_status");
    params.delete("payment_intent");
    params.delete("payment_intent_client_secret");
    const next = `${location.pathname}${params.toString() ? `?${params}` : ""}${location.hash}`;
    history.replaceState({}, "", next);
  }

  document.addEventListener("click", (event) => {
    const opener = event.target.closest("[data-donate-open]");
    if (!opener) return;
    event.preventDefault();
    openDonate();
  });

  maybeReturnFromRedirect();
})();
