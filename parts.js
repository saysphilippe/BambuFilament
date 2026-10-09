// Komponentbiblioteket: alt vi har kjøpt hos AliExpress og Mouser (og lagt inn for hånd),
// i samme database som filamentet (samlingen «parts», se worker/src/records.js).
//
// Import fra AliExpress: brukeren drar et bokmerke til bokmerkelinjen og trykker på det på
// ordresiden hos AliExpress. Skriptet laster inn alle ordrene, leser dem fra siden og sender
// dem hit med postMessage (siden åpnes i et nytt vindu). Ingen passord forlater nettleseren.

const SITE = "https://saysphilippe.github.io/BambuFilament/";
const ALI_ORIGINS = /^https:\/\/([a-z]+\.)?aliexpress\.(com|us|ru)$/;
const MOUSER_ORIGINS = /^https:\/\/([a-z]+\.)?mouser\.[a-z.]+$/;
const IMG_HOSTS = /^https:\/\/([a-z0-9-]+\.)*(alicdn\.com|aliexpress-media\.com|mouser\.com)\//;
const PATCH_CHUNK = 400;

// ---------- Kategorier ----------
//
// Første regel som treffer, vinner, så de smaleste står først (filtføtter er husholdning,
// ikke festemidler). Hver vare kan få en annen kategori for hånd i detaljvinduet.
export const CATEGORIES = [
  ["3dprint", "3D-print", /3d print|\bprinter\b|nozzle|hotend|hot end|extruder|filament|bambu|prusa|\bender\b|\bpei\b|build plate|bowden|\bptfe\b|heat ?bed|bltouch|volcano|\be3d\b/],
  ["house", "Husholdning", /\bfelt\b|furniture|chair leg|table leg|kitchen|bathroom|shower|toilet|towel|refrigerator|\bfridge|curtain|door stop|cleaning|\bmop\b|broom|\bdish|\bmugs?\b|\bcups?\b|water bottle|lunch box|pillow|bed sheet|blanket|laundry|hanger|trash|garbage|vacuum|\bsink\b|faucet|non-slip|anti-slip|carpet|\brugs?\b|household/],
  ["sensor", "Sensorer", /sensor|\brfid\b|rc522|\bnfc\b|ultrasonic|hc-sr|\bpir\b|thermistor|thermocouple|\bdht\d|\bbme\d|\bbmp\d|accelerometer|gyro|\bmpu\d|hall effect|load cell|hx711|ds18b20|lidar|\btof\b|photoresistor/],
  ["tool", "Verktøy", /\btools?\b|plier|screwdriver|nail gun|staple gun|stapler|airbrush|soldering|\bsolder\b|multimeter|wrench|\bdrill|tweezer|\bknife|\bknives\b|cutter|\bsaws?\b|hacksaw|chain ?saw|caliper|crimping|heat gun|glue gun|file set|sandpaper|\bvise\b|tape measure|spirit level|oscilloscope|\btester\b|hex key|allen key|ratchet|socket set/],
  ["mcu", "Mikrokontrollere", /esp32|esp8266|\besp-|arduino|raspberry|stm32|nodemcu|wemos|\bpico\b|attiny|atmega|development board|dev board|nrf52|rp2040|\bxiao\b|teensy|microcontroller/],
  ["power", "Strøm og batterier", /batter(y|ies)|charger|charging|power supply|power bank|\bbuck\b|\bboost\b|step.?down|step.?up|dc-dc|converter|18650|lipo|li-ion|lithium|\bsolar\b|\badapter\b|transformer|inverter|\bpsu\b|tp4056/],
  ["passive", "Passive komponenter", /resistor|capacitor|inductor|\bdiodes?\b|transistor|mosfet|potentiometer|crystal oscillator|\bfuses?\b|varistor|thyristor|\btriac|\bic chip|optocoupler|voltage regulator|ams1117|\blm7\d|ne555|assortment kit|\b2n\d{4}\b|\bbc5\d\d\b|\bs80[0-9]{2}\b|\birf\w+|\birlz?\w+|\btip1[0-9]{2}\b/],
  ["module", "Moduler og skjermer", /\boled\b|\blcd\b|\btft\b|display|\brelays?\b|\bmodule\b|driver board|motor driver|a4988|tmc2\d|amplifier|\bdac\b|\badc\b|\brtc\b|shield|breakout/],
  ["led", "LED og lys", /\bleds?\b|\blamps?\b|\blights?\b|bulb|\bneon\b|ws281|sk6812|lantern|flashlight|torch|spotlight/],
  ["cable", "Kabler og kontakter", /\bcables?\b|\bwires?\b|connector|\bjst\b|dupont|terminal|\bplugs?\b|\bsockets?\b|pin header|\bheaders?\b|heat shrink|\bcrimp|usb.?c\b|\bhdmi\b|ethernet|\bcords?\b|\bwago\b|banana plug|\bxt60|\bxt30|cable ties|zip ties|velcro|sleeving/],
  ["motor", "Motorer og mekanikk", /\bmotors?\b|stepper|\bservo|bearing|pulley|timing belt|\bgears?\b|linear rail|lead screw|\bshafts?\b|\bsprings?\b|coupling|v-slot|alumin(i)?um profile|extrusion|\bwheels?\b|caster|\bhinges?\b|slide rail/],
  ["fastener", "Festemidler", /\bscrews?\b|\bbolts?\b|\bnuts?\b|washers?|rivets?|standoffs?|\binserts?\b|threaded|\banchors?\b|\bnails?\b|fastener|spacers?|\bclips?\b|\bclamps?\b|\bhooks?\b|\bmagnets?\b(?!.*\b(sheets?|mats?)\b)/],
  ["craft", "Hobby og håndverk", /\bcraft|\bdiy\b|\bpaint|\bbrush|sticker|\bvinyl|decal|\bwood|plywood|basswood|\blaser\b|sewing|needle|\byarn|\bresin|\bmold|\bmould|epoxy|glitter|\bstamp|embroider|magnetic (sheet|mat)/],
  ["computer", "Data og mobil", /\bphones?\b|iphone|samsung|\bcase\b|screen protector|keyboard|\bmouse\b|headphone|earphone|earbuds|speaker|usb hub|sd card|memory card|\bssd\b|flash drive|laptop|tablet|smart ?watch|webcam|router/],
  ["outdoor", "Bil, sykkel og friluft", /\bcars?\b|vehicle|\bbike|bicycle|cycling|camping|\btents?\b|canopy|fishing|hiking|outdoor|garden|kayak|motorcycle|scooter|survival/],
  ["clothes", "Klær, skjønnhet og tilbehør", /\bshirts?\b|t-shirt|\bshoes?\b|\bsocks?\b|jacket|\bhats?\b|\bcaps?\b|\bgloves?\b|\bbags?\b|backpack|wallet|watch band|\bstraps?\b|glasses|sunglasses|jewelry|necklace|nail art|manicure|eyeshadow|cosmetic|makeup|pimple|\brings?\b/],
  ["other", "Annet", /$^/],
];
const CAT_NAME = Object.fromEntries(CATEGORIES.map(([id, name]) => [id, name]));

