// Henter Bambu Lab sin filamentkatalog og skriver data/colors.json og data/catalog.json.
//
// - Farger og typer: filaments_color_codes.json i Bambu Studio-repoet. Historikken
//   til filen gir datoen hver farge og type dukket opp første gang.
// - Produktsider: nettstedskartet til eu.store.bambulab.com (tittel, bilde, lenke).
//
// Kjøres daglig av .github/workflows/catalog.yml. Krever Node 20+, ingen avhengigheter.
// GITHUB_TOKEN brukes hvis den finnes (høyere grense mot GitHub API).

import { writeFile, readFile } from "node:fs/promises";

const REPO = "bambulab/BambuStudio";
const FILE = "resources/profiles/BBL/filament/filaments_color_codes.json";
const SITEMAP = "https://eu.store.bambulab.com/sitemap_products_1.xml";
const STORE = "https://eu.store.bambulab.com";

const gh = (url) =>
  fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "BambuFilament-catalog",
      ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
    },
  }).then((r) => {
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    return r.json();
  });

const raw = (sha) =>
  fetch(`https://raw.githubusercontent.com/${REPO}/${sha}/${FILE}`).then((r) => {
    if (!r.ok) throw new Error(`raw ${sha}: ${r.status}`);
    return r.json();
  });

async function commits() {
  const all = [];
  for (let page = 1; page < 20; page++) {
    const batch = await gh(`https://api.github.com/repos/${REPO}/commits?path=${encodeURIComponent(FILE)}&per_page=100&page=${page}`);
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return all
    .map((c) => ({ sha: c.sha, date: c.commit.committer.date }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// Fargekoden (f.eks. "A0") ligger i color_code. Eldre versjoner av filen hadde den
// bare som slutten av fila_color_code ("A00A0").
const keyOf = (e) => `${e.fila_id}-${e.color_code || String(e.fila_color_code || "").slice(-2)}`;

// ---------- Farger og typer med første dato ----------

async function colorHistory() {
  const list = await commits();
  const firstColor = {};
  const firstType = {};
  let latest = null;
  for (const { sha, date } of list) {
    let data;
    try { data = (await raw(sha)).data || []; } catch (err) { console.warn(err.message); continue; }
    for (const e of data) {
      firstColor[keyOf(e)] ||= date;
      firstType[e.fila_type] ||= date;
    }
    latest = data;
  }
  // Utgangspunkt: første versjon som faktisk hadde data. Alt som kom senere regnes som nytt.
  const baseline = Object.values(firstColor).sort()[0] || null;
  return { latest, firstColor, firstType, baseline };
}

// ---------- Produktsider ----------

const decode = (s) => s
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
  .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9+]/g, "");

// Butikken avviser av og til GitHub sine servere, så proxyen på Cloudflare brukes som reserve.
const SITEMAP_PROXY = "https://bambufilament-proxy.saysphilippe.workers.dev/sitemap";

async function sitemapXml() {
  try {
    const res = await fetch(SITEMAP, { headers: { "User-Agent": "Mozilla/5.0 (BambuFilament catalog)" } });
    const xml = await res.text();
    if (res.ok && xml.includes("<url>")) {
      console.log(`Nettstedskart direkte: ${res.url}`);
      return xml;
    }
    console.warn(`Nettstedskart direkte: ${res.status}, prøver proxyen`);
  } catch (err) {
    console.warn(`Nettstedskart direkte: ${err.message}, prøver proxyen`);
  }
  const res = await fetch(SITEMAP_PROXY, { method: "POST", headers: { Origin: "https://saysphilippe.github.io" } });
  if (!res.ok) throw new Error(`sitemap via proxy: ${res.status}`);
  return res.text();
}

async function products() {
  const xml = await sitemapXml();
  return xml.split("<url>").slice(1)
    .map((b) => ({
      url: (b.match(/<loc>([^<]*)/) || [])[1] || "",
      lastmod: (b.match(/<lastmod>([^<]*)/) || [])[1] || "",
      title: decode((b.match(/<image:title>([^<]*)/) || [])[1] || ""),
      image: (b.match(/<image:loc>([^<]*)/) || [])[1] || "",
    }))
    // GitHub sine servere kan bli sendt til en annen region (f.eks. us.store), så alle
    // regioner godtas og lenken bygges om til EU-butikken. Språkvarianter (/de/ osv.) hoppes over.
    .map((p) => ({ ...p, handle: (p.url.match(/^https:\/\/[a-z]+\.store\.bambulab\.com\/products\/([^/?#]+)$/) || [])[1] }))
    .filter((p) => p.handle)
    .map(({ handle, ...p }) => ({ ...p, url: `${STORE}/products/${handle}` }));
}

// Finner produktsiden for en filamenttype: eksakt tittel først, så nærmeste treff.
function findProduct(type, prods) {
  const t = norm(type);
  const exact = prods.find((p) => norm(p.title) === t);
  if (exact) return exact;
  const variants = [t.replace(/^support/, "supportfor"), t + "filament"];
  const alt = prods.find((p) => variants.includes(norm(p.title)));
  if (alt) return alt;
  const candidates = prods.filter((p) => norm(p.title).includes(t) || t.includes(norm(p.title)) && norm(p.title).length > 3);
  candidates.sort((a, b) => Math.abs(norm(a.title).length - t.length) - Math.abs(norm(b.title).length - t.length));
  return candidates[0] || null;
}

// ---------- Hovedprogram ----------

const { latest, firstColor, firstType, baseline } = await colorHistory();
if (!latest) throw new Error("Fant ingen fargedata");

let prods = [];
try { prods = await products(); } catch (err) { console.warn(`Produktsider: ${err.message}`); }

// colors.json: samme kompakte format som nettsiden allerede bruker.
const colors = {};
for (const e of latest) {
  const k = keyOf(e);
  colors[k] ||= [e.fila_color_name?.en || "", e.fila_type || "", e.fila_color || []];
}

const types = {};
for (const e of latest) {
  const t = e.fila_type || "Ukjent";
  types[t] ||= { type: t, materialId: e.fila_id, firstSeen: firstType[t] || null, colors: [] };
  if (!types[t].colors.some((c) => c.key === keyOf(e))) {
    types[t].colors.push({
      key: keyOf(e),
      name: e.fila_color_name?.en || "",
      hex: e.fila_color || [],
      code: String(e.fila_color_code || ""),
      firstSeen: firstColor[keyOf(e)] || null,
    });
  }
}

let previous = {};
try { previous = JSON.parse(await readFile("data/catalog.json", "utf8")); } catch { /* første kjøring */ }
const prevProduct = Object.fromEntries((previous.types || []).map((t) => [t.type, t.product]));

for (const t of Object.values(types)) {
  const p = prods.length ? findProduct(t.type, prods) : null;
  t.product = p ? { url: p.url, title: p.title, image: p.image } : prevProduct[t.type] || null;
}

// ---------- Lagerstatus i Bambu-butikken (EU) ----------
//
// queryDrawer gir alle SKU-er for et produkt med isSoldOut. Fargen står som
// "Black(30105)", der tallet er fila_color_code i Bambu sin fargeliste.
// Resultat per farge: "in" (kan kjøpes), "out" (utsolgt) eller "missing" (ikke i butikken).

const STORE_API = "https://eu-store-api.bambulab.com/mall-goods/product/queryDrawer";
const STORE_PROXY = "https://bambufilament-proxy.saysphilippe.workers.dev/store-product";
const STORE_HEADERS = {
  Accept: "application/json",
  "Bbl-Locale": "en-US",
  "X-BBL-STORE-REGION": "EU",
  "X-BBL-TIME-ZONE": "Europe/Oslo",
  "User-Agent": "Mozilla/5.0 (BambuFilament catalog)",
};

async function storeSkus(seoCode) {
  const tries = [
    () => fetch(`${STORE_API}?seoCode=${seoCode}`, { headers: STORE_HEADERS }),
    () => fetch(STORE_PROXY, { method: "POST", headers: { Origin: "https://saysphilippe.github.io" }, body: JSON.stringify({ seoCode }) }),
  ];
  for (const attempt of tries) {
    try {
      const json = await (await attempt()).json();
      if (json.code === 1 && json.data) return json.data.productSkuList || [];
    } catch { /* prøv neste */ }
  }
  return null;
}

const stockCache = {};
let stockChecked = 0;
for (const t of Object.values(types)) {
  const seo = t.product?.url.split("/products/")[1];
  if (!seo) continue;
  stockCache[seo] ||= await storeSkus(seo);
  const skus = stockCache[seo];
  if (!skus) continue;
  stockChecked++;
  const byCode = {};
  for (const sku of skus) {
    const color = (sku.productSkuPropertyList || []).find((p) => p.propertyKey === "Color")?.propertyValue || "";
    const code = (color.match(/\((\d+)\)/) || [])[1];
    if (!code) continue;
    byCode[code] ||= false;
    if (!sku.isSoldOut) byCode[code] = true;
  }
  t.storeColors = Object.keys(byCode).length;
  for (const c of t.colors) c.stock = !(c.code in byCode) ? "missing" : byCode[c.code] ? "in" : "out";
}

const catalog = {
  source: { colors: `https://github.com/${REPO}/blob/master/${FILE}`, store: STORE },
  baseline,
  types: Object.values(types).sort((a, b) => a.type.localeCompare(b.type)),
};

// Skriv bare om innholdet er endret, så workflowen ikke lager tomme commits.
const before = JSON.stringify({ ...previous, updated: undefined }, null, 1);
if (before !== JSON.stringify({ ...catalog, updated: undefined }, null, 1)) {
  await writeFile("data/catalog.json", JSON.stringify({ updated: new Date().toISOString(), ...catalog }, null, 1) + "\n");
  console.log("data/catalog.json oppdatert");
} else {
  console.log("data/catalog.json uendret");
}
await writeFile("data/colors.json", JSON.stringify(colors));

const missing = catalog.types.filter((t) => !t.product).map((t) => t.type);
const stockCounts = {};
for (const t of catalog.types) for (const c of t.colors) stockCounts[c.stock || "ukjent"] = (stockCounts[c.stock || "ukjent"] || 0) + 1;
console.log(`${catalog.types.length} typer, ${Object.keys(colors).length} farger, ${prods.length} produktsider`);
console.log(`Lagerstatus fra ${stockChecked} typer: ${JSON.stringify(stockCounts)}`);
if (missing.length) console.log(`Uten produktside: ${missing.join(", ")}`);
