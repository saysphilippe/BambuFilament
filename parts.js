// Komponentbiblioteket: alt vi har kjøpt hos AliExpress og Mouser (og lagt inn for hånd),
// i samme database som filamentet (samlingen «parts», se worker/src/records.js).
//
// Import fra AliExpress: brukeren drar et bokmerke til bokmerkelinjen og trykker på det på
// ordresiden hos AliExpress. Skriptet laster inn alle ordrene, leser dem fra siden og sender
// dem hit med postMessage (siden åpnes i et nytt vindu). Ingen passord forlater nettleseren.

import { CATEGORIES, CAT_NAME, classify } from "./categories.js?v=20261009201410";
import { componentHtml, findPart } from "./circuits.js?v=20261009201410";
import { detectPack } from "./pack.js?v=20261009201410";
import { findPackage, packageSvg, packageInfo } from "./packages.js?v=20261009201410";

const SITE = "https://saysphilippe.github.io/BambuFilament/";
const ALI_ORIGINS = /^https:\/\/([a-z]+\.)?aliexpress\.(com|us|ru)$/;
const MOUSER_ORIGINS = /^https:\/\/([a-z]+\.)?mouser\.[a-z.]+$/;
const LCSC_ORIGINS = /^https:\/\/(www\.)?lcsc\.com$/;
const IMG_HOSTS = /^https:\/\/([a-z0-9-]+\.)*(alicdn\.com|aliexpress-media\.com|mouser\.com|lcsc\.com)\//;
const PATCH_CHUNK = 400;

// ---------- Kategorier ----------
//
// Kategoriene og den automatiske klassifiseringen ligger i categories.js (poeng per nøkkelord,
// tidlige ord teller mest). Butikkens egen kategori (Mouser, LCSC) går foran når den finnes,
// og en kategori satt for hånd går foran alt.
export { CATEGORIES, classify };
// Kategorier der datablad og koblingsskjema er aktuelt.
const ELECTRONICS = new Set(["mcu", "display", "sensor", "wireless", "module", "semi", "passive", "switch", "led", "power", "audio", "connector"]);

// Butikkens kategoristi (Mouser, LCSC) -> vår kategori.
export function mouserCategory(crumbs) {
  const c = crumbs.join(" › ").toLowerCase();
  if (/display|lcd|oled/.test(c)) return "display";
  if (/sensor/.test(c)) return "sensor";
  if (/rf |rf\/|wireless|antenna|bluetooth|wifi/.test(c)) return "wireless";
  if (/embedded|development boards|microcontroller|mcu|engineering tools/.test(c)) return "mcu";
  if (/driver ics?|motor driver/.test(c)) return "semi";
  if (/buzzer|speaker|microphone/.test(c)) return "audio";
  if (/vibration motor/.test(c)) return "motor";
  if (/audio/.test(c)) return "audio";
  if (/led|optoelectronic|lighting/.test(c)) return /optocoupler|photo/.test(c) ? "semi" : "led";
  if (/switch|button|encoder|potentiometer knob/.test(c)) return "switch";
  if (/connector|terminal|header|socket/.test(c)) return "connector";
  if (/wire|cable/.test(c)) return "cable";
  if (/battery|batteries|power supplies|charger/.test(c)) return "power";
  if (/motor|fan|actuator|solenoid/.test(c)) return "motor";
  if (/relay/.test(c)) return "module";
  if (/tool|supplies|solder/.test(c)) return "tool";
  if (/hardware|fastener|standoff|screw/.test(c)) return "fastener";
  if (/resistor|capacitor|inductor|choke|ferrite|crystal|oscillator|resonator|circuit protection|fuse|varistor|potentiometer|passive/.test(c)) return "passive";
  if (/semiconductor|diode|transistor|mosfet|thyristor|discrete|integrated circuit|ics?\b|power management|pmic|regulator|amplifier|logic|interface|memory|data acquisition|driver ic|motor driver/.test(c)) return "semi";
  return "";
}

// ---------- Hjelpere ----------

