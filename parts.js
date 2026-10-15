// Komponentbiblioteket: alt vi har kjøpt hos AliExpress og Mouser (og lagt inn for hånd),
// i samme database som filamentet (samlingen «parts», se worker/src/records.js).
//
// Import fra AliExpress: brukeren drar et bokmerke til bokmerkelinjen og trykker på det på
// ordresiden hos AliExpress. Skriptet laster inn alle ordrene, leser dem fra siden og sender
// dem hit med postMessage (siden åpnes i et nytt vindu). Ingen passord forlater nettleseren.

import { CATEGORIES, CAT_NAME, classify } from "./categories.js?v=20261009202254";
import { componentHtml, findPart, semiType, SEMI_TYPES, datasheetLinks } from "./circuits.js?v=20261009202254";
import { detectPack } from "./pack.js?v=20261009202254";
import { inventory } from "./worker/src/records.js?v=20261009202254";
import { footprintSvg, footprintCaption, kicadName } from "./footprints.js?v=20261009202254";
import { findPackage, packageSvg, packageInfo } from "./packages.js?v=20261009202254";

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
const ELECTRONICS = new Set(["mcu", "display", "sensor", "wireless", "module", "semi", "passive", "switch", "led", "power", "audio", "connector", "motor"]);

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
  parts: [], deleted: new Set(), loaded: false, loading: false, error: "",
  reqs: [], prefs: {},
  q: "", cat: "", sub: "", owner: "", source: "", pkg: "", imgf: "", editCats: false, projects: [], project: "", projShow: "mine", bomPreview: null, bomText: "", sort: "new", show: "have", view: "list",
  importLog: [], importBusy: false,
};

