import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { build } from "esbuild";
import { escapeHtml, page, privacy } from "./templates.mjs";

export async function buildSite(root, site, makePages, entries, workerEntry) {
  const url = new URL(site.url);
  if (url.protocol !== "https:" || !url.pathname.endsWith("/") || url.search || url.hash || url.username || url.password) {
    throw new Error("Enter a public HTTPS URL ending in /.");
  }
  if (site.publisher && !/^ca-pub-\d{16}$/.test(site.publisher)) {
    throw new Error("The publisher must be a public AdSense ca-pub ID with 16 digits.");
  }
  if (site.serveAds && !site.publisher) throw new Error("Enter an AdSense publisher ID before enabling ads.");

  const pages = [...makePages(site), privacy(site)];
  const routes = pages.map(({ route = "" }) => route);
  if (new Set(routes).size !== routes.length) throw new Error("The website contains duplicate URLs.");
  const directory = join(root, "docs");
  const assets = join(directory, "assets");
  await rm(directory, { recursive: true, force: true });
  await mkdir(assets, { recursive: true });

  const browserOptions = {
    absWorkingDir: root, bundle: true, format: "iife", platform: "browser", target: "es2022",
    charset: "utf8",
  };
  const define = {};
  if (workerEntry) {
    const worker = await build({ ...browserOptions, entryPoints: [workerEntry], write: false });
    const script = worker.outputFiles[0].text;
    await writeFile(join(assets, "adi-worker.js"), script);
    define.__ADI_LOCAL_WORKER_SOURCE__ = JSON.stringify(script);
  }
  await build({
    ...browserOptions,
    define,
    entryPoints: { site: "src/shared/site.mjs", ...entries },
    outdir: assets,
  });
  await copyFile(join(root, "src/shared/site.css"), join(assets, "site.css"));
  for (const input of pages) {
    const output = join(directory, input.route ?? "", "index.html");
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, page(site, input));
  }
  const sitemap = pages.filter(input => input.index !== false)
    .map(({ route = "" }) => "  <url><loc>" + escapeHtml(new URL(route, site.url).href) + "</loc></url>").join("\n");
  await writeFile(join(directory, "sitemap.xml"),
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
      + sitemap + "\n</urlset>\n");
  await writeFile(join(directory, "robots.txt"),
    "User-agent: *\nAllow: /\nSitemap: " + new URL("sitemap.xml", site.url).href + "\n");
  await writeFile(join(directory, ".nojekyll"), "");
  if (url.pathname === "/" && !url.hostname.endsWith(".github.io")) {
    await writeFile(join(directory, "CNAME"), url.hostname + "\n");
  }
  if (site.publisher) {
    await writeFile(join(directory, "ads.txt"), "google.com, " + site.publisher.slice(3) + ", DIRECT, f08c47fec0942fa0\n");
  }
  console.log(site.name + " · " + pages.length + " HTML pages · " + directory);
}