let ctx = null; // fra app.js: { $, esc, dbCall, token, userName, userColor, users, store, DEMO, setSync }
const pstate = {
  parts: [], loaded: false, loading: false, error: "",
  reqs: [], prefs: {},
  q: "", cat: "", owner: "", source: "", pkg: "", sort: "new", show: "have", view: "list",
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
    id: clip(p.id, 200), source: ["aliexpress", "mouser", "lcsc", "manual"].includes(p.source) ? p.source : "manual",
    owner: clip(p.owner, 40), title: clip(p.title, 300), variant: clip(p.variant, 200),
    qty: Math.max(0, Math.round(num(p.qty) ?? 1)),
    // Stk per kjøpt enhet («12pcs»). Mouser og LCSC oppgir stk direkte. Kan rettes for hånd.
    pack: p.packManual && num(p.pack) >= 1 ? Math.round(num(p.pack)) : p.source === "mouser" || p.source === "lcsc" ? 1 : detectPack(p.variant, p.title),
    packManual: !!p.packManual,
    left: p.left === null || p.left === undefined ? null : Math.max(0, Math.round(num(p.left) ?? 0)),
    unitPrice: num(p.unitPrice), currency: clip(p.currency, 4), orderTotal: clip(p.orderTotal, 40),
    orderId: clip(p.orderId, 40), orderDate: /^\d{4}-\d{2}-\d{2}$/.test(p.orderDate || "") ? p.orderDate : "",
    status: clip(p.status, 60), store: clip(p.store, 100), itemId: clip(p.itemId, 30),
    url: safeUrl(p.url), storeUrl: safeUrl(p.storeUrl), image: safeImg(p.image),
    // Bildet er hentet fra en lignende vare (søk på tittelen), fordi originalen er fjernet hos AliExpress.
    imgSearch: !!p.imgSearch && !!safeImg(p.image),
    // Bildet er satt eller fjernet for hånd; automatiske bildesøk rører det ikke.
    imgManual: !!p.imgManual,
    // Pakketype (TO-92, SOT-23, 0805 …) fra tittel, variant og delenummer, ellers fra kjente delenumre.
    // Butikkens egen pakkeangivelse (LCSC) går foran det vi finner i teksten.
    pkgFixed: clip(p.pkgFixed, 30),
    pkg: findPackage(p.pkgFixed) || clip(p.pkgFixed, 30) || findPackage(p.variant, p.title, p.mpn, p.description) || String(findPart(p.title, p.mpn)?.pkg || "").split("/")[0],
    // Datablad (PDF) og butikkens egen kategori (Mouser: «Sensors › Humidity Sensors»).
    datasheet: /^https:\/\/(([a-z0-9-]+\.)*mouser\.[a-z.]+\/.+\.pdf|datasheet\.lcsc\.com\/[^\s"'<>]+)$/i.test(String(p.datasheet || "")) ? String(p.datasheet) : "",
    // Regnes ut på nytt fra butikkens kategoritekst, så nye kategorier (f.eks. Halvledere) slår inn.
    shopCat: clip(p.shopCat, 160), catHint: (p.shopCat && mouserCategory(String(p.shopCat).split(" › "))) || (CAT_NAME[p.catHint] ? p.catHint : ""),
    mpn: clip(p.mpn, 80), maker: clip(p.maker, 80), description: clip(p.description, 600),
    // Kategorien regnes ut på nytt med de nyeste reglene, med mindre den er satt for hånd.
    category: p.catManual && CAT_NAME[p.category] ? p.category : CAT_NAME[p.catHint] ? p.catHint : classify(p.title, [p.variant, p.shopCat].filter(Boolean).join(" ")), catManual: !!p.catManual,
    location: clip(p.location, 80), note: clip(p.note, 400),
    added: clip(p.added, 30), updated: clip(p.updated, 30),
  };
}

// Antall stk: kjøpt antall × stk per pakke. «Igjen» regnes også i stk.
const units = (p) => p.qty * (p.pack || 1);
const remaining = (p) => (p.left === null ? units(p) : p.left);
const fmtMoney = (p) => {
  if (p.unitPrice === null) return "";
  const v = p.unitPrice.toLocaleString("nb-NO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return { NOK: `${v} kr`, EUR: `€${v}`, USD: `$${v}`, GBP: `£${v}` }[p.currency] || v;
};
const fmtDate = (d) => (d ? new Date(d + "T12:00:00").toLocaleDateString("nb-NO", { day: "numeric", month: "short", year: "numeric" }) : "");

// Omtrentlige kurser for å vise samlet beløp i kroner (summen per valuta står i verktøytipset).
const FX_NOK = { NOK: 1, EUR: 11.6, USD: 10.6, GBP: 13.6 };

const SOURCE_LABEL = { aliexpress: "AliExpress", mouser: "Mouser", lcsc: "LCSC", manual: "Lagt inn for hånd" };

// ---------- Lasting og lagring ----------

async function load(force = false) {
  if (ctx.DEMO) {
    if (!pstate.loaded) { pstate.parts = demoParts(); pstate.reqs = demoReqs(); }
    pstate.loaded = true;
    return render();
  }
  if (!ctx.token()) return;
  // Pågående lasting: gi samme løfte, så importen kan vente på den.
  if (pstate.loading) return pstate.loading;
  if (pstate.loaded && !force) return;
  pstate.loading = loadNow();
  return pstate.loading;
}

async function loadNow() {
  pstate.error = "";
  render();
  try {
    const { parts } = await ctx.dbCall("/db/load", { files: ["parts"] });
    pstate.parts = (parts?.parts || []).map(cleanPart).filter(Boolean);
    pstate.reqs = (parts?.requests || []).map(cleanReq).filter(Boolean);
    pstate.prefs = Object.fromEntries(Object.entries(parts?.prefs || {})
      .filter(([o, v]) => o && v && Array.isArray(v.hidden)).map(([o, v]) => [String(o).slice(0, 40), { hidden: v.hidden.map(String).slice(0, 40) }]));
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
    await ctx.dbCall("/db/patch", { ops: ops.slice(i, i + PATCH_CHUNK).map((o) => ({ coll: o.coll || "parts", id: o.id, data: o.data })) });
    onProgress?.(Math.min(ops.length, i + PATCH_CHUNK), ops.length);
  }
}

async function saveOne(p) {
  p.updated = new Date().toISOString();
  if (ctx.DEMO) return render();
  await savePatch([{ id: p.id, data: p }]);
  render();
}

// ---------- Handlekurv ----------
//
// Noen trenger en vare fra en annens lager: den legges i handlekurven (utkast), sendes som
// ønske til eieren, og eieren ser den under «Ønsket fra meg» med plassering, så den er lett å
// finne fram. Når eieren trykker «Sendt», trekkes antallet fra det eieren har igjen.

const REQ_STATUS = { draft: "I handlekurven", open: "Venter på eier", sent: "Sendt", declined: "Kan ikke", received: "Mottatt" };

function cleanReq(q) {
  if (!q || typeof q !== "object" || !q.id) return null;
  return {
    id: clip(q.id, 60), partId: clip(q.partId, 200), owner: clip(q.owner, 40), by: clip(q.by, 40),
    qty: Math.max(1, Math.min(100000, Math.round(num(q.qty) ?? 1))), note: clip(q.note, 200), reply: clip(q.reply, 200),
    status: REQ_STATUS[q.status] ? q.status : "draft",
    at: clip(q.at, 30), sentAt: clip(q.sentAt, 30), updated: clip(q.updated, 30),
  };
}

const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

async function saveReqs(list, parts = []) {
  const now = new Date().toISOString();
  for (const x of [...list, ...parts]) x.updated = now;
  if (ctx.DEMO) return render();
  await savePatch(list.map((q) => ({ coll: "partreqs", id: q.id, data: q })).concat(parts.map((p) => ({ id: p.id, data: p }))));
  render();
}

async function removeReq(q) {
  pstate.reqs = pstate.reqs.filter((x) => x !== q);
  if (!ctx.DEMO) await savePatch([{ coll: "partreqs", id: q.id, data: null }]);
  render();
}

async function addToCart(part, qty, note) {
  const me = ctx.userName() || (ctx.DEMO ? "Philippe" : "");
  if (!me) throw new Error("Logg inn først.");
  const old = pstate.reqs.find((q) => q.partId === part.id && q.by === me && q.status === "draft");
  if (old) {
    old.qty += qty;
    if (note) old.note = clip(note, 200);
    return saveReqs([old]);
  }
  const q = cleanReq({ id: newId(), partId: part.id, owner: part.owner, by: me, qty, note, status: "draft", at: new Date().toISOString() });
  pstate.reqs.push(q);
  return saveReqs([q]);
}

const meName = () => ctx.userName() || (ctx.DEMO ? "Philippe" : "");
const cartDrafts = () => pstate.reqs.filter((q) => q.by === meName() && q.status === "draft");
const askedOfMe = () => pstate.reqs.filter((q) => q.owner === meName() && q.status === "open");

// Komponenter-knappen øverst viser hvor mange ønsker som venter på deg.
function updateBadge() {
  const b = document.querySelector('.section-btn[data-section="parts"]');
  if (!b) return;
  const n = askedOfMe().length;
  b.innerHTML = `Komponenter${n ? ` <span class="nav-n alert" title="${n} ønsker venter på deg">${n}</span>` : ""}`;
}

function subnav() {
  const n = cartDrafts().length, m = askedOfMe().length;
  const b = (view, label) => `<button type="button" class="parts-tab${pstate.view === view ? " active" : ""}" data-pview="${view}">${label}</button>`;
  return `<nav class="parts-nav" aria-label="Komponenter">
    ${b("list", "Alle komponenter")}
    ${b("cart", `Handlekurv${n ? ` <span class="nav-n">${n}</span>` : ""}`)}
    ${b("requests", `Ønsket fra meg${m ? ` <span class="nav-n alert">${m}</span>` : ""}`)}
    ${b("import", "Importer")}
  </nav>`;
}

function reqRow(q, mode) {
  const p = pstate.parts.find((x) => x.id === q.partId);
  const img = p?.image ? `<img src="${ctx.esc(/alicdn|aliexpress-media/.test(p.image) ? `${p.image}_220x220.jpg` : p.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<span class="part-noimg">${ctx.esc(p ? CAT_NAME[p.category] : "Slettet")}</span>`;
  const who = mode === "cart" ? q.owner : q.by;
  const left = p ? remaining(p) : 0;
  const act = (a, label, primary = false) => `<button type="button" class="btn btn-small${primary ? " btn-primary" : ""}" data-reqact="${a}" data-req="${ctx.esc(q.id)}">${label}</button>`;
  let actions = "";
  if (mode === "cart") {
    if (q.status === "draft") actions = act("remove", "Fjern");
    else if (q.status === "open") actions = act("withdraw", "Trekk tilbake");
    else if (q.status === "sent") actions = act("receive", "Mottatt", true);
    else actions = act("remove", "Fjern");
  } else if (q.status === "open") {
    actions = act("decline", "Kan ikke") + act("send", "Sendt", true);
  }
  return `<li class="req-row status-${q.status}">
    <button type="button" class="req-img" data-part="${ctx.esc(q.partId)}" ${p ? "" : "disabled"}>${img}</button>
    <div class="req-text">
      <b>${ctx.esc(p?.title || "Varen er slettet")}</b>
      ${p?.variant ? `<span class="hint">${ctx.esc(p.variant)}</span>` : ""}
      <span class="req-meta">
        ${mode === "requests" ? `<span class="req-loc${p?.location ? "" : " missing"}">${ctx.esc(p?.location ? `Ligger: ${p.location}` : "Ingen plassering registrert")}</span>` : ""}
        <span><span class="owner-dot" style="--owner:${ctx.userColor(who)}"></span>${mode === "cart" ? "Eier" : "Ønsket av"}: ${ctx.esc(who || "Ukjent")}</span>
        ${p ? `<span>${left} igjen</span>` : ""}
        ${p?.pkg ? `<span>${ctx.esc(p.pkg)}</span>` : ""}
      </span>
      ${q.note ? `<span class="req-note">«${ctx.esc(q.note)}»</span>` : ""}
    </div>
    <div class="req-qty">${mode === "cart" && q.status === "draft"
      ? `<label>Antall<input type="number" min="1" max="${Math.max(1, left)}" value="${q.qty}" data-reqqty="${ctx.esc(q.id)}"></label>`
      : `<b>${q.qty} stk</b>`}
      <span class="req-status">${ctx.esc(REQ_STATUS[q.status])}${q.sentAt && q.status === "sent" ? ` ${ctx.esc(fmtDate(q.sentAt.slice(0, 10)))}` : ""}</span>
    </div>
    <div class="req-actions">${actions}</div>
  </li>`;
}

function groupBy(list, key) {
  const g = new Map();
  for (const x of list) (g.get(x[key]) || g.set(x[key], []).get(x[key])).push(x);
  return [...g.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]), "nb"));
}

