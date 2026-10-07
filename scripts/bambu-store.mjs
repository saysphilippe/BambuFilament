// Felles oppslag mot Bambu Lab-butikken (EU), brukt av update-catalog.mjs og update-store.mjs.
//
// Butikken avviser av og til GitHub sine servere, så Cloudflare-proxyen brukes som reserve.

export const STORE = "https://eu.store.bambulab.com";
const SITEMAP = `${STORE}/sitemap_products_1.xml`;
const PROXY = "https://bambufilament-proxy.saysphilippe.workers.dev";
const ORIGIN = { Origin: "https://saysphilippe.github.io" };
const DRAWER = "https://eu-store-api.bambulab.com/mall-goods/product/queryDrawer";
const STORE_HEADERS = {
  Accept: "application/json",
  "Bbl-Locale": "en-US",
  "X-BBL-STORE-REGION": "EU",
  "X-BBL-TIME-ZONE": "Europe/Oslo",
  "User-Agent": "Mozilla/5.0 (BambuFilament catalog)",
};

const decode = (s) => s
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
  .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

async function sitemapXml() {
  try {
    const res = await fetch(SITEMAP, { headers: { "User-Agent": STORE_HEADERS["User-Agent"] } });
    const xml = await res.text();
    if (res.ok && xml.includes("<url>")) {
      console.log(`Nettstedskart direkte: ${res.url}`);
      return xml;
    }
    console.warn(`Nettstedskart direkte: ${res.status}, prøver proxyen`);
  } catch (err) {
    console.warn(`Nettstedskart direkte: ${err.message}, prøver proxyen`);
  }
  const res = await fetch(`${PROXY}/sitemap`, { method: "POST", headers: ORIGIN });
  if (!res.ok) throw new Error(`sitemap via proxy: ${res.status}`);
  return res.text();
}

// Alle produkter i nettstedskartet: { handle, url, title, image, lastmod }.
// GitHub sine servere kan bli sendt til en annen region (f.eks. us.store), så alle
// regioner godtas og lenken bygges om til EU-butikken. Språkvarianter (/de/ osv.) hoppes over.
export async function sitemapProducts() {
  const xml = await sitemapXml();
  const seen = new Set();
  return xml.split("<url>").slice(1)
    .map((b) => {
      const loc = (b.match(/<loc>([^<]*)/) || [])[1] || "";
      return {
        handle: (loc.match(/^https:\/\/[a-z]+\.store\.bambulab\.com\/products\/([^/?#]+)$/) || [])[1],
        lastmod: (b.match(/<lastmod>([^<]*)/) || [])[1] || "",
        title: decode((b.match(/<image:title>([^<]*)/) || [])[1] || ""),
        image: (b.match(/<image:loc>([^<]*)/) || [])[1] || "",
      };
    })
    .filter((p) => p.handle && !seen.has(p.handle) && seen.add(p.handle))
    .map((p) => ({ ...p, url: `${STORE}/products/${p.handle}` }));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const stats = { retries: 0, viaProxy: 0 };

async function drawer(seoCode, viaProxy) {
  const res = viaProxy
    ? await fetch(`${PROXY}/store-product`, { method: "POST", headers: ORIGIN, body: JSON.stringify({ seoCode }) })
    : await fetch(`${DRAWER}?seoCode=${seoCode}`, { headers: STORE_HEADERS });
  const json = await res.json().catch(() => null);
  return json?.code === 1 && json.data ? json.data : null;
}

// Produktet med alle SKU-er (isSoldOut, pris, egenskaper), eller null.
// Butikken struper ved mange kall, så det prøves på nytt med økende pause, til slutt via proxyen.
export async function storeProduct(seoCode) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const viaProxy = attempt === 4;
    try {
      const data = await drawer(seoCode, viaProxy);
      if (data) {
        if (viaProxy) stats.viaProxy++;
        return data;
      }
    } catch { /* prøv igjen */ }
    stats.retries++;
    await sleep(500 * 2 ** attempt);
  }
  return null;
}

// Kjører fn over listen med begrenset samtidighet, så butikken ikke belastes unødig.
export async function mapLimit(list, limit, fn) {
  const out = new Array(list.length);
  let next = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (next < list.length) {
      const i = next++;
      out[i] = await fn(list[i], i);
    }
  }));
  return out;
}