export function classify(title) {
  const t = ` ${String(title || "").toLowerCase()} `;
  return (CATEGORIES.find(([, , re]) => re.test(t)) || ["other"])[0];
}

// ---------- Hjelpere ----------

let ctx = null; // fra app.js: { $, esc, dbCall, token, userName, userColor, users, store, DEMO, setSync }
const pstate = {
  parts: [], loaded: false, loading: false, error: "",
  q: "", cat: "", owner: "", source: "", sort: "new", show: "have", view: "list",
  importLog: [], importBusy: false,
};

const clip = (s, n) => String(s ?? "").trim().slice(0, n);
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
// AliExpress sitt grå plassholderbilde (gamle ordre og varer som er fjernet har ikke bilde lenger).
const ALI_PLACEHOLDER = /Sf5a31ce867174aa7bf499352d6875ddcs/;
const safeImg = (u) => {
  u = String(u || "").trim();
  if (ALI_PLACEHOLDER.test(u)) return "";
  if (u.startsWith("//")) u = "https:" + u;
  return IMG_HOSTS.test(u) ? u.split(/[?#]/)[0] : "";
};
const safeUrl = (u) => {
  u = String(u || "").trim();
  if (u.startsWith("//")) u = "https:" + u;
  return /^https:\/\/([a-z0-9-]+\.)*(aliexpress\.(com|us|ru)|mouser\.[a-z.]+)\//.test(u) ? u.split(/[?#]/)[0] : "";
};

// «42,52kr x4», «US $13.27 x1», «€5.73» -> { amount, currency }
export function parsePrice(text) {
  const t = String(text || "").replace(/\s+/g, " ");
  const currency = /kr|nok/i.test(t) ? "NOK" : /€|eur/i.test(t) ? "EUR" : /\$|usd/i.test(t) ? "USD" : /£|gbp/i.test(t) ? "GBP" : "";
  const m = t.match(/(\d{1,3}(?:[ . ]\d{3})*(?:[.,]\d{1,2})|\d+(?:[.,]\d{1,2})?)/);
  if (!m) return { amount: null, currency };
  let s = m[1].replace(/[  ]/g, "");
  // Komma som desimaltegn (42,52) eller tusenskille (1.234,56)
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  return { amount: num(s), currency };
}

// Renser en post fra databasen eller importen før den vises.
function cleanPart(p) {
  if (!p || typeof p !== "object" || !p.id) return null;
  return {
    id: clip(p.id, 200), source: ["aliexpress", "mouser", "manual"].includes(p.source) ? p.source : "manual",
    owner: clip(p.owner, 40), title: clip(p.title, 300), variant: clip(p.variant, 200),
    qty: Math.max(0, Math.round(num(p.qty) ?? 1)), left: p.left === null || p.left === undefined ? null : Math.max(0, Math.round(num(p.left) ?? 0)),
    unitPrice: num(p.unitPrice), currency: clip(p.currency, 4), orderTotal: clip(p.orderTotal, 40),
    orderId: clip(p.orderId, 40), orderDate: /^\d{4}-\d{2}-\d{2}$/.test(p.orderDate || "") ? p.orderDate : "",
    status: clip(p.status, 60), store: clip(p.store, 100), itemId: clip(p.itemId, 30),
    url: safeUrl(p.url), storeUrl: safeUrl(p.storeUrl), image: safeImg(p.image),
    // Bildet er hentet fra en lignende vare (søk på tittelen), fordi originalen er fjernet hos AliExpress.
    imgSearch: !!p.imgSearch && !!safeImg(p.image),
    mpn: clip(p.mpn, 80), maker: clip(p.maker, 80), description: clip(p.description, 600),
    // Kategorien regnes ut på nytt med de nyeste reglene, med mindre den er satt for hånd.
    category: p.catManual && CAT_NAME[p.category] ? p.category : classify(p.title), catManual: !!p.catManual,
    location: clip(p.location, 80), note: clip(p.note, 400),
    added: clip(p.added, 30), updated: clip(p.updated, 30),
  };
}

const remaining = (p) => (p.left === null ? p.qty : p.left);
const fmtMoney = (p) => {
  if (p.unitPrice === null) return "";
  const v = p.unitPrice.toLocaleString("nb-NO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return { NOK: `${v} kr`, EUR: `€${v}`, USD: `$${v}`, GBP: `£${v}` }[p.currency] || v;
};
const fmtDate = (d) => (d ? new Date(d + "T12:00:00").toLocaleDateString("nb-NO", { day: "numeric", month: "short", year: "numeric" }) : "");

const SOURCE_LABEL = { aliexpress: "AliExpress", mouser: "Mouser", manual: "Lagt inn for hånd" };

// ---------- Lasting og lagring ----------

async function load(force = false) {
  if (ctx.DEMO) {
    if (!pstate.loaded) pstate.parts = demoParts();
    pstate.loaded = true;
    return render();
  }
  if (!ctx.token() || pstate.loading || (pstate.loaded && !force)) return;
  pstate.loading = true;
  pstate.error = "";
  render();
  try {
    const { parts } = await ctx.dbCall("/db/load", { files: ["parts"] });
    pstate.parts = (parts?.parts || []).map(cleanPart).filter(Boolean);
    pstate.loaded = true;
  } catch (err) {
    pstate.error = err.message;
  } finally {
    pstate.loading = false;
    render();
  }
}

// Lagrer endrede poster (null = slett), i porsjoner så hvert kall holder seg lite.
async function savePatch(ops, onProgress) {
  for (let i = 0; i < ops.length; i += PATCH_CHUNK) {
    await ctx.dbCall("/db/patch", { ops: ops.slice(i, i + PATCH_CHUNK).map((o) => ({ coll: "parts", id: o.id, data: o.data })) });
    onProgress?.(Math.min(ops.length, i + PATCH_CHUNK), ops.length);
  }
}

async function saveOne(p) {
  p.updated = new Date().toISOString();
  if (ctx.DEMO) return render();
  await savePatch([{ id: p.id, data: p }]);
  render();
}

// ---------- Import ----------

// Rader fra bokmerket -> poster. Eksisterende poster beholder det brukeren har endret
// (kategori satt for hånd, plassering, notat, antall igjen).
function mergeImport(rows, source) {
  const owner = ctx.userName();
  const byId = new Map(pstate.parts.map((p) => [p.id, p]));
  const now = new Date().toISOString();
  const changed = [], ids = new Set();
  let added = 0, updated = 0;
  for (const r of rows) {
    const id = source === "aliexpress"
      ? `ae:${clip(r.orderId, 30)}:${clip(r.itemId, 30) || clip(r.title, 40)}:${clip(r.variant, 60)}`
      : `mo:${clip(r.orderId, 30)}:${clip(r.mpn || r.title, 60)}`;
    ids.add(id);
    const price = r.priceText ? parsePrice(r.priceText) : { amount: r.unitPrice, currency: r.currency };
    const fresh = cleanPart({ ...r, unitPrice: price.amount, currency: price.currency || r.currency, id, source, owner, added: now, updated: now });
    if (!fresh) continue;
    const old = byId.get(id);
    if (old) {
      const keep = { category: old.catManual ? old.category : fresh.category, catManual: old.catManual, location: old.location, note: old.note, left: old.left, added: old.added, owner: old.owner };
      const next = { ...fresh, ...keep };
      if (JSON.stringify({ ...next, updated: "" }) === JSON.stringify({ ...old, updated: "" })) continue;
      Object.assign(old, next);
      changed.push(old);
      updated++;
    } else {
      pstate.parts.push(fresh);
      byId.set(id, fresh);
      changed.push(fresh);
      added++;
    }
  }
  return { changed, added, updated, ids };
}

// replaceOrders: ordrenumre der alle varene er lest på nytt (fra ordredetaljene). Egne poster
// fra disse ordrene som ikke finnes i de nye radene (plassholdere uten navn), slettes.
async function importRows(rows, source, label, replaceOrders = []) {
  if (!ctx.token() && !ctx.DEMO) throw new Error("Logg inn i Filament og elektronikk universet først.");
  if (!Array.isArray(rows) || !rows.length) throw new Error("Fant ingen varer i dataene.");
  pstate.importBusy = true;
  const log = (t) => { pstate.importLog.unshift(`${new Date().toLocaleTimeString("nb-NO")} ${t}`); pstate.importLog.length = Math.min(pstate.importLog.length, 30); render(); };
  try {
    const { changed, added, updated, ids } = mergeImport(rows, source);
    const replace = new Set(replaceOrders.map(String));
    const gone = pstate.parts.filter((p) => p.source === source && p.owner === ctx.userName() && replace.has(p.orderId) && !ids.has(p.id));
    pstate.parts = pstate.parts.filter((p) => !gone.includes(p));
    log(`${label}: ${rows.length} varer lest, ${added} nye, ${updated} oppdatert${gone.length ? `, ${gone.length} plassholdere fjernet` : ""}.`);
    const ops = changed.map((p) => ({ id: p.id, data: p })).concat(gone.map((p) => ({ id: p.id, data: null })));
    if (ops.length && !ctx.DEMO) {
      await savePatch(ops, (n, total) => log(`Lagret ${n} av ${total} i databasen…`));
      log(`Ferdig. ${ops.length} endringer lagret.`);
    }
    pstate.view = "list";
  } finally {
    pstate.importBusy = false;
    render();
  }
}

// Mottar data fra bokmerket (vinduet som åpnet denne siden).
function listenForImport() {
  window.addEventListener("message", async (e) => {
    const isAli = ALI_ORIGINS.test(e.origin), isMouser = MOUSER_ORIGINS.test(e.origin);
    if (!isAli && !isMouser) return;
    const msg = e.data;
    if (!msg || msg.type !== "bf-import" || !Array.isArray(msg.rows)) return;
    ctx.showSection?.("parts");
    pstate.view = "import";
    try {
      await importRows(msg.rows.slice(0, 20000), isAli ? "aliexpress" : "mouser", isAli ? "AliExpress" : "Mouser",
        Array.isArray(msg.replaceOrders) ? msg.replaceOrders.slice(0, 20000) : []);
      e.source?.postMessage({ type: "bf-imported", count: msg.rows.length }, e.origin);
    } catch (err) {
      pstate.importLog.unshift(`Feil: ${err.message}`);
      render();
      e.source?.postMessage({ type: "bf-import-error", error: err.message }, e.origin);
    }
  });
  // Si fra til bokmerket at siden er klar (den ble åpnet av ordresiden).
  if (window.opener && location.hash === "#import") {
    for (const origin of ["https://www.aliexpress.com", "https://aliexpress.com", "https://www.aliexpress.us", "https://www.mouser.com", "https://eu.mouser.com", "https://no.mouser.com"]) {
      try { window.opener.postMessage({ type: "bf-ready" }, origin); } catch { /* annet domene */ }
    }
  }
}

// ---------- Bokmerket ----------
//
// Kjører på ordresiden hos AliExpress (www.aliexpress.com/p/order/index.html). Laster inn alle
// ordrene med «View orders», leser hver vare og sender alt til Filament og elektronikk universet.
// Holdes uten avhengigheter, siden det kjøres som en javascript:-adresse.
function aliBookmarklet(SITE) {
  if (!/aliexpress\./.test(location.hostname)) { alert("Åpne ordresiden på AliExpress først (Konto → Ordrer), og trykk på bokmerket der."); return; }
  if (!/\/p\/order\//.test(location.pathname)) { location.href = "https://www.aliexpress.com/p/order/index.html"; return; }
  if (window.__bfRunning) return;
  window.__bfRunning = true;
  const win = window.open(SITE + "#import", "bf-import");
  const box = document.createElement("div");
  box.style.cssText = "position:fixed;z-index:2147483647;right:16px;bottom:16px;width:300px;padding:14px 16px;border-radius:12px;background:#141615;color:#e8ebe9;font:14px/1.45 system-ui,sans-serif;box-shadow:0 8px 30px #0006";
  box.innerHTML = '<b style="display:block;margin-bottom:4px">Filament og elektronikk universet</b><div id="bf-status">Starter…</div><button id="bf-send" style="margin-top:10px;padding:7px 12px;border:0;border-radius:8px;background:#1fc25b;color:#04140a;font-weight:700;cursor:pointer">Send det som er lastet nå</button>';
  document.body.appendChild(box);
  const status = (t) => { box.querySelector("#bf-status").textContent = t; };
  let stop = false, sent = false;
  box.querySelector("#bf-send").onclick = () => { stop = true; };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const text = (el, sel) => (el.querySelector(sel)?.innerText || "").trim();
  const months = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const isoDate = (s) => {
    const m = s.match(/([A-Za-z]{3})[a-z]*\.? (\d{1,2}), (\d{4})/);
    return m && months[m[1].toLowerCase()] ? `${m[3]}-${String(months[m[1].toLowerCase()]).padStart(2, "0")}-${m[2].padStart(2, "0")}` : "";
  };
  const read = () => {
    const rows = [];
    for (const o of document.querySelectorAll(".order-item")) {
      const head = text(o, ".order-item-header-right-info");
      const orderId = (head.match(/(\d{12,})/) || [])[1] || "";
      const orderDate = isoDate(head);
      const status = text(o, ".order-item-header-status-text");
      const storeA = o.querySelector(".order-item-store-name a, a.order-item-store-name, .order-item-store a");
      const store = text(o, ".order-item-store-name");
      const orderTotal = text(o, ".order-item-content-opt-price-total").replace(/^Total:\s*/i, "");
      for (const b of o.querySelectorAll(".order-item-content-body")) {
        const nameA = b.querySelector(".order-item-content-info-name a") || b.querySelector("a[href*='/item/']");
        const href = nameA?.getAttribute("href") || o.querySelector("a[href*='/item/']")?.getAttribute("href") || "";
        const itemId = (href.match(/item\/(\d+)/) || [])[1] || "";
        const img = b.querySelector(".order-item-content-img");
        const bg = (img?.style.backgroundImage || "").match(/url\("?([^")]+)"?\)/);
        const numText = text(b, ".order-item-content-info-number");
        const qty = Number((numText.match(/x\s*(\d+)/i) || [])[1] || 1);
        rows.push({
          orderId, orderDate, status, store, orderTotal,
          storeUrl: (storeA?.getAttribute("href") || "").split("?")[0],
          title: text(b, ".order-item-content-info-name"), variant: text(b, ".order-item-content-info-sku"),
          priceText: numText.replace(/x\s*\d+\s*$/i, "").trim(), qty, itemId,
          url: itemId ? `https://www.aliexpress.com/item/${itemId}.html` : "",
          image: ((bg && bg[1]) || img?.querySelector("img")?.src || "").split("?")[0].replace(/_\d+x\d+\.(jpg|png|webp)$/i, "").replace(/\.(jpg|png|webp)_.*$/i, ".$1"),
        });
      }
    }
    return rows;
  };
  // Ordre med flere produkter viser bare bilder i listen. Navn, antall, pris og variant
  // hentes fra ordredetaljene med AliExpress sin egen API-klient på siden (window.lib.mtop).
  const details = async (orderId) => {
    const r = await window.lib.mtop.request({ api: "mtop.aliexpress.trade.buyer.order.detail", v: "1.0", data: { tradeOrderId: orderId, clientPlatform: "pc", _lang: "en_US" }, type: "GET", dataType: "jsonp", needLogin: true });
    const blk = Object.values(r?.data?.data || {}).find((v) => v.fields?.productVOList);
    return (blk?.fields.productVOList || []).map((p) => ({
      title: p.itemTitle || "", itemId: String(p.productId || ""), qty: Number(p.quantity) || 1,
      priceText: p.itemPriceText || p.formatPriceInfo || "", variant: (p.skuAttrs || []).map((a) => a.text).filter(Boolean).join(", "),
      image: String(p.itemImgUrl || "").split("?")[0].replace(/_\d+x\d+\.(jpg|png|webp)$/i, ""),
      url: p.productId ? `https://www.aliexpress.com/item/${p.productId}.html` : "",
    }));
  };
  const send = async () => {
    if (sent) return;
    const rows = read();
    const multi = [...new Set(rows.filter((r) => !r.title && r.orderId).map((r) => r.orderId))];
    const replaceOrders = [];
    if (multi.length && window.lib?.mtop?.request) {
      for (const [i, id] of multi.entries()) {
        status(`Henter detaljer for ordre med flere varer: ${i + 1} av ${multi.length}…`);
        try {
          const items = await details(id);
          if (items.length) {
            const base = rows.find((r) => r.orderId === id);
            for (let k = rows.length - 1; k >= 0; k--) if (rows[k].orderId === id) rows.splice(k, 1);
            rows.push(...items.map((it) => ({ ...base, ...it })));
            replaceOrders.push(id);
          }
        } catch { /* hopper over ordren, plassholderen blir stående */ }
        await sleep(400 + Math.random() * 400);
      }
    }
    // Gamle varer som er fjernet fra AliExpress har bare en plassholder som bilde. Da søkes det
    // etter tittelen, og bildet fra det første treffet brukes (merket som lignende vare).
    const PH = /Sf5a31ce867174aa7bf499352d6875ddcs/;
    const noImg = rows.filter((r) => r.title && (!r.image || PH.test(r.image)));
    const found = {};
    for (const [i, r] of noImg.entries()) {
      const q = r.title.replace(/[^\w\s-]/g, " ").trim().split(/\s+/).slice(0, 8).join("-");
      if (!(q in found)) {
        status(`Søker etter bilder til varer som er fjernet: ${i + 1} av ${noImg.length}…`);
        try {
          const html = await (await fetch(`/w/wholesale-${encodeURIComponent(q)}.html`, { credentials: "include" })).text();
          found[q] = (html.match(/"imgUrl":"((?:https?:)?\/\/[^"]+\/kf\/[A-Za-z0-9_]+\.(?:jpg|jpeg|png|webp))/) || [])[1] || "";
        } catch { found[q] = ""; }
        await sleep(1500 + Math.random() * 1000);
      }
      if (found[q]) { r.image = found[q]; r.imgSearch = true; } else r.image = "";
    }
    status(`Sender ${rows.length} varer til Filament og elektronikk universet…`);
    win?.postMessage({ type: "bf-import", rows, replaceOrders }, new URL(SITE).origin);
  };
  window.addEventListener("message", (e) => {
    if (e.origin !== new URL(SITE).origin) return;
    if (e.data?.type === "bf-imported") { sent = true; status(`Ferdig: ${e.data.count} varer er sendt. Du kan lukke denne meldingen.`); }
    if (e.data?.type === "bf-import-error") status(`Feil: ${e.data.error}`);
  });
  (async () => {
    let idle = 0;
    while (!stop) {
      const btn = [...document.querySelectorAll("button")].find((b) => /^(View orders|Vis ordrer|Se flere ordrer|Load more)/i.test(b.textContent.trim()));
      const n = document.querySelectorAll(".order-item").length;
      const oldest = (text([...document.querySelectorAll(".order-item")].at(-1) || document.body, ".order-item-header-right-info").split("\n")[0] || "").replace(/^Date:\s*/, "");
      if (!btn) break;
      status(`${n} ordre lastet inn (eldste ${oldest}). Fortsetter…`);
      btn.click();
      let i = 0;
      for (; i < 60 && document.querySelectorAll(".order-item").length === n && !stop; i++) await sleep(250);
      if (document.querySelectorAll(".order-item").length === n) {
        idle++;
        status(`${n} ordre lastet inn. Venter – dukker det opp en robotsjekk, dra slideren, så fortsetter det.`);
        if (idle > 40) break;
        await sleep(3000);
      } else {
        idle = 0;
        await sleep(1000 + Math.random() * 800);
      }
    }
    status(`Alle ordrene er lastet inn. Sender…`);
    send();
  })();
}

export function bookmarkletHref() {
  return "javascript:" + encodeURIComponent(`(${aliBookmarklet.toString()})(${JSON.stringify(SITE)})`);
}

// ---------- Visning ----------

function filtered() {
  const q = pstate.q.trim().toLowerCase();
  const list = pstate.parts.filter((p) =>
    (!pstate.cat || p.category === pstate.cat) &&
    (!pstate.owner || p.owner === pstate.owner) &&
    (!pstate.source || p.source === pstate.source) &&
    (pstate.show === "all" || (pstate.show === "have" ? remaining(p) > 0 : remaining(p) === 0)) &&
    (!q || [p.title, p.variant, p.store, p.orderId, p.mpn, p.maker, p.location, p.note, CAT_NAME[p.category], p.owner].join(" ").toLowerCase().includes(q)));
  const by = {
    new: (a, b) => b.orderDate.localeCompare(a.orderDate) || a.title.localeCompare(b.title),
    old: (a, b) => a.orderDate.localeCompare(b.orderDate) || a.title.localeCompare(b.title),
    name: (a, b) => a.title.localeCompare(b.title, "nb"),
    price: (a, b) => (b.unitPrice ?? -1) - (a.unitPrice ?? -1),
    cat: (a, b) => CAT_NAME[a.category].localeCompare(CAT_NAME[b.category], "nb") || b.orderDate.localeCompare(a.orderDate),
  }[pstate.sort] || (() => 0);
  return list.sort(by);
}

const PAGE = 120;
let shown = PAGE;

function partCard(p) {
  const left = remaining(p);
  const qty = p.left === null || p.left === p.qty ? `${p.qty} stk` : `${left} av ${p.qty} igjen`;
  return `<button class="part-card${left === 0 ? " used-up" : ""}" type="button" data-part="${ctx.esc(p.id)}">
    <span class="part-img">${p.image ? `<img src="${ctx.esc(p.image)}_220x220.jpg" alt="" loading="lazy" referrerpolicy="no-referrer" data-full="${ctx.esc(p.image)}">` : `<span class="part-noimg">${ctx.esc(CAT_NAME[p.category])}</span>`}
      <span class="part-cat">${ctx.esc(CAT_NAME[p.category])}</span></span>
    <span class="part-body">
      <span class="part-title">${ctx.esc(p.title || "Uten navn")}</span>
      ${p.variant ? `<span class="part-variant">${ctx.esc(p.variant)}</span>` : ""}
      <span class="part-meta"><b>${ctx.esc(qty)}</b>${fmtMoney(p) ? ` · ${ctx.esc(fmtMoney(p))}/stk` : ""}</span>
      <span class="part-foot"><span class="owner-dot" style="--owner:${ctx.userColor(p.owner)}"></span>${ctx.esc(p.owner || "Ukjent")}<span class="part-date">${ctx.esc(fmtDate(p.orderDate))}</span></span>
    </span>
  </button>`;
}

function render() {
  const box = ctx.$("#parts-root");
  if (!box || box.hidden) return;
  if (pstate.view === "import") return renderImport(box);
  if (!ctx.token() && !ctx.DEMO) {
    box.innerHTML = `<section class="panel"><h2>Komponenter</h2><p class="hint">Logg inn for å se komponentbiblioteket.</p></section>`;
    return;
  }
  const all = pstate.parts;
  const list = filtered();
  const count = (key, val) => all.filter((p) => p[key] === val && (pstate.show === "all" || (pstate.show === "have" ? remaining(p) > 0 : remaining(p) === 0))).length;
  const owners = [...new Set(all.map((p) => p.owner).filter(Boolean))].sort();
  const cats = CATEGORIES.map(([id, name]) => [id, name, count("category", id)]).filter(([, , n]) => n);
  const chip = (key, val, label, n, dot) => `<button class="chip${pstate[key] === val ? " active" : ""}" type="button" data-pf="${key}" data-pv="${ctx.esc(val)}">${dot ? `<span class="owner-dot" style="--owner:${dot}"></span>` : ""}${ctx.esc(label)}${n !== undefined ? ` <span class="chip-n">${n}</span>` : ""}</button>`;
  const totalNok = all.filter((p) => p.currency === "NOK" && p.unitPrice !== null).reduce((s, p) => s + p.unitPrice * p.qty, 0);
  box.innerHTML = `
    <div class="parts-layout">
      <aside class="parts-rail">
        <div class="stats stats-side">
          <div class="stat"><b>${all.length.toLocaleString("nb-NO")}</b><span>varer totalt</span></div>
          <div class="stat"><b>${all.filter((p) => remaining(p) > 0).length.toLocaleString("nb-NO")}</b><span>har igjen</span></div>
          ${totalNok ? `<div class="stat"><b>${Math.round(totalNok / 1000).toLocaleString("nb-NO")}k</b><span>kr handlet (NOK-ordre)</span></div>` : ""}
        </div>
        <nav class="parts-cats" aria-label="Kategori"><span class="rail-label">Kategori</span><div class="chips">
          ${chip("cat", "", "Alle", undefined)}${cats.map(([id, name, n]) => chip("cat", id, name, n)).join("")}
        </div></nav>
      </aside>
      <div class="parts-main">
        <section class="panel filters">
          <div class="filter-row">
            <input id="parts-q" type="search" placeholder="Søk etter navn, variant, butikk, ordrenummer, plassering…" aria-label="Søk i komponenter" value="${ctx.esc(pstate.q)}">
            <select id="parts-show" aria-label="Vis">
              <option value="have"${pstate.show === "have" ? " selected" : ""}>Har igjen</option>
              <option value="used"${pstate.show === "used" ? " selected" : ""}>Brukt opp</option>
              <option value="all"${pstate.show === "all" ? " selected" : ""}>Alle</option>
            </select>
            <select id="parts-sort" aria-label="Sortering">
              ${[["new", "Nyeste først"], ["old", "Eldste først"], ["name", "Navn"], ["cat", "Kategori"], ["price", "Pris per stk"]].map(([v, l]) => `<option value="${v}"${pstate.sort === v ? " selected" : ""}>Sorter: ${l}</option>`).join("")}
            </select>
            <button class="btn" type="button" data-pview="import">Importer</button>
          </div>
          ${owners.length > 1 ? `<div class="chip-row"><span class="chip-label">Eier</span><div class="chips">${chip("owner", "", "Alle")}${owners.map((o) => chip("owner", o, o, undefined, ctx.userColor(o))).join("")}</div></div>` : ""}
          <div class="chip-row"><span class="chip-label">Butikk</span><div class="chips">${chip("source", "", "Alle")}${["aliexpress", "mouser", "manual"].filter((s) => all.some((p) => p.source === s)).map((s) => chip("source", s, SOURCE_LABEL[s])).join("")}</div></div>
        </section>
        ${pstate.loading ? `<p class="count">Henter komponenter…</p>` : pstate.error ? `<p class="notice">${ctx.esc(pstate.error)}</p>` : ""}
        ${!pstate.loading && !all.length ? `<section class="panel empty-parts"><h2>Ingen komponenter ennå</h2><p class="hint">Importer det du har kjøpt hos AliExpress eller Mouser, så havner alt her, sortert i kategorier.</p><button class="btn btn-primary" type="button" data-pview="import">Importer</button></section>` : ""}
        ${all.length ? `<p class="count">${list.length.toLocaleString("nb-NO")} varer${list.length > shown ? `, viser ${shown}` : ""}</p>` : ""}
        <section class="parts-grid">${list.slice(0, shown).map(partCard).join("")}</section>
        ${list.length > shown ? `<button class="btn parts-more" type="button" data-pmore>Vis flere (${(list.length - shown).toLocaleString("nb-NO")} til)</button>` : ""}
      </div>
    </div>`;
}

function renderImport(box) {
  const signedIn = !!ctx.token();
  box.innerHTML = `
    <section class="panel import-panel">
      <div class="import-head"><h2>Importer komponenter</h2><button class="btn" type="button" data-pview="list">Tilbake til komponentene</button></div>
      ${signedIn ? "" : `<p class="notice">Logg inn i Filament og elektronikk universet først, så havner varene på deg.</p>`}
      <h3>AliExpress</h3>
      <ol class="import-steps">
        <li>Dra knappen under til bokmerkelinjen i nettleseren (vis linjen med Ctrl+Shift+B).<br>
          <a class="btn btn-primary bookmarklet" href="${ctx.esc(bookmarkletHref())}" title="Dra meg til bokmerkelinjen">Importer til Filament og elektronikk universet</a></li>
        <li>Logg inn på <a href="https://www.aliexpress.com/p/order/index.html" target="_blank" rel="noopener">AliExpress → Ordrer</a> med din egen konto.</li>
        <li>Trykk på bokmerket. Det laster inn alle ordrene, åpner denne siden og sender varene hit. Med mange ordre tar det noen minutter. Dukker det opp en robotsjekk, drar du slideren, så fortsetter det.</li>
      </ol>
      <p class="hint">Passordet ditt blir hos AliExpress. Bokmerket leser bare ordrelisten i din egen nettleser. Varer som er importert før, blir oppdatert, og det du har endret selv (kategori, plassering, notat, antall igjen) beholdes.</p>
      <h3>Mouser</h3>
      <p class="hint">Gå til <a href="https://www.mouser.com/OrderHistory/" target="_blank" rel="noopener">Mouser → Order History</a>, last ned ordrene som CSV eller Excel-tekst (Export), og lim inn innholdet her. Første linje må være overskriftene.</p>
      <textarea id="mouser-paste" rows="6" placeholder="Lim inn CSV fra Mouser her"></textarea>
      <p><button class="btn btn-primary" type="button" data-pimport="mouser" ${pstate.importBusy ? "disabled" : ""}>Importer fra Mouser</button></p>
      <h3>Logg</h3>
      <ul class="import-log">${pstate.importLog.length ? pstate.importLog.map((l) => `<li>${ctx.esc(l)}</li>`).join("") : `<li class="hint">Ingen import ennå.</li>`}</ul>
    </section>`;
}

// ---------- Mouser (CSV fra Order History) ----------

function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", q = false;
  const sep = (text.split("\n")[0].match(/\t/g) || []).length > (text.split("\n")[0].match(/,/g) || []).length ? "\t" : (text.split("\n")[0].match(/;/g) || []).length > (text.split("\n")[0].match(/,/g) || []).length ? ";" : ",";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c;
    } else if (c === '"') q = true;
    else if (c === sep) { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (c !== "\r") cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}

