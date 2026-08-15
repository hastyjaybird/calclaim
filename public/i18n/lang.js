/* global CALCLAIM_I18N */

(function () {
  const SUPPORTED = ["en", "es", "zh", "vi", "tl"];
  const LANG_PREFIX_RE = /^\/(es|zh|vi|tl)(?=\/|$)/;

  function detectLang() {
    const m = location.pathname.match(LANG_PREFIX_RE);
    if (m) return m[1];
    const q = new URLSearchParams(location.search).get("lang");
    if (q && SUPPORTED.includes(q)) return q;
    return "en";
  }

  function stripLangPrefix(pathname) {
    return pathname.replace(LANG_PREFIX_RE, "") || "/";
  }

  function withLang(path, lang) {
    if (!path) return path;
    if (path.startsWith("#") || path.startsWith("mailto:")) return path;

    if (/^https?:\/\//i.test(path)) {
      try {
        const u = new URL(path);
        if (u.origin !== location.origin) return path;
        const localized = withLang(`${u.pathname}${u.search}${u.hash}`, lang);
        return localized.startsWith("http") ? localized : `${u.origin}${localized}`;
      } catch {
        return path;
      }
    }

    if (!path.startsWith("/")) return path;
    const hashIdx = path.indexOf("#");
    const hash = hashIdx >= 0 ? path.slice(hashIdx) : "";
    const noHash = hashIdx >= 0 ? path.slice(0, hashIdx) : path;
    const qIdx = noHash.indexOf("?");
    const query = qIdx >= 0 ? noHash.slice(qIdx) : "";
    const pathOnly = qIdx >= 0 ? noHash.slice(0, qIdx) : noHash;
    if (
      pathOnly.startsWith("/dev") ||
      pathOnly.startsWith("/go/") ||
      pathOnly.startsWith("/api/") ||
      pathOnly.startsWith("/r/") ||
      pathOnly.startsWith("/report/") ||
      pathOnly.startsWith("/brand/") ||
      pathOnly.startsWith("/health")
    ) {
      return pathOnly + query + hash;
    }
    const clean = pathOnly.replace(LANG_PREFIX_RE, "") || "/";
    const localized = (lang === "en" ? "" : `/${lang}`) + (clean === "/" ? "/impact" : clean);
    return localized + query + hash;
  }

  /** Same page in another language: keep query (verify token), drop hash. */
  function langSwitchPath() {
    const base = stripLangPrefix(location.pathname);
    const path = base === "/" ? "/impact" : base;
    const params = new URLSearchParams(location.search);
    params.delete("lang");
    const query = params.toString();
    return query ? `${path}?${query}` : path;
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

  function htmlLang(lang) {
    if (lang === "zh") return "zh-Hans";
    return lang;
  }

  function applyTranslations(lang) {
    document.documentElement.lang = htmlLang(lang);

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
      if (!href || href.startsWith("#") || href.startsWith("mailto:")) {
        return;
      }
      if (a.classList.contains("lang-btn")) return;
      if (href.startsWith("/dev")) return;
      const next = withLang(href, lang);
      if (next !== href) a.setAttribute("href", next);
    });

    const brand = document.querySelector(".banner-brand");
    if (brand) brand.setAttribute("href", withLang("/impact", lang));

    const switchPath = langSwitchPath();
    document.querySelectorAll(".lang-btn").forEach((btn) => {
      const btnLang = btn.getAttribute("data-lang");
      btn.setAttribute("href", withLang(switchPath, btnLang));
      btn.setAttribute("aria-pressed", btnLang === lang ? "true" : "false");
      btn.classList.toggle("is-active", btnLang === lang);
    });
  }

  function mountLangSwitch(lang) {
    const host = document.getElementById("lang-switch");
    if (!host) return;
    // No hash – language switches should start at the top of the page.
    const basePath = langSwitchPath();
    host.setAttribute("role", "navigation");
    host.setAttribute("aria-label", t(lang, "lang.aria"));
    host.innerHTML = SUPPORTED.map(
      (code) =>
        `<a class="lang-btn" data-lang="${code}" href="${withLang(basePath, code)}">${t(lang, `lang.${code}`)}</a>`,
    ).join("\n      ");
  }

  function revealDeveloperDashboardNav() {
    const nav = document.querySelector(".site-nav");
    if (!nav || nav.querySelector(".nav-dev-dashboard")) return;

    fetch("/api/dev/session", { credentials: "same-origin", cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data?.authenticated) return;
        if (nav.querySelector(".nav-dev-dashboard")) return;

        const label = t(lang, "nav.dashboard") || "Developer dashboard";
        const link = document.createElement("a");
        link.href = "/dev";
        link.className = "nav-dev-dashboard";
        link.textContent = label;

        const donate = nav.querySelector("[data-donate-open]");
        if (donate) nav.insertBefore(link, donate);
        else nav.appendChild(link);

        document.querySelectorAll(".footer-dev-login").forEach((el) => {
          el.removeAttribute("data-i18n");
          el.textContent = label;
        });
      })
      .catch(() => {});
  }

  const lang = detectLang();
  window.CalClaimLang = {
    lang,
    t: (key) => t(lang, key),
    withLang: (path) => withLang(path, lang),
  };

  mountLangSwitch(lang);
  applyTranslations(lang);
  revealDeveloperDashboardNav();
})();
