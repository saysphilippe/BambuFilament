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

async function products() {
  const res = await fetch(SITEMAP, { headers: { "User-Agent": "Mozilla/5.0 (BambuFilament catalog)" } });
  if (!res.ok) throw new Error(`sitemap: ${res.status}`);
  const xml = await res.text();
  return xml.split("<url>").slice(1)
    .map((b) => ({
      url: (b.match(/<loc>([^<]*)/) || [])[1] || "",
      lastmod: (b.match(/<lastmod>([^<]*)/) || [])[1] || "",
      title: decode((b.match(/<image:title>([^<]*)/) || [])[1] || ""),
      image: (b.match(/<image:loc>([^<]*)/) || [])[1] || "",
    }))
    .filter((p) => p.url.startsWith(`${STORE}/products/`));
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
console.log(`${catalog.types.length} typer, ${Object.keys(colors).length} farger, ${prods.length} produktsider`);
if (missing.length) console.log(`Uten produktside: ${missing.join(", ")}`);
