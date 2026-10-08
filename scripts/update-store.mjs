// Henter alle produkter i Bambu Lab-butikken (EU) med pris og lagerstatus per variant, og
// eurokursen fra Norges Bank, og sender alt til databasen via Workeren (/store/ingest, med
// STORE_INGEST_KEY). Workeren lagrer prishistorikk for hver prisendring. Uten nøkkel (lokalt)
// skrives data/store.json i stedet.
//
// Produktlisten kommer fra nettstedskartet, lagerstatus fra butikkens queryDrawer.
// Kjøres to ganger i døgnet av .github/workflows/catalog.yml, med få samtidige kall.

import { writeFile } from "node:fs/promises";
import { STORE, sitemapProducts, storeProduct, mapLimit, stats } from "./bambu-store.mjs";

const CONCURRENCY = 2;
const PAUSE_MS = 120; // pause mellom kall per tråd, for å ikke bli strupet

// Kategori ut fra navnet. Rekkefølgen avgjør ved flere treff.
const MODEL = /\s-\s.*\b(X1|P1|A1|H2|P2S|X2D|A2L|R1|H2D|H2C|H2S|A1 mini)\b/i;
const CATEGORIES = [
  ["printers", "3D-printere", (n) => /^Bambu Lab (X|P|A|H|R)\w*\d\w*( (Carbon|mini|Combo|Pro|Laser).*)?$/i.test(n) || /\b3D Printer\b/i.test(n)],
  ["ams", "AMS og filamenthåndtering", (n) => /\bAMS\b|Filament (Buffer|Dryer|Cutter)|Spool|PTFE|\bDryer\b|Filament Sensor/i.test(n)],
  ["hotend", "Hotend og dyser", (n) => /Hotend|Nozzle|Extruder|Heater|Thermistor|Heatsink/i.test(n)],
  ["plates", "Byggeplater", (n) => /Plate\b|Heatbed|Build Surface|Bed Surface/i.test(n)],
  ["laser", "Laser og kutting", (n) => /Laser|Cutting|Blade|Vinyl|Plywood|Cutter Module|Pen Module/i.test(n)],
  ["parts", "Reservedeler", (n) => MODEL.test(n) || /\b(Board|Cable|Fan|Cover|Panel|Belt|Assembly|Screen|Mainboard|Camera|Antenna|Housing|Shell|Glass|Gasket|Motor - )\b/i.test(n)],
  ["makers", "Maker's Supply og komponenter", (n) => /Maker's Supply|Kit\b|Motor|Servo|Bearing|Screw|Magnet|Wire|Shaft|Spring|Stud|Rod\b|Fastener|Tape|CyberBrick|Battery|Insert|Connector/i.test(n)],
];

function category(name, isFilament) {
  if (isFilament) return "filament";
  return (CATEGORIES.find(([, , test]) => test(name)) || ["other"])[0];
}

const products = await sitemapProducts();
console.log(`${products.length} produkter i nettstedskartet`);

let failed = 0;
const rows = await mapLimit(products, CONCURRENCY, async (p) => {
  const d = await storeProduct(p.handle);
  await new Promise((r) => setTimeout(r, PAUSE_MS));
  if (!d) failed++;
  const skus = d?.productSkuList || [];
  const prices = skus.map((s) => Number(s.discountPrice ?? s.price)).filter((x) => Number.isFinite(x) && x > 0);
  // Filament: laveste pris for «Refill» og for «Filament with spool», så siden kan regne ut
  // hva spolen koster (forskjellen) når noen gjør opp et lån.
  const priceWhere = (test) => {
    const list = skus.filter((s) => (s.productSkuPropertyList || []).some((x) => test(String(x.propertyValue))))
      .map((s) => Number(s.discountPrice ?? s.price)).filter((x) => Number.isFinite(x) && x > 0);
    return list.length ? Math.min(...list) : null;
  };
  const refill = d?.isFilament ? priceWhere((v) => /refill/i.test(v)) : null;
  const withSpool = d?.isFilament ? priceWhere((v) => /with spool/i.test(v)) : null;
  const soldOut = skus.filter((s) => s.isSoldOut).length;
  const name = d?.name || p.title || p.handle;
  // Mengderabatt («filament-bulk-sale»): antall ruller på tvers av alle produkter i samme
  // kampanje gir prosent avslag. thresholdInfo type 2 = antall, discountInfo type 2 = prosent.
  const bundle = d?.promotion?.bundleFullDiscount;
  const tiers = (bundle?.thresholdList || [])
    .filter((t) => t.thresholdInfo?.type === 2 && t.discountInfo?.type === 2)
    .map((t) => [Number(t.thresholdInfo.value), Number(t.discountInfo.value)])
    .filter(([n, pct]) => n > 0 && pct > 0 && pct < 100);
  const bulk = tiers.length ? { id: String(bundle.activityInfo?.activityId || bundle.activityInfo?.seoCode || "bulk"), tiers } : null;
  return {
    handle: p.handle,
    name,
    image: (d?.mediaFileUrls || [])[0] || p.image || "",
    category: category(name, d?.isFilament),
    price: prices.length ? Math.min(...prices) : null,
    ...(refill ? { refill } : {}),
    ...(withSpool ? { withSpool } : {}),
    ...(bulk ? { bulk } : {}),
    // [navn, utsolgt, pris i euro]
    variants: skus.map((s) => [
      (s.productSkuPropertyList || []).map((x) => x.propertyValue).join(" / ") || name,
      s.isSoldOut ? 1 : 0,
      Number.isFinite(Number(s.discountPrice ?? s.price)) ? Number(s.discountPrice ?? s.price) : null,
    ]),
    status: !d ? "unknown" : !skus.length ? "unknown" : soldOut === 0 ? "in" : soldOut === skus.length ? "out" : "partial",
    isNew: d?.newFlag === 1,
  };
});

const categories = Object.fromEntries([
  ["filament", "Filament"],
  ...CATEGORIES.map(([key, label]) => [key, label]),
  ["other", "Annet"],
]);

const counts = {};
for (const r of rows) counts[r.status] = (counts[r.status] || 0) + 1;

// Eurokurs (NOK per EUR) fra Norges Bank, siste publiserte dag.
async function eurNok() {
  try {
    const res = await fetch("https://data.norges-bank.no/api/data/EXR/B.EUR.NOK.SP?lastNObservations=1&format=sdmx-json");
    const j = await res.json();
    const series = Object.values(j.data.dataSets[0].series)[0];
    const i = Object.keys(series.observations).at(-1);
    return { eurNok: Number(series.observations[i][0]), date: j.data.structure.dimensions.observation[0].values[i].id, source: "Norges Bank" };
  } catch (err) {
    console.warn("Fant ikke eurokurs:", err.message);
    return null;
  }
}

const store = {
  meta: { updated: new Date().toISOString(), store: STORE, currency: "EUR", categories, fx: await eurNok() },
  products: rows.sort((a, b) => a.name.localeCompare(b.name)),
};
console.log(`Eurokurs: ${JSON.stringify(store.meta.fx)}`);

const KEY = process.env.STORE_INGEST_KEY;
const WORKER = process.env.WORKER_URL || "https://bambufilament-proxy.saysphilippe.workers.dev";
if (KEY) {
  const res = await fetch(`${WORKER}/store/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Store-Key": KEY },
    body: JSON.stringify(store),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Workeren svarte ${res.status}: ${out.error || ""}`);
  console.log(`Lagret i databasen: ${JSON.stringify(out)}`);
} else {
  await writeFile("data/store.json", JSON.stringify({ ...store.meta, products: store.products }) + "\n");
  console.log("Ingen STORE_INGEST_KEY: skrev data/store.json lokalt");
}

console.log(`Lagerstatus: ${JSON.stringify(counts)}, feilet: ${failed}, nye forsøk: ${stats.retries}, via proxy: ${stats.viaProxy}`);
const byCat = {};
for (const r of rows) byCat[r.category] = (byCat[r.category] || 0) + 1;
console.log(`Kategorier: ${JSON.stringify(byCat)}`);