export function mouserRows(text) {
  const [head, ...data] = parseCsv(text);
  if (!head) return [];
  const h = head.map((x) => x.trim().toLowerCase());
  const col = (...names) => h.findIndex((x) => names.some((n) => x.includes(n)));
  const c = {
    order: col("sales order", "order number", "web order", "order #", "order no"),
    date: col("order date", "date"),
    mpn: col("mfr. #", "mfr #", "manufacturer part", "mfr part", "mfr. part"),
    mouser: col("mouser #", "mouser part", "mouser no"),
    maker: col("manufacturer", "mfr."),
    desc: col("description", "desc"),
    qty: col("quantity", "qty", "order qty"),
    price: col("unit price", "price"),
    status: col("status"),
  };
  return data.map((r) => {
    const get = (i) => (i >= 0 ? String(r[i] || "").trim() : "");
    const d = new Date(get(c.date));
    const pr = parsePrice(get(c.price));
    const mpn = get(c.mpn) || get(c.mouser);
    return {
      orderId: get(c.order), orderDate: isNaN(d) ? "" : d.toISOString().slice(0, 10), status: get(c.status),
      title: [get(c.maker) && get(c.maker) !== get(c.mpn) ? get(c.maker) : "", mpn, get(c.desc) ? `– ${get(c.desc)}` : ""].filter(Boolean).join(" "),
      mpn, maker: get(c.maker), description: get(c.desc), qty: Number(get(c.qty).replace(/[^\d]/g, "")) || 1,
      unitPrice: pr.amount, currency: pr.currency || "NOK", store: "Mouser",
      url: get(c.mouser) ? `https://www.mouser.com/ProductDetail/${encodeURIComponent(get(c.mouser))}` : "",
    };
  }).filter((r) => r.mpn || r.title);
}

