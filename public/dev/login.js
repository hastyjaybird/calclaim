const form = document.getElementById("login-form");
const errorEl = document.getElementById("error");
const captchaImg = document.getElementById("captcha-img");
const captchaId = document.getElementById("captcha-id");
const captchaAnswer = document.getElementById("captcha-answer");
const password = document.getElementById("password");
const human = document.getElementById("human");
const refreshBtn = document.getElementById("captcha-refresh");

function showError(msg) {
  errorEl.hidden = !msg;
  errorEl.textContent = msg || "";
}

async function loadCaptcha() {
  showError("");
  captchaAnswer.value = "";
  const res = await fetch("/api/dev/captcha", { cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Could not load CAPTCHA");
  captchaId.value = data.id;
  captchaImg.src = `data:image/svg+xml;base64,${btoa(data.svg)}`;
  captchaImg.alt = data.question || "CAPTCHA challenge";
}

refreshBtn.addEventListener("click", () => {
  loadCaptcha().catch((err) => showError(err.message));
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  showError("");

  if (!human.checked) {
    showError("You must confirm you are a human operator.");
    return;
  }

  const submit = form.querySelector('button[type="submit"]');
  submit.disabled = true;
  try {
    const res = await fetch("/api/dev/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        password: password.value,
        captchaId: captchaId.value,
        captchaAnswer: captchaAnswer.value,
        humanAttestation: human.checked,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      await loadCaptcha();
      showError(data.error || "Login failed");
      return;
    }
    const next = new URLSearchParams(location.search).get("next") || "/dev";
    location.href = next.startsWith("/dev") ? next : "/dev";
  } catch {
    showError("Network error – try again.");
    await loadCaptcha().catch(() => {});
  } finally {
    submit.disabled = false;
  }
});

loadCaptcha().catch((err) => showError(err.message));
