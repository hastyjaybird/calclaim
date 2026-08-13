/* global CALCLAIM_I18N */

(function () {
  const SUPPORTED = ["en", "es", "zh"];

  function detectLang() {
    const m = location.pathname.match(/^\/(es|zh)(?=\/|$)/);
    if (m) return m[1];
    const q = new URLSearchParams(location.search).get("lang");
    if (q && SUPPORTED.includes(q)) return q;
    return "en";
  }

  function stripLangPrefix(pathname) {
    return pathname.replace(/^\/(es|zh)(?=\/|$)/, "") || "/";
  }

  function withLang(path, lang) {
    if (!path.startsWith("/")) return path;
    const hashIdx = path.indexOf("#");
    const hash = hashIdx >= 0 ? path.slice(hashIdx) : "";
    const pathOnly = hashIdx >= 0 ? path.slice(0, hashIdx) : path;
    if (
      pathOnly.startsWith("/dev") ||
      pathOnly.startsWith("/go/") ||
      pathOnly.startsWith("/api/") ||
      pathOnly.startsWith("/r/") ||
      pathOnly.startsWith("/report/") ||
      pathOnly.startsWith("/brand/") ||
      pathOnly.startsWith("/health") ||
      pathOnly.startsWith("http")
    ) {
      return pathOnly + hash;
    }
    const clean = pathOnly.replace(/^\/(es|zh)(?=\/|$)/, "") || "/";
    if (lang === "en") return (clean === "/" ? "/impact" : clean) + hash;
    return `/${lang}${clean === "/" ? "/impact" : clean}${hash}`;
  }

  function t(lang, key) {
    const parts = key.split(".");
    let node = CALCLAIM_I18N[lang] || CALCLAIM_I18N.en;
    for (const p of parts) {
      node = node?.[p];
      if (node == null) break;
    }
    if (node == null) {
      node = CALCLAIM_I18N.en;
      for (const p of parts) node = node?.[p];
    }
    return typeof node === "string" ? node : "";
  }

  function fillFooter(html, lang) {
    return html
      .replaceAll("__PRIVACY__", withLang("/impact#privacy", lang))
      .replaceAll("__CONTACT__", withLang("/impact#contact", lang));
  }

  function applyTranslations(lang) {
    document.documentElement.lang = lang === "zh" ? "zh-Hans" : lang;

    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      if (!key) return;
      const value = t(lang, key);
      if (!value) return;
      if (el.hasAttribute("data-i18n-html")) {
        el.innerHTML = fillFooter(value, lang);
      } else {
        el.textContent = value;
      }
    });

    document.querySelectorAll("[data-i18n-aria]").forEach((el) => {
      const key = el.getAttribute("data-i18n-aria");
      const value = t(lang, key);
      if (value) el.setAttribute("aria-label", value);
    });

    document.querySelectorAll("[data-i18n-alt]").forEach((el) => {
      const key = el.getAttribute("data-i18n-alt");
      const value = t(lang, key);
      if (value) el.setAttribute("alt", value);
    });

    document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
      const key = el.getAttribute("data-i18n-placeholder");
      const value = t(lang, key);
      if (value) el.setAttribute("placeholder", value);
    });

    const page = document.body.getAttribute("data-page");
    if (page && CALCLAIM_I18N[lang]?.meta?.[`${page}Title`]) {
      document.title = CALCLAIM_I18N[lang].meta[`${page}Title`];
    }

    // Keep public nav/footer links in the active language; leave /dev alone.
    document.querySelectorAll("a[href]").forEach((a) => {
      const href = a.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("http")) {
        return;
      }
      if (a.classList.contains("lang-btn")) return;
      if (href.startsWith("/dev")) return;
      const next = withLang(href, lang);
      if (next !== href) a.setAttribute("href", next);
    });

    const brand = document.querySelector(".banner-brand");
    if (brand) brand.setAttribute("href", withLang("/impact", lang));

    document.querySelectorAll(".lang-btn").forEach((btn) => {
      const btnLang = btn.getAttribute("data-lang");
      const base = stripLangPrefix(location.pathname);
      // No hash – language switches should start at the top of the page.
      const targetPath = base === "/" ? "/impact" : base;
      btn.setAttribute("href", withLang(targetPath, btnLang));
      btn.setAttribute("aria-pressed", btnLang === lang ? "true" : "false");
      btn.classList.toggle("is-active", btnLang === lang);
    });
  }

  function mountLangSwitch(lang) {
    const host = document.getElementById("lang-switch");
    if (!host) return;
    // No hash – language switches should start at the top of the page.
    const basePath = stripLangPrefix(location.pathname) || "/impact";
    host.setAttribute("role", "navigation");
    host.setAttribute("aria-label", t(lang, "lang.aria"));
    host.innerHTML = `
      <a class="lang-btn" data-lang="en" href="${withLang(basePath, "en")}">${t(lang, "lang.en")}</a>
      <a class="lang-btn" data-lang="es" href="${withLang(basePath, "es")}">${t(lang, "lang.es")}</a>
      <a class="lang-btn" data-lang="zh" href="${withLang(basePath, "zh")}">${t(lang, "lang.zh")}</a>
    `;
  }

  const lang = detectLang();
  window.CalClaimLang = {
    lang,
    t: (key) => t(lang, key),
    withLang: (path) => withLang(path, lang),
  };

  mountLangSwitch(lang);
  applyTranslations(lang);
})();