// ---------- Detaljvindu ----------

function openPart(id) {
  const p = pstate.parts.find((x) => x.id === id);
  if (!p) return;
  let dlg = ctx.$("#part-dialog");
  if (!dlg) {
    dlg = document.createElement("dialog");
    dlg.id = "part-dialog";
    dlg.className = "wide-dialog part-dialog";
    document.body.appendChild(dlg);
  }
  const mine = ctx.DEMO || p.owner === ctx.userName() || !p.owner;
  const row = (k, v) => (v ? `<tr><th>${ctx.esc(k)}</th><td>${v}</td></tr>` : "");
  dlg.innerHTML = `<form method="dialog" class="part-detail">
    <div class="part-detail-img">${p.image ? `<img src="${ctx.esc(p.image)}" alt="" referrerpolicy="no-referrer">` : `<span class="part-noimg">${ctx.esc(CAT_NAME[p.category])}</span>`}</div>
    <div class="part-detail-text">
      <h2>${ctx.esc(p.title)}</h2>
      ${p.variant ? `<p class="part-variant">${ctx.esc(p.variant)}</p>` : ""}
      <table class="part-facts">
        ${row("Eier", `<span class="owner-dot" style="--owner:${ctx.userColor(p.owner)}"></span> ${ctx.esc(p.owner || "Ukjent")}`)}
        ${row("Kjøpt", `${ctx.esc(p.qty)} stk${fmtMoney(p) ? ` à ${ctx.esc(fmtMoney(p))}` : ""}${p.orderTotal ? ` · ordre totalt ${ctx.esc(p.orderTotal)}` : ""}`)}
        ${row("Dato", ctx.esc(fmtDate(p.orderDate)))}
        ${row("Butikk", `${ctx.esc(SOURCE_LABEL[p.source])}${p.store && p.store !== "Mouser" ? ` · ${p.storeUrl ? `<a href="${ctx.esc(p.storeUrl)}" target="_blank" rel="noopener">${ctx.esc(p.store)}</a>` : ctx.esc(p.store)}` : ""}`)}
        ${row("Ordrenummer", ctx.esc(p.orderId))}
        ${row("Status", ctx.esc(p.status))}
        ${row("Produsent", ctx.esc(p.maker))}
        ${row("Delenummer", ctx.esc(p.mpn))}
        ${row("Beskrivelse", ctx.esc(p.description))}
        ${row("Produktside", p.url ? `<a href="${ctx.esc(p.url)}" target="_blank" rel="noopener">Åpne hos ${ctx.esc(SOURCE_LABEL[p.source])} ↗</a>` : "")}
        ${row("Bilde", p.imgSearch ? "Fra en lignende vare. Originalen er fjernet hos AliExpress." : "")}
      </table>
      <div class="part-edit">
        <label>Kategori<select id="pd-cat" ${mine ? "" : "disabled"}>${CATEGORIES.map(([cid, name]) => `<option value="${cid}"${cid === p.category ? " selected" : ""}>${ctx.esc(name)}</option>`).join("")}</select></label>
        <label>Antall igjen<input id="pd-left" type="number" min="0" max="100000" value="${remaining(p)}" ${mine ? "" : "disabled"}></label>
        <label>Plassering<input id="pd-loc" type="text" maxlength="80" value="${ctx.esc(p.location)}" placeholder="F.eks. Skuff 3, verkstedet" ${mine ? "" : "disabled"}></label>
        <label class="pd-note">Notat<textarea id="pd-note" rows="2" maxlength="400" ${mine ? "" : "disabled"}>${ctx.esc(p.note)}</textarea></label>
      </div>
      ${mine ? "" : `<p class="hint">Bare ${ctx.esc(p.owner)} kan endre denne varen.</p>`}
      <div class="part-actions">
        ${mine ? `<button class="btn btn-primary" value="save" type="submit">Lagre</button>` : ""}
        <button class="btn" value="cancel" type="submit">Lukk</button>
      </div>
    </div>
  </form>`;
  dlg.onclose = async () => {
    if (dlg.returnValue !== "save" || !mine) return;
    const cat = dlg.querySelector("#pd-cat").value;
    if (cat !== p.category) { p.category = cat; p.catManual = true; }
    const left = Math.max(0, Math.round(Number(dlg.querySelector("#pd-left").value) || 0));
    p.left = left === p.qty ? null : left;
    p.location = clip(dlg.querySelector("#pd-loc").value, 80);
    p.note = clip(dlg.querySelector("#pd-note").value, 400);
    try { await saveOne(p); ctx.setSync("Lagret"); } catch (err) { ctx.setSync(err.message, true); }
  };
  dlg.returnValue = "";
  dlg.showModal();
}