function renderCart(box) {
  const me = meName();
  const mine = pstate.reqs.filter((q) => q.by === me && q.status !== "received").sort((a, b) => b.at.localeCompare(a.at));
  const drafts = mine.filter((q) => q.status === "draft");
  box.innerHTML = subnav() + `<section class="panel req-panel">
    <h2>Handlekurv</h2>
    <p class="hint">Legg varer du trenger i handlekurven fra detaljvinduet til en komponent. Når du sender, får eieren dem under «Ønsket fra meg» og kan finne dem fram og sende dem til deg.</p>
    ${mine.length ? groupBy(mine, "owner").map(([owner, list]) => `<h3><span class="owner-dot" style="--owner:${ctx.userColor(owner)}"></span> Fra ${ctx.esc(owner || "ukjent eier")}</h3><ul class="req-list">${list.map((q) => reqRow(q, "cart")).join("")}</ul>`).join("")
      : `<p class="empty-msg">Handlekurven er tom. Åpne en komponent og trykk «Legg i handlekurv».</p>`}
    ${drafts.length ? `<div class="req-send"><span class="hint">${drafts.length} ${drafts.length === 1 ? "vare" : "varer"} er ikke sendt ennå.</span><button type="button" class="btn btn-primary" data-sendcart>Send ønskene til eierne</button></div>` : ""}
  </section>`;
}

function renderRequests(box) {
  const me = meName();
  const recent = Date.now() - 14 * 864e5;
  const list = pstate.reqs.filter((q) => q.owner === me && (q.status === "open" || ((q.status === "sent" || q.status === "declined") && new Date(q.updated || q.at).getTime() > recent)));
  const open = list.filter((q) => q.status === "open");
  box.innerHTML = subnav() + `<section class="panel req-panel">
    <h2>Ønsket fra meg</h2>
    <p class="hint">Varer fra ditt lager som andre trenger. Finn dem fram (plasseringen står på hver linje), send dem, og trykk «Sendt». Da trekkes antallet fra det du har igjen.</p>
    ${open.length ? groupBy(open, "by").map(([by, l]) => `<h3><span class="owner-dot" style="--owner:${ctx.userColor(by)}"></span> Til ${ctx.esc(by)}</h3><ul class="req-list">${l.map((q) => reqRow(q, "requests")).join("")}</ul>`).join("")
      : `<p class="empty-msg">Ingen venter på noe fra deg akkurat nå.</p>`}
    ${list.length > open.length ? `<h3>Siste 14 dager</h3><ul class="req-list done">${list.filter((q) => q.status !== "open").map((q) => reqRow(q, "requests")).join("")}</ul>` : ""}
  </section>`;
}