const clip = (s, n) => String(s ?? "").trim().slice(0, n);
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
// AliExpress sitt grå plassholderbilde (gamle ordre og varer som er fjernet har ikke bilde lenger).
const OWN_IMG_MAX = 140000;
const ALI_PLACEHOLDER =/Sf5a31ce867174aa7bf499352d6875ddcs/;
const safeImg = (u) => {
  u = String(u || "").trim();
  if (ALI_PLACEHOLDER.test(u)) return "";
  if (u.startsWith("//")) u = "https:" + u;
  // Eget bilde tatt eller lastet opp i appen (lite JPEG, se openNewPart).
  if (u.length <= OWN_IMG_MAX && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(u)) return u;
  // Egne bilder i repoet (img/parts/C233265.png) for deler butikken ikke har bilde av lenger.
  if (/^img\/parts\/[A-Za-z0-9_-]+\.(png|jpe?g|webp)$/.test(u)) return u;
  return IMG_HOSTS.test(u) ? u.split(/[?#]/)[0] : "";
};
const safeWebImg = (u) => {
  u = String(u || "").trim();
  return /^https:\/\/[a-z0-9.-]+\.[a-z]{2,}\/[^\s"'<>]{1,400}$/i.test(u) && !/\.svg(\?|$)/i.test(u) ? u : "";
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
    url: safeUrl(p.url), storeUrl: safeUrl(p.storeUrl), image: safeImg(p.image) || (p.imgWeb || p.imgManual ? safeWebImg(p.image) : ""),
    // Bildet er funnet ved søk på nettet (ikke hos AliExpress) og må godkjennes av eieren.
    imgWeb: !!p.imgWeb && !!safeWebImg(p.image), imgWebSrc: /^https:\/\//.test(String(p.imgWebSrc || "")) ? clip(p.imgWebSrc, 400) : "",
    // Bildet er hentet fra en lignende vare (søk på tittelen), fordi originalen er fjernet hos AliExpress.
    imgSearch: !!p.imgSearch && !!safeImg(p.image),
    // Bildet er satt eller fjernet for hånd; automatiske bildesøk rører det ikke.
    imgManual: !!p.imgManual,
    // Merket «Feil bilde» av eieren: bildesøket plukker opp disse og fjerner merket når det finner et nytt.
    imgWrong: !!p.imgWrong,
    imgWrongAt: clip(p.imgWrongAt, 30),
    // Når bildet sist ble byttet, og av hvem («bildesøk» eller et navn).
    imgUpdated: clip(p.imgUpdated, 30), imgBy: clip(p.imgBy, 40),
    // Pakketype (TO-92, SOT-23, 0805 …) fra tittel, variant og delenummer, ellers fra kjente delenumre.
    // Butikkens egen pakkeangivelse (LCSC) går foran det vi finner i teksten.
    pkgFixed: clip(p.pkgFixed, 30),
    pkg: findPackage(p.pkgFixed) || clip(p.pkgFixed, 30) || findPackage(p.variant, p.title, p.mpn, p.description) || String(findPart(p.title, p.mpn)?.pkg || "").split("/")[0],
    // Datablad (PDF) og butikkens egen kategori (Mouser: «Sensors › Humidity Sensors»).
    datasheet: /^https:\/\/(([a-z0-9-]+\.)*mouser\.[a-z.]+\/.+\.pdf|datasheet\.lcsc\.com\/[^\s"'<>]+|www\.lcsc\.com\/datasheet\/C\d+\.pdf|[a-z0-9.-]+\.[a-z]{2,}\/[^\s"'<>?#]+\.pdf)$/i.test(String(p.datasheet || "")) ? String(p.datasheet) : "",
    // Regnes ut på nytt fra butikkens kategoritekst, så nye kategorier (f.eks. Halvledere) slår inn.
    shopCat: clip(p.shopCat, 160), catHint: (p.shopCat && mouserCategory(String(p.shopCat).split(" › "))) || (CAT_NAME[p.catHint] ? p.catHint : ""),
    mpn: clip(p.mpn, 80), maker: clip(p.maker, 80), description: clip(p.description, 600),
    // Kategorien regnes ut på nytt med de nyeste reglene, med mindre den er satt for hånd.
    category: p.catManual && CAT_NAME[p.category] ? p.category : CAT_NAME[p.catHint] ? p.catHint : classify(p.title, [p.variant, p.shopCat].filter(Boolean).join(" ")), catManual: !!p.catManual,
    // Delprodukt i et sett: id-en til hovedproduktet (settet).
    parent: clip(p.parent, 200),
    // Løpenummer på produkter opprettet for hånd (vises som M-12).
    manualNo: Math.max(0, Math.round(num(p.manualNo) ?? 0)),
    location: clip(p.location, 80), note: clip(p.note, 400),
    // Felt rettet etter bildeanalysen. Lagres her også, så en ny import fra butikken ikke skriver dem over.
    ov: cleanOv(p.ov),
    added: clip(p.added, 30), updated: clip(p.updated, 30),
  };
}
const OV_KEYS = ["title", "mpn", "maker", "pkgFixed", "description"];
const cleanOv = (o) => Object.fromEntries(OV_KEYS.filter((k) => o && typeof o[k] === "string" && o[k].trim()).map((k) => [k, clip(o[k], k === "description" ? 600 : 300)]));

// Antall stk: kjøpt antall × stk per pakke. «Igjen» regnes også i stk.
const units = (p) => p.qty * (p.pack || 1);
const remaining = (p) => (p.left === null ? units(p) : p.left);
const fmtMoney = (p) => {
  if (p.unitPrice === null) return "";
  const v = p.unitPrice.toLocaleString("nb-NO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return { NOK: `${v} kr`, EUR: `€${v}`, USD: `$${v}`, GBP: `£${v}` }[p.currency] || v;
};
// Pris per stykk (kjøpt pris delt på pakkestørrelsen) og verdien av et ønske i kroner.
const pieceMoney = (p) => (p && p.unitPrice !== null ? { unitPrice: p.unitPrice / (p.pack || 1), currency: p.currency } : null);
const nok = (v) => `${Math.round(v).toLocaleString("nb-NO")} kr`;
// Beløp slik butikken skrev det («kr 1 928,63», «42,52kr», «US $12.45») vises på samme måte som
// resten av siden («1 928,63 kr»).
const fmtTotal = (text) => {
  const t = parsePrice(text);
  return t.amount === null ? String(text || "") : fmtMoney({ unitPrice: t.amount, currency: t.currency || "NOK" });
};
const reqNok = (q) => {
  const p = pstate.parts.find((x) => x.id === q.partId), m = pieceMoney(p);
  return m ? m.unitPrice * q.qty * (FX_NOK[m.currency] || 1) : null;
};
// Sum for en liste med ønsker, og hvor mange som mangler pris.
function reqSum(list) {
  let sum = 0, missing = 0;
  // Avviste ønsker («Kan ikke») kommer ikke, så de teller ikke med i summen.
  for (const q of list.filter((x) => x.status !== "declined")) { const v = reqNok(q); if (v === null) missing++; else sum += v; }
  return `<span class="req-sum">ca. <b>${nok(sum)}</b>${missing ? ` <span class="hint">(${missing} uten pris)</span>` : ""}</span>`;
}
const kicadHint = (p) => {
  const t = `${p.title} ${p.variant} ${p.description}`.toLowerCase();
  return /\bleds?\b/.test(t) ? "LED" : /capacitor|\d\s?(uf|nf|pf|µf)\b/.test(t) ? "C" : /inductor|ferrite|\d\s?(uh|mh|µh)\b/.test(t) ? "L" : /\bdiodes?\b|zener|schottky/.test(t) ? "D" : "R";
};
const fmtDate = (d) => (d ? new Date(d + "T12:00:00").toLocaleDateString("nb-NO", { day: "numeric", month: "short", year: "numeric" }) : "");

// Omtrentlige kurser for å vise samlet beløp i kroner (summen per valuta står i verktøytipset).
const FX_NOK = { NOK: 1, EUR: 11.6, USD: 10.6, GBP: 13.6 };

const SOURCE_LABEL = { aliexpress: "AliExpress", mouser: "Mouser", lcsc: "LCSC", manual: "Lagt inn for hånd" };

// ---------- Lasting og lagring ----------

async function load(force = false) {
  if (ctx.DEMO) {
    if (!pstate.loaded) { pstate.parts = demoParts(); pstate.reqs = demoReqs(); pstate.projects = demoProjects(); }
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
    applyCats(Object.values(parts?.cats || {}));
    const raw = parts?.parts || [];
    pstate.deleted = new Set(raw.filter((p) => p?.deleted && p.id).map((p) => String(p.id)));
    pstate.parts = raw.filter((p) => !p?.deleted).map(cleanPart).filter(Boolean);
    // Delprodukter som har fått kopiert settets bilde i databasen (eldre lagring) ryddes, og eldre produkter
    // opprettet for hånd får løpenummer. Gjelder bare mine egne varer.
    const bloated = pstate.parts.filter((c) => c.parent && c.image.startsWith("data:") && c.owner === meName() && pstate.parts.find((x) => x.id === c.parent)?.image === c.image);
    const legacy = pstate.parts.filter((c) => c.source === "manual" && !c.parent && !c.manualNo && c.owner === meName()).sort((a, b) => (a.added || "").localeCompare(b.added || ""));
    let nextNo = Math.max(0, ...pstate.parts.map((x) => x.manualNo || 0));
    for (const c of legacy) c.manualNo = ++nextNo;
    inheritKitPkg(pstate.parts);
    if (!ctx.DEMO && ctx.token() && (bloated.length || legacy.length)) savePatch([...new Set([...bloated, ...legacy])].map((c) => ({ id: c.id, data: c }))).catch(() => {});
    pstate.reqs = (parts?.requests || []).map(cleanReq).filter(Boolean);
    pstate.projects = (parts?.projects || []).map(cleanProject).filter(Boolean);
    pstate.prefs = Object.fromEntries(Object.entries(parts?.prefs || {})
      .filter(([o, v]) => o && v && Array.isArray(v.hidden)).map(([o, v]) => [String(o).slice(0, 40), { hidden: v.hidden.map(String).slice(0, 40), hideSpent: !!v.hideSpent }]));
    pstate.loaded = true;
  } catch (err) {
    pstate.error = err.message;
  } finally {
    pstate.loading = false;
    render();
  }
}

// Lagrer endrede poster (null = slett), i porsjoner så hvert kall holder seg lite.
// Felles kategorier for alle brukere (D1-samlingen partcats, id = kategori-id):
// { name } gir en innebygd kategori nytt navn; nye kategorier har id «c_…».
// Lagt til før «Annet», som alltid står sist.
const BUILTIN_NAME = { ...CAT_NAME };
function applyCats(list) {
  for (const c of list) {
    const id = String(c?.id || "").slice(0, 40), name = clip(c?.name, 40);
    if (!/^[a-z0-9_]+$/.test(id)) continue;
    if (c.deleted) {
      if (!BUILTIN_NAME[id]) { const i = CATEGORIES.findIndex(([x]) => x === id); if (i >= 0) CATEGORIES.splice(i, 1); delete CAT_NAME[id]; }
      else { CAT_NAME[id] = BUILTIN_NAME[id]; const e = CATEGORIES.find(([x]) => x === id); if (e) e[1] = BUILTIN_NAME[id]; }
      continue;
    }
    if (!name) continue;
    const e = CATEGORIES.find(([x]) => x === id);
    if (e) e[1] = name; else CATEGORIES.splice(CATEGORIES.length - 1, 0, [id, name, []]);
    CAT_NAME[id] = name;
  }
}
// Kategoriene alfabetisk (norsk sortering), med «Annet» til slutt. CATEGORIES selv beholder
// rekkefølgen, fordi klassifiseringen bruker den ved likt antall poeng.
const sortedCats = () => [...CATEGORIES].sort(([a, x], [b, y]) => (a === "other") - (b === "other") || x.localeCompare(y, "nb"));
const isCustomCat = (id) => /^c_/.test(id);
const slug = (t) => String(t).toLowerCase().normalize("NFKD").replace(/[æ]/g, "ae").replace(/[ø]/g, "o").replace(/[å]/g, "a").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 24);

async function saveCat(id, data) {
  applyCats([{ id, ...(data || { deleted: true }) }]);
  render();
  if (!ctx.DEMO) await savePatch([{ coll: "partcats", id, data: data && { id, ...data, updated: new Date().toISOString(), by: meName() } }]);
}
async function createCat(name) {
  name = clip(name, 40);
  if (!name) return;
  const taken = Object.entries(CAT_NAME).find(([, n]) => n.toLowerCase() === name.toLowerCase());
  if (taken) { pstate.cat = taken[0]; render(); throw new Error(`«${name}» finnes allerede.`); }
  const id = `c_${slug(name) || "kategori"}_${Math.random().toString(36).slice(2, 6)}`;
  await saveCat(id, { name });
  pstate.cat = id;
  render();
}
async function renameCat(id, name) {
  name = clip(name, 40);
  if (!CAT_NAME[id] || !name || name === CAT_NAME[id]) return;
  // Tilbake til det opprinnelige navnet på en innebygd kategori: fjern overstyringen.
  if (BUILTIN_NAME[id] === name) { await saveCat(id, null); return; }
  await saveCat(id, { name });
}
async function deleteCat(id) {
  if (!isCustomCat(id)) return;
  if (pstate.parts.some((p) => p.category === id)) throw new Error("Kategorien er ikke tom. Flytt varene først.");
  if (pstate.cat === id) pstate.cat = "";
  await saveCat(id, null);
}
// Flytt varer (alle kjøp av samme produkt) til en annen kategori.
async function moveToCat(id, cat) {
  const p = pstate.parts.find((x) => x.id === id);
  if (!p || !CAT_NAME[cat]) return;
  const me = meName();
  const list = siblings(p).filter((x) => x.category !== cat && (ctx.DEMO || x.owner === me || ctx.isAdmin?.()));
  if (!list.length) throw new Error(p.category === cat ? "Varen ligger allerede der." : "Du kan bare flytte dine egne varer.");
  const now = new Date().toISOString();
  for (const x of list) { x.category = cat; x.catManual = true; x.updated = now; }
  render();
  if (!ctx.DEMO) await savePatch(list.map((x) => ({ id: x.id, data: x })));
  ctx.setSync(`Flyttet til «${CAT_NAME[cat]}»`);
}

// Bare eieren kan slette sine egne varer.
async function deleteParts(list) {
  const now = new Date().toISOString(), by = meName();
  list = list.filter((p) => ctx.DEMO || (p.owner && p.owner === by));
  if (!list.length) throw new Error("Bare eieren kan slette varen.");
  const ids = new Set(list.map((p) => p.id));
  pstate.parts = pstate.parts.filter((p) => !ids.has(p.id));
  for (const id of ids) pstate.deleted.add(id);
  render();
  if (!ctx.DEMO) await savePatch(list.map((p) => ({ id: p.id, data: { id: p.id, deleted: true, owner: p.owner, title: p.title.slice(0, 80), deletedAt: now, by } })));
}

// ---------- Forstørret fotavtrykk og koblingsskjema ----------
// Eget vindu over produktvinduet. Zoom med knappene, Ctrl/⌘ + hjul eller to fingre (nettleseren).
const FP_ZOOMS = [1, 1.5, 2, 3, 4];
function openFootprintZoom(pkg, hint) {
  const name = kicadName(pkg, hint);
  openZoom(`<b>${ctx.esc(pkg)}</b>${name ? `<br><code class="kicad-name">${ctx.esc(name)}</code>` : ""}`, footprintSvg(pkg, 600, { detail: true }),
    `<p class="hint">${ctx.esc(footprintCaption(pkg, hint))}</p><span class="fp-legend"><i class="cu"></i>F.Cu <i class="silk"></i>F.SilkS <i class="drill"></i>Drill</span>`, true);
}
// head, svg og foot er ferdig escapet HTML (svg er laget av egen kode).
function openZoom(head, svg, foot, light) {
  let dlg = document.getElementById("fp-zoom");
  if (!dlg) {
    dlg = document.createElement("dialog");
    dlg.id = "fp-zoom";
    dlg.className = "fp-zoom-dialog";
    document.body.append(dlg);
    dlg.addEventListener("click", (e) => {
      const z = e.target.closest("[data-fpz]");
      if (z) return setZoom(dlg, Number(dlg.dataset.z || 0) + Number(z.dataset.fpz));
      if (e.target.closest("[data-fpzclose]") || e.target === dlg) dlg.close();
    });
    dlg.addEventListener("wheel", (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZoom(dlg, Number(dlg.dataset.z || 0) + (e.deltaY < 0 ? 1 : -1));
    }, { passive: false });
  }
  dlg.innerHTML = `<div class="fpz-head">
      <div>${head}</div>
      <div class="fpz-tools">
        <button type="button" class="icon-btn" data-fpz="-1" aria-label="Zoom ut" title="Zoom ut">−</button>
        <span class="fpz-level" aria-live="polite"></span>
        <button type="button" class="icon-btn" data-fpz="1" aria-label="Zoom inn" title="Zoom inn">+</button>
        <button type="button" class="icon-btn" data-fpzclose aria-label="Lukk" title="Lukk"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
      </div>
    </div>
    <div class="fpz-stage${light ? " light" : ""}">${svg}</div>
    ${foot}`;
  setZoom(dlg, 0);
  dlg.showModal();
}
// Bilde i stort format med samme zoomknapper (−/+, Ctrl/⌘ + hjul). Bildet ligger i «fpz-stage» og kan rulles når det er zoomet.
function openImageZoom(src, title) {
  openZoom(`<b>${ctx.esc(title || "Bilde")}</b>`, `<img src="${ctx.esc(src)}" alt="" referrerpolicy="no-referrer">`, "", true);
}
function setZoom(dlg, i) {
  i = Math.max(0, Math.min(FP_ZOOMS.length - 1, i));
  dlg.dataset.z = i;
  dlg.style.setProperty("--fpz", FP_ZOOMS[i]);
  dlg.querySelector(".fpz-level").textContent = `${Math.round(FP_ZOOMS[i] * 100)} %`;
  dlg.querySelector('[data-fpz="-1"]').disabled = i === 0;
  dlg.querySelector('[data-fpz="1"]').disabled = i === FP_ZOOMS.length - 1;
}

// Alles beholdning som JSON (samme form som /inventory i Workeren), for Claude-skillen.
async function exportInventory() {
  try {
    await load();
    const data = inventory({ parts: pstate.parts }, (p) => {
      const f = findPart(p.title, p.mpn);
      return { categoryName: CAT_NAME[p.category] || p.category, part: f?.mpn || "", kind: f?.kind || "", type: p.category === "semi" ? semiType(p) : "" };
    });
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: "application/json" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `lager-${new Date().toISOString().slice(0, 10)}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    ctx.setSync(`Eksporterte ${data.count} varer`);
  } catch (err) {
    ctx.setSync(err.message, true);
  }
}

// Bildet et delprodukt arver fra settet lagres ikke på delproduktet (ellers kopieres hele bildet til hvert delprodukt).
function withoutInheritedImg(o) {
  const d = o.data;
  if ((o.coll || "parts") !== "parts" || !d || !d.parent || !d.image) return d;
  const kit = pstate.parts.find((x) => x.id === d.parent);
  return kit && kit.image === d.image ? { ...d, image: "", imgSearch: false, imgWeb: false, imgWebSrc: "" } : d;
}
async function savePatch(ops, onProgress) {
  for (let i = 0; i < ops.length; i += PATCH_CHUNK) {
    await ctx.dbCall("/db/patch", { ops: ops.slice(i, i + PATCH_CHUNK).map((o) => ({ coll: o.coll || "parts", id: o.id, data: withoutInheritedImg(o) })) });
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
    projectId: clip(q.projectId, 60),
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
    ${b("projects", `Prosjekter${myProjects().length ? ` <span class="nav-n">${myProjects().length}</span>` : ""}`)}
    ${b("import", "Importer")}
    <button type="button" class="parts-tab" data-psettings>Innstillinger</button>
    <button type="button" class="parts-tab" data-pexport title="Last ned alles beholdning som JSON, for Claude-skillen «elektronikk-design»">Eksporter lager for Claude</button>
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
    <div class="req-qty">
      <div class="req-calc">${mode === "cart" && q.status === "draft"
        ? `<input type="number" min="1" max="${Math.max(1, left)}" value="${q.qty}" data-reqqty="${ctx.esc(q.id)}" aria-label="Antall"><span class="req-unit">stk</span>`
        : `<b>${q.qty} stk</b>`}
        ${mode === "cart" ? (pieceMoney(p)
          ? `<span class="req-each">× ${ctx.esc(fmtMoney(pieceMoney(p)))}</span><b class="req-line">${ctx.esc(fmtMoney({ ...pieceMoney(p), unitPrice: pieceMoney(p).unitPrice * q.qty }))}</b>`
          : `<span class="req-each">ingen pris</span>`) : ""}
      </div>
      ${mode === "cart" && q.status === "draft" ? "" : `<span class="req-status">${ctx.esc(REQ_STATUS[q.status])}${q.sentAt && q.status === "sent" ? ` ${ctx.esc(fmtDate(q.sentAt.slice(0, 10)))}` : ""}</span>`}
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
    ${mine.length ? groupBy(mine, "owner").map(([owner, list]) => `<h3><span class="owner-dot" style="--owner:${ctx.userColor(owner)}"></span> Fra ${ctx.esc(owner || "ukjent eier")} ${reqSum(list)}</h3><ul class="req-list">${list.map((q) => reqRow(q, "cart")).join("")}</ul>`).join("")
      : `<p class="empty-msg">Handlekurven er tom. Åpne en komponent og trykk «Legg i handlekurv».</p>`}
    ${mine.length ? `<p class="req-total">Verdi i handlekurven: ${reqSum(mine)} <span class="hint">Kjøpspris per stykk, omregnet til kroner med omtrentlig kurs.</span></p>` : ""}
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

// ---------- Prosjekter ----------
//
// Et prosjekt samler delene til én bygging. Hver linje har én kilde:
//   eget lager  (kind "stock", delen eies av prosjekteieren): reservert, ingen forespørsel.
//   fra en venn (kind "stock", annen eier): en forespørsel i handlekurven, merket med prosjektet
//                (partreqs.projectId), så et prosjekt kan ha én handlekurv per venn.
//   må kjøpes   (kind "buy"): navn, antall, lenke og pris; krysses av når den er kjøpt.
// D1: projects { id, name, desc, owner, status, created, updated, lines: [...] }.

const PROJ_STATUS = { plan: "Planlegges", collect: "Samler deler", build: "Bygges", done: "Ferdig" };

function cleanProject(x) {
  if (!x || typeof x !== "object" || !x.id) return null;
  const lines = (Array.isArray(x.lines) ? x.lines : []).slice(0, 300).map((l) => ({
    id: clip(l?.id, 40) || newId(), kind: l?.kind === "buy" ? "buy" : "stock",
    partId: clip(l?.partId, 200), reqId: clip(l?.reqId, 60),
    qty: Math.max(1, Math.min(100000, Math.round(num(l?.qty) ?? 1))),
    label: clip(l?.label, 120), note: clip(l?.note, 200), url: safeUrl(l?.url),
    price: num(l?.price), bought: !!l?.bought,
    // Trukket fra lageret da prosjektet ble ferdig: [{ id, n }], så det kan legges tilbake.
    used: (Array.isArray(l?.used) ? l.used : []).slice(0, 20).map((u) => ({ id: clip(u?.id, 200), n: Math.max(0, Math.round(num(u?.n) ?? 0)) })).filter((u) => u.id && u.n),
  })).filter((l) => l.kind === "buy" ? l.label : l.partId);
  return {
    id: clip(x.id, 60), name: clip(x.name, 80) || "Uten navn", desc: clip(x.desc, 1000), owner: clip(x.owner, 40),
    status: PROJ_STATUS[x.status] ? x.status : "plan", created: clip(x.created, 30), updated: clip(x.updated, 30), lines,
  };
}

const projectById = (id) => pstate.projects.find((x) => x.id === id);
const myProjects = () => pstate.projects.filter((x) => x.owner === meName() && x.status !== "done");
const canEditProject = (x) => ctx.DEMO || x.owner === meName();

async function saveProject(x, reqs = []) {
  x.updated = new Date().toISOString();
  if (!ctx.DEMO) await savePatch([{ coll: "projects", id: x.id, data: x }, ...reqs.map((q) => ({ coll: "partreqs", id: q.id, data: q }))]);
  render();
}

// Linjens tilstand: klar, venter eller problem, med en kort tekst.
function lineState(x, l) {
  if (l.kind === "buy") return l.bought ? ["ok", "Kjøpt"] : ["wait", "Må kjøpes"];
  const p = pstate.parts.find((y) => y.id === l.partId);
  if (!p) return ["bad", "Varen er slettet"];
  if (p.owner === x.owner) {
    if (l.used?.length) return ["ok", `Brukt (${l.used.reduce((a, u) => a + u.n, 0)} stk trukket fra)`];
    const others = reservedElsewhere(p.id, x.id);
    if (remaining(p) < l.qty) return ["bad", `Bare ${remaining(p)} igjen`];
    if (remaining(p) < l.qty + others) return ["warn", `Reservert ${others} stk i andre prosjekter også`];
    return ["ok", "Reservert fra eget lager"];
  }
  const q = pstate.reqs.find((y) => y.id === l.reqId);
  if (!q) return ["bad", "Forespørselen er fjernet"];
  return { draft: ["wait", "I handlekurven, ikke sendt"], open: ["wait", `Venter på ${p.owner}`], sent: ["ok", "Sendt fra eier"], received: ["ok", "Mottatt"], declined: ["bad", `${p.owner} kan ikke`] }[q.status] || ["wait", q.status];
}

// Hvor mange stk av en egen vare som er reservert i andre åpne prosjekter.
function reservedElsewhere(partId, exceptId) {
  let n = 0;
  for (const x of pstate.projects) {
    if (x.id === exceptId || x.status === "done") continue;
    for (const l of x.lines) if (l.kind === "stock" && l.partId === partId && pstate.parts.find((p) => p.id === partId)?.owner === x.owner) n += l.qty;
  }
  return n;
}

function projectProgress(x) {
  const st = x.lines.map((l) => lineState(x, l)[0]);
  return { ok: st.filter((s) => s === "ok" || s === "warn").length, bad: st.filter((s) => s === "bad").length, total: st.length };
}

function projectCost(x) {
  let nokSum = 0;
  for (const l of x.lines) {
    if (l.kind === "buy") { if (l.price) nokSum += l.price * l.qty; continue; }
    const m = pieceMoney(pstate.parts.find((p) => p.id === l.partId));
    if (m) nokSum += m.unitPrice * l.qty * (FX_NOK[m.currency] || 1);
  }
  return nokSum;
}

// Legg en vare til et prosjekt: egen vare reserveres, en venns vare blir en forespørsel.
async function setProjectStatus(x, status) {
  const was = x.status;
  x.status = status;
  const parts = [], reqs = [], short = [];
  if (status === "done" && was !== "done") {
    for (const l of x.lines) {
      if (l.kind !== "stock" || l.used?.length) continue;
      const p = pstate.parts.find((y) => y.id === l.partId);
      if (p && p.owner === x.owner) {
        try {
          const r = await useParts(p, l.qty, false);
          l.used = r.taken;
          parts.push(...r.changed);
          if (r.short) short.push(`${p.title.slice(0, 40)} (mangler ${r.short})`);
        } catch { short.push(`${p.title.slice(0, 40)} (ingen igjen)`); }
      } else {
        const q = pstate.reqs.find((y) => y.id === l.reqId);
        if (q && q.status === "sent") { q.status = "received"; reqs.push(q); }
      }
    }
  } else if (was === "done" && status !== "done") {
    for (const l of x.lines) if (l.used?.length) { parts.push(...unuseParts(l.used)); l.used = []; }
  }
  x.updated = new Date().toISOString();
  if (!ctx.DEMO) await savePatch([{ coll: "projects", id: x.id, data: x }, ...reqs.map((q) => ({ coll: "partreqs", id: q.id, data: q })), ...parts.map((p) => ({ id: p.id, data: p }))]);
  render();
  const n = parts.length ? x.lines.reduce((sum, l) => sum + (l.used || []).reduce((a, u) => a + u.n, 0), 0) : 0;
  return status === "done" ? `Ferdig: ${n} stk trukket fra lageret${reqs.length ? `, ${reqs.length} lån markert som mottatt` : ""}.${short.length ? ` Fantes ikke nok av: ${short.join(", ")}.` : ""}` : was === "done" ? "Delene er lagt tilbake i lageret." : "Lagret";
}

async function addPartToProject(x, p, qty, note) {
  if (!canEditProject(x)) throw new Error("Bare eieren av prosjektet kan endre det.");
  const reqs = [];
  const line = x.lines.find((l) => l.kind === "stock" && l.partId === p.id);
  if (p.owner === x.owner) {
    if (line) line.qty += qty; else x.lines.push({ id: newId(), kind: "stock", partId: p.id, reqId: "", qty, label: "", note: clip(note, 200), url: "", price: null, bought: false });
  } else {
    let q = line && pstate.reqs.find((y) => y.id === line.reqId && y.status === "draft");
    if (q) q.qty += qty;
    else {
      q = cleanReq({ id: newId(), partId: p.id, owner: p.owner, by: x.owner, qty, note: note || `Til prosjektet «${x.name}»`, status: "draft", at: new Date().toISOString(), projectId: x.id });
      pstate.reqs.push(q);
    }
    reqs.push(q);
    if (line) { line.qty += qty; line.reqId = q.id; } else x.lines.push({ id: newId(), kind: "stock", partId: p.id, reqId: q.id, qty, label: "", note: clip(note, 200), url: "", price: null, bought: false });
  }
  await saveProject(x, reqs);
}

async function createProject(name, desc = "", lines = []) {
  const me = meName();
  if (!me) throw new Error("Logg inn først.");
  const x = cleanProject({ id: newId(), name, desc, owner: me, status: "plan", created: new Date().toISOString(), lines });
  pstate.projects.push(x);
  pstate.project = x.id;
  await saveProject(x);
  return x;
}

// Stykkliste fra Claude-skillen «elektronikk-design» (JSON): { name, desc, lines: [ { ids: [...], qty, label, note }
// | { buy: true, label, qty, url, price } ] }. Lager-linjer bruker kjøpet med mest igjen blant ids.
function parseBom(text) {
  let d;
  try { d = JSON.parse(String(text).trim().replace(/^```(json)?|```$/g, "")); } catch { throw new Error("Det er ikke gyldig JSON. Lim inn hele blokken fra Claude."); }
  d = d.project || d;
  if (!Array.isArray(d.lines)) throw new Error("Mangler «lines» i stykklisten.");
  const out = [], problems = [];
  for (const l of d.lines.slice(0, 300)) {
    const qty = Math.max(1, Math.round(num(l?.qty) ?? 1));
    if (l?.buy || !(l?.ids || l?.partId)) {
      if (l?.label) out.push({ kind: "buy", label: clip(l.label, 120), qty, url: safeUrl(l.url), price: num(l.price), note: clip(l.note, 200) });
      continue;
    }
    const ids = [].concat(l.ids || l.partId).map(String);
    const p = pstate.parts.filter((y) => ids.includes(y.id)).sort((a, b) => remaining(b) - remaining(a))[0];
    if (!p) { problems.push(`${l.label || ids[0]}: finnes ikke i lageret`); continue; }
    out.push({ kind: "stock", part: p, qty, note: clip(l.note || l.label, 200) });
  }
  return { name: clip(d.name, 80) || "Prosjekt fra Claude", desc: clip(d.desc, 1000), lines: out, problems };
}

function projectLineRow(x, l, edit) {
  const [st, txt] = lineState(x, l);
  const del = edit ? `<button type="button" class="btn btn-small" data-projact="delline" data-line="${ctx.esc(l.id)}">Fjern</button>` : "";
  if (l.kind === "buy") {
    return `<li class="req-row proj-line st-${st}">
      <span class="req-img"><span class="part-noimg">Kjøp</span></span>
      <div class="req-text"><b>${ctx.esc(l.label)}</b>${l.note ? `<span class="req-note">${ctx.esc(l.note)}</span>` : ""}
        <span class="req-meta">${l.url ? `<a href="${ctx.esc(l.url)}" target="_blank" rel="noopener">Lenke ↗</a>` : ""}${l.price ? `<span>ca. ${ctx.esc(nok(l.price))} per stk</span>` : ""}</span></div>
      <div class="req-qty"><b>${l.qty} stk</b><span class="proj-state">${ctx.esc(txt)}</span></div>
      <div class="req-actions">${edit ? `<label class="cat-toggle"><input type="checkbox" data-projbought="${ctx.esc(l.id)}"${l.bought ? " checked" : ""}> Kjøpt</label>` : ""}${del}</div>
    </li>`;
  }
  const p = pstate.parts.find((y) => y.id === l.partId);
  const img = p?.image ? `<img src="${ctx.esc(/alicdn|aliexpress-media/.test(p.image) ? `${p.image}_220x220.jpg` : p.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<span class="part-noimg">${ctx.esc(p ? CAT_NAME[p.category] : "Slettet")}</span>`;
  return `<li class="req-row proj-line st-${st}">
    <button type="button" class="req-img" data-part="${ctx.esc(l.partId)}" ${p ? "" : "disabled"}>${img}</button>
    <div class="req-text"><b>${ctx.esc(p?.title || "Varen er slettet")}</b>
      <span class="req-meta">${p?.pkg ? `<span>${ctx.esc(p.pkg)}</span>` : ""}${p ? `<span>${remaining(p)} igjen</span>` : ""}${p?.location ? `<span>Ligger: ${ctx.esc(p.location)}</span>` : ""}</span>
      ${l.note ? `<span class="req-note">${ctx.esc(l.note)}</span>` : ""}</div>
    <div class="req-qty"><b>${l.qty} stk</b><span class="proj-state">${ctx.esc(txt)}</span></div>
    <div class="req-actions">${del}</div>
  </li>`;
}

function renderProjects(box) {
  const me = meName();
  const x = projectById(pstate.project);
  if (!x) {
    const list = pstate.projects.filter((y) => pstate.projShow === "all" || y.owner === me).sort((a, b) => (a.status === "done") - (b.status === "done") || String(b.updated).localeCompare(String(a.updated)));
    box.innerHTML = subnav() + `<section class="panel req-panel">
      <h2>Prosjekter</h2>
      <p class="hint">Et prosjekt samler delene til én bygging: fra eget lager (reserveres), fra venner (blir ønsker i handlekurven) og det som må kjøpes. Du kan også lime inn en stykkliste fra Claude-skillen «elektronikk-design».</p>
      <form class="proj-new" data-projform="new"><input type="text" id="proj-name" maxlength="80" placeholder="Navn på nytt prosjekt, f.eks. «Værstasjon»" required><button type="submit" class="btn btn-primary">Nytt prosjekt</button></form>
      <div class="chips proj-filter"><button type="button" class="chip${pstate.projShow !== "all" ? " active" : ""}" data-projshow="mine">Mine</button><button type="button" class="chip${pstate.projShow === "all" ? " active" : ""}" data-projshow="all">Alle</button></div>
      ${list.length ? `<ul class="proj-list">${list.map((y) => { const pr = projectProgress(y); return `<li><button type="button" class="proj-card status-${y.status}" data-projopen="${ctx.esc(y.id)}">
        <b>${ctx.esc(y.name)}</b>
        <span class="proj-meta"><span class="owner-dot" style="--owner:${ctx.userColor(y.owner)}"></span>${ctx.esc(y.owner)} · ${ctx.esc(PROJ_STATUS[y.status])}</span>
        <span class="proj-bar"><i style="width:${pr.total ? Math.round(pr.ok / pr.total * 100) : 0}%"></i></span>
        <span class="hint">${pr.ok} av ${pr.total} deler klare${pr.bad ? ` · ${pr.bad} problem` : ""}</span>
      </button></li>`; }).join("")}</ul>` : `<p class="empty-msg">Ingen prosjekter ennå.</p>`}
    </section>`;
    return;
  }
  const edit = canEditProject(x);
  const pr = projectProgress(x);
  const own = x.lines.filter((l) => l.kind === "stock" && pstate.parts.find((p) => p.id === l.partId)?.owner === x.owner);
  const friends = x.lines.filter((l) => l.kind === "stock" && !own.includes(l));
  const buy = x.lines.filter((l) => l.kind === "buy");
  const byOwner = groupBy(friends.map((l) => ({ l, owner: pstate.parts.find((p) => p.id === l.partId)?.owner || "ukjent" })), "owner");
  const drafts = friends.map((l) => pstate.reqs.find((q) => q.id === l.reqId)).filter((q) => q?.status === "draft");
  const loose = edit ? pstate.reqs.filter((q) => q.by === x.owner && !q.projectId && ["draft", "open", "sent"].includes(q.status)) : [];
  const cost = projectCost(x);
  box.innerHTML = subnav() + `<section class="panel req-panel proj-panel">
    <p><button type="button" class="linkbtn" data-projopen="">← Alle prosjekter</button></p>
    ${edit ? `<div class="proj-head">
        <input type="text" class="proj-title" id="proj-title" maxlength="80" value="${ctx.esc(x.name)}" aria-label="Navn på prosjektet">
        <select id="proj-status" aria-label="Status">${Object.entries(PROJ_STATUS).map(([k, v]) => `<option value="${k}"${k === x.status ? " selected" : ""}>${v}</option>`).join("")}</select>
      </div>
      <textarea id="proj-desc" rows="2" maxlength="1000" placeholder="Hva skal bygges? (valgfritt)">${ctx.esc(x.desc)}</textarea>`
      : `<h2>${ctx.esc(x.name)}</h2><p class="hint">${ctx.esc(x.owner)} · ${ctx.esc(PROJ_STATUS[x.status])}</p>${x.desc ? `<p>${ctx.esc(x.desc)}</p>` : ""}`}
    <div class="proj-summary">
      <span class="proj-bar big"><i style="width:${pr.total ? Math.round(pr.ok / pr.total * 100) : 0}%"></i></span>
      <span><b>${pr.ok} av ${pr.total}</b> deler klare${pr.bad ? ` · <span class="error">${pr.bad} problem</span>` : ""}${cost ? ` · verdi ca. ${ctx.esc(nok(cost))}` : ""}</span>
    </div>
    <h3>Fra eget lager <span class="hint">(reservert)</span></h3>
    ${own.length ? `<ul class="req-list">${own.map((l) => projectLineRow(x, l, edit)).join("")}</ul>` : `<p class="hint">Ingen ennå. Åpne en av dine komponenter og trykk «Legg til i prosjekt».</p>`}
    ${byOwner.map(([owner, list]) => `<h3><span class="owner-dot" style="--owner:${ctx.userColor(owner)}"></span> Fra ${ctx.esc(owner)}</h3><ul class="req-list">${list.map(({ l }) => projectLineRow(x, l, edit)).join("")}</ul>`).join("")}
    ${drafts.length && edit ? `<div class="req-send"><span class="hint">${drafts.length} ${drafts.length === 1 ? "ønske" : "ønsker"} i prosjektet er ikke sendt.</span><button type="button" class="btn btn-primary" data-projact="send">Send prosjektets ønsker</button></div>` : ""}
    <h3>Må kjøpes</h3>
    ${buy.length ? `<ul class="req-list">${buy.map((l) => projectLineRow(x, l, edit)).join("")}</ul>` : `<p class="hint">Ingenting å kjøpe.</p>`}
    ${edit ? `<form class="proj-buy" data-projform="buy">
        <input type="text" name="label" maxlength="120" placeholder="Hva må kjøpes? F.eks. «BME280-modul»" required>
        <input type="number" name="qty" min="1" value="1" aria-label="Antall">
        <input type="url" name="url" maxlength="400" placeholder="Lenke (valgfritt)">
        <input type="number" name="price" min="0" step="0.01" placeholder="kr/stk" aria-label="Pris per stk">
        <button type="submit" class="btn">Legg til</button>
      </form>` : ""}
    ${loose.length ? `<details class="proj-more"><summary>Hent fra handlekurven (${loose.length})</summary>
        <ul class="proj-pick">${loose.map((q) => { const p = pstate.parts.find((y) => y.id === q.partId); return `<li><label class="cat-toggle"><input type="checkbox" data-projpick="${ctx.esc(q.id)}"> ${q.qty} stk ${ctx.esc(p?.title?.slice(0, 80) || "slettet vare")} <span class="hint">(${ctx.esc(q.owner)}, ${ctx.esc(REQ_STATUS[q.status])})</span></label></li>`; }).join("")}</ul>
        <button type="button" class="btn btn-small" data-projact="pick">Legg valgte i prosjektet</button>
      </details>` : ""}
    ${edit ? `<details class="proj-more"${pstate.bomPreview ? " open" : ""}><summary>Importer stykkliste fra Claude</summary>
        <p class="hint">Be Claude (skillen «elektronikk-design») om stykklisten som JSON for import, og lim den inn her. Du ser hva som blir lagt til før noe lagres.</p>
        <textarea id="proj-bom" rows="5" placeholder='{"name": "...", "lines": [{"ids": ["..."], "qty": 1, "label": "AMS1117-3.3"}, {"buy": true, "label": "BME280-modul", "qty": 1}]}'>${ctx.esc(pstate.bomText || "")}</textarea>
        <p><button type="button" class="btn btn-small" data-projact="bompreview">Vis hva som legges til</button></p>
        ${pstate.bomPreview ? `<div class="bom-preview">
          <ul>${pstate.bomPreview.lines.map((l) => `<li>${l.kind === "buy" ? `<b>Kjøp:</b> ${l.qty} × ${ctx.esc(l.label)}` : `<b>${l.part.owner === x.owner ? "Eget lager" : `Fra ${ctx.esc(l.part.owner)}`}:</b> ${l.qty} × ${ctx.esc(l.part.title.slice(0, 90))} <span class="hint">(${remaining(l.part)} igjen)</span>`}</li>`).join("")}</ul>
          ${pstate.bomPreview.problems.length ? `<p class="error">${pstate.bomPreview.problems.map(ctx.esc).join("<br>")}</p>` : ""}
          <button type="button" class="btn btn-primary btn-small" data-projact="bomadd">Legg til ${pstate.bomPreview.lines.length} linjer</button>
          <button type="button" class="btn btn-small" data-projact="bomcancel">Avbryt</button>
        </div>` : ""}
      </details>
      <p class="proj-danger"><button type="button" class="btn btn-danger btn-small" data-projact="delete">Slett prosjektet …</button></p>` : ""}
  </section>`;
}

async function projectAction(a, el) {
  const x = projectById(pstate.project);
  if (!x || !canEditProject(x)) return;
  if (a === "delline") {
    const l = x.lines.find((y) => y.id === el.dataset.line);
    x.lines = x.lines.filter((y) => y !== l);
    const q = l?.reqId && pstate.reqs.find((y) => y.id === l.reqId);
    // Et usendt ønske laget for prosjektet fjernes; et sendt beholdes, men kobles fra prosjektet.
    if (q && q.status === "draft") { pstate.reqs = pstate.reqs.filter((y) => y !== q); if (!ctx.DEMO) await savePatch([{ coll: "partreqs", id: q.id, data: null }]); return saveProject(x); }
    if (q) { q.projectId = ""; return saveProject(x, [q]); }
    return saveProject(x);
  }
  if (a === "send") {
    const reqs = x.lines.map((l) => pstate.reqs.find((q) => q.id === l.reqId)).filter((q) => q?.status === "draft");
    for (const q of reqs) { q.status = "open"; q.at = new Date().toISOString(); }
    await saveProject(x, reqs);
    return ctx.setSync(`${reqs.length} ønsker sendt`);
  }
  if (a === "pick") {
    const ids = [...document.querySelectorAll("[data-projpick]:checked")].map((c) => c.dataset.projpick);
    const reqs = pstate.reqs.filter((q) => ids.includes(q.id));
    for (const q of reqs) {
      q.projectId = x.id;
      const old = x.lines.find((l) => l.kind === "stock" && l.partId === q.partId);
      if (old && !old.reqId) old.reqId = q.id;
      else if (!old) x.lines.push({ id: newId(), kind: "stock", partId: q.partId, reqId: q.id, qty: q.qty, label: "", note: q.note, url: "", price: null, bought: false });
    }
    return saveProject(x, reqs);
  }
  if (a === "bompreview") {
    pstate.bomText = document.getElementById("proj-bom")?.value || "";
    try { pstate.bomPreview = parseBom(pstate.bomText); } catch (err) { pstate.bomPreview = null; ctx.setSync(err.message, true); }
    return render();
  }
  if (a === "bomcancel") { pstate.bomPreview = null; pstate.bomText = ""; return render(); }
  if (a === "bomadd") {
    const bom = pstate.bomPreview;
    pstate.bomPreview = null; pstate.bomText = "";
    if (!x.desc && bom.desc) x.desc = bom.desc;
    for (const l of bom.lines) {
      if (l.kind === "buy") x.lines.push({ id: newId(), kind: "buy", partId: "", reqId: "", qty: l.qty, label: l.label, note: l.note, url: l.url, price: l.price, bought: false });
      else await addPartToProject(x, l.part, l.qty, l.note);
    }
    await saveProject(x);
    return ctx.setSync(`${bom.lines.length} linjer lagt til`);
  }
  if (a === "delete") {
    if (el.dataset.sure !== "1") { el.dataset.sure = "1"; el.textContent = "Slett for godt? Trykk igjen"; return; }
    const reqs = pstate.reqs.filter((q) => q.projectId === x.id);
    for (const q of reqs) q.projectId = "";
    pstate.projects = pstate.projects.filter((y) => y !== x);
    pstate.project = "";
    if (!ctx.DEMO) await savePatch([{ coll: "projects", id: x.id, data: null }, ...reqs.map((q) => ({ coll: "partreqs", id: q.id, data: q }))]);
    render();
    return ctx.setSync("Prosjektet er slettet (ønskene ligger fortsatt i handlekurven)");
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
    if (pstate.deleted.has(id)) continue;
    const price = r.priceText ? parsePrice(r.priceText) : { amount: r.unitPrice, currency: r.currency };
    const catHint = r.catHint || (r.shopCat ? mouserCategory(String(r.shopCat).split(" › ")) : "");
    const old = byId.get(id);
    const fresh = cleanPart({ ...r, ...(old?.ov || {}), ov: old?.ov, catHint, unitPrice: price.amount, currency: price.currency || r.currency, id, source, owner, added: now, updated: now });
    if (!fresh) continue;
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
    const gone = pstate.parts.filter((p) => p.source === source && p.owner === ctx.userName() && replace.has(p.orderId) && !p.parent && !ids.has(p.id));
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
      const items = pstate.parts.filter((p) => p.owner === ctx.userName() && (msg.only === "wrong" ? p.imgWrong && !imgFixed(p)
        : (p.imgWrong && !imgFixed(p)) || (p.source === "aliexpress" && !p.imgManual && (p.imgSearch || !p.image))))
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
        for (const { id, image, web, src } of msg.images.slice(0, 20000)) {
          const p = byId.get(String(id));
          if (!p || p.owner !== ctx.userName() || (p.imgManual && !p.imgWrong)) continue;
          const img = web ? safeWebImg(image) : safeImg(image);
          if (img === p.image || (p.imgWrong && !img)) continue;
          p.image = img; p.imgSearch = !!img && !web; p.imgWeb = !!web && !!img; p.imgWebSrc = web ? clip(src, 400) : ""; p.updated = p.imgUpdated = new Date().toISOString(); p.imgBy = "bildesøk";
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

// Søk i verdier (2,2 uH, 100nF, ±10 %): µ = u, komma = punktum, og mellomrom mellom tall og enhet (2.2 uH = 2.2uh), ± og % tåles.
const valueForm = (t) => String(t || "").toLowerCase().replace(/[µμ]/g, "u").replace(/±/g, "").replace(/(\d),(\d)/g, "$1.$2")
  .replace(/(\d)\s+(?=[a-zΩ%])/g, "$1").replace(/\s+/g, " ").trim();
const matchesQ = (p, q) => {
  if (!q) return true;
  const hay = [p.manualNo ? `m-${p.manualNo}` : "", p.title, p.variant, p.store, p.orderId, p.mpn, p.maker, p.location, p.note, p.pkg, p.description, CAT_NAME[p.category], p.owner].join(" ");
  return hay.toLowerCase().includes(q) || valueForm(hay).includes(valueForm(q));
};

// Søketreff som filtrene (kategori, eier, butikk, pakke, «Har igjen») skjuler.
function hiddenMatches(shownCount) {
  const q = pstate.q.trim().toLowerCase();
  if (!q) return 0;
  return visibleParts().filter((p) => matchesQ(p, q)).length - shownCount;
}

function filtered() {
  const q = pstate.q.trim().toLowerCase();
  const list = visibleParts().filter((p) =>
    (!pstate.cat || p.category === pstate.cat) &&
    (!pstate.sub || pstate.cat !== "semi" || semiType(p) === pstate.sub) &&
    (!pstate.owner || p.owner === pstate.owner) &&
    (!pstate.source || p.source === pstate.source) &&
    (!pstate.pkg || p.pkg === pstate.pkg) &&
    (!pstate.imgf || !!IMG_FILTERS.find(([id]) => id === pstate.imgf)?.[2](p)) &&
    (pstate.show === "all" || (pstate.show === "have" ? remaining(p) > 0 : remaining(p) === 0)) &&
    matchesQ(p, q));
  const by = {
    new: (a, b) => b.orderDate.localeCompare(a.orderDate) || a.title.localeCompare(b.title),
    old: (a, b) => a.orderDate.localeCompare(b.orderDate) || a.title.localeCompare(b.title),
    name: (a, b) => a.title.localeCompare(b.title, "nb"),
    price: (a, b) => (b.unitPrice ?? -1) - (a.unitPrice ?? -1),
    cat: (a, b) => CAT_NAME[a.category].localeCompare(CAT_NAME[b.category], "nb") || b.orderDate.localeCompare(a.orderDate),
  }[pstate.sort] || (() => 0);
  return list.sort(by);
}

// Samme produkt kjøpt i flere ordre vises som ett kort med samlet antall.
// Nøkkel: eier + butikk + produkt (AliExpress-varenummer, ellers delenummer eller tittel) + variant.
const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
const groupKey = (p) => [p.owner, p.source, p.itemId || norm(p.mpn) || norm(p.title), norm(p.variant)].join("|");
// Sett (hovedprodukt) og delprodukter. Delprodukter er egne varer med lagerstatus og datablad.
const kitParts = (p) => pstate.parts.filter((x) => x.parent === p.id).sort((a, b) => byValue(a.mpn, b.mpn));
const kitOf = (p) => (p.parent ? pstate.parts.find((x) => x.id === p.parent) || null : null);
// «BC547 20», «BC547 x 20», «BC547» (antall fra feltet), eller en liste skilt med komma/linjeskift/mellomrom.
function normValue(t) {
  const m = /^(\d+(?:\.\d+)?)([pnuµμmMkKG]?)(H|F|Ω|R|OHM)?$/i.exec(String(t || "").replace(",", ".").trim());
  if (!m || (!m[2] && !m[3])) return null;
  const unit = /^[HF]$/i.test(m[3] || "") ? m[3].toUpperCase() : /^ohm$/i.test(m[3] || "") ? "Ω" : m[3] || "";
  let pre = m[2];
  if (/[µμUu]/.test(pre)) pre = "u";
  else if (/[nN]/.test(pre)) pre = "n";
  else if (/[pP]/.test(pre)) pre = "p";
  else if (/[kK]/.test(pre)) pre = "k";
  else if (/[mM]/.test(pre)) pre = unit === "H" || unit === "F" ? "m" : pre;
  return m[1] + pre + unit;
}
const partCase = (t) => normValue(t) || String(t).toUpperCase();
// Sorteringsnøkkel for verdier: 1uH før 100uH før 1mH (størrelsen, ikke teksten). Delenumre har ingen nøkkel.
const valueKey = (t) => {
  const m = /^(\d+(?:\.\d+)?)([pnumkMG]?)/.exec(String(t || ""));
  if (!m || !normValue(t)) return null;
  return Number(m[1]) * ({ p: 1e-12, n: 1e-9, u: 1e-6, m: 1e-3, k: 1e3, M: 1e6, G: 1e9 }[m[2]] || 1);
};
const byValue = (a, b) => { const x = valueKey(a), y = valueKey(b); return x !== null && y !== null && x !== y ? x - y : String(a).localeCompare(String(b), "en", { numeric: true }); };

function parseKitLines(text, defQty) {
  const out = new Map();
  for (const raw of String(text || "").split(/[\n,;]+/)) {
    const t = raw.trim();
    if (!t) continue;
    const m = t.match(/^(\S+)(?:\s*[x×*:]\s*|\s+)(\d{1,6})$/i);
    const items = m ? [[m[1], Number(m[2])]] : t.split(/\s+/).map((x) => [x, defQty]);
    for (const [mpn, n] of items) {
      const k = partCase(clip(mpn.replace(/[µμ]/g, "u").replace(/[^\w.+Ω-]/g, ""), 60));
      if (k) out.set(k, Math.max(1, n || defQty));
    }
  }
  return [...out];
}
// Leser delenumrene ut av tittelen på et sett: «BC337 BC327 2N2222 … Assortment Kit 10value 200PCS».
// Antall per type = totalt antall («200PCS») delt på antall typer («10value», ellers antall delenumre).
function deriveKit(title) {
  const t = String(title || "");
  const skip = /^\d+(pcs?|pieces?|values?|kinds?|types?|pack|sets?|v|mm|cm|w|a|k|r|uf|nf|pf|ohms?)$/i;
  const mpns = [];
  for (const w of t.split(/[\s,;/]+/)) {
    const k = partCase(w.replace(/[µμ]/g, "u").replace(/^[^\w]+|[^\w]+$/g, "")), K = k.toUpperCase();
    if (k.length < 3 || k.length > 14 || !/^[A-Z0-9][A-Z0-9.-]*$/.test(K) || /^[\d.]+[A-Z]*-[\d.]+[A-Z]*$/.test(K) || !/[A-Z]/.test(K) || !/\d/.test(K) || skip.test(K) || mpns.includes(k)) continue;
    mpns.push(k);
  }
  if (mpns.length < 2) return null;
  const total = Number((t.match(/(\d{1,6})\s*(?:pcs?|pieces?|stk)\b/i) || [])[1]) || 0;
  const kinds = Number((t.match(/(\d{1,4})\s*(?:values?|kinds?|types?)\b/i) || [])[1]) || mpns.length;
  const each = total ? Math.max(1, Math.floor(total / kinds)) : 0;
  return { mpns, each, total, kinds };
}
// Et sett med én pakketype i tittelen (f.eks. «180PCS SOT-23 Transistor Kit») har samme fotavtrykk på alle delprodukter,
// ikke det som følger av hvert enkelt delenummer (BC547 → TO-92). Butikkens egen pakkeangivelse (pkgFixed) går foran.
// Alt annet som delproduktet ikke har selv (kategori, bilde, butikk, ordre, plassering) arves også fra settet.
function inheritKitPkg(list) {
  for (const c of list) {
    if (!c.parent) continue;
    const k = pstate.parts.find((x) => x.id === c.parent);
    if (!k) continue;
    const pkg = findPackage(k.pkgFixed) || findPackage(k.variant, k.title);
    if (pkg && !c.pkgFixed) c.pkg = pkg;
    if (!c.catManual) c.category = k.category;
    if (!c.image && k.image) { c.image = k.image; c.imgSearch = k.imgSearch; c.imgWeb = k.imgWeb; c.imgWebSrc = k.imgWebSrc; }
    for (const f of ["shopCat", "catHint", "maker", "url", "store", "storeUrl", "orderId", "orderDate", "status", "location", "owner"]) if (!c[f] && k[f]) c[f] = k[f];
  }
}
async function addKitParts(kit, entries) {
  const now = new Date().toISOString(), made = [];
  for (const [mpn, n] of entries) {
    const id = `${kit.id}>${mpn}`;
    pstate.deleted.delete(id);
    const old = pstate.parts.find((x) => x.id === id);
    if (old) { old.qty = n; old.left = null; old.updated = now; made.push(old); continue; }
    const c = cleanPart({
      id, parent: kit.id, source: kit.source, owner: kit.owner, title: mpn, mpn, qty: n, pack: 1, packManual: true,
      orderId: kit.orderId, orderDate: kit.orderDate, status: kit.status, store: kit.store, storeUrl: kit.storeUrl,
      location: kit.location, added: now, updated: now,
    });
    pstate.parts.push(c);
    made.push(c);
  }
  inheritKitPkg(made);
  render();
  if (!ctx.DEMO) await savePatch(made.map((p) => ({ id: p.id, data: p })));
  return made;
}
const siblings = (p) => { const k = groupKey(p); return visibleParts().filter((x) => groupKey(x) === k); };
function groupParts(list) {
  const g = new Map();
  for (const p of list) { const k = groupKey(p); (g.get(k) || g.set(k, []).get(k)).push(p); }
  return [...g.values()];
}
// Kortet viser og handler på kjøpet med mest igjen (ved likt: det nyeste).
const pickRep = (items) => [...items].sort((a, b) => remaining(b) - remaining(a) || b.orderDate.localeCompare(a.orderDate))[0];

// «Feil bilde»: er bildet byttet etter at det ble merket? Da kan eieren sjekke det og fjerne krysset.
// Bildefilteret: én test per valg (pstate.imgf).
const IMG_FILTERS = [
  ["none", "Mangler bilde", (p) => !p.image],
  ["similar", "Lånt bilde, ikke godkjent", (p) => !!p.image && p.imgSearch && !p.imgManual],
  ["search", "Funnet av bildesøk", (p) => p.imgBy === "bildesøk" && !!p.image],
  ["locked", "Låst (satt for hånd)", (p) => p.imgManual],
  ["wrong", "Feil bilde", (p) => p.imgWrong && !imgFixed(p)],
  ["fixed", "Byttet – sjekk", (p) => imgFixed(p)],
  ["web", "Fra nettet – godkjenn", (p) => p.imgWeb],
];
const imgFixed = (p) => p.imgWrong && !!p.imgUpdated && p.imgUpdated > (p.imgWrongAt || "");
const fmtStamp = (iso) => (iso ? new Date(iso).toLocaleString("nb-NO", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");

const PAGE = 120;
let shown = PAGE;

function partCard(group) {
  const all = siblings(group[0]);
  const p = pickRep(all);
  const many = all.length > 1;
  const left = all.reduce((n, x) => n + remaining(x), 0);
  const total = all.reduce((n, x) => n + units(x), 0);
  const bought = !many && p.pack > 1 ? `${p.qty} × ${p.pack} = ${total} stk` : `${total} stk`;
  const qty = (left === total ? bought : `${left} av ${total} stk igjen`) + (many ? ` · ${all.length} kjøp` : "");
  const newest = all.reduce((d, x) => (x.orderDate > d ? x.orderDate : d), "");
  const canMove = ctx.DEMO || p.owner === meName() || ctx.isAdmin?.();
  return `<div class="part-card${left === 0 ? " used-up" : ""}"${canMove ? ` draggable="true" data-dragid="${ctx.esc(p.id)}" title="Dra til en kategori for å flytte"` : ""}>
  <button class="part-open" type="button" data-part="${ctx.esc(p.id)}">
    <span class="part-img">${p.image ? `<img src="${ctx.esc(/alicdn|aliexpress-media/.test(p.image) ? `${p.image}_220x220.jpg` : p.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-full="${ctx.esc(p.image)}">` : `<span class="part-noimg">${ctx.esc(CAT_NAME[p.category])}</span>`}
</span>
    <span class="part-cat">${p.imgWeb ? `<span class="img-wrong-tag web">Fra nettet – godkjenn</span> ` : ""}${p.imgWrong ? (imgFixed(p) ? `<span class="img-wrong-tag fixed" title="Byttet ${ctx.esc(fmtStamp(p.imgUpdated))}">Byttet – sjekk</span> ` : `<span class="img-wrong-tag">Feil bilde</span> `) : ""}${ctx.esc(CAT_NAME[p.category])}</span>
    <span class="part-body">
      <span class="part-title">${ctx.esc(p.title || "Uten navn")}</span>
      ${p.variant ? `<span class="part-variant">${ctx.esc(p.variant)}</span>` : ""}
      ${p.manualNo ? `<span class="kit-tag manual-no" title="Opprettet for hånd, løpenummer M-${p.manualNo}">✎ Opprettet for hånd · M-${p.manualNo}</span>` : ""}
      ${p.parent ? `<span class="kit-tag kit-child" title="${ctx.esc(kitOf(p)?.title || "")}">📦 Del av samling${kitOf(p) ? `: ${ctx.esc(kitOf(p).title)}` : ""}</span>` : kitParts(p).length ? `<span class="kit-tag">Sett · ${kitParts(p).length} delprodukter</span>` : ""}
      <span class="part-meta"><b>${ctx.esc(qty)}</b>${fmtMoney(p) ? ` · ${ctx.esc(fmtMoney(p))}/stk` : ""}</span>
      ${p.pkg ? `<span class="part-pkg" title="${ctx.esc(packageInfo(p.pkg))}">${footprintSvg(p.pkg, 24) || packageSvg(p.pkg, 22)}${ctx.esc(p.pkg)}</span>` : ""}
      <span class="part-foot"><span class="owner-dot" style="--owner:${ctx.userColor(p.owner)}"></span>${ctx.esc(p.owner || "Ukjent")}<span class="part-date">${ctx.esc(fmtDate(newest))}</span></span>
    </span>
  </button>
  ${needsImgApproval(p) && (ctx.DEMO || p.owner === meName()) ? `<label class="img-ok"><input type="checkbox" data-imgok="${ctx.esc(p.id)}"> Bildet stemmer – godkjenn</label>` : ""}
  ${ctx.token() || ctx.DEMO ? stepper(p) : ""}
  </div>`;
}

// Bildet venter på at eieren sier at det stemmer: funnet på nettet, byttet etter «Feil bilde»,
// eller lånt fra en lignende vare (AliExpress-originalen er borte) og ikke godkjent ennå.
const needsImgApproval = (p) => p.imgWeb || imgFixed(p) || (!!p.image && p.imgSearch && !p.imgManual);

// Godkjenn bildet rett fra kortet: fjerner «Fra nettet – godkjenn» og «Feil bilde», og låser bildet
// (bildesøket bytter det ikke ut). Gjelder alle kjøp av samme vare med samme bilde.
async function approveImage(p) {
  const now = new Date().toISOString();
  const list = siblings(p).filter((x) => x.owner === p.owner && x.image === p.image && needsImgApproval(x));
  if (!list.includes(p)) list.push(p);
  for (const x of list) {
    x.imgWeb = false;
    x.imgWrong = false;
    x.imgWrongAt = "";
    x.imgManual = true;
    x.updated = now;
  }
  render();
  if (!ctx.DEMO) await savePatch(list.map((x) => ({ id: x.id, data: x })));
  ctx.setSync(`Bildet er godkjent${list.length > 1 ? ` (${list.length} kjøp)` : ""}`);
}

// ---------- Brukt ----------
async function useParts(p, n, save = true) {
  const taken = [], changed = [];
  let need = n;
  // siblings() følger filtrene på siden; varen selv er alltid med.
  const pool = siblings(p).filter((y) => y.owner === p.owner);
  if (!pool.includes(p)) pool.push(p);
  for (const x of pool.sort((a, b) => remaining(b) - remaining(a))) {
    if (need <= 0) break;
    const t = Math.min(need, remaining(x));
    if (!t) continue;
    const left = remaining(x) - t;
    x.left = left === units(x) ? null : left;
    x.updated = new Date().toISOString();
    taken.push({ id: x.id, n: t });
    changed.push(x);
    need -= t;
  }
  if (need > 0 && !taken.length) throw new Error("Det er ingen igjen å trekke fra.");
  if (save && changed.length && !ctx.DEMO) await savePatch(changed.map((x) => ({ id: x.id, data: x })));
  return { taken, changed, short: need };
}
// Legg tilbake det som ble trukket fra (f.eks. når et ferdig prosjekt åpnes igjen).
function unuseParts(taken) {
  const changed = [];
  for (const { id, n } of taken || []) {
    const x = pstate.parts.find((y) => y.id === id);
    if (!x) continue;
    const left = Math.min(units(x), remaining(x) + n);
    x.left = left === units(x) ? null : left;
    x.updated = new Date().toISOString();
    changed.push(x);
  }
  return changed;
}

// − / antall / + under hvert kort: legg varer i handlekurven uten å åpne detaljvinduet.
const cartQty = (id) => cartDrafts().filter((q) => q.partId === id).reduce((s, q) => s + q.qty, 0);
function stepper(p) {
  if (p.owner && p.owner === meName()) {
    const left = siblings(p).filter((y) => y.owner === p.owner).reduce((sum, y) => sum + remaining(y), 0);
    return `<div class="part-step part-used-step"><span>${left} igjen</span><button type="button" class="part-used" data-usedone="${ctx.esc(p.id)}" ${left ? "" : "disabled"} title="Brukt én: trekk fra lageret">Brukt −1</button></div>`;
  }
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

// Ny tegning nullstiller rullingen i kategorilisten (egen rulling) og i chip-radene som rulles
// sidelengs på mobil. Den tas vare på, så listen ikke hopper til toppen når man f.eks. flytter en vare.
function render() {
  const box = ctx.$("#parts-root");
  const rail = box?.querySelector(".parts-rail")?.scrollTop || 0;
  const rows = box ? [...box.querySelectorAll(".chips")].map((c) => c.scrollLeft) : [];
  renderView();
  if (!box) return;
  const r = box.querySelector(".parts-rail");
  if (r && rail) r.scrollTop = rail;
  box.querySelectorAll(".chips").forEach((c, i) => { if (rows[i]) c.scrollLeft = rows[i]; });
}

function renderView() {
  updateBadge();
  const box = ctx.$("#parts-root");
  if (!box || box.hidden) return;
  if (pstate.view === "import") return renderImport(box);
  if (pstate.view === "cart" && (ctx.token() || ctx.DEMO)) return renderCart(box);
  if (pstate.view === "requests" && (ctx.token() || ctx.DEMO)) return renderRequests(box);
  if (pstate.view === "projects" && (ctx.token() || ctx.DEMO)) return renderProjects(box);
  if (!ctx.token() && !ctx.DEMO) {
    box.innerHTML = `<section class="panel"><h2>Komponenter</h2><p class="hint">Logg inn for å se komponentbiblioteket.</p></section>`;
    return;
  }
  const all = visibleParts();
  if (pstate.cat && !all.some((p) => p.category === pstate.cat)) pstate.cat = "";
  const list = filtered();
  const groups = groupParts(list);
  // Tallene i filtrene teller produkter (flere kjøp av samme vare = én), som «varer totalt» og listen.
  const products = (list) => new Set(list.map(groupKey)).size;
  const showOk = (p) => pstate.show === "all" || (pstate.show === "have" ? remaining(p) > 0 : remaining(p) === 0);
  const count = (key, val) => products(all.filter((p) => p[key] === val && showOk(p)));
  // «varer totalt» teller som eier-filteret: samme «Har igjen/Brukt opp/Alle»-valg, og bare valgt eier.
  const total = products(all.filter((p) => showOk(p) && (!pstate.owner || p.owner === pstate.owner)));
  const owners = [...new Set(all.map((p) => p.owner).filter(Boolean))].sort();
  const pkgCount = {};
  for (const p of all) if (p.pkg) (pkgCount[p.pkg] ||= new Set()).add(groupKey(p));
  for (const k in pkgCount) pkgCount[k] = pkgCount[k].size;
  const pkgs = Object.entries(pkgCount).sort((a, b) => b[1] - a[1]).slice(0, 18);
  const cats = sortedCats().map(([id, name]) => [id, name, count("category", id)]);
  const chip = (key, val, label, n, dot) => `<button class="chip${pstate[key] === val ? " active" : ""}${key === "cat" && val ? ` cat-drop${!n && !isCustomCat(val) ? " empty" : ""}` : ""}" type="button" data-pf="${key}" data-pv="${ctx.esc(val)}">${dot ? `<span class="owner-dot" style="--owner:${dot}"></span>` : ""}${ctx.esc(label)}${n !== undefined ? ` <span class="chip-n">${n}</span>` : ""}</button>`;
  // Betalt (vises bare for administrator): ordretotalen (inkl. frakt og avgifter) telles én gang per ordre, i alle valutaer.
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
  const spentTip = Object.entries(spent).sort((a, b) => b[1] - a[1]).map(([c, v]) => c === "NOK" ? nok(v) : fmtMoney({ unitPrice: Math.round(v), currency: c }).replace(/[,.]00$/, "")).join(" + ");
  box.innerHTML = subnav() + `
    <div class="parts-layout">
      <aside class="parts-rail">
        <div class="stats stats-side">
          <div class="stat"><b>${total.toLocaleString("nb-NO")}</b><span>varer totalt</span></div>
          ${totalNok && (ctx.DEMO || (ctx.isAdmin?.() && !pstate.prefs[meName()]?.hideSpent)) ? `<div class="stat" title="${ctx.esc(`${spentTip}. Omregnet til kroner med omtrentlig kurs.${noTotal.size ? ` For ${noTotal.size} ordre finnes ikke totalen lenger hos butikken (gamle AliExpress-ordre), så der er bare varene med, uten frakt.` : ""}`)}"><b>${Math.round(totalNok / 1000).toLocaleString("nb-NO")}k</b><span>kr betalt, ca. (${allOrders.size.toLocaleString("nb-NO")} ordre${noTotal.size ? `, frakt mangler for ${noTotal.size}` : ", inkl. frakt"})</span></div>` : ""}
        </div>
        <nav class="parts-cats" aria-label="Kategori"><span class="rail-label">Kategori <button type="button" class="linkbtn cat-edit-btn" data-editcats>${pstate.editCats ? "Ferdig" : "Endre"}</button></span>
        ${pstate.editCats ? `<div class="cat-edit">
            ${cats.filter(([id]) => id !== "other").map(([id, name, n]) => `<div class="cat-edit-row"><input type="text" maxlength="40" value="${ctx.esc(name)}" data-renamecat="${id}" aria-label="Navn på kategori">${isCustomCat(id) ? `<button type="button" class="btn btn-small" data-delcat="${id}" ${n ? "disabled title=\"Flytt varene først\"" : ""}>Slett</button>` : ""}</div>`).join("")}
            <form class="cat-edit-row" data-newcatform><input type="text" maxlength="40" id="newcat-name" placeholder="Ny kategori …" aria-label="Ny kategori"><button type="submit" class="btn btn-small btn-primary">Legg til</button></form>
            <p class="hint">Kategoriene er felles for alle. Endre navnet og trykk Enter eller klikk utenfor. Dra et kort til en kategori for å flytte det.</p>
          </div>`
        : `<div class="chips">${chip("cat", "", "Alle", undefined)}${cats.map(([id, name, n]) => chip("cat", id, name, n)).join("")}<button type="button" class="chip chip-add" data-editcats data-addcat>+ Ny</button></div>`}
        </nav>
        ${pstate.cat === "semi" ? (() => {
          const semis = all.filter((p) => p.category === "semi" && (pstate.show === "all" || (pstate.show === "have" ? remaining(p) > 0 : remaining(p) === 0)));
          const n = {};
          for (const p of semis) (n[semiType(p)] ||= new Set()).add(groupKey(p));
          for (const k in n) n[k] = n[k].size;
          return `<nav class="parts-cats parts-sub" aria-label="Type halvleder"><span class="rail-label">Type halvleder</span><div class="chips">${chip("sub", "", "Alle", undefined)}${SEMI_TYPES.filter(([id]) => n[id]).map(([id, name]) => chip("sub", id, name, n[id])).join("")}</div></nav>`;
        })() : ""}
      </aside>
      <div class="parts-main">
        <section class="panel filters">
          <div class="filter-row">
            <input id="parts-q" type="search" placeholder="Søk etter navn, variant, butikk, ordrenummer, plassering…" aria-label="Søk i komponenter" value="${ctx.esc(pstate.q)}">
            ${ctx.token() || ctx.DEMO ? `<button type="button" class="btn btn-primary" data-newpart>+ Nytt produkt</button>` : ""}
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
          ${(() => {
            const n = IMG_FILTERS.map(([id, label, test]) => [id, label, products(all.filter(test))]).filter(([id, , c]) => c || id === pstate.imgf);
            return n.length ? `<div class="chip-row"><span class="chip-label">Bilde</span><div class="chips">${chip("imgf", "", "Alle")}${n.map(([id, label, c]) => chip("imgf", id, label, c)).join("")}</div></div>` : "";
          })()}
        </section>
        ${pstate.loading ? `<p class="count">Henter komponenter…</p>` : pstate.error ? `<p class="notice">${ctx.esc(pstate.error)}</p>` : ""}
        ${!pstate.loading && !all.length ? `<section class="panel empty-parts"><h2>Ingen komponenter ennå</h2><p class="hint">Importer det du har kjøpt hos AliExpress eller Mouser, så havner alt her, sortert i kategorier.</p><button class="btn btn-primary" type="button" data-pview="import">Importer</button></section>` : ""}
        ${all.length ? `<p class="count">${groups.length.toLocaleString("nb-NO")} varer${groups.length < list.length ? ` (${list.length.toLocaleString("nb-NO")} kjøp)` : ""}${groups.length > shown ? `, viser ${shown}` : ""}${hiddenMatches(list.length) > 0 ? ` · <button class="linkbtn" type="button" data-pclear>${hiddenMatches(list.length).toLocaleString("nb-NO")} treff til skjules av filtrene, vis alle</button>` : ""}</p>` : ""}
        <section class="parts-grid">${groups.slice(0, shown).map(partCard).join("")}</section>
        ${groups.length > shown ? `<button class="btn parts-more" type="button" data-pmore>Vis flere (${(groups.length - shown).toLocaleString("nb-NO")} til)</button>` : ""}
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

// ---------- Nytt produkt for hånd, med bildetolkning ----------
//
// Bildet krympes i nettleseren til et lite JPEG (data-URL) og sendes til Workeren (/ai/describe), som
// foreslår tittel, delenummer, produsent, pakketype og kategori. Forslagene fylles inn i skjemaet og kan rettes.
async function shrinkImage(file, maxSide = 800, maxLen = OWN_IMG_MAX) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const cv = document.createElement("canvas");
  cv.width = Math.max(1, Math.round(bmp.width * k));
  cv.height = Math.max(1, Math.round(bmp.height * k));
  const g = cv.getContext("2d");
  g.fillStyle = "#fff";
  g.fillRect(0, 0, cv.width, cv.height);
  g.drawImage(bmp, 0, 0, cv.width, cv.height);
  for (const q of [0.78, 0.68, 0.58, 0.48, 0.4, 0.32]) {
    const url = cv.toDataURL("image/jpeg", q);
    if (url.length <= maxLen) return url;
  }
  throw new Error("Bildet ble for stort selv etter krymping. Prøv et enklere bilde.");
}
function openNewPart() {
  let dlg = ctx.$("#newpart-dialog");
  if (!dlg) {
    dlg = document.createElement("dialog");
    dlg.id = "newpart-dialog";
    dlg.className = "wide-dialog part-dialog";
    document.body.appendChild(dlg);
  }
  let image = "", aiImage = ""; // aiImage: større utgave bare til bildetolkningen (liten skrift leses bedre), lagres ikke
  dlg.innerHTML = `<button type="button" class="dlg-close" aria-label="Lukk" title="Lukk (Esc)">×</button>
  <form class="newpart" method="dialog">
    <h2>Nytt produkt</h2>
    <p class="hint">Ta eller velg et bilde, så foreslår appen tittel, delenummer, pakke og kategori. Du kan rette alt før du lagrer. Delprodukter legger du til etterpå.</p>
    <div class="np-img">
      <div class="np-preview"><span class="hint">Ingen bilde</span></div>
      <div class="np-actions">
        <label class="btn">Velg eller ta bilde<input id="np-file" type="file" accept="image/*" hidden></label>
        <button type="button" class="btn btn-primary" data-npsuggest disabled>Foreslå overskrift fra bildet</button>
        <p class="hint np-msg" role="status"></p>
      </div>
    </div>
    <label>Tittel<input id="np-title" type="text" maxlength="300" placeholder="F.eks. 180PCS SOT-23 Transistor Kit" required></label>
    <div class="np-row">
      <label>Delenummer<input id="np-mpn" type="text" maxlength="80"></label>
      <label>Produsent<input id="np-maker" type="text" maxlength="80"></label>
      <label>Pakke<input id="np-pkg" type="text" maxlength="30" placeholder="SOT-23, TO-92 …"></label>
    </div>
    <div class="np-row">
      <label>Kategori<select id="np-cat">${sortedCats().map(([cid, name]) => `<option value="${cid}"${cid === "other" ? " selected" : ""}>${ctx.esc(name)}</option>`).join("")}</select></label>
      <label>Antall (stk)<input id="np-qty" type="number" min="1" max="1000000" value="1"></label>
      <label>Plassering<input id="np-loc" type="text" maxlength="80" placeholder="F.eks. Skuff 3"></label>
    </div>
    <label>Beskrivelse<textarea id="np-desc" rows="2" maxlength="600"></textarea></label>
    <div class="np-row">
      <label class="grow">Delprodukter i settet (delenumre, ett per linje eller skilt med komma; tom = ingen)<textarea id="np-parts" rows="3" maxlength="2000" placeholder="BC327, BC337, BC517, BC547"></textarea></label>
      <label>Antall hver<input id="np-kitqty" type="number" min="1" max="100000" value="20"></label>
    </div>
    <div class="part-actions">
      <button class="btn" value="cancel" type="submit" formnovalidate>Avbryt</button>
      <button class="btn btn-primary" type="button" data-npsave>Lagre produkt</button>
    </div>
  </form>`;
  const $ = (s) => dlg.querySelector(s);
  const msg = (t, bad) => { const m = $(".np-msg"); m.textContent = t; m.classList.toggle("bad", !!bad); };
  $(".np-preview").onclick = () => { if (image) openImageZoom(image, $("#np-title").value.trim() || "Bilde"); };
  $("#np-file").onchange = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      image = await shrinkImage(f);
      aiImage = await shrinkImage(f, 1400, 600000).catch(() => image);
      $(".np-preview").innerHTML = `<img src="${ctx.esc(image)}" alt="Forhåndsvisning">`;
      $("[data-npsuggest]").disabled = false;
      msg(`Bildet er klart (${Math.round(image.length / 1024)} kB).`);
    } catch (err) { image = ""; $("[data-npsuggest]").disabled = true; msg(err.message, true); }
  };
  $("[data-npsuggest]").onclick = async (ev) => {
    const btn = ev.currentTarget;
    btn.disabled = true;
    msg("Leser bildet …");
    try {
      if (ctx.DEMO) throw new Error("Bildetolkning er ikke tilgjengelig i demoen.");
      const r = await ctx.dbCall("/ai/describe", { image: aiImage || image, cats: sortedCats().map(([id, name]) => ({ id, name })) });
      const put = (sel, v) => { if (v && !$(sel).value.trim()) $(sel).value = v; };
      // Alle delenumre i et sett skal stå i tittelen (som i butikklistinger), så delproduktene kan utledes fra den.
      const names = r.parts?.length ? r.parts : String(r.mpn).split(/[\s,;]+/).filter(Boolean).length > 1 ? String(r.mpn).split(/[\s,;]+/).filter(Boolean) : [];
      let title = String(r.title || "").trim();
      const missing = names.filter((n) => !title.toUpperCase().includes(n.toUpperCase()));
      if (names.length >= 2 && missing.length) title = `${title} ${names.join(",")}`.trim();
      if (title) $("#np-title").value = title;
      if (names.length < 2) put("#np-mpn", r.mpn); put("#np-maker", r.maker); put("#np-desc", [r.description, r.tolerance ? `Toleranse ${r.tolerance}.` : ""].filter(Boolean).join(" "));
      // Pakke: fra modellen, ellers fra tittelen («SOT-23 Transistor Kit») eller fra kjente delenumre (BC547 → TO-92).
      put("#np-pkg", findPackage(r.pkg) || r.pkg || findPackage(title) || names.map((n) => String(findPart(n, n)?.pkg || "").split("/")[0]).find(Boolean) || "");
      if (r.category) $("#np-cat").value = r.category;
      // Delprodukter og antall hver utledes fra tittelen, på samme måte som «Opprett delprodukter fra tittelen».
      const kit = deriveKit(title);
      if (kit && !$("#np-parts").value.trim()) {
        $("#np-parts").value = kit.mpns.join(", ");
        if (kit.each) $("#np-kitqty").value = kit.each;
        $("#np-qty").value = 1;
      }
      msg(r.title ? "Forslag fylt inn. Sjekk og rett det som er feil." : "Fant ikke noe tydelig i bildet. Fyll inn for hånd.", !r.title);
    } catch (err) { msg(err.message, true); }
    btn.disabled = false;
  };
  $("[data-npsave]").onclick = async (ev) => {
    const title = $("#np-title").value.trim();
    if (!title) { $("#np-title").focus(); msg("Skriv en tittel.", true); return; }
    ev.currentTarget.disabled = true;
    const today = new Date().toISOString();
    const c = cleanPart({
      id: `manual:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, source: "manual", owner: meName(),
      title, mpn: $("#np-mpn").value, maker: $("#np-maker").value, pkgFixed: $("#np-pkg").value, description: $("#np-desc").value,
      qty: Math.max(1, Math.round(Number($("#np-qty").value) || 1)), pack: 1, packManual: true, location: $("#np-loc").value,
      image, imgManual: !!image, imgBy: image ? meName() : "", imgUpdated: image ? today : "",
      category: $("#np-cat").value, catManual: true, orderDate: today.slice(0, 10), added: today, updated: today,
      manualNo: Math.max(0, ...pstate.parts.map((x) => x.manualNo || 0)) + 1,
    });
    try {
      pstate.parts.push(c);
      if (!ctx.DEMO) await savePatch([{ id: c.id, data: c }]);
      const kids = parseKitLines($("#np-parts").value, Math.max(1, Math.round(Number($("#np-kitqty").value) || 1)));
      if (kids.length) await addKitParts(c, kids);
      render();
      dlg.close("");
      ctx.setSync("Produktet er lagret");
      openPart(c.id);
    } catch (err) {
      pstate.parts = pstate.parts.filter((x) => x.id !== c.id);
      msg(err.message, true);
      ev.currentTarget.disabled = false;
    }
  };
  dlg.querySelector(".dlg-close").onclick = () => dlg.close("");
  dlg.showModal();
}

// ---------- Analyser bilde og overskrift på eksisterende produkter ----------
//
// Samme bildetolkning som ved «Nytt produkt», men for varer som allerede ligger i biblioteket. Resultatet vises som et
// forslag (nå -> forslag) med avkrysning, og ingenting endres før eieren trykker «Bruk valgte». Mønsteret i overskriften
// leses også (sett med flere delenumre, «200PCS … Kit»), også når varen ikke har bilde. Rettelsene lagres i p.ov, så
// en ny import fra butikken ikke skriver dem over.
function dataUrlToBlob(url) {
  const m = /^data:([^;,]+);base64,(.*)$/.exec(url);
  if (!m) throw new Error("Ugyldig bilde.");
  const bin = atob(m[2]), buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return new Blob([buf], { type: m[1] });
}
async function readImageWithAi(p) {
  const cats = sortedCats().map(([id, name]) => ({ id, name }));
  // Butikkbilder tillater lesing fra andre sider (CORS). Nettleseren laster dem som bilde (CSP tillater det, ikke fetch),
  // krymper dem og sender dem selv. Workeren henter bildet bare hvis det ikke går.
  let src = null;
  try {
    if (p.image.startsWith("data:")) src = dataUrlToBlob(p.image);
    else {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.referrerPolicy = "no-referrer";
      img.src = p.image.replace(/_\d+x\d+\.(jpg|png|webp)$/i, "");
      await img.decode();
      src = img;
    }
  } catch { /* faller tilbake til Workeren */ }
  if (!src) return ctx.dbCall("/ai/describe", { imageUrl: p.image, cats });
  const image = await shrinkImage(src, 1400, 600000).catch(() => (p.image.startsWith("data:") ? p.image : ""));
  if (!image) return ctx.dbCall("/ai/describe", { imageUrl: p.image, cats });
  return ctx.dbCall("/ai/describe", { image, cats });
}
// r: svaret fra bildetolkningen (eller null). Returnerer rader {key, label, now, next, checked} og eventuelle nye delprodukter.
function proposeChanges(p, r) {
  const rows = [];
  const own = deriveKit(p.title)?.mpns || [];
  const fromImg = r?.parts?.length ? r.parts : String(r?.mpn || "").split(/[\s,;]+/).filter((x) => x.length >= 3).length > 1 ? String(r.mpn).split(/[\s,;]+/).filter((x) => x.length >= 3) : [];
  const names = [...new Set([...own, ...fromImg.map(partCase)])];
  // Alle delenumre i et sett skal stå i overskriften (som i butikklistinger), så delproduktene kan utledes fra den.
  let title = p.title;
  if (!title && r?.title) title = r.title;
  const kitLike = names.length >= 3 || fromImg.length >= 2 || /\b(kit|assort\w*|sets?|\d+\s*values?|\d+\s*kinds?|\d+\s*types?)\b/i.test(p.title);
  const missing = names.length >= 2 && kitLike ? names.filter((n) => !title.toUpperCase().includes(n.toUpperCase())) : [];
  if (missing.length) title = `${title} ${missing.join(",")}`.trim();
  title = clip(title, 300);
  if (title && title !== p.title) rows.push({ key: "title", label: "Overskrift", now: p.title, next: title, checked: true });
  const one = (key, label, now, next, checked) => { next = String(next || "").trim(); if (next && next.toLowerCase() !== String(now || "").toLowerCase()) rows.push({ key, label, now, next, checked }); };
  if (!(names.length >= 2 && kitLike)) one("mpn", "Delenummer", p.mpn, r?.mpn, !p.mpn);
  one("maker", "Produsent", p.maker, r?.maker, !p.maker);
  const pkg = findPackage(r?.pkg) || r?.pkg || (names.length >= 2 ? findPackage(title) : "");
  one("pkgFixed", "Pakke", p.pkg, pkg, !p.pkg);
  const tol = String(r?.tolerance || "").trim();
  // Toleransen (±10 %) er nyttig produktinformasjon og tas med i beskrivelsen.
  const withTol = (d) => (tol && !String(d).replace(/\s/g, "").includes(tol.replace(/\s/g, "")) ? `${String(d).trim()} Toleranse ${tol}.`.trim() : String(d || "").trim());
  one("description", "Beskrivelse", p.description, withTol(p.description || r?.description || ""), !p.description || (!!tol && !p.description.includes(tol)));
  if (r?.category && CAT_NAME[r.category] && r.category !== p.category) rows.push({ key: "category", label: "Kategori", now: CAT_NAME[p.category], next: r.category, checked: p.category === "other" && !p.catManual });
  const kit = p.parent || !kitLike ? null : deriveKit(title);
  const have = new Set(kitParts(p).map((k) => k.mpn.toUpperCase()));
  const fresh = kit ? kit.mpns.filter((m) => !have.has(m.toUpperCase())) : [];
  // Delprodukter med verdier skrevet med feil liten/stor bokstav (1UH i stedet for 1uH, MH i stedet for mH).
  const fix = kitParts(p).filter((k) => normValue(k.mpn) && normValue(k.mpn) !== k.mpn).map((k) => [k.id, k.mpn, normValue(k.mpn)]);
  return { rows, fix, kit: fresh.length ? { mpns: fresh, each: kit.each || 1, had: have.size, kinds: /\d+\s*(values?|kinds?|types?)\b/i.test(title) ? kit.kinds : 0 } : null };
}
function renderProposal(dlg, p, prop, note) {
  const box = dlg.querySelector(".ai-box");
  const cell = (r) => r.key === "category"
    ? `<select data-aival="category">${sortedCats().map(([cid, name]) => `<option value="${ctx.esc(cid)}"${cid === r.next ? " selected" : ""}>${ctx.esc(name)}</option>`).join("")}</select>`
    : `<input type="text" data-aival="${r.key}" value="${ctx.esc(r.next)}" maxlength="${r.key === "description" ? 600 : 300}">`;
  const body = prop.rows.map((r) => `<tr><td><label><input type="checkbox" data-aikey="${r.key}"${r.checked ? " checked" : ""}> ${ctx.esc(r.label)}</label></td><td class="ai-now">${ctx.esc(r.now || "(tomt)")}</td><td>${cell(r)}</td></tr>`).join("");
  const kit = prop.kit ? `<tr><td><label><input type="checkbox" data-aikey="kit" checked> Delprodukter</label></td><td class="ai-now">${prop.kit.had ? `${prop.kit.had} fra før` : "(ingen)"}</td><td><input type="text" data-aikitlist maxlength="1500" value="${ctx.esc(prop.kit.mpns.join(", "))}"> <span class="hint">× <input type="number" data-aikitqty min="1" max="100000" value="${prop.kit.each}"> stk hver</span>${prop.kit.kinds && prop.kit.had + prop.kit.mpns.length < prop.kit.kinds ? `<br><span class="hint ai-missing">Overskriften sier ${prop.kit.kinds} typer, men bare ${prop.kit.had + prop.kit.mpns.length} er funnet. Legg til resten for hånd i feltet.</span>` : ""}</td></tr>` : "";
  const fix = prop.fix?.length ? `<tr><td><label><input type="checkbox" data-aikey="fixcase" checked> Skrivemåte</label></td><td class="ai-now">${ctx.esc(prop.fix.slice(0, 8).map((x) => x[1]).join(", "))}${prop.fix.length > 8 ? " …" : ""}</td><td>${ctx.esc(prop.fix.slice(0, 8).map((x) => x[2]).join(", "))}${prop.fix.length > 8 ? " …" : ""} <span class="hint">(${prop.fix.length} delprodukter, m = milli, M = mega, u = mikro)</span></td></tr>` : "";
  box.innerHTML = `<h3>Forslag til endringer</h3>${note ? `<p class="hint">${ctx.esc(note)}</p>` : ""}
    ${body || kit || fix ? `<table class="ai-table"><thead><tr><th>Felt</th><th>Nå</th><th>Forslag</th></tr></thead><tbody>${body}${fix}${kit}</tbody></table>
    <p><button type="button" class="btn btn-primary" data-aiapply>Bruk valgte</button> <span class="hint ai-apply-msg" role="status"></span></p>` : `<p class="hint">Ingen endringer å foreslå.</p>`}`;
  box.hidden = false;
  dlg._ai = prop;
}
async function analysePart(dlg, p, btn) {
  const msg = dlg.querySelector(".ai-msg");
  btn.disabled = true;
  let r = null, note = "";
  try {
    if (p.image) {
      if (ctx.DEMO) note = "Bildetolkning er ikke tilgjengelig i demoen. Forslaget bygger bare på overskriften.";
      else { msg.textContent = "Leser bildet …"; r = await readImageWithAi(p); }
    } else note = "Varen har ikke bilde. Forslaget bygger bare på overskriften.";
  } catch (err) { note = `Bildet kunne ikke leses (${err.message}). Forslaget bygger bare på overskriften.`; }
  msg.textContent = "";
  renderProposal(dlg, p, proposeChanges(p, r), note || (r && !r.title && !r.parts?.length ? "Fant ikke noe tydelig i bildet." : ""));
  btn.disabled = false;
}
async function applyProposal(dlg, p, btn) {
  const prop = dlg._ai, box = dlg.querySelector(".ai-box"), out = box.querySelector(".ai-apply-msg");
  const on = new Set([...box.querySelectorAll("[data-aikey]:checked")].map((i) => i.dataset.aikey));
  if (!on.size) { out.textContent = "Velg minst én endring."; return; }
  const val = (k) => box.querySelector(`[data-aival="${k}"]`)?.value.trim() || "";
  btn.disabled = true;
  const ov = { ...(p.ov || {}) };
  for (const k of OV_KEYS) if (on.has(k) && val(k)) { p[k] = val(k); ov[k] = val(k); }
  p.ov = ov;
  if (on.has("category") && CAT_NAME[val("category")]) { p.category = val("category"); p.catManual = true; }
  Object.assign(p, cleanPart(p));
  try {
    await saveOne(p);
    if (on.has("fixcase") && prop.fix?.length) {
      for (const [id, , good] of prop.fix) { const k = pstate.parts.find((x) => x.id === id); if (k) { k.mpn = good; k.title = good; } }
      await savePatch(prop.fix.map(([id]) => pstate.parts.find((x) => x.id === id)).filter(Boolean).map((k) => ({ id: k.id, data: k })));
    }
    if (on.has("kit") && prop.kit) {
      const each = Math.max(1, Math.round(Number(box.querySelector("[data-aikitqty]")?.value) || 1));
      const typed = parseKitLines(box.querySelector("[data-aikitlist]")?.value || "", each);
      await addKitParts(p, typed);
    }
    ctx.setSync("Endringene er lagret");
    dlg.close("");
    openPart(p.id);
  } catch (err) { out.textContent = err.message; btn.disabled = false; }
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
  const row = (k, v, cls = "") => (v ? `<tr${cls ? ` class="${cls}"` : ""}><th>${ctx.esc(k)}</th><td>${v}</td></tr>` : "");
  // Ordredetaljer (eier, dato, butikk, ordrenummer, status) er skjult til man åpner dem; valget huskes.
  const orderOpen = ctx.store("bf.partOrder") === "1";
  const hasOrder = !!(p.owner || p.orderDate || p.source || p.orderId || p.status);
  dlg.innerHTML = `<button type="button" class="dlg-close" aria-label="Lukk" title="Lukk (Esc)">×</button>
  <form method="dialog" class="part-detail">
    <div class="part-detail-side">
      <div class="part-detail-img">${p.image ? `<img src="${ctx.esc(p.image)}" alt="" referrerpolicy="no-referrer">` : `<span class="part-noimg">${ctx.esc(CAT_NAME[p.category])}</span>`}</div>
      ${ELECTRONICS.has(p.category) || p.source === "mouser" || p.source === "lcsc" ? componentHtml(p) : ""}
    </div>
    <div class="part-detail-text">
      ${(() => { const k = kitOf(p); return k ? `<div class="kit-back-box">${k.image ? `<button type="button" class="kit-back-img" data-sibling="${ctx.esc(k.id)}" title="${ctx.esc(k.title)}" aria-label="Tilbake til ${ctx.esc(k.title)}"><img src="${ctx.esc(k.image)}" alt="" referrerpolicy="no-referrer"></button>` : ""}<div><button type="button" class="btn btn-small kit-back" data-sibling="${ctx.esc(k.id)}" title="${ctx.esc(k.title)}">← Tilbake til hovedprodukt</button><span class="hint kit-back-name">Del av: ${ctx.esc(k.title)}</span></div></div>` : ""; })()}
      <h2>${ctx.esc(p.title)}</h2>
      ${p.variant ? `<p class="part-variant">${ctx.esc(p.variant)}</p>` : ""}
      <table class="part-facts${orderOpen ? " order-open" : ""}">
        ${row("Kjøpt", `${p.pack > 1 ? `${ctx.esc(p.qty)} × ${ctx.esc(p.pack)} stk = <b>${units(p)} stk</b>` : `<b>${units(p)} stk</b>`}${fmtMoney(p) ? ` à ${ctx.esc(fmtMoney(p))}${p.pack > 1 ? ` (${ctx.esc(fmtMoney({ ...p, unitPrice: p.unitPrice / p.pack }))} per stk)` : ""}` : ""}${p.orderTotal ? ` · ordre totalt ${ctx.esc(fmtTotal(p.orderTotal))}` : ""}`)}
        ${hasOrder ? `<tr class="order-toggle-row"><th></th><td><button type="button" class="linkbtn order-toggle" data-ordertoggle aria-expanded="${orderOpen}"><span class="order-show">Vis ordredetaljer ▾</span><span class="order-hide">Skjul ordredetaljer ▴</span></button> <span class="hint">eier, dato, butikk, ordrenummer, status</span></td></tr>` : ""}
        ${row("Eier", `<span class="owner-dot" style="--owner:${ctx.userColor(p.owner)}"></span> ${ctx.esc(p.owner || "Ukjent")}`, "order-row")}
        ${row("Dato", ctx.esc(fmtDate(p.orderDate)), "order-row")}
        ${row("Opprettelsesnr.", p.manualNo ? `<b>M-${p.manualNo}</b> <span class="hint">opprettet for hånd</span>` : "")}
        ${(() => {
          const sib = siblings(p).sort((a, b) => b.orderDate.localeCompare(a.orderDate));
          if (sib.length < 2) return "";
          const left = sib.reduce((n, x) => n + remaining(x), 0), total = sib.reduce((n, x) => n + units(x), 0);
          return row("Alle kjøp", `<b>${total} stk</b> i ${sib.length} kjøp, ${left} igjen<ul class="buy-list">${sib.map((x) => `<li><button type="button" class="linkbtn${x.id === p.id ? " current" : ""}" data-sibling="${ctx.esc(x.id)}">${ctx.esc(fmtDate(x.orderDate) || "uten dato")} · ${units(x)} stk${fmtMoney(x) ? ` à ${ctx.esc(fmtMoney(x))}` : ""}${x.orderId ? ` · ordre ${ctx.esc(x.orderId)}` : ""}</button> <span class="hint">${remaining(x)} igjen</span></li>`).join("")}</ul>`);
        })()}
        ${(() => { const k = kitOf(p); return k ? row("Del av sett", `<button type="button" class="linkbtn" data-sibling="${ctx.esc(k.id)}">${ctx.esc(k.title)}</button>${k.orderId ? ` <span class="hint">ordre ${ctx.esc(k.orderId)}</span>` : ""}`) : ""; })()}
        ${row("Butikk", `${ctx.esc(SOURCE_LABEL[p.source])}${p.store && p.store !== "Mouser" ? ` · ${p.storeUrl ? `<a href="${ctx.esc(p.storeUrl)}" target="_blank" rel="noopener">${ctx.esc(p.store)}</a>` : ctx.esc(p.store)}` : ""}`, "order-row")}
        ${row("Ordrenummer", ctx.esc(p.orderId), "order-row")}
        ${row("Status", ctx.esc(p.status), "order-row")}
        ${row("Produsent", ctx.esc(p.maker))}
        ${row("Delenummer", ctx.esc(p.mpn))}
        ${row("Pakke", p.pkg ? `<span class="pkg-row">${footprintSvg(p.pkg, 150, { detail: true }) ? `<button type="button" class="fp-zoom-btn" data-fpzoom="${ctx.esc(p.pkg)}" title="Trykk for å forstørre" aria-label="Forstørr fotavtrykket for ${ctx.esc(p.pkg)}">${footprintSvg(p.pkg, 150, { detail: true })}<span class="fp-zoom-icon" aria-hidden="true">⤢</span></button>` : packageSvg(p.pkg, 64)}<span><b>${ctx.esc(p.pkg)}</b><br><span class="hint">${ctx.esc(packageInfo(p.pkg))}</span>${kicadName(p.pkg, kicadHint(p)) ? `<br><code class="kicad-name" title="Fotavtrykk i KiCads standardbibliotek">${ctx.esc(kicadName(p.pkg, kicadHint(p)))}</code>` : ""}${footprintCaption(p.pkg) ? `<br><span class="hint fp-cap">${ctx.esc(footprintCaption(p.pkg, kicadHint(p)))}</span><span class="fp-legend"><i class="cu"></i>F.Cu <i class="silk"></i>F.SilkS <i class="drill"></i>Drill</span>` : ""}</span></span>` : "")}
        ${row("Beskrivelse", ctx.esc(p.description))}
        ${row("Produktside", p.url ? `<a href="${ctx.esc(p.url)}" target="_blank" rel="noopener">Åpne hos ${ctx.esc(SOURCE_LABEL[p.source])} ↗</a>` : "")}
        ${row("Bilde", [p.imgSearch ? "Fra en lignende vare. Originalen er fjernet hos AliExpress." : "", p.imgUpdated ? `Sist byttet ${ctx.esc(fmtStamp(p.imgUpdated))}${p.imgBy ? ` (${ctx.esc(p.imgBy)})` : ""}.` : ""].filter(Boolean).join(" "))}
        ${row("Kategori hos butikken", ctx.esc(p.shopCat))}
        ${row("Datablad", p.datasheet ? `<a href="${ctx.esc(p.datasheet)}" target="_blank" rel="noopener">Åpne PDF ↗</a>` : "")}
      </table>
      ${mine && (ctx.token() || ctx.DEMO) ? `<p class="ai-row"><button type="button" class="btn" data-aianalyse>${p.image ? "Analyser bilde og overskrift" : "Analyser overskrift"}</button> <span class="hint ai-msg" role="status">Foreslår rettelser av overskrift, delenummer, pakke, kategori og delprodukter. Ingenting endres før du godkjenner.</span></p><div class="ai-box" hidden></div>` : ""}
      ${p.parent ? "" : (() => {
        const kids = kitParts(p);
        if (!kids.length && !mine) return "";
        return `<section class="kit-box"><h3>Innhold i settet${kids.length ? ` <span class="hint">(${kids.length} delprodukter)</span>` : ""}</h3>
          ${kids.length ? `<table class="kit-list"><thead><tr><th>Delprodukt</th><th>Igjen</th><th>Datablad</th></tr></thead><tbody>${kids.map((c) => `<tr><td><button type="button" class="linkbtn" data-sibling="${ctx.esc(c.id)}">${ctx.esc(c.mpn || c.title)}</button>${c.pkg ? ` <span class="hint">${ctx.esc(c.pkg)}</span>` : ""}</td><td>${remaining(c)} av ${units(c)} stk</td><td>${datasheetLinks(c.mpn || c.title).slice(0, 2).map((d) => `<a href="${ctx.esc(d.url)}" target="_blank" rel="noopener">${ctx.esc(d.label)} ↗</a>`).join(" · ")}</td></tr>`).join("")}</tbody></table>` : `<p class="hint">Ingen delprodukter ennå. Legg inn innholdet i settet, så får hver type eget kort, datablad og lagerstatus.</p>`}
          ${mine && !kids.length && deriveKit(p.title) ? (() => { const d = deriveKit(p.title); return `<p class="kit-derive"><button type="button" class="btn btn-primary" data-derivekit>Opprett ${d.mpns.length} delprodukter fra tittelen${d.each ? ` × ${d.each} stk` : ""}</button> <span class="hint">${ctx.esc(d.mpns.join(", "))}</span></p>`; })() : ""}
          ${mine ? `<div class="kit-add"><label class="grow">Legg til delprodukter (delenummer, ett per linje eller skilt med komma; «BC547 20» gir eget antall)<textarea id="pd-kit" rows="3" maxlength="2000" placeholder="BC327, BC337, BC517, BC547"></textarea></label>
            <label>Antall hver<input id="pd-kitqty" type="number" min="1" max="100000" value="20"></label>
            <button type="button" class="btn" data-addkit>Legg til</button></div><p class="hint kit-msg" role="status"></p>` : ""}
        </section>`;
      })()}
      <div class="part-edit">
        <label>Kategori<select id="pd-cat" ${mine ? "" : "disabled"}>${sortedCats().map(([cid, name]) => `<option value="${cid}"${cid === p.category ? " selected" : ""}>${ctx.esc(name)}</option>`).join("")}</select></label>
        <label>Stk per pakke<input id="pd-pack" type="number" min="1" max="100000" value="${p.pack}" ${mine ? "" : "disabled"}></label>
        <label>Antall igjen (stk)<input id="pd-left" type="number" min="0" max="10000000" value="${remaining(p)}" ${mine ? "" : "disabled"}></label>
        ${mine && (ctx.token() || ctx.DEMO) ? `<div class="used-row"><label>Brukt nå (stk)<input id="pd-used" type="number" min="1" max="${Math.max(1, remaining(p))}" value="1"></label><button type="button" class="btn" data-useparts ${remaining(p) ? "" : "disabled"}>Trekk fra lageret</button><span class="hint used-msg" role="status"></span></div>` : ""}
        <label>Plassering<input id="pd-loc" type="text" maxlength="80" value="${ctx.esc(p.location)}" placeholder="F.eks. Skuff 3, verkstedet" ${mine ? "" : "disabled"}></label>
        <label class="pd-note">Notat<textarea id="pd-note" rows="2" maxlength="400" ${mine ? "" : "disabled"}>${ctx.esc(p.note)}</textarea></label>
        ${p.imgWeb ? `<div class="img-web-box"><b>Bildet er funnet på nettet</b>, ikke hos AliExpress${p.imgWebSrc ? ` (<a href="${ctx.esc(p.imgWebSrc)}" target="_blank" rel="noopener">kilde ↗</a>)` : ""}. Stemmer det?
          ${mine ? `<span class="img-web-actions"><button type="button" class="btn btn-small btn-primary" data-imgweb="ok">Godkjenn</button><button type="button" class="btn btn-small btn-danger" data-imgweb="no">Feil bilde</button></span>` : ""}</div>` : ""}
        <label class="cat-toggle pd-imgwrong"><input type="checkbox" id="pd-imgwrong"${p.imgWrong ? " checked" : ""}${mine ? "" : " disabled"}> Feil bilde – finn riktig bilde ved neste bildesøk${p.imgWrong ? ` <span class="hint">(merket ${ctx.esc(fmtStamp(p.imgWrongAt))}${imgFixed(p) ? `; bildet ble byttet ${ctx.esc(fmtStamp(p.imgUpdated))}${p.imgBy ? ` av ${ctx.esc(p.imgBy)}` : ""} – fjern krysset hvis det nå er riktig` : "; ikke byttet ennå"})</span>` : ""}</label>
        <label class="pd-note">Bilde (lenke fra AliExpress, LCSC eller Mouser; tom = ingen bilde)<input id="pd-img" type="url" maxlength="400" value="${ctx.esc(p.image.startsWith("data:") ? "" : p.image)}" placeholder="${p.image.startsWith("data:") ? "Eget opplastet bilde (la stå tom for å beholde)" : "https://ae-pic-a1.aliexpress-media.com/kf/….jpg"}" ${mine ? "" : "disabled"}></label>
      </div>
      ${mine ? "" : `<p class="hint">Bare ${ctx.esc(p.owner)} kan endre denne varen.</p>`}
      ${ctx.token() || ctx.DEMO ? `<div class="cart-add">
        <label>Antall<input id="pd-cartqty" type="number" min="1" max="${Math.max(1, remaining(p))}" value="1"></label>
        <label class="grow">Hva skal det brukes til? (valgfritt)<input id="pd-cartnote" type="text" maxlength="200" placeholder="F.eks. reservedel til leseren"></label>
        <button type="button" class="btn" data-addcart>${p.owner && p.owner !== meName() ? `Legg i handlekurv (fra ${ctx.esc(p.owner)})` : "Legg i handlekurv"}</button>
      </div>
      <div class="cart-add proj-add">
        <label class="grow">Prosjekt<select id="pd-proj">${myProjects().map((x) => `<option value="${ctx.esc(x.id)}">${ctx.esc(x.name)}</option>`).join("")}<option value="__new">+ Nytt prosjekt …</option></select></label>
        <button type="button" class="btn" data-addproj>${p.owner === meName() ? "Reserver i prosjekt" : "Legg til i prosjekt"}</button>
      </div>
      ${(() => { const used = pstate.projects.filter((x) => x.status !== "done" && x.lines.some((l) => l.kind === "stock" && l.partId === p.id)); return used.length ? `<p class="hint">Brukes i: ${used.map((x) => `${ctx.esc(x.name)} (${x.lines.filter((l) => l.partId === p.id).reduce((s, l) => s + l.qty, 0)} stk)`).join(", ")}</p>` : ""; })()}
      <p class="hint cart-msg" role="status">${(() => { const n = pstate.reqs.filter((q) => q.partId === p.id && ["draft", "open"].includes(q.status)).reduce((s, q) => s + q.qty, 0); return n ? `${n} stk av denne er i en handlekurv eller ønsket.` : ""; })()}</p>` : ""}
      <div class="part-actions">
        ${ctx.DEMO || (p.owner && p.owner === meName()) ? `<button class="btn btn-danger part-del" type="button" data-delpart>Slett …</button>` : ""}
        ${mine ? `<button class="btn btn-primary" value="save" type="submit">Lagre</button>` : ""}
        <button class="btn" value="cancel" type="submit">Lukk</button>
      </div>
      <div class="part-del-confirm" hidden>
        <p><b>Slette for godt?</b> Varen forsvinner fra biblioteket og kommer ikke tilbake ved ny import. Dette kan ikke angres.</p>
        <div class="part-actions">
          <button class="btn" type="button" data-delcancel>Avbryt</button>
          ${siblings(p).length > 1 ? `<button class="btn btn-danger" type="button" data-delconfirm="all">Slett alle ${siblings(p).length} kjøp</button>` : ""}
          <button class="btn btn-danger btn-solid-danger" type="button" data-delconfirm="one">${siblings(p).length > 1 ? "Slett bare dette kjøpet" : "Ja, slett"}</button>
        </div>
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
    if (imgIn !== p.image && !(p.image.startsWith("data:") && !imgIn)) {
      const img = safeImg(imgIn.replace(/_\d+x\d+\.(jpg|png|webp)$/i, ""));
      if (imgIn && !img) { ctx.setSync("Bildelenken må være fra AliExpress, LCSC eller Mouser.", true); }
      else { p.image = img; p.imgSearch = false; p.imgManual = true; p.imgUpdated = new Date().toISOString(); p.imgBy = meName(); }
    }
    try { await saveOne(p); ctx.setSync("Lagret"); } catch (err) { ctx.setSync(err.message, true); }
  };
  dlg.onchange = async (e) => {
    if (e.target.id !== "pd-imgwrong" || !mine) return;
    p.imgWrong = e.target.checked;
    p.imgWrongAt = p.imgWrong ? new Date().toISOString() : "";
    render();
    try { await saveOne(p); ctx.setSync(p.imgWrong ? "Merket som feil bilde" : "Lagret"); }
    catch (err) { e.target.checked = !e.target.checked; p.imgWrong = e.target.checked; ctx.setSync(err.message, true); }
  };
  dlg.onclick = async (e) => {
    if (e.target.closest(".dlg-close")) { dlg.close(""); return; }
    if (e.target.closest("[data-delpart], [data-delcancel]")) {
      const box = dlg.querySelector(".part-del-confirm");
      box.hidden = !!e.target.closest("[data-delcancel]");
      if (!box.hidden) box.scrollIntoView({ block: "nearest" });
      return;
    }
    const del = e.target.closest("[data-delconfirm]");
    if (del) {
      let list = del.dataset.delconfirm === "all" ? siblings(p) : [p];
      list = list.concat(list.flatMap(kitParts));
      try {
        await deleteParts(list);
        dlg.close("");
        ctx.setSync(list.length > 1 ? `${list.length} kjøp er slettet` : "Varen er slettet");
      } catch (err) { ctx.setSync(err.message, true); }
      return;
    }
    const iw = e.target.closest("[data-imgweb]");
    if (iw && mine) {
      // Godkjent: bildet blir stående som et vanlig, låst bilde. Avvist: varen havner i «Feil bilde».
      p.imgWeb = false;
      if (iw.dataset.imgweb === "ok") { p.imgManual = true; p.imgWrong = false; }
      else { p.imgWrong = true; p.imgWrongAt = new Date().toISOString(); }
      try { await saveOne(p); ctx.setSync(iw.dataset.imgweb === "ok" ? "Bildet er godkjent" : "Merket som feil bilde"); dlg.close(""); openPart(p.id); }
      catch (err) { ctx.setSync(err.message, true); }
      return;
    }
    const ot = e.target.closest("[data-ordertoggle]");
    if (ot) {
      const open = ot.closest("table").classList.toggle("order-open");
      ot.setAttribute("aria-expanded", open);
      ctx.store("bf.partOrder", open ? "1" : "");
      return;
    }
    const fz = e.target.closest("[data-fpzoom]");
    if (fz) return openFootprintZoom(fz.dataset.fpzoom, kicadHint(p));
    if (e.target.closest(".part-detail-img img") && p.image) return openImageZoom(p.image, p.title);
    const sch = e.target.closest(".schematic-fig .schematic-wrap");
    if (sch) {
      const fig = sch.closest(".schematic-fig");
      const [title, caption] = [...fig.querySelectorAll("figcaption")].map((f) => f.textContent.trim());
      return openZoom(`<b>${ctx.esc(title || "Koblingsskjema")}</b>`, sch.innerHTML, caption ? `<p class="hint">${ctx.esc(caption)}</p>` : "", false);
    }
    const an = e.target.closest("[data-aianalyse]");
    if (an && mine) { await analysePart(dlg, p, an); return; }
    const ap = e.target.closest("[data-aiapply]");
    if (ap && mine) { await applyProposal(dlg, p, ap); return; }
    if (e.target.closest("[data-derivekit]") && mine) {
      const d = deriveKit(p.title), msg = dlg.querySelector(".kit-msg");
      if (!d) return;
      try { await addKitParts(p, d.mpns.map((m) => [m, d.each || 1])); ctx.setSync(`${d.mpns.length} delprodukter opprettet`); dlg.close(""); openPart(p.id); }
      catch (err) { msg.textContent = err.message; }
      return;
    }
    if (e.target.closest("[data-addkit]") && mine) {
      const msg = dlg.querySelector(".kit-msg");
      const entries = parseKitLines(dlg.querySelector("#pd-kit").value, Math.max(1, Math.round(Number(dlg.querySelector("#pd-kitqty").value) || 1)));
      if (!entries.length) { msg.textContent = "Skriv inn minst ett delenummer."; return; }
      try { await addKitParts(p, entries); ctx.setSync(`${entries.length} delprodukter lagret`); dlg.close(""); openPart(p.id); }
      catch (err) { msg.textContent = err.message; }
      return;
    }
    const sib = e.target.closest("[data-sibling]");
    if (sib) { dlg.close(""); openPart(sib.dataset.sibling); return; }
    if (e.target.closest("[data-useparts]")) {
      const n = Math.max(1, Math.round(Number(dlg.querySelector("#pd-used").value) || 1));
      const out = dlg.querySelector(".used-msg");
      try {
        const { short } = await useParts(p, n);
        dlg.querySelector("#pd-left").value = remaining(p);
        out.textContent = short ? `Trakk fra ${n - short} stk (det var ikke flere).` : `Trakk fra ${n} stk. ${remaining(p)} igjen i dette kjøpet.`;
        render();
      } catch (err) { out.textContent = err.message; }
      return;
    }
    if (e.target.closest("[data-addproj]")) {
      const qty = Math.max(1, Math.round(Number(dlg.querySelector("#pd-cartqty").value) || 1));
      const msg = dlg.querySelector(".cart-msg");
      try {
        let x = projectById(dlg.querySelector("#pd-proj").value);
        if (!x) {
          const name = String(dlg.querySelector("#pd-cartnote").value || "").trim() || `Prosjekt ${new Date().toLocaleDateString("nb-NO")}`;
          x = await createProject(name);
        }
        await addPartToProject(x, p, qty, dlg.querySelector("#pd-cartnote").value);
        if (msg) msg.textContent = p.owner === x.owner ? `${qty} stk reservert i «${x.name}».` : `${qty} stk lagt til i «${x.name}» som ønske til ${p.owner}. Send fra prosjektet eller handlekurven.`;
      } catch (err) { if (msg) msg.textContent = err.message; }
      return;
    }
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
    const ed = e.target.closest("[data-editcats], [data-delcat]");
    if (ed) {
      if (ed.dataset.delcat) { try { await deleteCat(ed.dataset.delcat); ctx.setSync("Kategorien er slettet"); } catch (err) { ctx.setSync(err.message, true); } return; }
      pstate.editCats = !pstate.editCats || ed.hasAttribute("data-addcat");
      render();
      if (ed.hasAttribute("data-addcat")) ctx.$("#newcat-name")?.focus();
      return;
    }
    if (e.target.closest("[data-pexport]")) { exportInventory(); return; }
    if (e.target.closest("[data-newpart]")) { openNewPart(); return; }
    const pj = e.target.closest("[data-projopen], [data-projshow], [data-projact]");
    if (pj) {
      if (pj.dataset.projopen !== undefined) { pstate.project = pj.dataset.projopen; pstate.bomPreview = null; render(); window.scrollTo({ top: 0 }); return; }
      if (pj.dataset.projshow) { pstate.projShow = pj.dataset.projshow; return render(); }
      try { await projectAction(pj.dataset.projact, pj); } catch (err) { ctx.setSync(err.message, true); }
      return;
    }
    const u1 = e.target.closest("[data-usedone]");
    if (u1) {
      const p = pstate.parts.find((x) => x.id === u1.dataset.usedone);
      try { await useParts(p, 1); render(); ctx.setSync(`Brukt 1 stk – ${siblings(p).filter((y) => y.owner === p.owner).reduce((sum, y) => sum + remaining(y), 0)} igjen`); } catch (err) { ctx.setSync(err.message, true); }
      return;
    }
    const t = e.target.closest("[data-pf], [data-part], [data-pview], [data-pmore], [data-psettings], [data-pclear], [data-pimport], [data-reqact], [data-sendcart], [data-cartstep]");
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
    } else if (t.dataset.pclear !== undefined) {
      Object.assign(pstate, { cat: "", sub: "", owner: "", source: "", pkg: "", imgf: "", show: "all" });
      shown = PAGE;
      render();
    } else if (t.dataset.pf) {
      pstate[t.dataset.pf] = pstate[t.dataset.pf] === t.dataset.pv ? "" : t.dataset.pv;
      if (t.dataset.pf === "cat") pstate.sub = "";
      shown = PAGE;
      render();
    } else if (t.dataset.part) openPart(t.dataset.part);
    else if (t.hasAttribute("data-psettings")) ctx.openSettings?.();
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
  root.addEventListener("submit", async (e) => {
    const pf = e.target.dataset.projform;
    if (pf) {
      e.preventDefault();
      try {
        if (pf === "new") { await createProject(e.target.querySelector("#proj-name").value); ctx.setSync("Prosjektet er laget"); }
        else if (pf === "buy") {
          const x = projectById(pstate.project), f = e.target.elements;
          x.lines.push({ id: newId(), kind: "buy", partId: "", reqId: "", qty: Math.max(1, Math.round(num(f.qty.value) ?? 1)), label: clip(f.label.value, 120), note: "", url: safeUrl(f.url.value), price: num(f.price.value), bought: false });
          await saveProject(x);
        }
      } catch (err) { ctx.setSync(err.message, true); }
      return;
    }
    if (!e.target.matches("[data-newcatform]")) return;
    e.preventDefault();
    try { await createCat(e.target.querySelector("#newcat-name").value); ctx.setSync("Kategorien er lagt til"); ctx.$("#newcat-name")?.focus(); }
    catch (err) { ctx.setSync(err.message, true); }
  });
  let dragId = "";
  root.addEventListener("dragstart", (e) => {
    const card = e.target.closest?.("[data-dragid]");
    if (!card) return;
    dragId = card.dataset.dragid;
    e.dataTransfer.setData("text/plain", dragId);
    e.dataTransfer.effectAllowed = "move";
    document.body.classList.add("dragging-part");
  });
  root.addEventListener("dragend", () => { dragId = ""; document.body.classList.remove("dragging-part"); root.querySelectorAll(".drop-hover").forEach((x) => x.classList.remove("drop-hover")); });
  root.addEventListener("dragover", (e) => {
    const c = dragId && e.target.closest(".cat-drop");
    if (!c) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    root.querySelectorAll(".drop-hover").forEach((x) => x !== c && x.classList.remove("drop-hover"));
    c.classList.add("drop-hover");
  });
  root.addEventListener("dragleave", (e) => e.target.closest?.(".cat-drop")?.classList.remove("drop-hover"));
  root.addEventListener("drop", async (e) => {
    const c = dragId && e.target.closest(".cat-drop");
    if (!c) return;
    e.preventDefault();
    const id = dragId;
    dragId = "";
    document.body.classList.remove("dragging-part");
    try { await moveToCat(id, c.dataset.pv); } catch (err) { ctx.setSync(err.message, true); }
  });
  root.addEventListener("change", async (e) => {
    if (e.target.dataset.imgok && e.target.checked) {
      const p = pstate.parts.find((x) => x.id === e.target.dataset.imgok);
      if (p) try { await approveImage(p); } catch (err) { ctx.setSync(err.message, true); }
      return;
    }
    const px = ["proj-title", "proj-status", "proj-desc"].includes(e.target.id) || e.target.dataset.projbought ? projectById(pstate.project) : null;
    if (px && canEditProject(px)) {
      if (e.target.id === "proj-title") px.name = clip(e.target.value, 80) || px.name;
      else if (e.target.id === "proj-status") {
        if (!PROJ_STATUS[e.target.value]) return;
        try { ctx.setSync(await setProjectStatus(px, e.target.value)); } catch (err) { ctx.setSync(err.message, true); }
        return;
      }
      else if (e.target.id === "proj-desc") px.desc = clip(e.target.value, 1000);
      else { const l = px.lines.find((y) => y.id === e.target.dataset.projbought); if (l) l.bought = e.target.checked; }
      try { await saveProject(px); ctx.setSync("Lagret"); } catch (err) { ctx.setSync(err.message, true); }
      return;
    }
    if (e.target.dataset.renamecat) {
      try { await renameCat(e.target.dataset.renamecat, e.target.value); ctx.setSync("Navnet er endret"); } catch (err) { ctx.setSync(err.message, true); }
      return;
    }
    if (e.target.id === "parts-sort") { pstate.sort = e.target.value; render(); }
    if (e.target.id === "parts-show") { pstate.show = e.target.value; shown = PAGE; render(); }
    if (e.target.dataset.reqqty) {
      const q = pstate.reqs.find((x) => x.id === e.target.dataset.reqqty);
      if (q) { q.qty = Math.max(1, Math.round(Number(e.target.value) || 1)); render(); saveReqs([q]).catch((err) => ctx.setSync(err.message, true)); }
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
  const spent = ctx.isAdmin?.() ? `<h3>Komponenter: beløp betalt</h3>
    <label class="cat-toggle"><input type="checkbox" data-hidespent${pstate.prefs[me]?.hideSpent ? " checked" : ""}> Skjul boksen «kr betalt» i komponentoversikten</label>
    <p class="hint">Bare du som administrator ser boksen og denne innstillingen.</p>` : "";
  if (!pstate.loaded) return spent + intro + `<p class="hint">Henter komponentene…</p>`;
  if (!owners.length) return spent + intro + `<p class="hint">Ingen har lest inn komponenter ennå.</p>`;
  return spent + intro + owners.map((owner) => {
    const hidden = hiddenFor(owner);
    const canEdit = ctx.DEMO || owner === me || ctx.isAdmin?.();
    const mine = pstate.parts.filter((p) => p.owner === owner);
    const cats = sortedCats().map(([id, name]) => [id, name, mine.filter((p) => p.category === id).length]).filter(([, , n]) => n);
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
  const pref = { ...pstate.prefs[owner], hidden: [...hidden], updated: new Date().toISOString(), by: meName() };
  pstate.prefs[owner] = pref;
  render();
  if (!ctx.DEMO) await savePatch([{ coll: "partprefs", id: owner, data: pref }]);
}

// «kr betalt» i komponentoversikten: bare administrator ser den, og kan slå den av for seg selv.
export async function setSpentShown(shown) {
  const me = meName();
  if (!me || !ctx.isAdmin?.()) return;
  const pref = { ...pstate.prefs[me], hidden: [...hiddenFor(me)], hideSpent: !shown, updated: new Date().toISOString(), by: me };
  pstate.prefs[me] = pref;
  render();
  if (!ctx.DEMO) await savePatch([{ coll: "partprefs", id: me, data: pref }]);
}

// Antallene i Innstillinger trenger komponentene; hent dem i bakgrunnen.
// Gir et løfte bare når noe faktisk må hentes, så kalleren ikke tegner på nytt i en løkke.
export const loadParts = () => (pstate.loaded ? null : load());

// ---------- Demo ----------

function demoProjects() {
  const at = new Date(Date.now() - 2 * 864e5).toISOString();
  const r = { id: "demo-r4", partId: "demo:1", owner: "Niklas", by: "Philippe", qty: 1, note: "Til værstasjonen", status: "open", at, projectId: "demo-p1" };
  pstate.reqs.push(cleanReq(r));
  return [cleanProject({ id: "demo-p1", name: "Værstasjon", desc: "ESP32 med temperatur, fukt og lufttrykk, viser på OLED.", owner: "Philippe", status: "collect", created: at, updated: at, lines: [
    { id: "l1", kind: "stock", partId: "demo:0", qty: 1, note: "Hjernen" },
    { id: "l2", kind: "stock", partId: "demo:1", reqId: "demo-r4", qty: 1 },
    { id: "l3", kind: "buy", label: "BME280-modul (3,3 V)", qty: 1, price: 35, url: "https://www.aliexpress.com/" },
  ] })];
}

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
    ["100PCS 2N7002 SOT-23 N-Channel MOSFET 7002", "", 1, 12.0, "2026-01-20"],
    ["20PCS NE555 Timer IC DIP-8", "", 1, 22.0, "2025-12-02"],
    ["AMS1117-3.3 Voltage Regulator SOT-223 50pcs", "", 1, 18.0, "2025-11-11"],
    ["GY-BME280 Temperature Humidity Pressure Sensor Module I2C", "3.3V", 2, 39.0, "2025-10-05"],
    // Samme vare kjøpt flere ganger (samme eier) – vises som ett kort med samlet antall.
    ["RC522 RFID Reader Module 13.56MHz with Cards", "", 3, 17.5, "2025-09-14"],
    ["0.96 inch OLED Display Module SSD1306 I2C 128x64", "White", 2, 22.9, "2025-08-30"],
  ];
  return rows.map(([title, variant, qty, price, date], i) => cleanPart({
    id: `demo:${i}`, source: "aliexpress", owner: ["Philippe", "Niklas", "Peter"][i % 3], title, variant, qty,
    unitPrice: price, currency: "NOK", orderDate: date, store: "Demo Store", orderId: `80${i}123456789`,
  }));
}