// ---------- Oppsett ----------

export function initParts(context) {
  ctx = context;
  listenForImport();
  const root = ctx.$("#parts-root");
  root.addEventListener("click", async (e) => {
    const t = e.target.closest("[data-pf], [data-part], [data-pview], [data-pmore], [data-pimport]");
    if (!t) return;
    if (t.dataset.pf) {
      pstate[t.dataset.pf] = pstate[t.dataset.pf] === t.dataset.pv ? "" : t.dataset.pv;
      shown = PAGE;
      render();
    } else if (t.dataset.part) openPart(t.dataset.part);
    else if (t.dataset.pview) { pstate.view = t.dataset.pview; render(); }
    else if (t.hasAttribute("data-pmore")) { shown += PAGE * 2; render(); }
    else if (t.dataset.pimport === "mouser") {
      try {
        const rows = mouserRows(ctx.$("#mouser-paste").value);
        if (!rows.length) throw new Error("Fant ingen varer. Sjekk at første linje er overskriftene fra Mouser.");
        await importRows(rows, "mouser", "Mouser");
      } catch (err) {
        pstate.importLog.unshift(`Feil: ${err.message}`);
        render();
      }
    }
  });
  root.addEventListener("click", (e) => {
    if (e.target.closest("a.bookmarklet")) e.preventDefault();
  });
  root.addEventListener("input", (e) => {
    if (e.target.id === "parts-q") {
      pstate.q = e.target.value;
      shown = PAGE;
      const pos = e.target.selectionStart;
      render();
      const q = ctx.$("#parts-q");
      q.focus();
      q.setSelectionRange(pos, pos);
    }
  });
  root.addEventListener("change", (e) => {
    if (e.target.id === "parts-sort") { pstate.sort = e.target.value; render(); }
    if (e.target.id === "parts-show") { pstate.show = e.target.value; shown = PAGE; render(); }
  });
  // Bilder som ikke finnes i liten størrelse: prøv originalen, ellers kategorinavnet.
  root.addEventListener("error", (e) => {
    const img = e.target;
    if (img.tagName !== "IMG") return;
    if (img.dataset.full && img.src !== img.dataset.full) { img.src = img.dataset.full; img.dataset.full = ""; }
    else img.replaceWith(Object.assign(document.createElement("span"), { className: "part-noimg", textContent: "Mangler bilde" }));
  }, true);
}