async function reqAction(action, id) {
  const q = pstate.reqs.find((x) => x.id === id);
  if (!q) return;
  if (action === "remove") return removeReq(q);
  if (action === "withdraw") return removeReq(q);
  if (action === "receive") { q.status = "received"; return saveReqs([q]); }
  if (action === "decline") { q.status = "declined"; return saveReqs([q]); }
  if (action === "send") {
    q.status = "sent";
    q.sentAt = new Date().toISOString();
    const p = pstate.parts.find((x) => x.id === q.partId);
    if (p) {
      const left = Math.max(0, remaining(p) - q.qty);
      p.left = left === units(p) ? null : left;
      return saveReqs([q], [p]);
    }
    return saveReqs([q]);
  }
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
  const seen = {};
  for (const r of rows) {
    const base = source === "aliexpress"
      ? `ae:${clip(r.orderId, 30)}:${clip(r.itemId, 30) || clip(r.title, 40)}:${clip(r.variant, 60)}`
      : `${source === "lcsc" ? "lc" : "mo"}:${clip(r.orderId, 30)}:${clip(r.mpn || r.title, 60)}`;
    // Samme vare flere ganger i samme ordre (f.eks. ulike varianter som ikke oppgis for gamle
    // ordre): egen linje nummer 2, 3, … i den rekkefølgen butikken viser dem.
    seen[base] = (seen[base] || 0) + 1;
    const id = seen[base] > 1 ? `${base}#${seen[base]}` : base;
    ids.add(id);
    const price = r.priceText ? parsePrice(r.priceText) : { amount: r.unitPrice, currency: r.currency };
    const catHint = r.catHint || (r.shopCat ? mouserCategory(String(r.shopCat).split(" › ")) : "");
    const fresh = cleanPart({ ...r, catHint, unitPrice: price.amount, currency: price.currency || r.currency, id, source, owner, added: now, updated: now });
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
  // Vent til det som alt ligger i databasen er lastet. Ellers ser ikke importen eksisterende
  // varer, og plassering, notat og antall igjen kunne blitt skrevet over.
  if (!ctx.DEMO) await load();
  if (!ctx.DEMO && !pstate.loaded) throw new Error("Kunne ikke hente komponentene fra databasen. Prøv igjen.");
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
    const isAli = ALI_ORIGINS.test(e.origin), isMouser = MOUSER_ORIGINS.test(e.origin), isLcsc = LCSC_ORIGINS.test(e.origin);
    if (!isAli && !isMouser && !isLcsc) return;
    const msg = e.data;
    // AliExpress-fanen spør hvilke av mine varer som trenger nytt bilde (bilde fra søk eller ingen).
    if (msg?.type === "bf-list-noimg" && isAli) {
      await load();
      const items = pstate.parts.filter((p) => p.source === "aliexpress" && p.owner === ctx.userName() && !p.imgManual && (p.imgSearch || !p.image))
        .map((p) => ({ id: p.id, t: p.title }));
      e.source?.postMessage({ type: "bf-noimg", items }, e.origin);
      return;
    }
    // Nye bilder for gitte varer: [{ id, image }] (tom image = fjern bildet). Bare egne varer endres.
    if (msg?.type === "bf-images" && Array.isArray(msg.images)) {
      try {
        await load();
        const byId = new Map(pstate.parts.map((p) => [p.id, p]));
        const changed = [];
        for (const { id, image } of msg.images.slice(0, 20000)) {
          const p = byId.get(String(id));
          if (!p || p.owner !== ctx.userName() || p.imgManual) continue;
          const img = safeImg(image);
          if (img === p.image) continue;
          p.image = img; p.imgSearch = !!img; p.updated = new Date().toISOString();
          changed.push(p);
        }
        if (changed.length && !ctx.DEMO) await savePatch(changed.map((p) => ({ id: p.id, data: p })));
        render();
        e.source?.postMessage({ type: "bf-imported", count: changed.length }, e.origin);
      } catch (err) {
        e.source?.postMessage({ type: "bf-import-error", error: err.message }, e.origin);
      }
      return;
    }
    // Bare ordretotaler (f.eks. Invoice Total fra Mouser, inkl. frakt og mva): { ordrenummer: "kr 1 341,25" }.
    if (msg?.type === "bf-ordertotals" && msg.totals && typeof msg.totals === "object") {
      const source = isAli ? "aliexpress" : isLcsc ? "lcsc" : "mouser";
      try {
        await load();
        const changed = pstate.parts.filter((p) => p.source === source && p.owner === ctx.userName() && typeof msg.totals[p.orderId] === "string" && p.orderTotal !== clip(msg.totals[p.orderId], 40));
        for (const p of changed) { p.orderTotal = clip(msg.totals[p.orderId], 40); p.updated = new Date().toISOString(); }
        if (changed.length && !ctx.DEMO) await savePatch(changed.map((p) => ({ id: p.id, data: p })));
        pstate.importLog.unshift(`${new Date().toLocaleTimeString("nb-NO")} Ordretotaler: ${Object.keys(msg.totals).length} ordre, ${changed.length} varer oppdatert.`);
        render();
        e.source?.postMessage({ type: "bf-imported", count: changed.length }, e.origin);
      } catch (err) {
        e.source?.postMessage({ type: "bf-import-error", error: err.message }, e.origin);
      }
      return;
    }
    if (!msg || msg.type !== "bf-import" || !Array.isArray(msg.rows)) return;
    ctx.showSection?.("parts");
    pstate.view = "import";
    try {
      await importRows(msg.rows.slice(0, 20000), isAli ? "aliexpress" : isLcsc ? "lcsc" : "mouser", isAli ? "AliExpress" : isLcsc ? "LCSC" : "Mouser",
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
    for (const origin of ["https://www.aliexpress.com", "https://aliexpress.com", "https://www.aliexpress.us", "https://www.mouser.com", "https://eu.mouser.com", "https://no.mouser.com", "https://www.lcsc.com"]) {
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
  // Søkeord: de første meningsbærende ordene (uten «1pc», «10PCS/lot» og rene tall).
  const words = (t) => String(t).toLowerCase().replace(/[^\w\s.-]/g, " ").split(/\s+/)
    .filter((w) => w.length > 1 && !/^\d+(pcs?|pc|x|set|lot|pieces?)?$/.test(w) && !/^(pcs|lot|set|new|for|and|with|the|of|in|to|original|high|quality|free|shipping)$/.test(w));
  const searchQuery = (t) => words(t).slice(0, 7).join("-");
  // Velger hovedbildet til treffet med mest lik tittel (andel felles ord).
  const bestImage = (html, title) => {
    const mine = new Set(words(title).slice(0, 14));
    const starts = [...html.matchAll(/"productId":"?(\d{10,})/g)].map((m) => m.index);
    let best = "", top = 0;
    starts.forEach((s, k) => {
      const seg = html.slice(s, starts[k + 1] || s + 8000);
      const img = (seg.match(/"imgUrl":"((?:https?:)?\/\/[^"]+\/kf\/[A-Za-z0-9_]+\.(?:jpg|jpeg|png|webp))/) || [])[1];
      const t = (seg.match(/"displayTitle":"([^"]+)/) || [])[1];
      if (!img || !t) return;
      const theirs = new Set(words(t));
      const score = [...mine].filter((w) => theirs.has(w)).length / Math.max(4, mine.size);
      if (score > top) { top = score; best = img; }
    });
    return top >= 0.35 ? best : "";
  };
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
    // etter tittelen, og bildet fra treffet med mest lik tittel brukes (merket som lignende vare).
    // Ligner ingen treff nok, blir det ikke noe bilde – heller ingen enn feil.
    const PH = /Sf5a31ce867174aa7bf499352d6875ddcs/;
    const noImg = rows.filter((r) => r.title && (!r.image || PH.test(r.image)));
    const found = {};
    for (const [i, r] of noImg.entries()) {
      const q = searchQuery(r.title);
      if (!(q in found)) {
        status(`Søker etter bilder til varer som er fjernet: ${i + 1} av ${noImg.length}…`);
        try {
          const html = await (await fetch(`/w/wholesale-${encodeURIComponent(q)}.html`, { credentials: "include" })).text();
          found[q] = bestImage(html, r.title);
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

// Kategorier hver eier har skjult (Innstillinger, lagret i databasen): eierens varer i de
// kategoriene vises ikke for noen. Andres varer i samme kategori vises som vanlig.
const hiddenFor = (owner) => new Set((pstate.prefs[owner]?.hidden || []).filter((c) => CAT_NAME[c]));
const visibleParts = () => {
  const hidden = Object.fromEntries(Object.keys(pstate.prefs).map((o) => [o, hiddenFor(o)]));
  return Object.values(hidden).some((h) => h.size) ? pstate.parts.filter((p) => !hidden[p.owner]?.has(p.category)) : pstate.parts;
};

function filtered() {
  const q = pstate.q.trim().toLowerCase();
  const list = visibleParts().filter((p) =>
    (!pstate.cat || p.category === pstate.cat) &&
    (!pstate.owner || p.owner === pstate.owner) &&
    (!pstate.source || p.source === pstate.source) &&
    (!pstate.pkg || p.pkg === pstate.pkg) &&
    (pstate.show === "all" || (pstate.show === "have" ? remaining(p) > 0 : remaining(p) === 0)) &&
    (!q || [p.title, p.variant, p.store, p.orderId, p.mpn, p.maker, p.location, p.note, p.pkg, CAT_NAME[p.category], p.owner].join(" ").toLowerCase().includes(q)));
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
  const total = units(p);
  const bought = p.pack > 1 ? `${p.qty} × ${p.pack} = ${total} stk` : `${total} stk`;
  const qty = p.left === null || p.left === total ? bought : `${left} av ${total} stk igjen`;
  return `<div class="part-card${left === 0 ? " used-up" : ""}">
  <button class="part-open" type="button" data-part="${ctx.esc(p.id)}">
    <span class="part-img">${p.image ? `<img src="${ctx.esc(/alicdn|aliexpress-media/.test(p.image) ? `${p.image}_220x220.jpg` : p.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-full="${ctx.esc(p.image)}">` : `<span class="part-noimg">${ctx.esc(CAT_NAME[p.category])}</span>`}
      <span class="part-cat">${ctx.esc(CAT_NAME[p.category])}</span></span>
    <span class="part-body">
      <span class="part-title">${ctx.esc(p.title || "Uten navn")}</span>
      ${p.variant ? `<span class="part-variant">${ctx.esc(p.variant)}</span>` : ""}
      <span class="part-meta"><b>${ctx.esc(qty)}</b>${fmtMoney(p) ? ` · ${ctx.esc(fmtMoney(p))}/stk` : ""}</span>
      ${p.pkg ? `<span class="part-pkg" title="${ctx.esc(packageInfo(p.pkg))}">${packageSvg(p.pkg, 22)}${ctx.esc(p.pkg)}</span>` : ""}
      <span class="part-foot"><span class="owner-dot" style="--owner:${ctx.userColor(p.owner)}"></span>${ctx.esc(p.owner || "Ukjent")}<span class="part-date">${ctx.esc(fmtDate(p.orderDate))}</span></span>
    </span>
  </button>
  ${ctx.token() || ctx.DEMO ? stepper(p) : ""}
  </div>`;
}

// − / antall / + under hvert kort: legg varer i handlekurven uten å åpne detaljvinduet.
const cartQty = (id) => cartDrafts().filter((q) => q.partId === id).reduce((s, q) => s + q.qty, 0);
function stepper(p) {
  const n = cartQty(p.id), id = ctx.esc(p.id), max = remaining(p);
  return `<div class="part-step${n ? " in-cart" : ""}" data-step="${id}">
    <button type="button" data-cartstep="-1" data-pid="${id}" ${n ? "" : "disabled"} aria-label="Ta én ut av handlekurven">−</button>
    <span>${n ? `${n} i handlekurven` : "Handlekurv"}</span>
    <button type="button" data-cartstep="1" data-pid="${id}" ${max && n >= max ? "disabled" : ""} aria-label="Legg én i handlekurven">+</button>
  </div>`;
}

async function cartStep(pid, delta) {
  const p = pstate.parts.find((x) => x.id === pid);
  if (!p) return;
  const q = cartDrafts().find((x) => x.partId === pid);
  if (delta > 0) {
    if (q) { q.qty += 1; await saveReqs([q]); } else await addToCart(p, 1, "");
  } else if (q) {
    if (q.qty > 1) { q.qty -= 1; await saveReqs([q]); } else await removeReq(q);
  }
}

function render() {
  updateBadge();
  const box = ctx.$("#parts-root");
  if (!box || box.hidden) return;
  if (pstate.view === "import") return renderImport(box);
  if (pstate.view === "cart" && (ctx.token() || ctx.DEMO)) return renderCart(box);
  if (pstate.view === "requests" && (ctx.token() || ctx.DEMO)) return renderRequests(box);
  if (!ctx.token() && !ctx.DEMO) {
    box.innerHTML = `<section class="panel"><h2>Komponenter</h2><p class="hint">Logg inn for å se komponentbiblioteket.</p></section>`;
    return;
  }
  const all = visibleParts();
  if (pstate.cat && !all.some((p) => p.category === pstate.cat)) pstate.cat = "";
  const list = filtered();
  const count = (key, val) => all.filter((p) => p[key] === val && (pstate.show === "all" || (pstate.show === "have" ? remaining(p) > 0 : remaining(p) === 0))).length;
  const owners = [...new Set(all.map((p) => p.owner).filter(Boolean))].sort();
  const pkgCount = {};
  for (const p of all) if (p.pkg) pkgCount[p.pkg] = (pkgCount[p.pkg] || 0) + 1;
  const pkgs = Object.entries(pkgCount).sort((a, b) => b[1] - a[1]).slice(0, 18);
  const cats = CATEGORIES.map(([id, name]) => [id, name, count("category", id)]).filter(([, , n]) => n);
  const chip = (key, val, label, n, dot) => `<button class="chip${pstate[key] === val ? " active" : ""}" type="button" data-pf="${key}" data-pv="${ctx.esc(val)}">${dot ? `<span class="owner-dot" style="--owner:${dot}"></span>` : ""}${ctx.esc(label)}${n !== undefined ? ` <span class="chip-n">${n}</span>` : ""}</button>`;
  // Betalt: ordretotalen (inkl. frakt og avgifter) telles én gang per ordre, i alle valutaer.
  // Ordre uten total (Mouser, lagt inn for hånd) teller stykkpris × antall.
  // Gamle AliExpress-ordre (2018–2019) har ingen total hos AliExpress lenger; der telles bare varene.
  const spent = {};
  const seenOrders = new Set(), noTotal = new Set(), allOrders = new Set();
  for (const p of all.filter((x) => !pstate.owner || x.owner === pstate.owner)) {
    const key = `${p.source}:${p.orderId}`;
    if (p.orderId) allOrders.add(key);
    if (!p.orderTotal && p.orderId) noTotal.add(key);
    if (p.orderTotal && p.orderId) {
      if (seenOrders.has(key)) continue;
      seenOrders.add(key);
      const t = parsePrice(p.orderTotal);
      if (t.amount !== null) spent[t.currency || p.currency || "NOK"] = (spent[t.currency || p.currency || "NOK"] || 0) + t.amount;
    } else if (p.unitPrice !== null) spent[p.currency || "NOK"] = (spent[p.currency || "NOK"] || 0) + p.unitPrice * p.qty;
  }
  const totalNok = Object.entries(spent).reduce((s, [c, v]) => s + v * (FX_NOK[c] || 1), 0);
  const spentTip = Object.entries(spent).sort((a, b) => b[1] - a[1]).map(([c, v]) => `${Math.round(v).toLocaleString("nb-NO")} ${c}`).join(" + ");
  box.innerHTML = subnav() + `
    <div class="parts-layout">
      <aside class="parts-rail">
        <div class="stats stats-side">
          <div class="stat"><b>${all.length.toLocaleString("nb-NO")}</b><span>varer totalt</span></div>
          <div class="stat"><b>${all.filter((p) => remaining(p) > 0).length.toLocaleString("nb-NO")}</b><span>har igjen</span></div>
          ${totalNok ? `<div class="stat" title="${ctx.esc(`${spentTip}. Omregnet til kroner med omtrentlig kurs.${noTotal.size ? ` For ${noTotal.size} ordre finnes ikke totalen lenger hos butikken (gamle AliExpress-ordre), så der er bare varene med, uten frakt.` : ""}`)}"><b>${Math.round(totalNok / 1000).toLocaleString("nb-NO")}k</b><span>kr betalt, ca. (${allOrders.size.toLocaleString("nb-NO")} ordre${noTotal.size ? `, frakt mangler for ${noTotal.size}` : ", inkl. frakt"})</span></div>` : ""}
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
          </div>
          ${owners.length ? `<div class="chip-row"><span class="chip-label">Eier</span><div class="chips">${chip("owner", "", "Alle")}${owners.map((o) => chip("owner", o, o, count("owner", o), ctx.userColor(o))).join("")}</div></div>` : ""}
          <div class="chip-row"><span class="chip-label">Butikk</span><div class="chips">${chip("source", "", "Alle")}${["aliexpress", "mouser", "lcsc", "manual"].filter((s) => all.some((p) => p.source === s)).map((s) => chip("source", s, SOURCE_LABEL[s])).join("")}</div></div>
          ${pkgs.length ? `<div class="chip-row"><span class="chip-label">Pakke</span><div class="chips">${chip("pkg", "", "Alle")}${pkgs.map(([k, n]) => chip("pkg", k, k, n)).join("")}</div></div>` : ""}
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
  box.innerHTML = subnav() + `
    <section class="panel import-panel">
      <div class="import-head"><h2>Importer komponenter</h2></div>
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
  dlg.innerHTML = `<button type="button" class="dlg-close" aria-label="Lukk" title="Lukk (Esc)">×</button>
  <form method="dialog" class="part-detail">
    <div class="part-detail-side">
      <div class="part-detail-img">${p.image ? `<img src="${ctx.esc(p.image)}" alt="" referrerpolicy="no-referrer">` : `<span class="part-noimg">${ctx.esc(CAT_NAME[p.category])}</span>`}</div>
      ${ELECTRONICS.has(p.category) || p.source === "mouser" || p.source === "lcsc" ? componentHtml(p) : ""}
    </div>
    <div class="part-detail-text">
      <h2>${ctx.esc(p.title)}</h2>
      ${p.variant ? `<p class="part-variant">${ctx.esc(p.variant)}</p>` : ""}
      <table class="part-facts">
        ${row("Eier", `<span class="owner-dot" style="--owner:${ctx.userColor(p.owner)}"></span> ${ctx.esc(p.owner || "Ukjent")}`)}
        ${row("Kjøpt", `${p.pack > 1 ? `${ctx.esc(p.qty)} × ${ctx.esc(p.pack)} stk = <b>${units(p)} stk</b>` : `<b>${units(p)} stk</b>`}${fmtMoney(p) ? ` à ${ctx.esc(fmtMoney(p))}${p.pack > 1 ? ` (${ctx.esc(fmtMoney({ ...p, unitPrice: p.unitPrice / p.pack }))} per stk)` : ""}` : ""}${p.orderTotal ? ` · ordre totalt ${ctx.esc(p.orderTotal)}` : ""}`)}
        ${row("Dato", ctx.esc(fmtDate(p.orderDate)))}
        ${row("Butikk", `${ctx.esc(SOURCE_LABEL[p.source])}${p.store && p.store !== "Mouser" ? ` · ${p.storeUrl ? `<a href="${ctx.esc(p.storeUrl)}" target="_blank" rel="noopener">${ctx.esc(p.store)}</a>` : ctx.esc(p.store)}` : ""}`)}
        ${row("Ordrenummer", ctx.esc(p.orderId))}
        ${row("Status", ctx.esc(p.status))}
        ${row("Produsent", ctx.esc(p.maker))}
        ${row("Delenummer", ctx.esc(p.mpn))}
        ${row("Pakke", p.pkg ? `<span class="pkg-row">${packageSvg(p.pkg, 64)}<span><b>${ctx.esc(p.pkg)}</b><br><span class="hint">${ctx.esc(packageInfo(p.pkg))}</span></span></span>` : "")}
        ${row("Beskrivelse", ctx.esc(p.description))}
        ${row("Produktside", p.url ? `<a href="${ctx.esc(p.url)}" target="_blank" rel="noopener">Åpne hos ${ctx.esc(SOURCE_LABEL[p.source])} ↗</a>` : "")}
        ${row("Bilde", p.imgSearch ? "Fra en lignende vare. Originalen er fjernet hos AliExpress." : "")}
        ${row("Kategori hos butikken", ctx.esc(p.shopCat))}
        ${row("Datablad", p.datasheet ? `<a href="${ctx.esc(p.datasheet)}" target="_blank" rel="noopener">Åpne PDF ↗</a>` : "")}
      </table>
      <div class="part-edit">
        <label>Kategori<select id="pd-cat" ${mine ? "" : "disabled"}>${CATEGORIES.map(([cid, name]) => `<option value="${cid}"${cid === p.category ? " selected" : ""}>${ctx.esc(name)}</option>`).join("")}</select></label>
        <label>Stk per pakke<input id="pd-pack" type="number" min="1" max="100000" value="${p.pack}" ${mine ? "" : "disabled"}></label>
        <label>Antall igjen (stk)<input id="pd-left" type="number" min="0" max="10000000" value="${remaining(p)}" ${mine ? "" : "disabled"}></label>
        <label>Plassering<input id="pd-loc" type="text" maxlength="80" value="${ctx.esc(p.location)}" placeholder="F.eks. Skuff 3, verkstedet" ${mine ? "" : "disabled"}></label>
        <label class="pd-note">Notat<textarea id="pd-note" rows="2" maxlength="400" ${mine ? "" : "disabled"}>${ctx.esc(p.note)}</textarea></label>
        <label class="pd-note">Bilde (lenke fra AliExpress, LCSC eller Mouser; tom = ingen bilde)<input id="pd-img" type="url" maxlength="400" value="${ctx.esc(p.image)}" placeholder="https://ae-pic-a1.aliexpress-media.com/kf/….jpg" ${mine ? "" : "disabled"}></label>
      </div>
      ${mine ? "" : `<p class="hint">Bare ${ctx.esc(p.owner)} kan endre denne varen.</p>`}
      ${ctx.token() || ctx.DEMO ? `<div class="cart-add">
        <label>Antall<input id="pd-cartqty" type="number" min="1" max="${Math.max(1, remaining(p))}" value="1"></label>
        <label class="grow">Hva skal det brukes til? (valgfritt)<input id="pd-cartnote" type="text" maxlength="200" placeholder="F.eks. reservedel til leseren"></label>
        <button type="button" class="btn" data-addcart>${p.owner && p.owner !== meName() ? `Legg i handlekurv (fra ${ctx.esc(p.owner)})` : "Legg i handlekurv"}</button>
      </div>
      <p class="hint cart-msg" role="status">${(() => { const n = pstate.reqs.filter((q) => q.partId === p.id && ["draft", "open"].includes(q.status)).reduce((s, q) => s + q.qty, 0); return n ? `${n} stk av denne er i en handlekurv eller ønsket.` : ""; })()}</p>` : ""}
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
    const pack = Math.max(1, Math.round(Number(dlg.querySelector("#pd-pack").value) || 1));
    if (pack !== p.pack) { p.pack = pack; p.packManual = true; }
    const left = Math.max(0, Math.round(Number(dlg.querySelector("#pd-left").value) || 0));
    p.left = left === units(p) ? null : left;
    p.location = clip(dlg.querySelector("#pd-loc").value, 80);
    p.note = clip(dlg.querySelector("#pd-note").value, 400);
    const imgIn = dlg.querySelector("#pd-img").value.trim();
    if (imgIn !== p.image) {
      const img = safeImg(imgIn.replace(/_\d+x\d+\.(jpg|png|webp)$/i, ""));
      if (imgIn && !img) { ctx.setSync("Bildelenken må være fra AliExpress, LCSC eller Mouser.", true); }
      else { p.image = img; p.imgSearch = false; p.imgManual = true; }
    }
    try { await saveOne(p); ctx.setSync("Lagret"); } catch (err) { ctx.setSync(err.message, true); }
  };
  dlg.onclick = async (e) => {
    if (e.target.closest(".dlg-close")) { dlg.close(""); return; }
    if (!e.target.closest("[data-addcart]")) return;
    const qty = Math.max(1, Math.round(Number(dlg.querySelector("#pd-cartqty").value) || 1));
    const msg = dlg.querySelector(".cart-msg");
    try {
      await addToCart(p, qty, dlg.querySelector("#pd-cartnote").value);
      msg.textContent = `${qty} stk lagt i handlekurven. Send ønskene fra fanen Handlekurv.`;
    } catch (err) {
      msg.textContent = err.message;
    }
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
    const t = e.target.closest("[data-pf], [data-part], [data-pview], [data-pmore], [data-pimport], [data-reqact], [data-sendcart], [data-cartstep]");
    if (!t) return;
    if (t.dataset.cartstep) {
      try { await cartStep(t.dataset.pid, Number(t.dataset.cartstep)); } catch (err) { ctx.setSync(err.message, true); }
    } else if (t.dataset.reqact) {
      t.disabled = true;
      try { await reqAction(t.dataset.reqact, t.dataset.req); } catch (err) { ctx.setSync(err.message, true); t.disabled = false; }
    } else if (t.hasAttribute("data-sendcart")) {
      const drafts = cartDrafts();
      for (const q of drafts) { q.status = "open"; q.at = new Date().toISOString(); }
      try { await saveReqs(drafts); ctx.setSync(`${drafts.length} ønsker sendt`); } catch (err) { ctx.setSync(err.message, true); }
    } else if (t.dataset.pf) {
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
    if (e.target.dataset.reqqty) {
      const q = pstate.reqs.find((x) => x.id === e.target.dataset.reqqty);
      if (q) { q.qty = Math.max(1, Math.round(Number(e.target.value) || 1)); saveReqs([q]).catch((err) => ctx.setSync(err.message, true)); }
    }
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

// Under Innstillinger: én blokk per bruker som har lest inn varer. Hver eier velger hvilke av
// sine kategorier som vises for alle; administrator kan endre for alle.
export function partsSettingsHtml() {
  const me = meName();
  const owners = [...new Set(pstate.parts.map((p) => p.owner).filter(Boolean))]
    .sort((a, b) => (a === me ? -1 : b === me ? 1 : a.localeCompare(b, "nb")));
  const intro = `<h3>Komponenter: kategorier som vises</h3>
    <p class="hint">Hver bruker velger hvilke av sine egne kategorier som vises i komponentbiblioteket. Skjulte kategorier forsvinner fra listen, filtrene og tellingen for alle. Valget lagres i databasen.</p>`;
  if (!pstate.loaded) return intro + `<p class="hint">Henter komponentene…</p>`;
  if (!owners.length) return intro + `<p class="hint">Ingen har lest inn komponenter ennå.</p>`;
  return intro + owners.map((owner) => {
    const hidden = hiddenFor(owner);
    const canEdit = ctx.DEMO || owner === me || ctx.isAdmin?.();
    const mine = pstate.parts.filter((p) => p.owner === owner);
    const cats = CATEGORIES.map(([id, name]) => [id, name, mine.filter((p) => p.category === id).length]).filter(([, , n]) => n);
    return `<div class="cat-owner">
      <h4><span class="owner-dot" style="--owner:${ctx.userColor(owner)}"></span> ${ctx.esc(owner)} <span class="hint">${mine.length.toLocaleString("nb-NO")} varer${hidden.size ? `, ${hidden.size} ${hidden.size === 1 ? "kategori" : "kategorier"} skjult` : ""}${canEdit ? "" : " · bare " + ctx.esc(owner) + " kan endre"}</span></h4>
      <div class="cat-toggles">${cats.map(([id, name, n]) => `<label class="cat-toggle"><input type="checkbox" data-showcat="${id}" data-owner="${ctx.esc(owner)}"${hidden.has(id) ? "" : " checked"}${canEdit ? "" : " disabled"}> ${ctx.esc(name)} <span class="chip-n">${n}</span></label>`).join("")}</div>
    </div>`;
  }).join("");
}

export async function setCategoryShown(owner, id, shown) {
  if (!owner || !CAT_NAME[id]) return;
  const hidden = hiddenFor(owner);
  if (shown) hidden.delete(id); else hidden.add(id);
  const pref = { hidden: [...hidden], updated: new Date().toISOString(), by: meName() };
  pstate.prefs[owner] = pref;
  render();
  if (!ctx.DEMO) await savePatch([{ coll: "partprefs", id: owner, data: pref }]);
}

// Antallene i Innstillinger trenger komponentene; hent dem i bakgrunnen.
// Gir et løfte bare når noe faktisk må hentes, så kalleren ikke tegner på nytt i en løkke.
export const loadParts = () => (pstate.loaded ? null : load());

// ---------- Demo ----------

function demoReqs() {
  const at = new Date(Date.now() - 36e5).toISOString();
  return [
    { id: "demo-r1", partId: "demo:0", owner: "Philippe", by: "Niklas", qty: 1, note: "Til leseren i garasjen", status: "open", at },
    { id: "demo-r2", partId: "demo:3", owner: "Philippe", by: "Peter", qty: 10, note: "", status: "open", at },
    { id: "demo-r3", partId: "demo:1", owner: "Niklas", by: "Philippe", qty: 1, note: "Ekstra RFID-leser", status: "draft", at },
  ].map(cleanReq);
}

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
    ["100PCS 2N2222 NPN Transistor TO-92 2N2222A", "", 1, 19.5, "2026-01-20"],
    ["10PCS IRLZ44N Logic Level N-Channel MOSFET TO-220", "", 1, 48.0, "2026-01-20"],
    ["20PCS NE555 Timer IC DIP-8", "", 1, 22.0, "2025-12-02"],
    ["AMS1117-3.3 Voltage Regulator SOT-223 50pcs", "", 1, 18.0, "2025-11-11"],
    ["GY-BME280 Temperature Humidity Pressure Sensor Module I2C", "3.3V", 2, 39.0, "2025-10-05"],
  ];
  return rows.map(([title, variant, qty, price, date], i) => cleanPart({
    id: `demo:${i}`, source: "aliexpress", owner: ["Philippe", "Niklas", "Peter"][i % 3], title, variant, qty,
    unitPrice: price, currency: "NOK", orderDate: date, store: "Demo Store", orderId: `80${i}123456789`,
  }));
}
