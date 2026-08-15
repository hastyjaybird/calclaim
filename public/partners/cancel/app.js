function el(id) {
  return document.getElementById(id);
}

function txt(key, fallback) {
  return window.CalClaimLang?.t?.(key) || fallback;
}

function tokenFromQuery() {
  try {
    return new URLSearchParams(window.location.search).get("token") || "";
  } catch {
    return "";
  }
}

function showOnly(id) {
  for (const key of ["cancel-loading", "cancel-error", "cancel-confirm", "cancel-success"]) {
    const node = el(key);
    if (node) node.hidden = key !== id;
  }
}

function showError() {
  showOnly("cancel-error");
}

async function confirmCancel(token) {
  const btn = el("cancel-confirm-btn");
  const status = el("cancel-confirm-status");
  if (btn) {
    btn.disabled = true;
    btn.textContent = txt("cancel.confirming", "Removing…");
  }
  if (status) {
    status.hidden = true;
    status.textContent = "";
  }

  try {
    const res = await fetch("/api/partners/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      showError();
      return;
    }
    const body = el("cancel-success-body");
    if (body) {
      body.textContent = data.alreadyCanceled
        ? txt(
            "cancel.alreadyBody",
            "This listing was already removed from the public leaderboard.",
          )
        : txt(
            "cancel.successBody",
            "Your public listing is removed. Thank you for trying CalClaim.",
          );
    }
    showOnly("cancel-success");
  } catch {
    showError();
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = txt("cancel.confirmButton", "Yes, remove my listing");
    }
  }
}

function main() {
  const token = tokenFromQuery();
  if (!token) {
    showError();
    return;
  }

  showOnly("cancel-confirm");
  const btn = el("cancel-confirm-btn");
  if (btn) {
    btn.addEventListener("click", () => {
      void confirmCancel(token);
    });
  }
}

main();
