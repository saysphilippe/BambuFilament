// Henter alle produkter i Bambu Lab-butikken (EU) med pris og lagerstatus per variant,
// og skriver data/store.json for fanen «Butikk».
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
  return {
    handle: p.handle,
    name,
    image: (d?.mediaFileUrls || [])[0] || p.image || "",
    category: category(name, d?.isFilament),
    price: prices.length ? Math.min(...prices) : null,
    ...(refill ? { refill } : {}),
    ...(withSpool ? { withSpool } : {}),
    variants: skus.map((s) => [
      (s.productSkuPropertyList || []).map((x) => x.propertyValue).join(" / ") || name,
      s.isSoldOut ? 1 : 0,
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

await writeFile("data/store.json", JSON.stringify({
  updated: new Date().toISOString(),
  store: STORE,
  currency: "EUR",
  categories,
  products: rows.sort((a, b) => a.name.localeCompare(b.name)),
}) + "\n");

console.log(`Lagerstatus: ${JSON.stringify(counts)}, feilet: ${failed}, nye forsøk: ${stats.retries}, via proxy: ${stats.viaProxy}`);
const byCat = {};
for (const r of rows) byCat[r.category] = (byCat[r.category] || 0) + 1;
console.log(`Kategorier: ${JSON.stringify(byCat)}`);
