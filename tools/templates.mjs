export const escapeHtml = value => String(value).replace(/[&<>"']/g, char =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

export function mathText(value) {
  return escapeHtml(value).replace(/([_^])\{([^}]+)\}/g, (_, placement, content) => {
    const tag = placement === "_" ? "sub" : "sup";
    return "<" + tag + ">" + content + "</" + tag + ">";
  });
}

export function equations(lines) {
  const unique = [...new Set(lines.filter(Boolean))];
  return '<div class="equation">' + unique.map(line => '<div>' + mathText(line) + '</div>').join("") + '</div>';
}

export function symbolKey(entries) {
  return `<section class="notation"><h3>Symbols</h3><dl class="symbol-key">
    ${entries.map(([symbol, meaning]) => `<dt>${mathText(symbol)}</dt><dd>${escapeHtml(meaning)}</dd>`).join("")}
  </dl></section>`;
}

export function page(site, { route = "", title, description, content, scripts = [], index = true, ads = true }) {
  const root = "../".repeat(route.split("/").filter(Boolean).length) || "./";
  const canonical = new URL(route, site.url).href;
  const meta = site.publisher ? `<meta name="google-adsense-account" content="${site.publisher}">` : "";
  const advertising = site.serveAds && ads && index
    ? `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${site.publisher}" crossorigin="anonymous"></script>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${escapeHtml(canonical)}">
${index ? "" : '<meta name="robots" content="noindex,follow">'}
<link rel="stylesheet" href="${root}assets/site.css">
${meta}
${advertising}
${["site.js", ...scripts].map(script => `<script defer src="${root}assets/${script}"></script>`).join("\n")}
</head>
<body class="site-${site.key}">
<a class="skip-link" href="#main">Skip to content</a>
<header class="site-header">
  <div class="wrap">
    <a class="brand" href="${root}">${site.mark ? `<span class="brand-mark" aria-hidden="true">${site.mark}</span>` : ""}${site.name}</a>
    <nav class="site-nav" aria-label="Main navigation">${site.navigation.map(([target, label]) =>
    `<a href="${root}${target}">${label}</a>`).join("\n")}</nav>
  </div>
</header>
<main class="wrap page" id="main">
${typeof content === "function" ? content(root) : content}
</main>
<footer class="site-footer">
  <div class="wrap">
    <a href="https://aditusan.dev/">aditusan.dev</a>
    <nav aria-label="Footer navigation">
      <a href="${root}">${site.homeLabel}</a>
      <a href="${root}privacy/">Privacy</a>
      ${site.source ? `<a href="${site.source}">Desktop project</a>` : ""}
    </nav>
  </div>
</footer>
</body>
</html>
`;
}

export function heading(title, description, back) {
  return `<div class="title">
  ${back ? `<a class="back" href="${back.href}">← ${back.label}</a>` : ""}
  <h1>${escapeHtml(title)}</h1>
  <p>${escapeHtml(description)}</p>
</div>`;
}

export function numberField(name, label, value, unit = "", attributes = "") {
  return `<div class="field">
  <label for="${name}">${label}${unit ? ` <span class="unit">(${unit})</span>` : ""}</label>
  <input id="${name}" name="${name}" type="number" step="any" value="${value}" ${attributes}>
</div>`;
}

export const noScript = '<noscript><p class="noscript notice">Enable JavaScript to run this calculator. The reference text and links below are available without it.</p></noscript>';

export function historyPanel(id, title = "Calculation history", empty = "No calculations saved on this page yet.") {
  return `<section class="panel" id="${id}" aria-labelledby="${id}-title">
  <div class="panel-title history-header">
    <h2 id="${id}-title">${title}</h2>
    <button type="button" class="history-clear" disabled>Clear history</button>
  </div>
  <p class="empty small history-empty">${empty}</p>
  <ul class="history-list"></ul>
  <p class="history-message" role="status"></p>
</section>`;
}

export function privacy(site) {
  return {
    route: "privacy/",
    title: "Privacy | " + site.name,
    description: "How calculation inputs and optional advertising are handled on " + site.name + ".",
    ads: false,
    content: root => heading("Privacy", "How this calculator handles data.", { href: root, label: site.homeLabel }) + `
<div class="prose">
  <h2>Calculations</h2>
  <p>The calculator runs in your browser. When you submit a calculation, its inputs and results are saved in this browser’s site storage with the page’s calculation history. You can remove those entries using Clear history on the calculator or by clearing this site’s data in your browser.</p>
  <p>The hosting provider may process connection information as part of serving the website. Using a Copy button places the selected output on your device’s clipboard.</p>
  <h2>Advertising</h2>
  ${site.serveAds ? `<p>This site uses Google AdSense for advertising. Google and its partners may use cookies or other identifiers to serve and measure ads, including ads based on visits to this or other websites. You can manage advertising preferences in <a href="https://myadcenter.google.com/">My Ad Center</a> and through the privacy choices shown on this site where available.</p>
  <p><a href="https://policies.google.com/technologies/partner-sites">How Google uses information from sites that use its services</a></p>`
    : "<p>This build does not load advertising or analytics scripts.</p>"}
</div>`,
  };
}

export const referenceLinks = {
  psychSource: "https://github.com/Sentinel-Android/Psychrometric-tools",
  psychReport: "https://github.com/Sentinel-Android/Psychrometric-tools/blob/main/Project%20Report%28complete%20GUI%29.pdf",
};