export function showParts() {
  if (location.hash === "#import") pstate.view = "import";
  render();
  load();
}

export const refreshParts = () => load(true);

// ---------- Demo ----------

function demoParts() {
  const rows = [
    ["ESP32 DevKit V1 WROOM-32 Development Board", "Type-C", 3, 52.3, "2026-09-02"],
    ["RC522 RFID Reader Module 13.56MHz with Cards", "", 2, 18.9, "2026-08-21"],
    ["0.96 inch OLED Display Module SSD1306 I2C 128x64", "White", 5, 21.4, "2026-08-21"],
    ["100PCS Felt Pads Furniture Chair Leg Floor Protector", "25mm round", 1, 64.1, "2026-07-11"],
    ["M3 Brass Threaded Heat Set Inserts 100pcs", "M3x5x4", 2, 39.9, "2026-06-30"],
    ["Hardened Steel Nozzle for Bambu Lab X1 P1", "0.4mm", 2, 89.0, "2026-05-14"],
    ["Mini Precision Screwdriver Set 25 in 1", "", 1, 112.5, "2026-03-03"],
    ["18650 Battery Charger Module TP4056 USB-C", "", 10, 4.2, "2026-02-17"],
  ];
  return rows.map(([title, variant, qty, price, date], i) => cleanPart({
    id: `demo:${i}`, source: "aliexpress", owner: ["Philippe", "Niklas", "Peter"][i % 3], title, variant, qty,
    unitPrice: price, currency: "NOK", orderDate: date, store: "Demo Store", orderId: `80${i}123456789`,
  }));
}
