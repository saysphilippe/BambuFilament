import { parseTag, cssColor, buildBlocks } from "./bambu.js?v=20261008131032";
import { encryptToken, decryptToken, randomPassword, passwordProblem, makeKeys, openKeys, sealToken } from "./auth.js?v=20261008131032";

// Data og kode ligger i hver sine repoer. Den delte skrivetokenen gjelder bare
// data- og auth-repoet, så den kan ikke endre nettsidekoden i saysphilippe/BambuFilament.
//
// - BambuFilament-auth (offentlig): users.json med navn, farger og krypterte
//   innloggingsnøkler. Må kunne leses før innlogging.
// - BambuFilament-data (privat): spools.json (spoler, også for RFID-leserne) og
//   shared.json (delte AMS-data, bibliotek, venteliste). Leses bare med tokenen.
const DATA_REPO = "saysphilippe/BambuFilament-data";
const AUTH_REPO = "saysphilippe/BambuFilament-auth";
const BRANCH = "main";
const FILES = {
  users: { repo: AUTH_REPO, path: "users.json", public: true, empty: () => ({ version: 1, users: [] }) },
  spools: { repo: DATA_REPO, path: "spools.json", empty: () => ({ version: 1, spools: [] }) },
  shared: { repo: DATA_REPO, path: "shared.json", empty: () => ({ version: 1, ams: {}, library: {}, wishes: {} }) },
  // Innlogginger og sist aktiv, for innloggingsstatistikken (bare admin ser den).
  activity: { repo: DATA_REPO, path: "activity.json", empty: () => ({ version: 1, logins: [], seen: {} }) },
  // Utlån: hvem som har lånt hvilken spole, og om det er levert tilbake eller gjort opp.
  loans: { repo: DATA_REPO, path: "loans.json", empty: () => ({ version: 1, loans: [] }) },
  // E-postadresser og ventende registreringer (skrives også av Workeren, se worker/).
  contacts: { repo: DATA_REPO, path: "contacts.json", empty: () => ({ version: 1, emails: {}, pending: [] }) },
};
const MAX_LOGINS = 500;            // eldste innlogginger fjernes
const SEEN_EVERY_MS = 6 * 3600e3;  // «sist aktiv» lagres høyst hver 6. time per bruker
const apiUrl = (file) => `https://api.github.com/repos/${FILES[file].repo}/contents/${FILES[file].path}`;
const rawUrl = (file) => `https://raw.githubusercontent.com/${FILES[file].repo}/${BRANCH}/${FILES[file].path}`;

// Lengdegrenser for fritekst, så datafilen ikke kan blåses opp.
const MAX = { name: 60, note: 300, user: 40 };
const clip = (text, n) => String(text || "").trim().slice(0, n);
const REFRESH_MS = 120000;
// Midlertidige passord (vist her eller sendt på e-post) gjelder i 4 timer. De lagres som
// users[].reset ved siden av et eventuelt vanlig passord, som fortsatt virker.
const TEMP_MS = 4 * 3600e3;
const tempCred = async (tok, temp) => ({ ...(await encryptToken(tok, temp)), exp: new Date(Date.now() + TEMP_MS).toISOString() });
// Cloudflare Worker som videresender til Bambu (se worker/). Tom = AMS-fanen er av.
const PROXY_URL = ["127.0.0.1", "localhost"].includes(location.hostname) ? "http://127.0.0.1:8787" : "https://bambufilament-proxy.saysphilippe.workers.dev";
const DEMO = new URLSearchParams(location.search).has("demo");

const STATUS = { in: "På lager", out: "Tatt ut", empty: "Brukt opp" };
const ACTION = { in: "Sjekket inn", out: "Sjekket ut", empty: "Brukt opp" };
const USER_COLORS = ["#2563eb", "#db2777", "#7c3aed", "#0891b2", "#ca8a04", "#dc2626", "#4f46e5", "#0d9488"];

// Fargefamilier for filteret, i visningsrekkefølge.
const FAMILIES = [
  ["red", "Rød", "#d93025"], ["orange", "Oransje", "#f57c00"], ["yellow", "Gul", "#f9c80e"],
  ["green", "Grønn", "#2e9e44"], ["blue", "Blå", "#1e6fd9"], ["purple", "Lilla", "#7e57c2"],
  ["pink", "Rosa", "#ec6fa8"], ["brown", "Brun", "#8d5b3a"], ["white", "Hvit", "#f5f5f5"],
  ["gray", "Grå", "#9e9e9e"], ["black", "Svart", "#212121"], ["clear", "Gjennomsiktig", "linear-gradient(135deg, #ffffff, #cfd8dc)"], ["multi", "Flerfarget", "conic-gradient(#d93025, #f9c80e, #2e9e44, #1e6fd9, #7e57c2, #d93025)"],
];

const $ = (sel) => document.querySelector(sel);
const state = {
  doc: { version: 1, users: [], spools: [] },
  spools: [],
  colorNames: {},
  colorIndex: {},
  activity: { logins: [], seen: {} },
  contacts: { emails: {}, pending: [] },
  loans: [],
  usersTab: "list",
  tab: "stock",
  amsLive: null,
  libraryLive: null,
  amsBusy: false,
  amsError: "",
  catalog: null,
  newsDays: store("bf.newsDays") || "180",
  newsOnlyMissing: false,
  newsStock: store("bf.newsStock") || "",
  openTypes: new Set(),
  newsSub: store("bf.newsSub") || "new",
  store: null,
  shop: { q: "", cat: "", status: store("bf.shopStatus") || "", sort: store("bf.shopSort") || "name", limit: 60 },
  filters: { q: "", owner: "", type: "", family: "", status: "in", sort: "type" },
  selected: null,
};

// ---------- Lagring i nettleseren ----------

function store(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key) || "";
    if (value) localStorage.setItem(key, value); else localStorage.removeItem(key);
  } catch { return ""; }
}

// Innloggingen lagres i sessionStorage (forsvinner når fanen lukkes), eller i
// localStorage i 30 dager hvis brukeren velger «Husk meg».
const REMEMBER_MS = 30 * 24 * 60 * 60 * 1000;

function loadSession() {
  try {
    const temp = JSON.parse(sessionStorage.getItem("bf.session") || "null");
    if (temp?.token) return temp;
    const kept = JSON.parse(localStorage.getItem("bf.session") || "null");
    if (kept?.token && kept.exp > Date.now()) return kept;
    localStorage.removeItem("bf.session");
  } catch { /* ingen lagring tilgjengelig */ }
  return null;
}

function saveSession(value, remember) {
  try {
    sessionStorage.removeItem("bf.session");
    localStorage.removeItem("bf.session");
    if (!value) return;
    if (remember) localStorage.setItem("bf.session", JSON.stringify({ ...value, exp: Date.now() + REMEMBER_MS }));
    else sessionStorage.setItem("bf.session", JSON.stringify(value));
  } catch { /* ingen lagring tilgjengelig */ }
}

// Innlogget bruker: { user, token }. Tokenen er dekryptert med brukerens passord.
let session = DEMO ? null : loadSession();
const token = () => session?.token || "";
const userName = () => session?.user || "";
const isAdmin = () => !!state.doc.users.find((u) => u.name === userName())?.admin;
const ADMIN_ONLY = "Bare administrator kan endre brukere.";
const adminIn = (doc) => !!doc.users.find((u) => u.name === userName())?.admin;

// ---------- GitHub ----------

function headers(extra = {}) {
  const h = { "X-GitHub-Api-Version": "2022-11-28", ...extra };
  if (token()) h.Authorization = `Bearer ${token()}`;
  return h;
}

function decodeBase64(b64) {
  const bin = atob(b64.replace(/\s/g, ""));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

function encodeBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function loadFile(file) {
  try {
    const res = await fetch(`${apiUrl(file)}?ref=${BRANCH}`, {
      headers: headers({ Accept: "application/vnd.github.raw+json" }),
      cache: "no-store",
    });
    if (res.ok) return await res.json();
    if (res.status === 404 && FILES[file].public) return FILES[file].empty();
    if (res.status === 401) {
      setSession(null);
      throw new Error("Innloggingen er ikke lenger gyldig. Logg inn på nytt.");
    }
    if (!FILES[file].public) throw new Error(`Fikk ikke lest ${FILES[file].path} (${res.status}). Har tokenen tilgang til BambuFilament-data?`);
  } catch (err) {
    if (!FILES[file].public) throw err;
    /* offentlig fil: faller tilbake til raw.githubusercontent.com (uten API-grense) */
  }
  const res = await fetch(`${rawUrl(file)}?t=${Date.now()}`, { cache: "no-store" });
  if (res.status === 404) return FILES[file].empty();
  if (!res.ok) throw new Error(`Kunne ikke hente ${FILES[file].path} (${res.status})`);
  return res.json();
}

// Brukerlisten hentes alltid (trengs for å logge inn). Spoler og delte data hentes
// bare når man er logget inn, siden data-repoet er privat.
async function loadDoc() {
  const auth = await loadFile("users");
  if (!token()) return { ...auth, spools: [], ams: {}, library: {}, wishes: {} };
  const [main, shared, activity, contacts, loans] = await Promise.all([
    loadFile("spools"), loadFile("shared"), loadFile("activity"), loadFile("contacts").catch(() => FILES.contacts.empty()),
    loadFile("loans").catch(() => FILES.loans.empty()),
  ]);
  state.activity = cleanActivity(activity);
  state.loans = cleanLoans(loans);
  state.contacts = cleanContacts(contacts);
  return {
    users: auth.users || [], spools: main.spools || [], cards: main.cards || {}, settings: main.settings || {},
    ams: shared.ams || {}, library: shared.library || {}, wishes: shared.wishes || {},
  };
}

// Henter siste versjon av filen, lar mutate endre den, og lagrer. Prøver på nytt ved konflikt.
// file: "users" (brukere og innlogging), "spools" (spoler) eller "shared" (ams, library, wishes).
async function saveDoc(mutate, message, file = "spools") {
  if (DEMO) throw new Error("Demo-modus: endringer lagres ikke.");
  if (!token()) throw new Error("Logg inn for å kunne endre.");
  const API = apiUrl(file);
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${API}?ref=${BRANCH}`, { headers: headers({ Accept: "application/vnd.github+json" }), cache: "no-store" });
    let doc = FILES[file].empty(), sha;
    if (res.ok) {
      const meta = await res.json();
      sha = meta.sha;
      doc = JSON.parse(decodeBase64(meta.content));
    } else if (res.status !== 404) {
      throw new Error(`GitHub svarte ${res.status} ved henting`);
    }
    if (file === "users") {
      doc.users ||= [];
    } else if (file === "activity") {
      doc.logins = Array.isArray(doc.logins) ? doc.logins : [];
      doc.seen = doc.seen && typeof doc.seen === "object" ? doc.seen : {};
    } else if (file === "loans") {
      doc.loans = Array.isArray(doc.loans) ? doc.loans : [];
    } else if (file === "contacts") {
      doc.emails = doc.emails && typeof doc.emails === "object" ? doc.emails : {};
      doc.pending = Array.isArray(doc.pending) ? doc.pending : [];
    } else if (file === "spools") {
      doc.spools ||= [];
      // Brukere ligger i auth-repoet og delte data i shared.json (eldre versjoner la dem her).
      delete doc.users;
      delete doc.ams;
      delete doc.library;
      delete doc.wishes;
    } else {
      doc.ams ||= {};
      doc.library ||= {};
      doc.wishes ||= {};
    }
    const error = mutate(doc);
    if (error) throw new Error(error);
    const put = await fetch(API, {
      method: "PUT",
      headers: headers({ Accept: "application/vnd.github+json", "Content-Type": "application/json" }),
      body: JSON.stringify({ message, branch: BRANCH, sha, content: encodeBase64(JSON.stringify(doc, null, 2) + "\n") }),
    });
    if (put.ok) {
      if (file === "activity") {
        state.activity = cleanActivity(doc);
        return state.doc;
      }
      if (file === "contacts") {
        state.contacts = cleanContacts(doc);
        return state.doc;
      }
      if (file === "loans") {
        state.loans = cleanLoans(doc);
        return state.doc;
      }
      const merged = file === "users" ? { ...state.doc, users: doc.users }
        : file === "spools" ? { ...state.doc, spools: doc.spools, cards: doc.cards || {}, settings: doc.settings || {} }
        : { ...state.doc, ams: doc.ams, library: doc.library, wishes: doc.wishes };
      setDoc(merged);
      return state.doc;
    }
    if (put.status === 401) {
      setSession(null);
      throw new Error("Innloggingen er ikke lenger gyldig (tokenen er utløpt eller trukket tilbake). Logg inn på nytt.");
    }
    if (put.status === 403 || put.status === 404) {
      throw new Error(`GitHub-tokenen har ikke skrivetilgang til ${FILES[file].repo.split("/")[1]}. Tokenen må gjelde både BambuFilament-data og BambuFilament-auth, med Contents: Read and write.`);
    }
    if (put.status !== 409) throw new Error(`GitHub svarte ${put.status} ved lagring`);
  }
  throw new Error("Noen andre lagret samtidig. Prøv igjen.");
}

// ---------- Data ----------

// Eldre data brukte "active" for spoler på lager.
const statusOf = (s) => (s.status === "out" || s.status === "empty" ? s.status : "in");

const alpha = (hex) => parseInt(hex.slice(7, 9) || "FF", 16) / 255;

function hsl(hex) {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.substr(i, 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let hue = 0;
  if (d) hue = (max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60;
  return { h: (hue + 360) % 360, s, l };
}

function family(tag) {
  if (!tag) return "";
  if (tag.colors.length > 1) return "multi";
  if (alpha(tag.colors[0]) < 0.3) return "clear";
  const { h, s, l } = hsl(tag.colors[0]);
  if (l > 0.88 && s < 0.5) return "white";
  if (l < 0.13) return "black";
  if (s < 0.14) return "gray";
  if (h >= 15 && h < 45 && l < 0.42) return "brown";
  if (h < 15 || h >= 345) return "red";
  if (h < 42) return "orange";
  if (h < 68) return "yellow";
  if (h < 170) return "green";
  if (h < 255) return "blue";
  if (h < 290) return "purple";
  return "pink";
}

function enrich(spool) {
  const tag = parseTag(spool.blocks);
  const inAms = spool.inAms && str(spool.inAms.user) && !isNaN(new Date(spool.inAms.at))
    ? { user: clip(spool.inAms.user, MAX.user), at: str(spool.inAms.at) } : null;
  const code = tag?.variantId.split("-")[1];
  const official = tag && state.colorNames[`${tag.materialId}-${code}`];
  return {
    ...spool,
    inAms,
    status: statusOf(spool),
    tag,
    colorName: official?.[0] || "",
    typeName: official?.[1] || tag?.detailedType || "Ukjent type",
    family: family(tag),
  };
}

// Alt i spools.json kan skrives av alle med skrivetoken, og vises for alle besøkende.
// Farger og tall brukes i HTML og stilattributter, så de kontrolleres her før visning.
// Fritekst escapes med esc() der den vises.
const HEX = /^#?[0-9a-f]{6}([0-9a-f]{2})?$/i;
const safeColor = (c, fallback = "#8a8f8b") => (HEX.test(c || "") ? (c.startsWith("#") ? c : "#" + c) : fallback);
const hexOnly = (c) => (typeof c === "string" && HEX.test(c) ? c.replace("#", "").toUpperCase() : "");
const num = (x) => (x === null || x === undefined || x === "" ? null : Number.isFinite(Number(x)) ? Number(x) : null);
const str = (x) => (x === null || x === undefined ? "" : String(x));

function cleanTray(t, i) {
  const slot = num(t?.slot) ?? i;
  if (!t || t.empty) return { slot, empty: true };
  return {
    slot, type: str(t.type), subBrand: str(t.subBrand), color: hexOnly(t.color),
    cols: Array.isArray(t.cols) ? t.cols.map(hexOnly).filter(Boolean) : [],
    infoIdx: str(t.infoIdx), remain: num(t.remain), weight: num(t.weight),
    nozzleMin: num(t.nozzleMin), nozzleMax: num(t.nozzleMax), uuid: str(t.uuid),
  };
}

function cleanAms(a) {
  if (!a || !Array.isArray(a.printers)) return null;
  return {
    updated: str(a.updated),
    printers: a.printers.map((p) => ({
      ...(p.id ? { id: str(p.id) } : {}),
      name: str(p.name), model: str(p.model), online: !!p.online, reported: !!p.reported,
      ams: (Array.isArray(p.ams) ? p.ams : []).map((u) => ({
        unit: Math.max(0, Math.min(25, num(u.unit) ?? 0)),
        humidity: num(u.humidity), humidityLevel: num(u.humidityLevel), temp: num(u.temp),
        trays: (Array.isArray(u.trays) ? u.trays : []).map(cleanTray),
      })),
      external: (Array.isArray(p.external) ? p.external : []).map(cleanTray),
    })),
  };
}

function cleanLibrary(l) {
  if (!l || !Array.isArray(l.spools)) return null;
  return {
    updated: str(l.updated),
    spools: l.spools.map((x) => ({
      vendor: str(x.vendor), name: str(x.name), type: str(x.type), filamentId: str(x.filamentId),
      color: hexOnly(x.color), colors: Array.isArray(x.colors) ? x.colors.map(hexOnly).filter(Boolean) : [],
      net: num(x.net) ?? 0, total: num(x.total) ?? 0, rfid: str(x.rfid).toUpperCase(),
      note: str(x.note), variant: str(x.variant) || libVariantFromLocation(str(x.location)), device: str(x.device),
    })),
  };
}

// Eldre delte data hadde variant-ID-en (f.eks. "A01-G7") bakerst i location.
const libVariantFromLocation = (loc) => (loc.match(/([A-Z]\d\d-[A-Z0-9]{2,3})$/) || [])[1] || "";

function cleanActivity(a) {
  const logins = (Array.isArray(a?.logins) ? a.logins : []).map((x) => ({
    user: str(x.user), at: str(x.at), device: str(x.device), remember: !!x.remember,
  })).filter((x) => x.user && !isNaN(new Date(x.at)));
  const seen = Object.fromEntries(Object.entries(a?.seen || {}).map(([k, v]) => [str(k), str(v)]).filter(([, v]) => !isNaN(new Date(v))));
  return { logins, seen };
}

const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
const cleanEmail = (e) => (EMAIL_RE.test(str(e).trim()) ? str(e).trim().slice(0, 100) : "");

function cleanContacts(c) {
  const emails = Object.fromEntries(Object.entries(c?.emails || {}).map(([k, v]) => [str(k), cleanEmail(v)]).filter(([, v]) => v));
  const pending = (Array.isArray(c?.pending) ? c.pending : []).map((p) => ({
    name: clip(p?.name, MAX.user), email: cleanEmail(p?.email), at: str(p?.at),
  })).filter((p) => p.name && p.email);
  return { emails, pending };
}

function cleanLoans(d) {
  const time = (x) => (x && !isNaN(new Date(x)) ? str(x) : "");
  return (Array.isArray(d?.loans) ? d.loans : []).map((l) => ({
    id: str(l.id), spool: str(l.spool), owner: clip(l.owner, MAX.user), to: clip(l.to, MAX.user), by: clip(l.by, MAX.user),
    at: time(l.at), returnedAt: time(l.returnedAt), usedAt: time(l.usedAt), settledAt: time(l.settledAt),
    settledBy: clip(l.settledBy, MAX.user), note: clip(l.note, MAX.note),
    // Kopi av spolens navn, så lånet kan vises også om spolen slettes.
    title: clip(l.title, MAX.name), type: clip(l.type, MAX.name), color: hexOnly(l.color),
    pending: !!l.pending, own: !!l.own,
    gramsOut: num(l.gramsOut), gramsSrc: l.gramsSrc === "new" ? "new" : l.gramsSrc === "lib" ? "lib" : "", gramsIn: num(l.gramsIn),
  })).filter((l) => l.id && l.spool && (l.to || l.pending) && l.at);
}

// Innstillinger for RFID-leseren (spools.json: "settings"). Leseren leser dem ved hver skanning.
const SETTINGS = {
  cardMinutes: { def: 1, min: 0.25, max: 60, step: 0.25 },
  checkoutMinutes: { def: 10, min: 1, max: 1440, step: 1 },
};
function cleanSettings(x) {
  return Object.fromEntries(Object.entries(SETTINGS).map(([k, r]) => {
    const v = num(x?.[k]);
    return [k, v !== null && v >= r.min && v <= r.max ? v : r.def];
  }));
}

const cleanMap = (obj, fn) => Object.fromEntries(Object.entries(obj || {}).map(([k, v]) => [k, fn(v)]).filter(([, v]) => v));

function setDoc(doc) {
  state.doc = {
    ...doc,
    users: (doc.users || []).map((u) => ({ ...u, name: str(u.name), color: safeColor(u.color) })),
    spools: doc.spools || [],
    settings: cleanSettings(doc.settings),
    // RFID-kort for felles lesere: { UID: { user, label, added, reader } }. Nye kort har tom user.
    cards: Object.fromEntries(Object.entries(doc.cards || {}).map(([k, v]) => {
      const c = typeof v === "string" ? { user: v } : v || {};
      return [str(k).toUpperCase(), { user: clip(c.user, MAX.user), label: clip(c.label, MAX.name), added: str(c.added), reader: clip(c.reader, MAX.user) }];
    }).filter(([k]) => /^[0-9A-F]{8,20}$/.test(k))),
    ams: cleanMap(doc.ams, cleanAms),
    library: cleanMap(doc.library, cleanLibrary),
    wishes: doc.wishes || {},
  };
  state.spools = state.doc.spools.map(enrich);
}

function addEvent(spool, action, extra = {}) {
  spool.history = [...(spool.history || []), { at: new Date().toISOString(), action, by: userName(), ...extra }].slice(-10);
}

// Hvor mye som er igjen på en RFID-spole: fra Bambu-biblioteket hvis den finnes der,
// ellers full rull hvis den aldri er sjekket ut før (ubrukt). Ellers ukjent (null).
function gramsLeftNow(s, { beforeAt = "" } = {}) {
  const lib = libraryWeight(s.id);
  if (lib && lib.total) return { g: lib.net, src: "lib" };
  const earlierOut = (s.history || []).some((e) => e.action === "out" && (!beforeAt || e.at < beforeAt));
  if (!earlierOut && s.tag?.weight) return { g: s.tag.weight, src: "new" };
  return null;
}
const gramsText = (x) => (x ? `${x.g} g${x.src === "new" ? " (ubrukt rull)" : ""}` : "");

// Brukere fra listen, pluss eiere som finnes på spoler uten å være lagt inn.
function users() {
  const list = state.doc.users.map((u) => ({ ...u, known: true }));
  for (const s of state.spools) {
    if (s.owner && !list.some((u) => u.name === s.owner)) list.push({ name: str(s.owner), color: "#8a8f8b", known: false });
  }
  return list;
}

const userColor = (name) => safeColor(users().find((u) => u.name === name)?.color);

// Uten innlogging vises bare innloggingssiden (demo er unntaket).
function renderGate() {
  const locked = !DEMO && !token();
  document.body.classList.toggle("locked", locked);
  $("#gate").hidden = !locked;
}

async function refresh() {
  renderGate();
  setSync("Henter…");
  try {
    setDoc(DEMO ? demoDoc() : await loadDoc());
    if (token()) {
      recordSeen();
      shareToken();
      syncReaderCheckouts();
    }
    setSync(DEMO ? "Demo – eksempeldata" : `Oppdatert ${new Date().toLocaleTimeString("nb-NO", { hour: "2-digit", minute: "2-digit" })}`);
  } catch (e) {
    setSync(e.message, true);
  }
  render();
}

function setSync(text, error = false) {
  const el = $("#sync");
  el.textContent = text;
  el.classList.toggle("error", error);
}

// ---------- Visning ----------

// Vinduer der man ikke skal skrive med en gang: fokus på selve vinduet, ikke på første
// felt eller knapp (ellers blinker markøren i et felt). Tab går fortsatt til feltene.
function openQuiet(sel) {
  const dlg = $(sel);
  dlg.showModal();
  dlg.focus();
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// Gjennomsiktige farger vises over et rutemønster.
const CHECKER = "repeating-conic-gradient(#d5d9d6 0 25%, #f4f6f4 0 50%) 0 0 / 14px 14px";

function swatch(tag) {
  if (!tag) return "var(--muted-bg)";
  const c = tag.colors.map((x) => (alpha(x) < 0.15 ? "rgba(255,255,255,.35)" : cssColor(x)));
  const top = c.length > 1 ? `linear-gradient(135deg, ${c[0]} 50%, ${c[1]} 50%)` : `linear-gradient(${c[0]}, ${c[0]})`;
  return tag.colors.some((x) => alpha(x) < 0.99) ? `${top}, ${CHECKER}` : top;
}

const title = (s) => s.name || s.colorName || s.tag?.colors[0].slice(0, 7) || "Ukjent spole";

const SOURCE = { rfid: "RFID", library: "Bambu-bibliotek", ams: "I AMS" };

function libName(x) {
  const official = x.variant && state.colorNames[`GF${x.variant}`];
  return official ? { color: official[0], type: official[1] } : trayName({ infoIdx: x.filamentId, color: x.color });
}

// Hvor spoler står akkurat nå, ut fra AMS-dataene: { RFID/Tray UID: "Printer · AMS A1" }.
// includeOwn: ta med egne AMS-data selv om de ikke deles (brukes i «AMS og bibliotek»).
function amsLocations(includeOwn = false) {
  const where = {};
  for (const u of users()) {
    const ams = amsOf(u.name) || (includeOwn && u.name === userName() ? state.amsLive : null);
    for (const p of ams?.printers || []) {
      for (const a of p.ams) {
        for (const t of a.trays) if (!t.empty && t.uuid) where[t.uuid.toUpperCase()] = `${p.name} · AMS ${String.fromCharCode(65 + a.unit)}${t.slot + 1}`;
      }
      for (const t of p.external) if (!t.empty && t.uuid) where[t.uuid.toUpperCase()] = `${p.name} · ekstern spole`;
    }
  }
  return where;
}

// Antall spoler som står i en AMS akkurat nå (fra delte og egne AMS-data).
const amsCount = () => users().reduce((sum, u) => sum + (amsOf(u.name)?.printers || [])
  .reduce((n, p) => n + p.ams.reduce((m, a) => m + a.trays.filter((t) => !t.empty).length, 0) + p.external.filter((t) => !t.empty).length, 0), 0);

// Bibliotek og AMS i «Våre lokale lager»: bare det brukeren deler, også for en selv.
// For egen bruker brukes ferske live-data når delingen er på.
const sharing = (name, flag) => !!state.doc.users.find((u) => u.name === name)?.[flag];
const libraryOf = (name) => !sharing(name, "shareLibrary") ? null
  : (name === userName() && state.libraryLive) || state.doc.library?.[name] || null;
const amsOf = (name) => !sharing(name, "shareAms") ? null
  : (name === userName() && state.amsLive) || state.doc.ams?.[name] || null;

// Felles form for oppføringer som ikke er RFID-skannet, så filtre og kort kan behandle alt likt.
function stockEntry({ kind, id, owner, status, cols, infoIdx, color, fallbackType, names, ...extra }) {
  const n = names || trayName({ infoIdx, color });
  const colors = cols.length ? cols : ["#CCCCCC"];
  const tag = { colors, weight: extra.total || 0 };
  return {
    kind, id, owner, status, tag, name: "", note: extra.note || "",
    colorName: n.color,
    typeName: n.color ? n.type : fallbackType || "Ukjent type",
    family: cols.length ? family(tag) : "",
    ...extra,
  };
}

// Alt som finnes i lagrene våre. En spole som finnes flere steder (samme RFID / Tray UID)
// vises bare én gang: RFID-skannet først, så biblioteket, så AMS.
function stockItems() {
  const where = amsLocations();
  const items = state.spools.map((s) => ({ ...s, kind: "rfid", location: where[s.id.toUpperCase()] || "" }));
  const seen = new Set(state.spools.map((s) => s.id.toUpperCase()));
  for (const u of users()) {
    const lib = libraryOf(u.name);
    for (const [i, x] of (lib?.spools || []).entries()) {
      if (x.rfid && seen.has(x.rfid)) continue;
      if (x.rfid) seen.add(x.rfid);
      items.push(stockEntry({
        kind: "library", id: `lib:${u.name}:${x.rfid || i}`, owner: u.name, status: x.net > 0 ? "in" : "empty",
        cols: (x.colors.length ? x.colors : [x.color]).filter(Boolean).map((c) => "#" + c),
        infoIdx: x.filamentId, color: x.color, names: libName(x),
        fallbackType: [x.vendor && x.vendor !== "Bambu Lab" ? x.vendor : "", x.name || x.type].filter(Boolean).join(" "),
        net: x.net, total: x.total, location: (x.rfid && where[x.rfid]) || "", note: x.note,
      }));
    }
    for (const p of amsOf(u.name)?.printers || []) {
      const slots = [
        ...p.ams.flatMap((a) => a.trays.map((t) => [t, `${p.name} · AMS ${String.fromCharCode(65 + a.unit)}${t.slot + 1}`])),
        ...p.external.map((t) => [t, `${p.name} · ekstern spole`]),
      ];
      for (const [t, where] of slots) {
        if (t.empty) continue;
        const uuid = (t.uuid || "").toUpperCase();
        if (uuid && seen.has(uuid)) continue;
        if (uuid) seen.add(uuid);
        items.push(stockEntry({
          kind: "ams", id: `ams:${u.name}:${where}`, owner: u.name, status: "in",
          cols: (t.cols.length ? t.cols : [t.color]).filter(Boolean).map((c) => "#" + c),
          infoIdx: t.infoIdx, color: t.color, fallbackType: t.subBrand || t.type,
          remain: t.remain !== null && t.remain >= 0 ? t.remain : null, total: t.weight || 0, location: where,
        }));
      }
    }
  }
  return items;
}

// Omtrentlig gram igjen, for summen øverst.
function gramsLeft(s) {
  if (s.kind === "library") return s.net || 0;
  if (s.kind === "ams") return s.remain !== null ? Math.round(((s.total || 1000) * s.remain) / 100) : 0;
  const lib = libraryWeight(s.id);
  return lib && lib.total ? lib.net : s.tag?.weight || 0;
}
const hueOf = (s) => (s.tag ? FAMILIES.findIndex((f) => f[0] === s.family) * 1000 + hsl(s.tag.colors[0]).h : 1e9);

function filtered({ ignoreType = false } = {}) {
  const { q, owner, family: fam, status, sort } = state.filters;
  const type = ignoreType ? "" : state.filters.type;
  const needle = q.trim().toLowerCase();
  const list = stockItems().filter((s) =>
    (!owner || s.owner === owner) &&
    (!type || s.typeName === type) &&
    (!fam || s.family === fam) &&
    (!status || s.status === status) &&
    (!needle || [title(s), s.typeName, s.colorName, s.tag?.colors.join(" "), s.owner, s.note, s.location, SOURCE[s.kind], usage(s)?.user].join(" ").toLowerCase().includes(needle))
  );
  const by = {
    type: (a, b) => a.typeName.localeCompare(b.typeName) || hueOf(a) - hueOf(b),
    color: (a, b) => hueOf(a) - hueOf(b),
    recent: (a, b) => (b.lastScan || "").localeCompare(a.lastScan || ""),
    owner: (a, b) => (a.owner || "").localeCompare(b.owner || "") || a.typeName.localeCompare(b.typeName) || hueOf(a) - hueOf(b),
  }[sort];
  return list.sort(by);
}

function chip(group, value, label, active, dot) {
  return `<button class="chip${active ? " active" : ""}" data-group="${group}" data-value="${esc(value)}">` +
    (dot ? `<span class="chip-dot" style="background:${dot}"></span>` : "") + `${esc(label)}</button>`;
}

function render() {
  renderAms();
  if (state.tab === "news") renderNews();
  if (state.tab === "loans") renderLoans();
  if (state.tab === "cards") renderCards();
  if (state.tab === "settings") renderSettings();
  renderPendingCount();
  const all = users();
  const items = stockItems();
  const inStock = items.filter((s) => s.status === "in");
  const kg = inStock.reduce((sum, s) => sum + gramsLeft(s), 0) / 1000;
  const inAms = amsCount();
  $("#stats").innerHTML =
    `<div class="stat"><b>${inStock.length}</b><span>spoler på lager</span></div>` +
    `<div class="stat"><b>${kg.toLocaleString("nb-NO", { maximumFractionDigits: 1 })} kg</b><span>filament igjen (ca.)</span></div>` +
    `<div class="stat"><b>${inAms}</b><span>i AMS nå</span></div>` +
    `<div class="stat"><b>${items.filter((s) => s.status === "out").length}</b><span>tatt ut</span></div>` +
    all.map((u) => `<div class="stat owner-stat" style="--owner:${u.color}"><b>${inStock.filter((s) => s.owner === u.name).length}</b><span>${esc(u.name)}</span></div>`).join("");

  // Filtre
  const f = state.filters;
  $("#owner-chips").innerHTML = chip("owner", "", "Alle", !f.owner) +
    all.map((u) => chip("owner", u.name, u.name, f.owner === u.name, u.color)).join("");
  const presentFamilies = new Set(items.map((s) => s.family));
  $("#family-chips").innerHTML = chip("family", "", "Alle farger", !f.family) +
    FAMILIES.filter(([k]) => presentFamilies.has(k)).map(([k, label, c]) => chip("family", k, label, f.family === k, c)).join("");
  // Én fane per filamenttype som finnes i lageret. Antallet følger de andre filtrene.
  const typeCounts = {};
  for (const s of filtered({ ignoreType: true })) typeCounts[s.typeName] = (typeCounts[s.typeName] || 0) + 1;
  const types = [...new Set(items.map((s) => s.typeName))].sort();
  if (f.type && !types.includes(f.type)) f.type = "";
  const total = Object.values(typeCounts).reduce((a, b) => a + b, 0);
  $("#type-tabs").innerHTML =
    `<button class="type-tab${!f.type ? " active" : ""}" data-type="">Alle <span>${total}</span></button>` +
    types.filter((t) => typeCounts[t] || f.type === t)
      .map((t) => `<button class="type-tab${f.type === t ? " active" : ""}" data-type="${esc(t)}">${esc(t)} <span>${typeCounts[t] || 0}</span></button>`).join("");

  // Siste bevegelser
  const events = state.spools
    .flatMap((s) => (s.history || []).map((e) => ({ ...e, spool: s })))
    .sort((a, b) => (b.at || "").localeCompare(a.at || ""))
    .slice(0, 6);
  $("#activity").hidden = !events.length;
  $("#activity-list").innerHTML = events.map((e) => `
    <li data-id="${esc(e.spool.id)}">
      <span class="dot" style="background:${swatch(e.spool.tag)}"></span>
      <span class="act act-${esc(e.action)}">${ACTION[e.action] || esc(e.action)}</span>
      <span class="what">${esc(title(e.spool))} <span class="muted">${esc(e.spool.typeName)}</span>${actDetail(e)}</span>
      <span class="who">${fmtTime(e.at)}</span>
    </li>`).join("");

  // Spoler
  const list = filtered();
  $("#count").textContent = `${list.length} ${list.length === 1 ? "spole" : "spoler"}`;
  // RFID-spoler kan åpnes og redigeres. Bibliotek- og AMS-oppføringer kommer fra Bambu og vises som de er.
  $("#grid").innerHTML = list.length
    ? list.map((s) => {
      const tagName = s.kind === "rfid" ? "button" : "div";
      return `
      <${tagName} class="card status-${s.status} kind-${s.kind}" ${s.kind === "rfid" ? `data-id="${esc(s.id)}"` : ""} style="--owner:${userColor(s.owner)}">
        <div class="swatch" style="background:${swatch(s.tag)}">
          ${s.status !== "in" ? `<span class="badge badge-${s.status}">${STATUS[s.status]}</span>` : ""}
          <span class="source source-${s.kind}">${SOURCE[s.kind]}</span>
          <span class="tip">${productionTip(s)}</span>
        </div>
        <div class="owner-bar"><span class="owner-dot"></span>${esc(s.owner || "Ingen eier")}</div>
        <div class="card-body">
          <div class="card-title">${esc(title(s))}</div>
          <div class="card-type">${esc(s.typeName)}</div>
          <div class="card-meta">
            <span class="hex">${esc(s.tag?.colors.map((c) => c.slice(0, 7)).join(" / ") || "")}</span>
            ${weightLabel(s)}
          </div>
          ${s.location ? `<div class="card-loc">${esc(s.location)}</div>` : ""}
          ${usageLine(s)}
          ${s.note ? `<div class="card-note">${esc(s.note)}</div>` : ""}
        </div>
      </${tagName}>`;
    }).join("")
    : `<p class="empty-msg">${items.length ? "Ingen spoler passer filteret." : `Ingen spoler ennå. Skann en spole med leseren, eller del Bambu-biblioteket ditt under «AMS og bibliotek»${DEMO ? "" : `, eller <a href="?demo">se demo med eksempeldata</a>`}.`}</p>`;
}

// Hvem som bruker en lagerspole: «I AMS hos X» (fra X sin egen AMS) eller «Tatt ut av X».
// En AMS-merking eldre enn siste innsjekk gjelder ikke (spolen er tilbake på hylla).
function usage(s) {
  if (s.kind !== "rfid") return null;
  const history = s.history || [];
  const lastIn = [...history].reverse().find((e) => e.action === "in");
  if (s.inAms && (!lastIn || s.inAms.at > lastIn.at)) return { kind: "ams", user: s.inAms.user, at: s.inAms.at };
  if (s.status === "out") {
    const wait = state.loans.find((l) => l.spool === s.id && loanState(l) === "pending");
    if (wait) return { kind: "pending", user: wait.by, at: wait.at };
    const loan = openLoan(s.id);
    if (loan) return { kind: "loan", user: loan.to, at: loan.at };
    const out = [...history].reverse().find((e) => e.action === "out");
    if (out?.by) return { kind: "out", user: out.by, at: out.at };
  }
  return null;
}

function usageLine(s) {
  const u = usage(s);
  if (!u) return "";
  const text = { ams: `I AMS hos ${u.user}`, loan: `Utlånt til ${u.user}`, pending: `Tatt ut av ${u.user} · venter på godkjenning` }[u.kind] || `Tatt ut av ${u.user}`;
  const tip = u.kind === "ams" ? `Sist sett i AMS-en ${fmtTime(u.at)}` : fmtTime(u.at);
  return `<div class="card-use" style="--owner:${userColor(u.user)}" title="${esc(tip)}"><span class="owner-dot"></span>${esc(text)}</div>`;
}

// ---------- Lånt filament ----------
//
// Et lån opprettes når en spole sjekkes ut til noen andre enn eieren: valgt i «Lånes ut til»,
// eller automatisk når noen sjekker ut en spole de ikke eier (også med RFID-leseren).
// Status regnes ut fra lånet og spolen: utlånt → levert tilbake (sjekket inn) eller
// skylder (brukt opp) → gjort opp.

const MAX_LOANS = 300;
const LOAN_STATE = { out: "Utlånt", owes: "Skylder", returned: "Levert tilbake", settled: "Gjort opp" };

function loanState(l) {
  if (l.own) return "own";
  if (l.pending) {
    // Sjekket inn igjen før noen godkjente: ingenting å godkjenne lenger.
    const s = state.spools.find((x) => x.id === l.spool);
    return !s || s.status !== "out" || (s.history || []).some((e) => e.at > l.at) ? "void" : "pending";
  }
  if (l.settledAt) return "settled";
  if (l.returnedAt) return "returned";
  if (l.usedAt) return "owes";
  const s = state.spools.find((x) => x.id === l.spool);
  if (!s) return "owes";
  const after = (s.history || []).filter((e) => e.at > l.at);
  const last = after.at(-1);
  if (s.status === "empty" && after.some((e) => e.action === "empty")) return "owes";
  if (s.status === "in" && last?.action === "in") return "returned";
  return "out";
}

const openLoan = (spoolId) => [...state.loans].reverse().find((l) => l.spool === spoolId && loanState(l) === "out");

function loanFor(spool, to, at, by, left = gramsLeftNow(spool, { beforeAt: at })) {
  return {
    id: `${spool.id}:${at}`, spool: spool.id, owner: spool.owner || "", to, by, at,
    title: title(spool), type: spool.typeName || "", color: spool.tag?.colors[0]?.slice(1, 7) || "",
    ...(left ? { gramsOut: left.g, gramsSrc: left.src } : {}),
  };
}

// Eldste avsluttede lån fjernes når listen blir for lang.
function trimLoans(doc) {
  while (doc.loans.length > MAX_LOANS) {
    const i = doc.loans.findIndex((l) => l.own || l.settledAt || l.returnedAt);
    doc.loans.splice(i >= 0 ? i : 0, 1);
  }
}

async function addLoan(spool, to, at, by, left) {
  const loan = loanFor(spool, to, at, by, left || undefined);
  await saveDoc((doc) => {
    if (doc.loans.some((l) => l.id === loan.id)) return;
    doc.loans.push(loan);
    trimLoans(doc);
  }, `Lån: ${loan.title} til ${to} (${by})`, "loans");
}

async function closeLoan(spoolId, field, note = "", lib = null) {
  const loan = openLoan(spoolId) || state.loans.find((l) => l.spool === spoolId && loanState(l) === "owes");
  if (!loan) return;
  await saveDoc((doc) => {
    const l = doc.loans.find((x) => x.id === loan.id);
    if (!l) return "Lånet finnes ikke lenger.";
    l[field] = new Date().toISOString();
    if (field === "settledAt") l.settledBy = userName();
    if (note) l.note = clip(note, MAX.note);
    // Vekt ved innlevering fra Bambu-biblioteket, så man ser hvor mye som ble brukt.
    if (field === "returnedAt" && lib?.total) l.gramsIn = lib.net;
  }, `Lån ${{ returnedAt: "levert tilbake", usedAt: "brukt opp", settledAt: "gjort opp" }[field]}: ${loan.title} (${userName()})`, "loans");
}

// Utsjekk med RFID-leseren må godkjennes på siden: fra eget lager holder det med «OK»,
// ellers må man velge hvem spolen gikk til (blir et lån). Leseren setter lastScan til samme
// tidspunkt som hendelsen, så slik kjennes leser-utsjekk igjen. Bare nye utsjekk tas med.
const PENDING_SINCE = "2026-10-08T12:20:00.000Z";
// Leseren merker hendelsene med dev: "reader" (eldre programvare: lastScan = hendelsens tidspunkt).
const fromReader = (s, e) => e.dev === "reader" || e.at === s.lastScan;

async function syncReaderCheckouts() {
  if (DEMO || !token()) return;
  const fresh = [];
  for (const s of state.spools) {
    if (s.status !== "out") continue;
    const out = (s.history || []).at(-1);
    if (out?.action !== "out" || !fromReader(s, out) || out.at < PENDING_SINCE) continue;
    if (state.loans.some((l) => l.spool === s.id && l.at >= out.at)) continue;
    fresh.push({ ...loanFor(s, "", out.at, out.by || ""), pending: true });
  }
  if (!fresh.length) return;
  try {
    await saveDoc((doc) => {
      for (const l of fresh) if (!doc.loans.some((x) => x.id === l.id)) doc.loans.push(l);
      trimLoans(doc);
    }, `Utsjekk fra RFID-leser til godkjenning (${fresh.length})`, "loans");
    render();
  } catch (err) {
    console.warn("Kunne ikke registrere utsjekk:", err.message);
  }
}

// Godkjenner en utsjekk fra leseren: til eieren = eget forbruk, ellers et lån.
async function approveCheckout(loanId, to, btn) {
  if (!to) return ($("#loan-error").textContent = "Velg hvem spolen ble sjekket ut til.");
  btn.disabled = true;
  try {
    await saveDoc((doc) => {
      const l = doc.loans.find((x) => x.id === loanId);
      if (!l) return "Utsjekken finnes ikke lenger.";
      l.pending = false;
      l.to = to;
      l.approvedBy = userName();
      if (to === l.owner) l.own = true;
    }, `Godkjente utsjekk til ${to} (${userName()})`, "loans");
    $("#loan-error").textContent = "";
  } catch (err) {
    $("#loan-error").textContent = err.message;
    btn.disabled = false;
  }
  render();
}

async function loanAction(action, spoolId, btn) {
  const labels = { returned: "Levert? Trykk igjen", used: "Brukt opp? Trykk igjen", settled: "Gjort opp? Trykk igjen" };
  if (!confirmed(btn, labels[action])) return;
  btn.disabled = true;
  try {
    if (action === "returned" || action === "used") {
      const status = action === "returned" ? "in" : "empty";
      await saveDoc((doc) => {
        const s = doc.spools.find((x) => x.id === spoolId);
        if (!s) return;
        if (statusOf(s) !== status) addEvent(s, status);
        s.status = status;
      }, `${action === "returned" ? "Innsjekk" : "Brukt opp"} spole ${spoolId.slice(0, 8)} (${userName()}, lån)`);
      await closeLoan(spoolId, action === "returned" ? "returnedAt" : "usedAt", "", libraryWeight(spoolId));
    } else {
      await closeLoan(spoolId, "settledAt");
    }
  } catch (err) {
    $("#loan-error").textContent = err.message;
    btn.disabled = false;
  }
  render();
}

function renderLoans() {
  const box = $("#tab-loans");
  const loans = state.loans.map((l) => ({ ...l, state: loanState(l) }));
  const waiting = loans.filter((l) => l.state === "pending");
  const mine = new Set(myTodos().map((l) => l.id));
  const todos = waiting.filter((l) => mine.has(l.id));
  const others = waiting.filter((l) => !mine.has(l.id));
  const out = loans.filter((l) => l.state === "out");
  const owes = loans.filter((l) => l.state === "owes");
  const done = loans.filter((l) => l.state === "returned" || l.state === "settled")
    .sort((a, b) => (b.settledAt || b.returnedAt || b.at).localeCompare(a.settledAt || a.returnedAt || a.at)).slice(0, 25);

  // Hvem skylder hvem: én linje per låntaker → eier.
  const debts = {};
  for (const l of owes) {
    const k = `${l.to}\u0000${l.owner}`;
    debts[k] = (debts[k] || 0) + 1;
  }
  const debtChips = Object.entries(debts).map(([k, n]) => {
    const [to, owner] = k.split("\u0000");
    return `<span class="loan-debt"><span class="owner-dot" style="--owner:${userColor(to)}"></span><b>${esc(to)}</b> skylder <b>${esc(owner || "ukjent eier")}</b> ${n} ${n === 1 ? "spole" : "spoler"}</span>`;
  }).join("");

  const spoolOf = (l) => state.spools.find((x) => x.id === l.spool);
  const row = (l) => {
    const s = spoolOf(l);
    const color = s?.tag ? swatch(s.tag) : l.color ? "#" + l.color : "var(--muted-bg)";
    const use = s && usage(s);
    const when = l.state === "settled" ? `gjort opp ${fmtTime(l.settledAt)}${l.settledBy ? ` av ${esc(l.settledBy)}` : ""}`
      : l.state === "returned" ? `levert ${fmtTime(l.returnedAt || (s?.history || []).filter((e) => e.at > l.at && e.action === "in").at(-1)?.at)}`
      : l.state === "owes" ? `brukt opp${l.usedAt ? " " + fmtTime(l.usedAt) : ""}` : `siden ${fmtTime(l.at)}`;
    const grams = l.gramsOut === null ? "" : [
      `${l.gramsOut} g ved utlån${l.gramsSrc === "new" ? " (ubrukt rull)" : ""}`,
      l.gramsIn !== null && l.gramsIn <= l.gramsOut ? `brukt ${l.gramsOut - l.gramsIn} g` : l.state === "owes" ? `brukt ca. ${l.gramsOut} g` : "",
    ].filter(Boolean).join(" · ");
    const actions = !token() ? ""
      : l.state === "out" ? `<button class="btn btn-small" data-loan="returned" data-spool="${esc(l.spool)}">Levert tilbake</button>
          <button class="btn btn-small" data-loan="used" data-spool="${esc(l.spool)}">Brukt opp</button>`
      : l.state === "owes" ? `<button class="btn btn-primary btn-small" data-loan="settled" data-spool="${esc(l.spool)}">Gjort opp</button>` : "";
    return `<li>
      <span class="dot" style="background:${color}"></span>
      <span class="loan-what"><b>${esc(s ? title(s) : l.title || "Slettet spole")}</b><span class="muted">${esc(s?.typeName || l.type)}${use?.kind === "ams" ? ` · i AMS hos ${esc(use.user)}` : ""}</span></span>
      <span class="loan-who"><span class="owner-dot" style="--owner:${userColor(l.owner)}"></span>${esc(l.owner || "Ingen eier")} → <span class="owner-dot" style="--owner:${userColor(l.to)}"></span><b>${esc(l.to)}</b></span>
      <span class="loan-state ${l.state}">${LOAN_STATE[l.state]}</span>
      <span class="muted">${when}${grams ? ` · ${grams}` : ""}</span>
      <span class="loan-actions">${actions}</span>
    </li>`;
  };
  const section = (h, list, empty) => `<h2>${h} (${list.length})</h2>` +
    (list.length ? `<ul class="loan-list">${list.map(row).join("")}</ul>` : `<p class="muted">${empty}</p>`);

  const pendingRow = (l) => {
    const s = spoolOf(l);
    const ownStock = l.by === l.owner;
    // Den som tappet kortet er valgt på forhånd (også om vedkommende ikke er bruker ennå).
    const names = [...new Set([...users().filter((u) => u.known).map((u) => u.name), l.by].filter(Boolean))];
    const opts = names.map((n) =>
      `<option value="${esc(n)}"${n === l.by ? " selected" : ""}>${esc(n)}${n === l.owner ? " (eier)" : ""}</option>`).join("");
    return `<li>
      <span class="dot" style="background:${s?.tag ? swatch(s.tag) : "var(--muted-bg)"}"></span>
      <span class="loan-what"><b>${esc(s ? title(s) : l.title)}</b><span class="muted">${esc(s?.typeName || l.type)} · eier ${esc(l.owner || "ukjent")}</span></span>
      <span class="muted">Sjekket ut med RFID-leseren${l.by ? ` av ${esc(l.by)}` : " (ukjent – ingen kort tappet)"} · ${fmtTime(l.at)}${l.gramsOut !== null ? ` · ${l.gramsOut} g` : ""}</span>
      <span class="loan-actions">${canApprove(l) ? `<select data-pending-to="${esc(l.id)}" aria-label="Sjekket ut til">${l.by ? "" : `<option value="">Sjekket ut til …</option>`}${opts}</select>
        <button class="btn btn-primary btn-small" data-approve-out="${esc(l.id)}">${ownStock ? "OK" : "Godkjenn"}</button>` : `<span class="muted">venter på ${esc(l.owner)}</span>`}</span>
    </li>`;
  };

  box.innerHTML = `<section class="panel loans">
    ${todos.length ? `<div class="pending-box"><h2>Dine gjøremål: utsjekk å godkjenne (${todos.length})</h2>
      <p class="hint">Spolene dine ble sjekket ut med RFID-leseren. Tok du den selv: trykk OK. Ellers velg hvem den gikk til og trykk Godkjenn, så blir det et lån.</p>
      <ul class="loan-list">${todos.map(pendingRow).join("")}</ul></div>` : ""}
    ${others.length ? `<h2>Venter på godkjenning hos andre (${others.length})</h2><ul class="loan-list">${others.map(pendingRow).join("")}</ul>` : ""}
    <div class="loan-sum">${debtChips || `<span class="loan-debt clear">Ingen skylder filament akkurat nå</span>`}</div>
    <p class="hint">Et lån registreres når en spole sjekkes ut til noen andre enn eieren: velg det i «Sjekk ut til» når du sjekker ut. Utsjekk med RFID-leseren må godkjennes her først. Lånet avsluttes når spolen sjekkes inn igjen. Brukes den opp, står låntakeren som skyldig til noen trykker «Gjort opp».</p>
    <p id="loan-error" class="error"></p>
    ${section("Utlånt nå", out, "Ingen spoler er utlånt.")}
    ${section("Skylder", owes, "Ingen skylder filament.")}
    ${section("Avsluttet", done, "Ingen avsluttede lån ennå.")}
  </section>`;
}

// Første del (hvem som gjorde det) i fet skrift, resten som vanlig tekst.
function actDetail(e) {
  const [who, ...rest] = eventDetails(e).split(" · ");
  return `<span class="act-detail"><b>${esc(who)}</b>${rest.length ? ` · ${esc(rest.join(" · "))}` : ""}</span>`;
}

// Detaljer for en hendelse i «Siste bevegelser»: til hvem, lån eller eget lager, gram og om
// den kom fra RFID-leseren og venter på godkjenning.
function eventDetails(e) {
  const s = e.spool;
  const loan = state.loans.find((l) => l.spool === s.id && l.at === e.at);
  const st = loan && loanState(loan);
  const verb = { out: "Sjekket ut", in: "Sjekket inn", empty: "Merket brukt opp" }[e.action] || "Endret";
  const parts = [`${verb} av ${e.by || (fromReader(s, e) ? "ukjent (ingen kort tappet)" : "ukjent")}`];
  if (e.action === "out") {
    const to = loan?.to || e.to || "";
    if (st === "pending") parts.push("venter på godkjenning");
    else if (to && to !== s.owner) parts.push(`lånt til ${to}${st && st !== "out" ? ` (${LOAN_STATE[st].toLowerCase()})` : ""}`);
    else if (to === s.owner || st === "own" || e.by === s.owner) parts.push("eget lager");
    if (s.owner && e.by && e.by !== s.owner && !(to && to !== s.owner)) parts.push(`fra lageret til ${s.owner}`);
    const g = num(e.g) ?? loan?.gramsOut ?? null;
    if (g !== null) parts.push(`${g} g${(e.src || loan?.gramsSrc) === "new" ? " (ubrukt rull)" : ""}`);
  }
  if (e.action === "in") {
    const back = state.loans.find((l) => l.spool === s.id && l.at < e.at && l.to && !l.own && ["returned", "settled"].includes(loanState(l))
      && !(s.history || []).some((x) => x.action === "in" && x.at > l.at && x.at < e.at));
    if (back) parts.push(`lån fra ${back.to} levert tilbake`);
  }
  if (e.action === "empty") {
    const lent = [...state.loans].reverse().find((l) => l.spool === s.id && l.at < e.at && l.to && !l.own && !l.pending);
    if (lent) parts.push(`lånt av ${lent.to}${loanState(lent) === "settled" ? " (gjort opp)" : loanState(lent) === "owes" ? " (skylder)" : ""}`);
  }
  if (fromReader(s, e)) parts.push("RFID-leser");
  return parts.join(" · ");
}

// Utsjekk fra RFID-leseren godkjennes av eieren av spolen (administrator kan også).
// Det blir eierens gjøremål: antallet vises på fanen «Lånt filament» og øverst i lageret.
const canApprove = (l) => !!token() && (l.owner === userName() || isAdmin() || !l.owner);
const myTodos = () => state.loans.filter((l) => loanState(l) === "pending" && (l.owner === userName() || (!l.owner && isAdmin())));

function renderPendingCount() {
  const n = myTodos().length;
  const tab = document.querySelector('.tab[data-tab="loans"]');
  tab.innerHTML = `Lånt filament${n ? `<span class="tab-count">${n}</span>` : ""}`;
  const unnamed = token() ? unnamedCards() : 0;
  document.querySelector('.tab[data-tab="cards"]').innerHTML = `RFID-kort${unnamed ? `<span class="tab-count">${unnamed}</span>` : ""}`;
  $("#stock-pending").hidden = !n;
  $("#stock-pending").textContent = n ? `Gjøremål: ${n} ${n === 1 ? "utsjekk" : "utsjekk"} av spolene dine fra RFID-leseren må godkjennes – trykk for å se` : "";
}

// ---------- Detaljer og redigering ----------

function fmtDate(d) {
  if (!d) return "–";
  return new Date(d).toLocaleDateString("nb-NO", { day: "numeric", month: "short", year: "numeric" });
}

function fmtTime(d) {
  if (!d) return "";
  return new Date(d).toLocaleString("nb-NO", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function openDetail(id) {
  const s = state.spools.find((x) => x.id === id);
  if (!s) return;
  state.selected = id;
  const t = s.tag;
  $("#d-swatch").style.background = swatch(t);
  $("#d-title").textContent = title(s);
  $("#d-sub").textContent = s.typeName;
  const owner = $("#d-owner");
  owner.textContent = s.owner || "Ingen eier";
  owner.style.setProperty("--owner", userColor(s.owner));
  const rows = t ? [
    ["Farge", `${s.colorName || "Ukjent navn"} (${t.colors.map((c) => c.slice(0, 7)).join(" / ")})`],
    ["Status", STATUS[s.status]],
    ["Vekt (ny)", `${t.weight} g`],
    ["Diameter", `${t.diameter} mm`],
    ["Dyse", `${t.hotendMin}–${t.hotendMax} °C`],
    ["Seng", `${t.bedTemp} °C`],
    ["Tørking", `${t.dryingTemp} °C i ${t.dryingHours} t`],
    ["Produsert", t.productionDate instanceof Date && !isNaN(t.productionDate) ? fmtProduction(t.productionDate) : "–"],
    ["Bambu-ID", `${t.materialId} · ${t.variantId}`],
  ] : [["Data", "Kunne ikke tolke brikken"]];
  rows.push(["Lagt inn", fmtDate(s.added)], ["Sist skannet", `${fmtDate(s.lastScan)} (${num(s.scans) || 1}×)`]);
  const left = s.status !== "out" && gramsLeftNow(s);
  if (left) rows.splice(2, 0, [left.src === "lib" ? "Igjen (Bambu-biblioteket)" : "Igjen", gramsText(left)]);
  const use = usage(s);
  if (use) rows.splice(2, 0, [{ ams: "I AMS hos", loan: "Utlånt til", out: "Tatt ut av", pending: "Tatt ut av (venter)" }[use.kind], `${use.user} (${use.kind === "ams" ? "sist sett " : ""}${fmtTime(use.at)})`]);
  // Utsjekk til en person (standard: deg selv). Er det ikke eieren, blir det et lån.
  $("#d-borrower").innerHTML = users().filter((u) => u.known).map((u) =>
    `<option value="${esc(u.name)}"${u.name === userName() ? " selected" : ""}>${esc(u.name)}${u.name === s.owner ? " (eier)" : ""}${u.name === userName() ? " – meg" : ""}</option>`).join("");
  $("#d-borrow-label").hidden = s.status === "out";
  $("#d-rows").innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("");
  $("#d-history").innerHTML = (s.history || []).slice().reverse()
    .map((e) => `<li><span class="act act-${esc(e.action)}">${ACTION[e.action] || esc(e.action)}</span> ${esc(e.by || "")} · ${fmtTime(e.at)}${num(e.g) !== null ? ` · ${num(e.g)} g igjen${e.src === "new" ? " (ubrukt)" : ""}` : ""}</li>`)
    .join("") || "<li class='muted'>Ingen hendelser ennå</li>";
  $("#d-checkin").hidden = s.status === "in";
  $("#d-checkout").hidden = s.status === "out";

  const form = $("#d-form");
  const owners = users().map((u) => u.name);
  form.elements.owner.innerHTML = `<option value="">Ingen eier</option>` +
    owners.map((n) => `<option${n === s.owner ? " selected" : ""}>${esc(n)}</option>`).join("");
  form.elements.name.value = s.name || "";
  form.elements.status.value = s.status;
  form.elements.note.value = s.note || "";
  const canEdit = !!token();
  form.querySelectorAll("input, select, textarea, button").forEach((el) => (el.disabled = !canEdit));
  $("#d-close").disabled = false;
  $("#d-hint").hidden = canEdit;
  $("#d-hint").textContent = DEMO ? "Demo-modus: endringer lagres ikke." : "Logg inn for å kunne endre.";
  $("#d-error").textContent = "";
  openQuiet("#detail");
}

async function saveDetail(e) {
  e.preventDefault();
  const form = e.target;
  const id = state.selected;
  const action = e.submitter?.value;
  if (action === "close") return $("#detail").close();
  if (action === "delete" && !confirmed(e.submitter, "Slette? Trykk igjen")) return;

  const fields = {
    name: clip(form.elements.name.value, MAX.name),
    owner: clip(form.elements.owner.value, MAX.user),
    status: action === "in" || action === "out" ? action : form.elements.status.value,
    note: clip(form.elements.note.value, MAX.note),
  };
  form.querySelectorAll("button").forEach((b) => (b.disabled = true));
  const before = state.spools.find((x) => x.id === id);
  const left = fields.status === "out" && before && before.status !== "out" ? gramsLeftNow(before) : null;
  try {
    await saveDoc((doc) => {
      if (action === "delete") { doc.spools = doc.spools.filter((s) => s.id !== id); return; }
      const spool = doc.spools.find((s) => s.id === id);
      if (!spool) return "Spolen finnes ikke lenger.";
      const to = fields.status === "out" ? $("#d-borrower").value : "";
      if (fields.status !== statusOf(spool)) addEvent(spool, fields.status, { ...(left ? { g: left.g, src: left.src } : {}), ...(to && to !== userName() ? { to } : {}) });
      Object.assign(spool, fields);
    }, `${{ delete: "Slettet", in: "Innsjekk", out: "Utsjekk" }[action] || "Oppdaterte"} spole ${id.slice(0, 8)} (${userName()})`);
    const borrower = $("#d-borrower").value;
    const spool = state.spools.find((x) => x.id === id);
    if (action === "out" && borrower && spool && borrower !== spool.owner) {
      await addLoan(spool, borrower, spool.history?.at(-1)?.at || new Date().toISOString(), userName(), left);
    }
    if (action === "in" && openLoan(id)) await closeLoan(id, "returnedAt", "", libraryWeight(id));
    render();
    $("#detail").close();
  } catch (err) {
    $("#d-error").textContent = err.message;
  } finally {
    form.querySelectorAll("button").forEach((b) => (b.disabled = false));
  }
}

// ---------- Bekreftelse ----------

// Første trykk ber om bekreftelse i knappen, andre trykk (innen 5 sek) utfører handlingen.
// Brukes i stedet for window.confirm, som nettleseren kan blokkere uten å si fra.
function confirmed(btn, question = "Trykk igjen for å bekrefte") {
  if (!btn) return true;
  if (btn.dataset.confirming) {
    clearTimeout(Number(btn.dataset.confirming));
    delete btn.dataset.confirming;
    btn.textContent = btn.dataset.label;
    btn.classList.remove("confirming");
    return true;
  }
  btn.dataset.label = btn.textContent;
  btn.textContent = question;
  btn.classList.add("confirming");
  btn.dataset.confirming = String(setTimeout(() => {
    delete btn.dataset.confirming;
    btn.textContent = btn.dataset.label;
    btn.classList.remove("confirming");
  }, 5000));
  return false;
}

// ---------- Brukere ----------

// Midlertidige passord laget i denne økten. Vises til vinduet lukkes, og lagres aldri.
let freshPasswords = [];

function renderUsers() {
  const canEdit = !!token() && isAdmin();
  const me = userName();
  $("#u-list").innerHTML = users().map((u) => {
    const count = state.spools.filter((s) => s.owner === u.name).length;
    const why = u.name === me ? "Du kan ikke fjerne deg selv" : count ? "Flytt eller slett spolene til brukeren først" : "Fjern bruker";
    const note = [u.admin && "admin", !u.known && "ikke i brukerlisten", u.known && !hasLogin(u) && "ingen innlogging", u.mustChange && "må bytte passord"].filter(Boolean).join(", ");
    const email = state.contacts.emails[u.name] || "";
    return `<li style="--owner:${u.color}">
      <span class="owner-dot"></span>
      <span class="u-name">${esc(u.name)}${note ? ` <span class="muted">(${note})</span>` : ""}</span>
      ${u.known && canEdit ? `<input type="email" class="u-email" data-email="${esc(u.name)}" value="${esc(email)}" placeholder="E-post" maxlength="100" aria-label="E-post for ${esc(u.name)}">`
        : email && isAdmin() ? `<span class="u-email-text muted">${esc(email)}</span>` : ""}
      <span class="muted">${count} ${count === 1 ? "spole" : "spoler"}</span>
      ${u.known ? `
        ${email
          ? `<button type="button" class="btn btn-small" data-send="${esc(u.name)}" ${canEdit ? "" : "disabled"} title="Send midlertidig passord til ${esc(email)}">Send passord</button>`
          : `<button type="button" class="btn btn-small" data-reset="${esc(u.name)}" ${canEdit ? "" : "disabled"} title="Lag midlertidig passord som vises her, og som du gir brukeren selv">Vis nytt passord</button>`}
        <button type="button" class="btn btn-danger btn-small" data-remove="${esc(u.name)}" ${!canEdit || why !== "Fjern bruker" ? "disabled" : ""} title="${why}">Fjern</button>` : ""}
    </li>`;
  }).join("") || "<li class='muted'>Ingen brukere ennå</li>";
  const pending = canEdit ? state.contacts.pending : [];
  $("#u-pending").innerHTML = pending.length ? `<div class="u-pending">
      <h3>Venter på godkjenning (${pending.length})</h3>
      <ul class="u-list">${pending.map((p) => `
        <li>
          <span class="u-name">${esc(p.name)}</span>
          <span class="u-email-text">${esc(p.email)}</span>
          <span class="muted">${p.at ? fmtTime(p.at) : ""}</span>
          <button type="button" class="btn btn-primary btn-small" data-approve="${esc(p.email)}">Godkjenn</button>
          <button type="button" class="btn btn-danger btn-small" data-reject="${esc(p.email)}">Avvis</button>
        </li>`).join("")}</ul>
      <p class="hint">Ved godkjenning legges brukeren til og får et midlertidig passord på e-post.</p>
    </div>` : "";
  $("#u-fresh").innerHTML = freshPasswords.length
    ? `<p><b>Midlertidige passord.</b> Gi dem til brukerne nå, de vises bare denne ene gangen. De virker i 4 timer, og brukeren velger eget passord når hen logger inn med dem. Et passord brukeren har fra før, virker fortsatt.</p>
       <table>${freshPasswords.map(([n, p]) => `<tr><td>${esc(n)}</td><td><code class="pw">${esc(p)}</code></td></tr>`).join("")}</table>`
    : "";
  const form = $("#u-form");
  form.querySelectorAll("input, button").forEach((el) => (el.disabled = !canEdit));
  $("#u-hint").hidden = canEdit;
  $("#u-hint").textContent = DEMO ? "Demo-modus: endringer lagres ikke."
    : !token() ? "Logg inn som administrator for å legge til og fjerne brukere."
    : "Bare administrator kan legge til og fjerne brukere. Du kan bytte ditt eget passord under kontoen din.";
  const used = new Set(state.doc.users.map((u) => u.color));
  form.elements.color.value = USER_COLORS.find((c) => !used.has(c)) || USER_COLORS[0];
}

function openUsers() {
  $("#u-error").textContent = "";
  renderUsers();
  showUsersTab(state.usersTab);
  openQuiet("#users");
}

async function addUser(e) {
  e.preventDefault();
  const form = e.target;
  const name = clip(form.elements.name.value, MAX.user);
  const color = form.elements.color.value;
  const email = form.elements.email.value.trim();
  if (!name) return;
  $("#u-error").textContent = "";
  if (email) {
    if (!cleanEmail(email)) return ($("#u-error").textContent = "E-postadressen ser ikke riktig ut.");
    try {
      await createWithEmail(name, email, color);
      form.elements.name.value = "";
      form.elements.email.value = "";
    } catch (err) {
      $("#u-error").textContent = err.message;
    }
    return;
  }
  try {
    const temp = randomPassword();
    const reset = await tempCred(token(), temp);
    await saveDoc((doc) => {
      if (!adminIn(doc)) return ADMIN_ONLY;
      if (doc.users.some((u) => u.name.toLowerCase() === name.toLowerCase())) return `${name} finnes allerede.`;
      doc.users.push({ name, color, reset, mustChange: true });
    }, `La til bruker ${name} (${userName()})`, "users");
    freshPasswords.push([name, temp]);
    form.elements.name.value = "";
    render();
    renderUsers();
  } catch (err) {
    $("#u-error").textContent = err.message;
  }
}

async function resetPassword(name, btn) {
  $("#u-error").textContent = `Lager passord for ${name}…`;
  if (btn) btn.disabled = true;
  try {
    const temp = randomPassword();
    const reset = await tempCred(token(), temp);
    await saveDoc((doc) => {
      if (!adminIn(doc)) return ADMIN_ONLY;
      const u = doc.users.find((x) => x.name === name);
      if (!u) return `${name} finnes ikke lenger.`;
      u.reset = reset;
    }, `Nytt passord for ${name} (${userName()})`, "users");
    freshPasswords = freshPasswords.filter(([n]) => n !== name).concat([[name, temp]]);
    $("#u-error").textContent = "";
    if (name === userName()) {
      $("#users").close();
      openChangePassword(true);
    }
    renderUsers();
  } catch (err) {
    $("#u-error").textContent = err.message;
    if (btn) btn.disabled = false;
  }
}

async function removeUser(name, btn) {
  if (!confirmed(btn, "Fjerne? Trykk igjen")) return;
  $("#u-error").textContent = "";
  try {
    await saveDoc((doc) => {
      if (!adminIn(doc)) return ADMIN_ONLY;
      if (name === userName()) return "Du kan ikke fjerne deg selv.";
      if (state.spools.some((s) => s.owner === name)) return `${name} eier fortsatt spoler. Flytt eller slett dem først.`;
      doc.users = doc.users.filter((u) => u.name !== name);
    }, `Fjernet bruker ${name} (${userName()})`, "users");
    if (state.contacts.emails[name]) {
      await saveDoc((doc) => { delete doc.emails[name]; }, `Fjernet e-post for ${name} (${userName()})`, "contacts");
    }
    freshPasswords = freshPasswords.filter(([n]) => n !== name);
    if (state.filters.owner === name) state.filters.owner = "";
    render();
    renderUsers();
  } catch (err) {
    $("#u-error").textContent = err.message;
  }
}

// ---------- RFID-kort ----------
//
// Flere kan dele én leser: hver bruker tapper kortet sitt før spolene. Leseren slår opp kortet
// i spools.json ("cards") og viser navnet på skjermen. Et nytt kort registreres uten navn,
// og navnet settes her. Kortet ditt kan du endre selv; administrator kan endre alle.

const canEditCard = (c) => !!token() && (isAdmin() || !c.user || c.user === userName());
const unnamedCards = () => Object.values(state.doc.cards || {}).filter((c) => !c.user).length;

function renderCards() {
  const box = $("#tab-cards");
  const entries = Object.entries(state.doc.cards || {})
    .sort(([, a], [, b]) => (!!a.user - !!b.user) || a.user.localeCompare(b.user) || (b.added || "").localeCompare(a.added || ""));
  const names = users().filter((u) => u.known).map((u) => u.name);
  const row = ([uid, c]) => {
    const edit = canEditCard(c);
    const choices = isAdmin() ? names : [...new Set([c.user, userName()].filter(Boolean))];
    return `<tr style="--owner:${userColor(c.user)}">
      <td><code>${esc(uid)}</code></td>
      <td>${edit ? `<select data-card-user="${esc(uid)}" aria-label="Bruker for ${esc(uid)}">
          <option value=""${c.user ? "" : " selected"}>Uten navn</option>
          ${choices.map((n) => `<option${n === c.user ? " selected" : ""}>${esc(n)}</option>`).join("")}
        </select>` : c.user ? `<span class="owner-dot"></span> ${esc(c.user)}` : `<span class="muted">Uten navn</span>`}</td>
      <td>${edit ? `<input data-card-label="${esc(uid)}" value="${esc(c.label)}" placeholder="F.eks. blå nøkkelring" maxlength="${MAX.name}">` : esc(c.label)}</td>
      <td class="muted">${c.added ? fmtTime(c.added) : "–"}${c.reader ? ` · leser ${esc(c.reader)}` : ""}</td>
      <td>${edit ? `<button type="button" class="btn btn-danger btn-small" data-card-remove="${esc(uid)}">Fjern</button>` : ""}</td>
    </tr>`;
  };
  box.innerHTML = `<section class="panel cards-panel">
    <h2>RFID-kort</h2>
    <p class="hint">Deler flere én leser, tapper hver sitt kort før spolene. Da registreres spolene på den som eier kortet (${fmtMinutes(state.doc.settings?.cardMinutes ?? 1)} etter siste tapp, se Innstillinger), og navnet vises på leserens skjerm. Et nytt kort registreres uten navn første gang det tappes. Velg navnet her, så viser leseren det neste gang. Du kan endre ditt eget kort, og kort uten navn. Administrator kan endre alle.</p>
    ${unnamedCards() ? `<p class="notice">${unnamedCards()} ${unnamedCards() === 1 ? "kort mangler" : "kort mangler"} navn.</p>` : ""}
    <p id="card-error" class="error"></p>
    ${entries.length ? `<div class="table-wrap"><table class="stat-table cards-table">
      <thead><tr><th>Kort</th><th>Brukes av</th><th>Etikett</th><th>Registrert</th><th></th></tr></thead>
      <tbody>${entries.map(row).join("")}</tbody></table></div>`
      : `<p class="muted">Ingen kort registrert ennå. Tapp et kort på leseren, så dukker det opp her.</p>`}
  </section>`;
}

async function cardAction(kind, uid, value, el) {
  if (kind === "remove" && !confirmed(el, "Fjerne? Trykk igjen")) return;
  el.disabled = true;
  try {
    await saveDoc((doc) => {
      doc.cards = doc.cards && typeof doc.cards === "object" ? doc.cards : {};
      const raw = doc.cards[uid];
      const c = typeof raw === "string" ? { user: raw } : raw ? { ...raw } : null;
      if (!c) return "Kortet finnes ikke lenger.";
      if (!(isAdmin() || !c.user || c.user === userName())) return "Du kan bare endre ditt eget kort.";
      if (kind === "user") {
        if (value && value !== userName() && !isAdmin()) return "Du kan bare koble kort til deg selv.";
        c.user = value;
      }
      if (kind === "label") c.label = clip(value, MAX.name);
      if (kind === "remove") delete doc.cards[uid];
      else doc.cards[uid] = c;
    }, `${{ user: value ? `RFID-kort ${uid} til ${value}` : `RFID-kort ${uid} uten navn`, label: `Etikett på RFID-kort ${uid}`, remove: `Fjernet RFID-kort ${uid}` }[kind]} (${userName()})`);
    $("#card-error").textContent = "";
  } catch (err) {
    $("#card-error").textContent = err.message;
  }
  render();
}

// ---------- Innstillinger ----------

const fmtMinutes = (m) => (m < 1 ? `${Math.round(m * 60)} sekunder` : m === 1 ? "1 minutt" : `${String(m).replace(".", ",")} minutter`);

function renderSettings() {
  const box = $("#tab-settings");
  const st = state.doc.settings || cleanSettings({});
  const edit = !!token() && isAdmin() && !DEMO;
  const field = (key, label, help) => {
    const r = SETTINGS[key];
    return `<label class="setting">
      <span class="setting-label">${label}</span>
      <span class="setting-input"><input type="number" data-setting="${key}" value="${st[key]}" min="${r.min}" max="${r.max}" step="${r.step}" ${edit ? "" : "disabled"}> minutter</span>
      <span class="hint">${help} Nå: ${fmtMinutes(st[key])}. Standard: ${fmtMinutes(r.def)}.</span>
    </label>`;
  };
  box.innerHTML = `<section class="panel settings-panel">
    <h2>Innstillinger</h2>
    <h3>RFID-leser</h3>
    <p class="hint">Leseren henter innstillingene hver gang et kort eller en spole skannes, så endringer gjelder med en gang. ${edit ? "" : "Bare administrator kan endre dem."}</p>
    ${field("cardMinutes", "RFID-kort gjelder i", "Hvor lenge spoler registreres på den som tappet kortet sitt. Hver spole som tappes, starter tiden på nytt.")}
    ${field("checkoutMinutes", "Utsjekk etter", "En spole som er inne, sjekkes ut når den skannes på nytt etter så lang tid. Skannes den før det, skjer ingenting.")}
    <p id="settings-msg" class="hint" role="status"></p>
  </section>`;
}

async function saveSetting(key, input) {
  const r = SETTINGS[key];
  const v = num(input.value);
  const msg = $("#settings-msg");
  if (v === null || v < r.min || v > r.max) {
    msg.textContent = `Velg mellom ${r.min} og ${r.max} minutter.`;
    return;
  }
  input.disabled = true;
  try {
    await saveDoc((doc) => {
      if (!adminIn(state.doc)) return "Bare administrator kan endre innstillingene.";
      doc.settings = { ...(doc.settings || {}), [key]: v };
    }, `Innstilling ${key} = ${v} (${userName()})`);
    msg.textContent = "Lagret. Leseren bruker den nye verdien ved neste skanning.";
  } catch (err) {
    msg.textContent = err.message;
  }
  renderSettings();
}

// ---------- E-post og registrering ----------

// Ny bruker uten passord på skjermen: Workeren lager et midlertidig passord og sender det.
async function createWithEmail(name, email, color, fromPending = false) {
  $("#u-error").textContent = `Legger til ${name}…`;
  await saveDoc((doc) => {
    if (!adminIn(doc)) return ADMIN_ONLY;
    if (doc.users.some((u) => u.name.toLowerCase() === name.toLowerCase())) return `${name} finnes allerede.`;
    doc.users.push({ name, color, mustChange: true });
  }, `La til bruker ${name} (${userName()})`, "users");
  await saveDoc((doc) => {
    doc.emails[name] = email;
    if (fromPending) doc.pending = doc.pending.filter((p) => p.email !== email);
  }, `E-post for ${name} (${userName()})`, "contacts");
  render();
  renderUsers();
  await sendPassword(name);
}

async function sendPassword(name, btn) {
  const email = state.contacts.emails[name];
  if (!email) return;
  if (btn) btn.disabled = true;
  $("#u-error").textContent = `Sender passord til ${email}…`;
  try {
    await shareToken(true);
    await proxy("/reset", { who: name });
    $("#u-error").textContent = `Midlertidig passord er sendt til ${email}. Det virker i 4 timer.`;
    setTimeout(refresh, 2000);
  } catch (err) {
    $("#u-error").textContent = `Kunne ikke sende e-post: ${err.message}`;
  }
  if (btn) btn.disabled = false;
}

async function saveEmail(name, input) {
  const email = input.value.trim();
  if (email === (state.contacts.emails[name] || "")) return;
  if (email && !cleanEmail(email)) return ($("#u-error").textContent = "E-postadressen ser ikke riktig ut.");
  $("#u-error").textContent = "Lagrer e-post…";
  try {
    await saveDoc((doc) => {
      if (!adminIn(state.doc)) return ADMIN_ONLY;
      if (email) doc.emails[name] = email; else delete doc.emails[name];
    }, `E-post for ${name} (${userName()})`, "contacts");
    $("#u-error").textContent = email ? `Lagret e-post for ${name}.` : `Fjernet e-post for ${name}.`;
    renderUsers();
  } catch (err) {
    $("#u-error").textContent = err.message;
  }
}

async function approve(email, btn) {
  const p = state.contacts.pending.find((x) => x.email === email);
  if (!p) return;
  btn.disabled = true;
  const used = new Set(state.doc.users.map((u) => u.color));
  const color = USER_COLORS.find((c) => !used.has(c)) || USER_COLORS[state.doc.users.length % USER_COLORS.length];
  try {
    await createWithEmail(p.name, p.email, color, true);
  } catch (err) {
    $("#u-error").textContent = err.message;
    btn.disabled = false;
  }
}

async function reject(email, btn) {
  if (!confirmed(btn, "Avvise? Trykk igjen")) return;
  try {
    await saveDoc((doc) => {
      if (!adminIn(state.doc)) return ADMIN_ONLY;
      doc.pending = doc.pending.filter((p) => p.email !== email);
    }, `Avviste registrering (${userName()})`, "contacts");
    $("#u-error").textContent = "";
    renderUsers();
  } catch (err) {
    $("#u-error").textContent = err.message;
  }
}

// Workeren trenger GitHub-tokenen for å sende passord og ta imot registreringer.
// Den sendes når administrator er innlogget (og når tokenen er byttet).
let tokenShared = "";
async function shareToken(strict = false) {
  if (DEMO || !token() || !isAdmin() || tokenShared === token()) return;
  try {
    await proxy("/reset-token", {}, token());
    tokenShared = token();
  } catch (err) {
    if (strict) throw err;
    console.warn("Kunne ikke gi Workeren tokenen:", err.message);
  }
}

function openPublic(id) {
  if (id === "forgot") {
    $("#f-who").value = $("#login").open ? $("#l-user").value : "";
    $("#f-status").textContent = "";
    $("#f-error").textContent = "";
    $("#f-send").disabled = false;
  } else {
    $("#r-name").value = "";
    $("#r-email").value = "";
    $("#r-status").textContent = "";
    $("#r-error").textContent = "";
    $("#r-send").disabled = false;
  }
  if ($("#login").open) $("#login").close();
  $(`#${id}`).showModal();
}

async function forgot(e) {
  e.preventDefault();
  if (e.submitter?.value === "cancel") return $("#forgot").close();
  const who = $("#f-who").value.trim();
  if (!who) return;
  $("#f-error").textContent = "";
  $("#f-status").textContent = "Sender…";
  $("#f-send").disabled = true;
  try {
    await proxy("/reset", { who });
    $("#f-status").textContent = "Er brukeren eller adressen registrert med e-post, er et midlertidig passord sendt nå. Sjekk innboksen (og søppelpost). Får du ingenting, spør administrator om å legge inn e-postadressen din.";
  } catch (err) {
    $("#f-status").textContent = "";
    $("#f-error").textContent = err.message;
    $("#f-send").disabled = false;
  }
}

async function registerUser(e) {
  e.preventDefault();
  if (e.submitter?.value === "cancel") return $("#register").close();
  const name = $("#r-name").value.trim();
  const email = $("#r-email").value.trim();
  if (!name || !email) return;
  $("#r-error").textContent = "";
  $("#r-status").textContent = "Sender…";
  $("#r-send").disabled = true;
  try {
    await proxy("/register", { name, email });
    $("#r-status").textContent = "Forespørselen er sendt. Når administrator har godkjent den, får du et midlertidig passord på e-post.";
  } catch (err) {
    $("#r-status").textContent = "";
    $("#r-error").textContent = err.message;
    $("#r-send").disabled = false;
  }
}

// ---------- Innloggingsstatistikk ----------

// Kort beskrivelse av nettleser og system, f.eks. "Chrome · Windows".
function deviceName() {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox"
    : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Annen nettleser";
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad|iPod/.test(ua) ? "iOS"
    : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "annet system";
  return `${browser} · ${os}`;
}

// Lagres i bakgrunnen; en feil her skal aldri hindre innlogging.
async function recordLogin(name, remember) {
  try {
    const at = new Date().toISOString();
    await saveDoc((doc) => {
      doc.logins.push({ user: name, at, device: deviceName(), remember: !!remember });
      doc.logins = doc.logins.slice(-MAX_LOGINS);
      doc.seen[name] = at;
    }, `Innlogging (${name})`, "activity");
  } catch (err) {
    console.warn("Kunne ikke lagre innlogging:", err.message);
  }
}

// «Sist aktiv» oppdateres når en innlogget bruker bruker siden (høyst hver 6. time).
async function recordSeen() {
  const name = userName();
  if (!name || DEMO) return;
  const last = new Date(state.activity.seen[name] || 0).getTime();
  if (Date.now() - last < SEEN_EVERY_MS) return;
  try {
    await saveDoc((doc) => { doc.seen[name] = new Date().toISOString(); }, `Aktiv (${name})`, "activity");
  } catch (err) {
    console.warn("Kunne ikke lagre aktivitet:", err.message);
  }
}

function renderStats() {
  const box = $("#u-stats");
  const { logins, seen } = state.activity;
  const now = Date.now();
  const since30 = now - 30 * 864e5;
  const recent = logins.filter((x) => new Date(x.at).getTime() >= since30);

  // Innlogginger per dag, siste 30 dager
  const days = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(now - (29 - i) * 864e5);
    return d.toISOString().slice(0, 10);
  });
  const perDay = Object.fromEntries(days.map((d) => [d, 0]));
  for (const x of recent) if (x.at.slice(0, 10) in perDay) perDay[x.at.slice(0, 10)]++;
  const max = Math.max(1, ...Object.values(perDay));

  const rows = users().filter((u) => u.known).map((u) => {
    const mine = logins.filter((x) => x.user === u.name);
    const last = mine[mine.length - 1];
    return {
      u, total: mine.length, recent: mine.filter((x) => new Date(x.at).getTime() >= since30).length,
      last, seen: seen[u.name] || last?.at || "",
      devices: [...new Set(mine.map((x) => x.device))],
    };
  }).sort((a, b) => (b.seen || "").localeCompare(a.seen || ""));

  const ago = (d) => {
    if (!d) return "aldri";
    const h = (now - new Date(d).getTime()) / 3600e3;
    return h < 1 ? "nå nettopp" : h < 24 ? `${Math.floor(h)} t siden` : `${Math.floor(h / 24)} d siden`;
  };

  box.innerHTML = `
    <div class="stats stats-small">
      <div class="stat"><b>${logins.length}</b><span>innlogginger totalt</span></div>
      <div class="stat"><b>${recent.length}</b><span>siste 30 dager</span></div>
      <div class="stat"><b>${rows.filter((r) => r.seen && now - new Date(r.seen).getTime() < 7 * 864e5).length}</b><span>aktive siste 7 dager</span></div>
      <div class="stat"><b>${rows.filter((r) => !r.total).length}</b><span>aldri logget inn</span></div>
    </div>

    <h3>Innlogginger per dag (siste 30 dager)</h3>
    <div class="day-chart" role="img" aria-label="Innlogginger per dag">
      ${days.map((d) => `<div class="day-bar" title="${fmtDay(d)}: ${perDay[d]}"><span style="height:${Math.round((perDay[d] / max) * 100)}%"></span></div>`).join("")}
    </div>
    <div class="day-axis"><span>${fmtDay(days[0])}</span><span>i dag</span></div>

    <h3>Per bruker</h3>
    <table class="stat-table">
      <thead><tr><th>Bruker</th><th>Sist aktiv</th><th>Siste innlogging</th><th>30 d</th><th>Totalt</th><th>Enheter</th></tr></thead>
      <tbody>${rows.map((r) => `
        <tr style="--owner:${r.u.color}">
          <td><span class="owner-dot"></span> ${esc(r.u.name)}${r.u.mustChange ? ` <span class="muted">(midlertidig passord)</span>` : ""}</td>
          <td title="${esc(r.seen ? fmtTime(r.seen) : "")}">${ago(r.seen)}</td>
          <td>${r.last ? fmtTime(r.last.at) : "–"}</td>
          <td>${r.recent}</td>
          <td>${r.total}</td>
          <td class="muted">${esc(r.devices.join(", ")) || "–"}</td>
        </tr>`).join("")}</tbody>
    </table>

    <h3>Siste innlogginger</h3>
    <ul class="login-log">${logins.slice(-25).reverse().map((x) => `
      <li><span class="owner-dot" style="--owner:${userColor(x.user)}"></span><b>${esc(x.user)}</b>
        <span class="muted">${fmtTime(x.at)} · ${esc(x.device)}${x.remember ? " · husk meg" : ""}</span></li>`).join("") || "<li class='muted'>Ingen innlogginger registrert ennå.</li>"}
    </ul>
    <p class="hint">Registreres fra og med nå: vellykkede innlogginger og «sist aktiv» (høyst hver 6. time). Mislykkede forsøk kan ikke registreres, fordi siden ikke har skrivetilgang før passordet er riktig. Lagres i det private data-repoet (maks ${MAX_LOGINS} innlogginger).</p>`;
}

function showUsersTab(tab) {
  const admin = isAdmin();
  state.usersTab = admin && tab === "stats" ? "stats" : "list";
  $("#u-tabs").hidden = !admin;
  document.querySelectorAll("#u-tabs .sub-tab").forEach((b) => b.classList.toggle("active", b.dataset.utab === state.usersTab));
  $("#u-list-pane").hidden = state.usersTab !== "list";
  $("#u-stats").hidden = state.usersTab !== "stats";
  if (state.usersTab === "stats") renderStats();
}

// ---------- Innlogging ----------

function renderAccount() {
  $("#account-label").textContent = session ? session.user : "Logg inn";
  $("#account").classList.toggle("logged-in", !!session);
  $("#account").hidden = DEMO;
}

function setSession(value, remember = !!session?.exp) {
  const changed = !!session?.token !== !!value?.token;
  session = value && { user: value.user, token: value.token };
  saveSession(session, remember);
  renderGate();
  // Ved inn- eller utlogging hentes dataene på nytt (eller tømmes).
  if (changed) {
    if (!value) setDoc({ users: state.doc.users, spools: [], ams: {}, library: {}, wishes: {} });
    setTimeout(refresh);
  }
  state.amsLive = null;
  state.libraryLive = null;
  state.amsError = "";
  renderAccount();
  render();
  if (value && state.tab === "ams") refreshAms();
}

function openAccount() {
  if (!session) return openLogin();
  $("#a-name").textContent = session.user;
  openQuiet("#account-dialog");
}

function openLogin() {
  const withLogin = state.doc.users.filter(hasLogin);
  if (!withLogin.length) return openSetup();
  const last = store("bf.lastUser");
  $("#l-user").innerHTML = withLogin.map((u) => `<option${u.name === last ? " selected" : ""}>${esc(u.name)}</option>`).join("");
  $("#l-password").value = "";
  $("#l-error").textContent = "";
  $("#login").showModal();
}

async function login(e) {
  e.preventDefault();
  if (e.submitter?.value === "cancel") return $("#login").close();
  const name = $("#l-user").value;
  const user = state.doc.users.find((u) => u.name === name);
  $("#l-error").textContent = "Sjekker…";
  const pw = $("#l-password").value;
  // Nøkkelpar (vanlig), eldre innlogging (tokenen kryptert direkte med passordet) eller
  // midlertidig passord fra e-post (gjelder i 4 timer).
  let tok = user?.kp && (await openKeys(user.kp, pw));
  let legacy = false;
  if (!tok && user?.cred) {
    tok = await decryptToken(user.cred, pw);
    legacy = !!tok;
  }
  let viaReset = false;
  if (!tok && user?.reset && new Date(user.reset.exp).getTime() > Date.now()) {
    tok = await decryptToken(user.reset, pw);
    viaReset = !!tok;
  }
  if (!tok) {
    const expired = user?.reset && !viaReset && new Date(user.reset.exp).getTime() <= Date.now() && (await decryptToken(user.reset, pw));
    $("#l-error").textContent = expired
      ? "Det midlertidige passordet er utløpt (det gjaldt i 4 timer). Trykk «Glemt passord?» for å få et nytt, eller spør administrator."
      : "Feil passord.";
    return;
  }
  // Sjekk at tokenen fortsatt virker (den kan være utløpt eller generert på nytt).
  const check = await fetch(`https://api.github.com/repos/${AUTH_REPO}`, { headers: { Authorization: `Bearer ${tok}` } }).catch(() => null);
  if (check?.status === 401) {
    if (user.admin) {
      $("#login").close();
      return openRekey(name, $("#l-password").value, $("#l-remember").checked);
    }
    $("#l-error").textContent = "GitHub-tokenen er utløpt eller byttet. Administrator må logge inn og legge inn en ny token.";
    return;
  }
  store("bf.lastUser", name);
  setSession({ user: name, token: tok }, $("#l-remember").checked);
  recordLogin(name, $("#l-remember").checked);
  $("#login").close();
  if (user.admin) shareToken();
  if (user.mustChange || viaReset) openChangePassword(true);
  else if (legacy) upgradeLogin(name, tok, pw);
}

const hasLogin = (u) => !!(u && (u.kp || u.cred || u.reset));

// Eldre innlogging gjøres om til nøkkelpar i bakgrunnen, med samme passord.
async function upgradeLogin(name, tok, pw) {
  try {
    const kp = await makeKeys(tok, pw);
    await saveDoc((doc) => {
      const u = doc.users.find((x) => x.name === name);
      if (!u) return "Brukeren finnes ikke.";
      u.kp = kp;
      delete u.cred;
    }, `Ny innloggingsnøkkel (${name})`, "users");
  } catch (err) {
    console.warn("Kunne ikke oppgradere innloggingen:", err.message);
  }
}

// ---------- Ny GitHub-token (når den gamle er utløpt eller generert på nytt) ----------
//
// Brukere med nøkkelpar får den nye tokenen kryptert til sin offentlige nøkkel og beholder
// passordet. Bare brukere som ennå ikke har valgt eget passord (midlertidig passord eller
// eldre innlogging) trenger nytt midlertidig passord: på e-post hvis de har adresse,
// ellers vises det her.
let rekey = null;

function openRekey(name, password, remember) {
  rekey = { name, password, remember };
  $("#rk-token").value = "";
  $("#rk-error").textContent = "";
  $("#rk-form").hidden = false;
  $("#rk-done").hidden = true;
  $("#rekey").showModal();
}

async function saveRekey(e) {
  e.preventDefault();
  if (e.submitter?.value === "cancel") {
    rekey = null;
    return $("#rekey").close();
  }
  const tok = $("#rk-token").value.trim();
  const err = $("#rk-error");
  try {
    if (!/^(github_pat_|ghp_)/.test(tok)) throw new Error("Det ser ikke ut som en GitHub-token. Den skal starte med github_pat_.");
    err.textContent = "Sjekker tokenen…";
    for (const repo of [DATA_REPO, AUTH_REPO]) {
      const res = await fetch(`https://api.github.com/repos/${repo}`, { headers: { Authorization: `Bearer ${tok}` } });
      if (res.status === 401) throw new Error("GitHub godtar ikke tokenen. Sjekk at hele tokenen er kopiert.");
      if (!res.ok) throw new Error(`Tokenen har ikke tilgang til ${repo.split("/")[1]}. Velg både BambuFilament-data og BambuFilament-auth under Repository access.`);
    }
    err.textContent = "Krypterer og lagrer…";
    const mine = await makeKeys(tok, rekey.password);
    // E-postadressene kunne ikke leses med den gamle tokenen.
    session = { user: rekey.name, token: tok };
    state.contacts = cleanContacts(await loadFile("contacts").catch(() => FILES.contacts.empty()));
    // Krypteringen er asynkron, så den gjøres før lagring (saveDoc kjører mutate synkront).
    const plan = {};
    for (const u of state.doc.users) {
      if (u.name === rekey.name) continue;
      if (u.kp && !u.mustChange) plan[u.name] = { kp: { ...u.kp, box: await sealToken(tok, u.kp.pub) } };
      else if (!(u.kp || u.cred || u.reset)) continue;
      else if (state.contacts.emails[u.name]) plan[u.name] = { mail: true };
      else {
        const temp = randomPassword();
        plan[u.name] = { temp, reset: await tempCred(tok, temp) };
      }
    }
    const kept = [], mailed = [], shown = [];
    session = { user: rekey.name, token: tok };
    await saveDoc((doc) => {
      kept.length = mailed.length = shown.length = 0;
      for (const u of doc.users) {
        delete u.reset; // kryptert med den gamle tokenen
        const p = plan[u.name];
        if (u.name === rekey.name) {
          Object.assign(u, { kp: mine, mustChange: false });
          delete u.cred;
        } else if (p?.kp && u.kp?.pub === p.kp.pub) {
          u.kp = p.kp;
          kept.push(u.name);
        } else if (p?.mail) {
          mailed.push(u.name);
        } else if (p?.reset) {
          u.reset = p.reset;
          u.mustChange = true;
          delete u.cred;
          delete u.kp;
          shown.push({ name: u.name, temp: p.temp });
        }
      }
    }, `Ny GitHub-token (${rekey.name})`, "users");
    session = null;
    setSession({ user: rekey.name, token: tok }, rekey.remember);
    recordLogin(rekey.name, rekey.remember);
    // Workeren må ha den nye tokenen før den kan sende passord.
    let mailError = "";
    if (mailed.length) {
      try {
        await shareToken(true);
        for (const name of mailed) await proxy("/reset", { who: name });
      } catch (ex) {
        mailError = ex.message;
      }
    }
    $("#rk-summary").innerHTML = [
      kept.length && `<p><b>Beholder passordet sitt:</b> ${kept.map(esc).join(", ")}. De merker ingenting, bortsett fra at de som er innlogget må logge inn på nytt.</p>`,
      mailed.length && (mailError
        ? `<p class="error">Kunne ikke sende e-post til ${mailed.map(esc).join(", ")}: ${esc(mailError)}. De kan bruke «Glemt passord?».</p>`
        : `<p><b>Fikk nytt midlertidig passord på e-post:</b> ${mailed.map(esc).join(", ")} (hadde ikke valgt eget passord ennå).</p>`),
      shown.length && `<p><b>Gi disse midlertidige passordene til brukerne.</b> De vises bare nå og virker i 4 timer.</p>`,
    ].filter(Boolean).join("") || "<p>Ingen andre brukere har innlogging.</p>";
    $("#rk-list").innerHTML = shown.map((o) => `<tr><td>${esc(o.name)}</td><td><code class="pw">${esc(o.temp)}</code></td></tr>`).join("");
    $("#rk-form").hidden = true;
    $("#rk-done").hidden = false;
    rekey = null;
    err.textContent = "";
  } catch (ex) {
    session = null;
    err.textContent = ex.message;
  }
}

function accountAction(e) {
  const action = e.submitter?.value;
  if (action === "logout") setSession(null);
  if (action === "password") setTimeout(() => openChangePassword(false));
}

function openChangePassword(forced) {
  const dlg = $("#password");
  dlg.dataset.forced = forced ? "1" : "";
  $("#p-forced").hidden = !forced;
  $("#p-cancel").hidden = forced;
  // Ved frivillig bytte må nåværende passord oppgis, så ingen kan bytte det fra en
  // innlogget nettleser («Husk meg») og stenge eieren ute. Tvunget bytte rett etter
  // innlogging med midlertidig passord er unntaket.
  $("#p-current-label").hidden = forced;
  $("#p-current").value = "";
  $("#p-new").value = "";
  $("#p-repeat").value = "";
  $("#p-error").textContent = "";
  dlg.showModal();
}

async function changePassword(e) {
  e.preventDefault();
  const dlg = $("#password");
  if (e.submitter?.value === "cancel" && !dlg.dataset.forced) return dlg.close();
  const pw = $("#p-new").value;
  if (!dlg.dataset.forced) {
    const me = state.doc.users.find((u) => u.name === userName());
    const cur = $("#p-current").value;
    const ok = ((me?.kp && (await openKeys(me.kp, cur))) || (me?.cred && (await decryptToken(me.cred, cur)))) === token();
    if (!ok) return ($("#p-error").textContent = "Nåværende passord er feil.");
  }
  const weak = passwordProblem(pw, userName());
  if (weak) return ($("#p-error").textContent = weak);
  if (pw !== $("#p-repeat").value) return ($("#p-error").textContent = "Passordene er ikke like.");
  $("#p-error").textContent = "Lagrer…";
  try {
    const kp = await makeKeys(token(), pw);
    await saveDoc((doc) => {
      const u = doc.users.find((x) => x.name === userName());
      if (!u) return "Brukeren din finnes ikke lenger.";
      u.kp = kp;
      u.mustChange = false;
      delete u.cred;
      delete u.reset;
    }, `Byttet passord (${userName()})`, "users");
    freshPasswords = freshPasswords.filter(([n]) => n !== userName());
    dlg.close();
  } catch (err) {
    $("#p-error").textContent = err.message;
  }
}

// Første oppsett: ingen brukere har innlogging ennå.
function openSetup() {
  const existing = [...state.doc.users].sort((a, b) => !!b.admin - !!a.admin).map((u) => u.name);
  if (existing.length) $("#su-names").value = existing.join("\n");
  $("#setup-form").hidden = false;
  $("#setup-done").hidden = true;
  $("#su-error").textContent = "";
  $("#setup").showModal();
}

async function setup(e) {
  e.preventDefault();
  if (e.submitter?.value === "cancel") return $("#setup").close();
  const tok = $("#su-token").value.trim();
  const names = [...new Set($("#su-names").value.split(/[\n,]/).map((n) => n.trim()).filter(Boolean))];
  if (!tok || !names.length) return ($("#su-error").textContent = "Fyll inn token og minst én bruker.");
  $("#su-error").textContent = "Sjekker tokenen…";
  try {
    if (!/^(github_pat_|ghp_)/.test(tok)) throw new Error("Det ser ikke ut som en GitHub-token. Den skal starte med github_pat_.");
    for (const repo of [DATA_REPO, AUTH_REPO]) {
      const res = await fetch(`https://api.github.com/repos/${repo}`, { headers: { Authorization: `Bearer ${tok}` } });
      if (res.status === 401) throw new Error("GitHub godtar ikke tokenen. Sjekk at hele tokenen er kopiert, og at den ikke er utløpt.");
      if (!res.ok) throw new Error(`Tokenen har ikke tilgang til ${repo.split("/")[1]}. Velg både BambuFilament-data og BambuFilament-auth under Repository access.`);
    }
    $("#su-error").textContent = "Krypterer og lagrer…";
    const created = [];
    for (const [i, name] of names.entries()) {
      const temp = randomPassword();
      const color = state.doc.users.find((u) => u.name === name)?.color || USER_COLORS[i % USER_COLORS.length];
      created.push({ name, color, cred: await encryptToken(tok, temp), temp, admin: i === 0 });
    }
    session = { user: names[0], token: tok };
    await saveDoc((doc) => {
      if (doc.users.some(hasLogin)) return "Oppsettet er allerede gjort. Last siden på nytt.";
      for (const { name, color, cred, admin } of created) {
        const existing = doc.users.find((u) => u.name === name);
        if (existing) Object.assign(existing, { cred, admin, mustChange: true });
        else doc.users.push({ name, color, cred, admin, mustChange: true });
      }
    }, `Første oppsett: ${names.join(", ")}`, "users");
    setSession(session);
    freshPasswords = created.slice(1).map((c) => [c.name, c.temp]);
    $("#su-list").innerHTML = created.slice(1).map((c) => `<tr><td>${esc(c.name)}</td><td><code class="pw">${esc(c.temp)}</code></td></tr>`).join("");
    $("#su-me").textContent = names[0];
    $("#setup-form").hidden = true;
    $("#setup-done").hidden = false;
  } catch (err) {
    session = null;
    $("#su-error").textContent = err.message;
  }
}

function setupDone() {
  $("#setup").close();
  refresh();
  openChangePassword(true);
}

// ---------- AMS ----------

const AMS_REFRESH_MS = 5 * 60 * 1000;          // Bambu anbefaler ikke hyppigere "pushall"
const SNAPSHOT_MAX_AGE_MS = 6 * 60 * 60 * 1000; // delt øyeblikksbilde fornyes minst så ofte

// Bambu-tilkoblingen lagres i denne nettleseren per bruker, og overlever ut- og innlogging
// på siden. Tilgangsnøkkelen fornyes automatisk med refresh-tokenen når den utløper.
const bambuKey = () => `bf.bambu.${userName()}`;
function bambuAuth() {
  try { return JSON.parse(store(bambuKey()) || "null") || {}; } catch { return {}; }
}
const bambuToken = () => bambuAuth().token || "";

function saveBambuAuth(res, email) {
  const old = bambuAuth();
  store(bambuKey(), JSON.stringify({
    token: res.token,
    refreshToken: res.refreshToken || old.refreshToken || "",
    email: email || old.email || "",
    at: new Date().toISOString(),
  }));
}

// Kaller proxyen med Bambu-nøkkelen. Ved utløpt nøkkel fornyes den én gang
// før brukeren må koble til på nytt. Samtidige kall deler samme fornyelse.
let refreshing = null;
async function bambuCall(path) {
  try {
    return await proxy(path, {}, bambuToken());
  } catch (err) {
    const { refreshToken } = bambuAuth();
    if (err.status !== 401 || !refreshToken) throw err;
    refreshing ||= proxy("/refresh", { refreshToken }).then((res) => saveBambuAuth(res)).finally(() => (refreshing = null));
    await refreshing;
    return proxy(path, {}, bambuToken());
  }
}
const fetchAms = () => bambuCall("/ams");
const fetchLibrary = () => bambuCall("/library");

async function proxy(path, body, bambu) {
  if (!PROXY_URL) throw new Error("AMS-proxyen er ikke satt opp ennå.");
  const res = await fetch(PROXY_URL + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(bambu ? { Authorization: `Bearer ${bambu}` } : {}) },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Proxyen svarte ${res.status}`), { status: res.status });
  return data;
}

// Det som deles med andre: uten serienummer.
function snapshot(live) {
  return {
    updated: live.updated,
    printers: live.printers.map(({ id, ...p }) => p),
  };
}

const sameSnapshot = (a, b) => !!a && !!b && JSON.stringify(a.printers) === JSON.stringify(b.printers);

async function refreshAms() {
  const tok = bambuToken();
  if (!tok || !userName()) return renderAms();
  state.amsBusy = true;
  state.amsError = "";
  renderAms();
  try {
    const [amsRes, libRes] = await Promise.allSettled([fetchAms(), fetchLibrary()]);
    if (amsRes.status === "rejected" && libRes.status === "rejected") throw amsRes.reason;
    if (amsRes.status === "fulfilled") state.amsLive = cleanAms(amsRes.value);
    // En printer som er online, men ikke svarte innen fristen (f.eks. opptatt): prøv én gang til.
    if (state.amsLive?.printers.some((p) => p.online && !p.reported)) {
      const again = cleanAms(await fetchAms().catch(() => null));
      if (again) {
        const byId = Object.fromEntries(again.printers.map((p) => [p.id, p]));
        state.amsLive = { ...state.amsLive, printers: state.amsLive.printers.map((p) => (!p.reported && byId[p.id]?.reported ? byId[p.id] : p)) };
      }
    }
    if (libRes.status === "fulfilled") state.libraryLive = cleanLibrary(libRes.value);
    const failed = amsRes.status === "rejected" ? amsRes.reason : libRes.status === "rejected" ? libRes.reason : null;
    if (failed) state.amsError = `${amsRes.status === "rejected" ? "AMS" : "Filamentbiblioteket"}: ${failed.message}`;
    await publishSnapshot();
    if (amsRes.status === "fulfilled") await markAmsSpools();
  } catch (err) {
    state.amsError = err.message;
    if (err.status === 401) {
      store(bambuKey(), "");
      state.amsError = "Bambu-innloggingen er utløpt og kunne ikke fornyes. Koble til på nytt.";
    }
  }
  state.amsBusy = false;
  // Hele siden tegnes på nytt, så «Våre lokale lager» også viser de nye AMS- og bibliotekdataene.
  render();
}

// Merker lagerspoler (RFID) som står i brukerens egen AMS med navnet hans/hennes og tidspunktet,
// så andre ser hvem som bruker dem. Resten av AMS-dataene lagres ikke (det styres av «Del AMS»).
// Merkingen fornyes høyst hver 6. time, og fjernes når spolen ikke lenger står i AMS-en.
const MARK_EVERY_MS = 6 * 3600e3;
const marksAms = (name) => state.doc.users.find((u) => u.name === name)?.markAms !== false;

async function markAmsSpools({ clear = false } = {}) {
  const me = userName();
  if (!me || DEMO || (!clear && !state.amsLive)) return;
  const here = new Set();
  if (!clear && marksAms(me)) {
    for (const p of state.amsLive.printers) {
      for (const a of p.ams) for (const t of a.trays) if (!t.empty && t.uuid) here.add(t.uuid.toUpperCase());
      for (const t of p.external) if (!t.empty && t.uuid) here.add(t.uuid.toUpperCase());
    }
  }
  const now = new Date().toISOString();
  const update = (spool) => {
    const present = here.has(String(spool.id).toUpperCase());
    const mine = spool.inAms?.user === me;
    const lastEvent = (spool.history || []).at(-1)?.at || "";
    const stale = !mine || Date.now() - new Date(spool.inAms.at).getTime() > MARK_EVERY_MS || spool.inAms.at < lastEvent;
    if (present && stale) { spool.inAms = { user: me, at: now }; return true; }
    if (!present && mine) { delete spool.inAms; return true; }
    return false;
  };
  // Sjekk på en kopi først, så det bare lagres når noe faktisk endres.
  if (!state.doc.spools.some((s) => update(JSON.parse(JSON.stringify(s))))) return;
  try {
    await saveDoc((doc) => {
      let changed = false;
      for (const s of doc.spools) changed = update(s) || changed;
      if (!changed) return;
    }, `AMS-merking (${me})`);
  } catch (err) {
    console.warn("Kunne ikke merke spoler i AMS:", err.message);
  }
}

async function setMarkAms(on) {
  state.amsError = "";
  try {
    await saveDoc((doc) => {
      const u = doc.users.find((x) => x.name === userName());
      if (!u) return "Brukeren din finnes ikke.";
      if (on) delete u.markAms; else u.markAms = false;
    }, `${on ? "Viser" : "Viser ikke"} lagerspoler i AMS (${userName()})`, "users");
    await markAmsSpools({ clear: !on });
  } catch (err) {
    state.amsError = err.message;
  }
  render();
}

// Lagrer øyeblikksbildet i repoet hvis brukeren deler og innholdet er endret.
async function publishSnapshot() {
  const me = state.doc.users.find((u) => u.name === userName());
  if (!me) return;
  const age = (x) => (x ? Date.now() - new Date(x.updated).getTime() : Infinity);
  const oldAms = state.doc.ams?.[me.name];
  const oldLib = state.doc.library?.[me.name];
  const amsChanged = me.shareAms && state.amsLive && (!sameSnapshot(oldAms, snapshot(state.amsLive)) || age(oldAms) > SNAPSHOT_MAX_AGE_MS);
  const libChanged = me.shareLibrary && state.libraryLive && (JSON.stringify(oldLib?.spools) !== JSON.stringify(state.libraryLive.spools) || age(oldLib) > SNAPSHOT_MAX_AGE_MS);
  if (!amsChanged && !libChanged) return;
  await saveDoc((doc) => {
    if (amsChanged) (doc.ams ||= {})[me.name] = snapshot(state.amsLive);
    if (libChanged) (doc.library ||= {})[me.name] = state.libraryLive;
  }, `AMS/bibliotek-oppdatering (${me.name})`, "shared");
}

// Hver bruker velger for seg om AMS og/eller filamentbiblioteket deles med alle.
async function setShare(kind, share) {
  state.amsError = "";
  const label = kind === "library" ? "filamentbibliotek" : "AMS";
  try {
    const flag = kind === "library" ? "shareLibrary" : "shareAms";
    const live = kind === "library" ? state.libraryLive : state.amsLive && snapshot(state.amsLive);
    await saveDoc((doc) => {
      const u = doc.users.find((x) => x.name === userName());
      if (!u) return "Brukeren din finnes ikke.";
      u[flag] = share;
    }, `${share ? "Deler" : "Sluttet å dele"} ${label} (${userName()})`, "users");
    if (share && !live) return render();
    await saveDoc((doc) => {
      const bucket = kind === "library" ? doc.library : doc.ams;
      if (share) bucket[userName()] = live;
      else delete bucket[userName()];
    }, `${share ? "Deler" : "Sluttet å dele"} ${label} (${userName()})`, "shared");
  } catch (err) {
    state.amsError = err.message;
  }
  render();
}

function trayName(t) {
  const hex = (t.color || "").toUpperCase();
  const hit = state.colorIndex[`${t.infoIdx}|#${hex}`];
  return { color: hit?.[0] || "", type: hit?.[1] || t.subBrand || t.type || "Ukjent" };
}

function traySwatch(t) {
  const cols = (t.cols?.length ? t.cols : [t.color]).filter(Boolean).map((c) => "#" + c);
  if (!cols.length) return "var(--muted-bg)";
  return swatch({ colors: cols });
}

function renderTray(t, label) {
  if (t.empty) return `<div class="tray empty-tray"><span class="slot">${label}</span><div class="tray-dot"></div><div class="tray-text muted">Tom</div></div>`;
  const n = trayName(t);
  const remain = t.remain !== null && t.remain >= 0 ? t.remain : null;
  return `<div class="tray">
    <span class="slot">${label}</span>
    <div class="tray-dot" style="background:${traySwatch(t)}"></div>
    <div class="tray-text">
      <div class="tray-color">${esc(n.color || "#" + (t.color || "").slice(0, 6))}</div>
      <div class="tray-type">${esc(n.type)}</div>
      ${remain !== null ? `<div class="remain"><span style="width:${remain}%"></span></div><div class="muted">${remain} %</div>` : ""}
    </div>
  </div>`;
}

function renderPrinter(p) {
  const units = p.ams.map((u) => `
    <div class="ams-unit">
      <div class="ams-unit-head">
        <b>AMS ${String.fromCharCode(65 + u.unit)}</b>
        ${u.humidity !== null ? `<span class="muted">Fukt ${u.humidity}${u.humidity > 5 ? " %" : "/5"}</span>` : ""}
        ${u.temp !== null ? `<span class="muted">${u.temp} °C</span>` : ""}
      </div>
      <div class="trays">${u.trays.map((t) => renderTray(t, `${String.fromCharCode(65 + u.unit)}${t.slot + 1}`)).join("")}</div>
    </div>`).join("");
  const ext = p.external.filter((t) => !t.empty).map((t) => renderTray(t, "Ekstern")).join("");
  const body = !p.online ? `<p class="muted">Printeren er frakoblet.</p>`
    : !p.reported ? `<p class="muted">Printeren svarte ikke denne gangen.</p>`
    : (units || ext) ? units + (ext ? `<div class="ams-unit"><div class="ams-unit-head"><b>Ekstern spole</b></div><div class="trays">${ext}</div></div>` : "")
    : `<p class="muted">Ingen AMS.</p>`;
  return `<div class="printer">
    <div class="printer-head">
      <span class="online-dot ${p.online ? "on" : ""}"></span>
      <b>${esc(p.name)}</b><span class="muted">${esc(p.model)}</span>
    </div>
    ${body}
  </div>`;
}

function renderAms() {
  const me = userName();
  const meUser = state.doc.users.find((u) => u.name === me);
  const connected = !!bambuToken();
  const panel = $("#ams-me");

  if (DEMO) {
    panel.innerHTML = `<p class="muted">AMS-data vises ikke i demo-modus.</p>`;
  } else if (!PROXY_URL) {
    panel.innerHTML = `<p class="muted">AMS-proxyen er ikke satt opp ennå.</p>`;
  } else if (!me) {
    panel.innerHTML = `<p>Logg inn for å koble til Bambu-kontoen din og se AMS-ene dine.</p>`;
  } else if (!connected) {
    panel.innerHTML = `
      <div class="ams-me-row">
        <div><b>Koble til Bambu-kontoen din</b><p class="hint">Du kobler til én gang per nettleser. Tilkoblingen huskes også når du logger ut og inn på siden, og fornyes automatisk. Bambu-passordet lagres ikke.</p></div>
        <button class="btn btn-primary" data-ams="connect">Koble til</button>
      </div>`;
  } else {
    panel.innerHTML = `
      <div class="ams-me-row">
        <div>
          <b>Bambu-konto tilkoblet</b>${bambuAuth().email ? ` <span class="muted">(${esc(bambuAuth().email)})</span>` : ""}
          <div class="muted">${state.amsBusy ? "Henter AMS og filamentbibliotek…" : state.amsLive || state.libraryLive ? `Oppdatert ${fmtTime((state.amsLive || state.libraryLive).updated)}` : ""}</div>
        </div>
        <div class="share-toggles">
          <label class="switch"><input type="checkbox" data-ams="share-ams" ${meUser?.shareAms ? "checked" : ""}> Del AMS med alle</label>
          <label class="switch"><input type="checkbox" data-ams="share-library" ${meUser?.shareLibrary ? "checked" : ""}> Del filamentbibliotek med alle</label>
          <label class="switch" title="Lagerspoler som står i AMS-en din, får navnet ditt (ikke printer eller plass), så andre ser hvem som bruker dem."><input type="checkbox" data-ams="share-mark" ${meUser?.markAms !== false ? "checked" : ""}> Vis at lagerspoler står i AMS-en min</label>
        </div>
        <button class="btn" data-ams="refresh" ${state.amsBusy ? "disabled" : ""}>Oppdater</button>
        <button class="btn btn-danger" data-ams="disconnect">Koble fra</button>
      </div>`;
  }
  if (state.amsError) panel.innerHTML += `<p class="error">${esc(state.amsError)}</p>`;

  const sections = users().map((u) => {
    const mine = u.name === me;
    const data = (mine && state.amsLive) || state.doc.ams?.[u.name];
    const lib = (mine && state.libraryLive) || state.doc.library?.[u.name];
    if (!data && !lib) return "";
    const live = mine && (state.amsLive || state.libraryLive);
    const shared = [u.shareAms && "AMS", u.shareLibrary && "bibliotek"].filter(Boolean).join(" og ");
    const tag = live ? `Ditt · ${shared ? `deler ${shared}` : "bare synlig for deg"}` : `Delt ${fmtTime((data || lib).updated)}`;
    return `<section class="ams-owner" style="--owner:${u.color}">
      <h2><span class="owner-dot"></span>${esc(u.name)} <span class="muted">${tag}</span></h2>
      ${data ? `<details class="ams-fold" data-fold="ams:${esc(u.name)}"${folded(`ams:${u.name}`) ? "" : " open"}>
        <summary><b>AMS</b> <span class="muted">${amsSummary(data)}</span></summary>
        <div class="printers">${data.printers.map(renderPrinter).join("") || `<p class="muted">Ingen printere.</p>`}</div>
      </details>` : ""}
      ${lib ? renderLibrary(lib, u.name) : ""}
    </section>`;
  }).join("");
  $("#ams-list").innerHTML = sections || `<p class="empty-msg">Ingen AMS-data eller filamentbibliotek er delt ennå.</p>`;
}

// Filamentbiblioteket fra Bambu Studio / Handy (Filament Manager).
function libSwatch(x) {
  const cols = (x.colors?.length ? x.colors : [x.color]).filter(Boolean).map((c) => "#" + c);
  return cols.length ? swatch({ colors: cols }) : "var(--muted-bg)";
}

// Lukkede AMS-/bibliotekseksjoner huskes i nettleseren («ams:Navn» / «lib:Navn»).
const foldedSet = new Set((() => { try { return JSON.parse(store("bf.folded") || "[]"); } catch { return []; } })());
const folded = (key) => foldedSet.has(key);
function setFolded(key, closed) {
  if (closed) foldedSet.add(key); else foldedSet.delete(key);
  store("bf.folded", JSON.stringify([...foldedSet]));
}

function amsSummary(data) {
  const printers = data.printers.length;
  const units = data.printers.reduce((n, p) => n + p.ams.length, 0);
  const loaded = data.printers.reduce((n, p) => n + p.ams.reduce((m, a) => m + a.trays.filter((t) => !t.empty).length, 0) + p.external.filter((t) => !t.empty).length, 0);
  return `${printers} ${printers === 1 ? "printer" : "printere"} · ${units} AMS · ${loaded} spoler i bruk`;
}

function renderLibrary(lib, owner = "") {
  const scanned = new Set(state.spools.map((s) => s.id.toUpperCase()));
  const where = amsLocations(true);
  const list = lib.spools.slice().sort((a, b) => (b.net > 0) - (a.net > 0) || a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
  const left = list.filter((x) => x.net > 0);
  const grams = left.reduce((sum, x) => sum + x.net, 0);
  const items = list.map((x) => {
    const pct = x.total > 0 ? Math.round((x.net / x.total) * 100) : null;
    const n = libName(x);
    const loc = x.rfid && where[x.rfid];
    return `<div class="lib-item${x.net <= 0 ? " lib-empty" : ""}">
      <span class="lib-swatch" style="background:${libSwatch(x)}"></span>
      <div class="lib-text">
        <b>${esc(n.color || x.name || x.type)}</b>
        <span class="muted">${esc([x.vendor, n.color ? n.type : x.type].filter(Boolean).join(" · "))}</span>
        ${x.total ? `<div class="remain"><span style="width:${pct}%"></span></div><span class="muted">${x.net} av ${x.total} g</span>` : ""}
        ${loc ? `<span class="lib-loc">${esc(loc)}</span>` : ""}
        ${x.rfid && scanned.has(x.rfid) ? `<span class="owned">Skannet inn i lageret</span>` : ""}
      </div>
    </div>`;
  }).join("");
  const kg = (grams / 1000).toLocaleString("nb-NO", { maximumFractionDigits: 1 });
  return `<details class="library" data-fold="lib:${esc(owner)}"${folded(`lib:${owner}`) ? "" : " open"}>
    <summary><b>Filamentbibliotek</b> <span class="muted">${left.length} spoler med filament · ${kg} kg igjen${list.length > left.length ? ` · ${list.length - left.length} tomme` : ""}</span></summary>
    ${list.length ? `<div class="lib-grid">${items}</div>` : `<p class="muted">Biblioteket er tomt.</p>`}
  </details>`;
}

// Gjenværende vekt fra Bambu-biblioteket for en spole i lageret (samme RFID som Tray UID).
function libraryWeight(id) {
  const key = (id || "").toUpperCase();
  for (const lib of [state.libraryLive, ...Object.values(state.doc.library || {})]) {
    const hit = lib?.spools.find((x) => x.rfid === key);
    if (hit) return hit;
  }
  return null;
}

// Produksjonstidspunktet står i RFID-brikken (blokk 12) som fabrikkens lokaltid,
// så det vises akkurat som det er lagret, uten omregning til norsk tid.
function fmtProduction(d) {
  const opts = { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" };
  const time = d.toLocaleTimeString("nb-NO", { timeZone: "UTC", hour: "2-digit", minute: "2-digit" });
  return `${d.toLocaleDateString("nb-NO", opts)} kl. ${time}`;
}

function productionTip(s) {
  const d = s.tag?.productionDate;
  if (s.kind === "rfid" && d instanceof Date && !isNaN(d)) return `Produsert ${esc(fmtProduction(d))}`;
  if (s.kind === "rfid") return "Produksjonsdato mangler på brikken";
  return "Produksjonsdato er bare kjent for spoler skannet med RFID-leseren";
}

function weightLabel(s) {
  if (s.kind === "library") return s.total ? `<span class="lib-weight">${s.net} av ${s.total} g</span>` : "";
  if (s.kind === "ams") return s.remain !== null ? `<span class="lib-weight">${s.remain} % igjen</span>` : "";
  const lib = libraryWeight(s.id);
  if (lib && lib.total) return `<span class="lib-weight" title="Fra Bambu-filamentbiblioteket">${lib.net} av ${lib.total} g</span>`;
  return s.tag ? `<span>${s.tag.weight} g</span>` : "";
}

// Tilkobling til Bambu: e-post + passord, deretter eventuelt kode fra e-post eller autentiseringsapp.
const bambuLogin = { step: "password", email: "", tfaKey: "" };

function openBambu() {
  Object.assign(bambuLogin, { step: "password", email: "", tfaKey: "" });
  $("#b-email").value = "";
  $("#b-password").value = "";
  $("#b-code").value = "";
  showBambuStep();
  $("#bambu").showModal();
}

function showBambuStep(note = "") {
  const s = bambuLogin.step;
  $("#b-step-password").hidden = s !== "password";
  $("#b-step-code").hidden = s !== "code" && s !== "tfa";
  $("#b-step-token").hidden = s !== "token";
  $("#b-code-hint").textContent = s === "tfa"
    ? "Skriv inn koden fra autentiseringsappen din."
    : `${note}Bambu har sendt en kode til ${bambuLogin.email}. Skriv den inn her (sjekk også søppelpost).`;
  $("#b-error").textContent = "";
}

// Kode på e-post i stedet for passord: ingen robotsjekk hos Bambu.
async function bambuCodeLogin(note = "") {
  bambuLogin.email = $("#b-email").value.trim();
  if (!bambuLogin.email) throw new Error("Skriv e-postadressen til Bambu-kontoen først.");
  await proxy("/send-code", { email: bambuLogin.email }, token());
  bambuLogin.step = "code";
  showBambuStep(note);
}

async function bambuSubmit(e) {
  e.preventDefault();
  if (e.submitter?.value === "cancel") return $("#bambu").close();
  const err = $("#b-error");
  err.textContent = "Kobler til…";
  try {
    let res;
    if (e.submitter?.value === "code") return await bambuCodeLogin();
    if (e.submitter?.value === "token") {
      bambuLogin.email = $("#b-email").value.trim();
      bambuLogin.step = "token";
      return showBambuStep();
    }
    if (bambuLogin.step === "token") {
      // Nøkkel limt inn fra bambulab.com: sjekk at Bambu godtar den før den lagres.
      const tok = $("#b-token").value.trim().replace(/^token=/, "").replace(/^"|"$/g, "");
      if (tok.length < 20) throw new Error("Lim inn hele verdien fra raden «token».");
      await proxy("/library", {}, tok);
      saveBambuAuth({ token: tok, refreshToken: "" }, bambuLogin.email);
      $("#b-token").value = "";
      $("#bambu").close();
      refreshAms();
      return;
    }
    if (bambuLogin.step === "password") {
      bambuLogin.email = $("#b-email").value.trim();
      res = await proxy("/login", { account: bambuLogin.email, password: $("#b-password").value });
      if (res.step === "code") await proxy("/send-code", { email: bambuLogin.email, ticket: res.ticket });
    } else if (bambuLogin.step === "code") {
      res = await proxy("/login", { account: bambuLogin.email, code: $("#b-code").value.trim() });
    } else {
      res = await proxy("/tfa", { tfaKey: bambuLogin.tfaKey, tfaCode: $("#b-code").value.trim() });
    }
    if (res.token) {
      saveBambuAuth(res, bambuLogin.email);
      $("#b-password").value = "";
      $("#bambu").close();
      refreshAms();
      return;
    }
    if (res.step === "robot") {
      // Robotsjekk også for koden: en ny kode ville bare gjort den forrige ugyldig.
      if (bambuLogin.step === "code") {
        bambuLogin.step = "token";
        showBambuStep();
        $("#b-error").textContent = "Bambu godtar ikke innlogging via BambuFilament akkurat nå (robotsjekk). Hent tilgangsnøkkelen fra bambulab.com som beskrevet over.";
        return;
      }
      return await bambuCodeLogin("Bambu ville sjekke at du ikke er en robot, så vi bruker kode på e-post i stedet. ");
    }
    bambuLogin.step = res.step;
    bambuLogin.tfaKey = res.tfaKey || "";
    showBambuStep();
  } catch (ex) {
    err.textContent = ex.message;
  }
}

async function amsAction(action, el) {
  if (action === "connect") openBambu();
  if (action === "refresh") refreshAms();
  if (action === "share-ams") await setShare("ams", el.checked);
  if (action === "share-library") await setShare("library", el.checked);
  if (action === "share-mark") await setMarkAms(el.checked);
  if (action === "disconnect") {
    if (!confirmed(el, "Koble fra? Trykk igjen")) return;
    store(bambuKey(), "");
    state.amsLive = null;
    markAmsSpools({ clear: true });
    renderAms();
  }
}

// ---------- Nytt fra Bambu ----------

const DAY = 864e5;

async function loadCatalog() {
  try {
    const res = await fetch(`data/catalog.json?t=${Date.now()}`, { cache: "no-store" });
    if (res.ok) state.catalog = await res.json();
  } catch { /* fanen viser en melding */ }
}

// Hvem som har en gitt farge: { "GFA00-A0": ["Philippe", ...] } (spoler på lager eller tatt ut).
function ownedKeys() {
  const map = {};
  for (const s of state.spools) {
    if (!s.tag || s.status === "empty") continue;
    const key = `${s.tag.materialId}-${s.tag.variantId.split("-")[1]}`;
    (map[key] ||= []).includes(s.owner) || map[key].push(s.owner);
  }
  return map;
}

const fmtDay = (d) => new Date(d).toLocaleDateString("nb-NO", { day: "numeric", month: "long", year: "numeric" });

function productLink(t, label = "Se i Bambu-butikken") {
  return t.product
    ? `<a class="btn btn-small" href="${esc(t.product.url)}" target="_blank" rel="noopener">${label} ↗</a>`
    : `<a class="btn btn-small" href="${esc(state.catalog.source.store)}/collections/filament" target="_blank" rel="noopener">Alle filamenter ↗</a>`;
}

function ownedBadge(owners) {
  if (!owners?.length) return "";
  return `<span class="owned">${owners.map((o) => `<span class="owner-dot" style="--owner:${userColor(o)}" title="${esc(o)}"></span>`).join("")}Har: ${esc(owners.join(", "))}</span>`;
}

// Lagerstatus i Bambu-butikken (EU), hentet av katalogjobben.
const STOCK = {
  in: ["På lager i butikken", "stock-in"],
  out: ["Utsolgt i butikken", "stock-out"],
  missing: ["Ikke i butikken", "stock-missing"],
};

function stockBadge(stock) {
  const s = STOCK[stock];
  return s ? `<span class="stock ${s[1]}">${s[0]}</span>` : "";
}

// Ønsker: { "GFG00-P01": [{ user, at }], "type:PLA Lite": [...] }
const wishersOf = (key) => (state.doc.wishes?.[key] || []).map((w) => w.user);

function wishButton(key) {
  const who = wishersOf(key);
  const mine = who.includes(userName());
  const label = mine ? "✓ Du venter på denne" : "Jeg venter på denne";
  return `<button type="button" class="btn btn-small wish${mine ? " active" : ""}" data-wish="${esc(key)}"
    title="${who.length ? "Venter: " + esc(who.join(", ")) : "Marker at du vil ha denne når den kommer på lager"}">${label}${who.length ? ` <span class="wish-count">${who.length}</span>` : ""}</button>`;
}

async function toggleWish(key, btn) {
  if (!token()) return openLogin();
  btn.disabled = true;
  try {
    await saveDoc((doc) => {
      doc.wishes ||= {};
      const list = (doc.wishes[key] ||= []);
      const i = list.findIndex((w) => w.user === userName());
      if (i >= 0) list.splice(i, 1);
      else list.push({ user: userName(), at: new Date().toISOString() });
      if (!list.length) delete doc.wishes[key];
    }, `Venteliste: ${key} (${userName()})`, "shared");
    render();
    renderNews();
    if (state.tab === "shop") renderShop();
  } catch (err) {
    alertNews(err.message);
    if (state.tab === "shop") $("#shop-error").textContent = err.message;
    btn.disabled = false;
  }
}

function alertNews(text) {
  const el = $("#news-error");
  if (el) el.textContent = text;
}

function catalogIndex() {
  const byKey = {};
  for (const t of state.catalog?.types || []) {
    byKey[`type:${t.type}`] = { t, type: true };
    for (const x of t.colors) byKey[x.key] = { t, x };
  }
  for (const p of state.store?.products || []) byKey[`product:${p.handle}`] = { p };
  return byKey;
}

const productUrl = (p) => `${state.store?.store || "https://eu.store.bambulab.com"}/products/${p.handle}`;

const typeInStock = (t) => t.colors.some((x) => x.stock === "in");

// Alt brukerne venter på (farger, typer og butikkprodukter), med status nå.
// Det som har kommet på lager vises først.
function waitingList() {
  const idx = catalogIndex();
  return Object.entries(state.doc.wishes || {})
    .filter(([key, list]) => list.length && idx[key])
    .map(([key, list]) => {
      const { t, x, type, p } = idx[key];
      if (p) {
        return { key, list, stock: p.status === "in" ? "in" : p.status === "partial" ? "partial" : "out",
          title: p.name, sub: state.store.categories[p.category] || "Butikk", url: productUrl(p), image: p.image };
      }
      const stock = type ? (typeInStock(t) ? "in" : t.product ? "out" : "missing") : x.stock;
      return { key, list, stock, title: type ? t.type : x.name, sub: type ? "Hele typen" : t.type, url: t.product?.url,
        swatch: type ? "var(--muted-bg)" : swatch({ colors: x.hex.length ? x.hex : ["#cccccc"] }) };
    })
    .sort((a, b) => (b.stock === "in") - (a.stock === "in") || b.list.length - a.list.length);
}

function waitCard(w) {
  return `
    <div class="wait-item ${w.stock === "in" ? "arrived" : ""}">
      ${w.image ? `<img class="wait-img" src="${esc(w.image)}" alt="" loading="lazy">` : `<span class="news-swatch" style="background:${w.swatch}"></span>`}
      <div class="news-color-text">
        <b>${esc(w.title)}</b>
        <span>${esc(w.sub)}</span>
        ${w.stock === "in" ? `<span class="stock stock-in">Nå på lager i butikken!</span>` : w.stock === "partial" ? `<span class="stock stock-out">Delvis utsolgt</span>` : stockBadge(w.stock)}
        <span class="waiters">${w.list.map((x) => `<span class="owner-dot" style="--owner:${userColor(x.user)}"></span>${esc(x.user)}`).join(" ")}</span>
      </div>
      <div class="wait-actions">
        ${w.url ? `<a class="btn btn-small" href="${esc(w.url)}" target="_blank" rel="noopener">Butikken ↗</a>` : ""}
        ${wishButton(w.key)}
      </div>
    </div>`;
}

// Lagerfilteret: "" = alle, "in", "out", "missing", "notin" = utsolgt eller ikke i butikken.
function stockMatch(stock) {
  const f = state.newsStock;
  if (!f) return true;
  if (f === "notin") return stock === "out" || stock === "missing";
  return stock === f;
}

function renderNews() {
  const box = $("#tab-news");
  const c = state.catalog;
  if (!c) {
    box.innerHTML = `<p class="empty-msg">Katalogen er ikke hentet ennå.</p>`;
    return;
  }
  const days = Number(state.newsDays);
  const since = Math.max(new Date(c.baseline).getTime() + DAY, days ? Date.now() - days * DAY : 0);
  const owned = ownedKeys();
  const isNew = (d) => d && new Date(d).getTime() > since;

  const newTypes = c.types.filter((t) => isNew(t.firstSeen)).sort((a, b) => b.firstSeen.localeCompare(a.firstSeen));
  let newColors = c.types
    .flatMap((t) => t.colors.filter((x) => isNew(x.firstSeen)).map((x) => ({ ...x, t })))
    .sort((a, b) => b.firstSeen.localeCompare(a.firstSeen) || a.t.type.localeCompare(b.t.type));
  if (state.newsOnlyMissing) newColors = newColors.filter((x) => !owned[x.key]);
  newColors = newColors.filter((x) => stockMatch(x.stock));
  const visibleColors = (t) => t.colors.filter((x) => stockMatch(x.stock) && (!state.newsOnlyMissing || !owned[x.key]));
  const shownTypes = c.types.filter((t) => visibleColors(t).length);
  const shownNewTypes = newTypes.filter((t) => visibleColors(t).length);

  const byDay = {};
  for (const x of newColors) (byDay[x.firstSeen.slice(0, 10)] ||= []).push(x);

  const colorCard = (x) => `
    <div class="news-color ${x.stock ? "is-" + x.stock : ""}">
      <a class="news-color-main" href="${esc(x.t.product?.url || c.source.store + "/collections/filament")}" target="_blank" rel="noopener">
        <span class="news-swatch" style="background:${swatch({ colors: x.hex.length ? x.hex : ["#cccccc"] })}"></span>
        <span class="news-color-text">
          <b>${esc(x.name || x.key)}</b>
          <span>${esc(x.t.type)}</span>
          ${stockBadge(x.stock)}
          ${ownedBadge(owned[x.key])}
        </span>
        <span class="ext">↗</span>
      </a>
      ${x.stock && x.stock !== "in" || wishersOf(x.key).length ? wishButton(x.key) : ""}
    </div>`;

  // Det brukerne venter på, med status nå. Det som har kommet på lager vises først.
  const waiting = waitingList();

  const sub = ["new", "all", "wait"].includes(state.newsSub) ? state.newsSub : "new";
  const subTabs = [["new", "Nye farger og typer"], ["all", "Alt filament"], ["wait", `Venteliste${waiting.length ? ` (${waiting.length})` : ""}`]];

  box.innerHTML = `
    <nav class="sub-tabs" aria-label="Nytt fra Bambu">
      ${subTabs.map(([k, l]) => `<button class="sub-tab${sub === k ? " active" : ""}" data-sub="${k}">${l}</button>`).join("")}
    </nav>
    <section class="panel news-head">
      <div>
        <b>${{ new: "Nye farger og typer fra Bambu Lab", all: "Alt filament fra Bambu Lab", wait: "Det venter vi på" }[sub]}</b>
        <p class="hint">Hentes daglig fra Bambu Lab sin offisielle fargeliste (Bambu Studio) og nettbutikken.
        ${c.updated ? `Sist sjekket ${fmtTime(c.updated)}.` : ""} Lenkene går til produktsiden i Bambu-butikken.</p>
      </div>
      <div class="news-controls">
        <select id="news-days" aria-label="Periode" ${sub === "new" ? "" : "hidden"}>
          ${[[30, "Siste 30 dager"], [90, "Siste 3 måneder"], [180, "Siste 6 måneder"], [365, "Siste år"], [0, "Alt siden juli 2025"]]
            .map(([v, l]) => `<option value="${v}"${Number(state.newsDays) === v ? " selected" : ""}>${l}</option>`).join("")}
        </select>
        <select id="news-stock" aria-label="Lagerstatus i butikken" ${sub === "wait" ? "hidden" : ""}>
          ${[["", "Alle lagerstatuser"], ["in", "På lager i butikken"], ["notin", "Ikke på lager"], ["out", "Utsolgt"], ["missing", "Ikke i butikken"]]
            .map(([v, l]) => `<option value="${v}"${state.newsStock === v ? " selected" : ""}>${l}</option>`).join("")}
        </select>
        <label class="switch" ${sub === "wait" ? "hidden" : ""}><input type="checkbox" id="news-missing" ${state.newsOnlyMissing ? "checked" : ""}> Bare farger ingen av oss har</label>
      </div>
    </section>

    <p id="news-error" class="error"></p>

    ${sub === "wait" ? `
    ${waiting.length ? `<div class="wait-list">${waiting.map(waitCard).join("")}</div>`
      : `<p class="muted">Ingen venter på noe ennå. Trykk «Jeg venter på denne» på en farge, type eller et produkt som er utsolgt eller ikke i butikken.</p>`}
    ` : ""}

    ${sub === "new" ? `
    <h2 class="section-title">Nye typer <span class="muted">${shownNewTypes.length}</span></h2>
    ${shownNewTypes.length ? `<div class="news-types">${shownNewTypes.map((t) => `
      <div class="news-type">
        ${t.product?.image ? `<img src="${esc(t.product.image)}" alt="" loading="lazy">` : `<div class="img-ph"></div>`}
        <div class="news-type-body">
          <b>${esc(t.type)}</b>
          <span class="muted">Ny ${fmtDay(t.firstSeen)} · ${t.colors.length} farger</span>
          <div class="strip">${t.colors.slice(0, 14).map((x) => `<span style="background:${swatch({ colors: x.hex.length ? x.hex : ["#cccccc"] })}" title="${esc(x.name)}"></span>`).join("")}</div>
          <div class="row-actions">${productLink(t)}${!typeInStock(t) || wishersOf(`type:${t.type}`).length ? wishButton(`type:${t.type}`) : ""}</div>
          ${!t.product ? stockBadge("missing") : !typeInStock(t) ? stockBadge("out") : ""}
        </div>
      </div>`).join("")}</div>` : `<p class="muted">Ingen nye typer i perioden.</p>`}

    <h2 class="section-title">Nye farger <span class="muted">${newColors.length}</span></h2>
    ${Object.keys(byDay).length ? Object.entries(byDay).map(([day, list]) => `
      <h3>${fmtDay(day)}</h3>
      <div class="news-colors">${list.map(colorCard).join("")}</div>`).join("")
      : `<p class="muted">Ingen nye farger i perioden.</p>`}
    ` : ""}

    ${sub === "all" ? `
    <h2 class="section-title">Alle typer fra Bambu <span class="muted">${shownTypes.length}${shownTypes.length !== c.types.length ? ` av ${c.types.length}` : ""}</span></h2>
    <p class="hint">Trykk på en type for å se fargene, lagerstatus i butikken og venteliste.</p>
    <div class="all-types">${shownTypes.map((t) => {
      const have = t.colors.filter((x) => owned[x.key]).length;
      const inStore = t.colors.filter((x) => x.stock === "in").length;
      const known = t.colors.some((x) => x.stock);
      return `<details class="all-type" data-type="${esc(t.type)}" ${state.openTypes.has(t.type) ? "open" : ""}>
        <summary>
          <div class="all-type-head">
            <b>${esc(t.type)}</b>
            <span class="muted">${t.colors.length} farger${known ? ` · ${inStore} på lager i butikken` : ""}${have ? ` · ${have} hos oss` : ""}</span>
            ${productLink(t, "Produktside")}
          </div>
          <div class="strip big">${t.colors.map((x) => `<span class="${owned[x.key] ? "have" : ""} ${x.stock && x.stock !== "in" ? "na" : ""}"
            style="background:${swatch({ colors: x.hex.length ? x.hex : ["#cccccc"] })}"
            title="${esc(x.name)}${STOCK[x.stock] ? " – " + STOCK[x.stock][0] : ""}${owned[x.key] ? " – har: " + esc(owned[x.key].join(", ")) : ""}"></span>`).join("")}</div>
        </summary>
        ${!typeInStock(t) ? `<div class="row-actions type-wish">${stockBadge(t.product ? "out" : "missing")}${wishButton(`type:${t.type}`)}</div>` : ""}
        <div class="news-colors">${visibleColors(t).map((x) => colorCard({ ...x, t })).join("")}</div>
      </details>`;
    }).join("")}</div>
    ` : ""}`;

  $("#news-days").addEventListener("input", (e) => {
    state.newsDays = e.target.value;
    store("bf.newsDays", state.newsDays);
    renderNews();
  });
  $("#news-stock").addEventListener("input", (e) => {
    state.newsStock = e.target.value;
    store("bf.newsStock", state.newsStock);
    renderNews();
  });
  $("#news-missing").addEventListener("change", (e) => {
    state.newsOnlyMissing = e.target.checked;
    renderNews();
  });
}

// ---------- Butikk ----------

const SHOP_STATUS = {
  in: ["På lager", "stock-in"],
  partial: ["Noen varianter utsolgt", "stock-out"],
  out: ["Utsolgt", "stock-out"],
  unknown: ["Ukjent lagerstatus", "stock-missing"],
};

async function loadStore() {
  try {
    const res = await fetch(`data/store.json?t=${Date.now()}`, { cache: "no-store" });
    if (res.ok) state.store = await res.json();
  } catch { /* fanen viser en melding */ }
}

const fmtPrice = (x) => (x === null || x === undefined ? "" : `€ ${x.toLocaleString("nb-NO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

function shopFiltered({ ignoreCat = false } = {}) {
  const { q, cat, status } = state.shop;
  const needle = q.trim().toLowerCase();
  return state.store.products.filter((p) =>
    (ignoreCat || !cat || p.category === cat) &&
    (!status || (status === "notin" ? p.status === "out" || p.status === "partial" : p.status === status)) &&
    (!needle || p.name.toLowerCase().includes(needle) || p.variants.some((v) => v[0].toLowerCase().includes(needle)))
  );
}

function renderShop() {
  const st = state.store;
  if (!st) {
    $("#shop-grid").innerHTML = `<p class="empty-msg">Butikkdata er ikke hentet ennå.</p>`;
    return;
  }
  $("#shop-updated").textContent = `Hentet fra EU-butikken ${fmtTime(st.updated)}. ${st.products.length} produkter, priser i euro.`;

  const forCats = shopFiltered({ ignoreCat: true });
  const counts = {};
  for (const p of forCats) counts[p.category] = (counts[p.category] || 0) + 1;
  $("#shop-cats").innerHTML = chip("shopcat", "", `Alle ${forCats.length}`, !state.shop.cat) +
    Object.entries(st.categories).filter(([k]) => counts[k] || state.shop.cat === k)
      .map(([k, label]) => chip("shopcat", k, `${label} ${counts[k] || 0}`, state.shop.cat === k)).join("");

  const sorters = {
    name: (a, b) => a.name.localeCompare(b.name),
    priceAsc: (a, b) => (a.price ?? 1e9) - (b.price ?? 1e9),
    priceDesc: (a, b) => (b.price ?? -1) - (a.price ?? -1),
    status: (a, b) => ["out", "partial", "in", "unknown"].indexOf(a.status) - ["out", "partial", "in", "unknown"].indexOf(b.status) || a.name.localeCompare(b.name),
  };
  const list = shopFiltered().sort(sorters[state.shop.sort] || sorters.name);
  const shown = list.slice(0, state.shop.limit);
  $("#shop-count").textContent = `${list.length} produkter`;

  $("#shop-grid").innerHTML = shown.map((p) => {
    const [label, cls] = SHOP_STATUS[p.status] || SHOP_STATUS.unknown;
    const soldOut = p.variants.filter((v) => v[1]).length;
    const key = `product:${p.handle}`;
    return `<div class="shop-card is-${p.status}">
      <a class="shop-img" href="${esc(productUrl(p))}" target="_blank" rel="noopener">
        ${p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy">` : ""}
        ${p.isNew ? `<span class="badge-new">Nyhet</span>` : ""}
      </a>
      <div class="shop-body">
        <a class="shop-name" href="${esc(productUrl(p))}" target="_blank" rel="noopener">${esc(p.name)} ↗</a>
        <span class="muted">${esc(st.categories[p.category] || "")}</span>
        <div class="shop-meta">
          ${p.price !== null ? `<b>${p.variants.length > 1 ? "fra " : ""}${fmtPrice(p.price)}</b>` : ""}
          <span class="stock ${cls}">${label}${p.status === "partial" ? ` (${soldOut} av ${p.variants.length})` : ""}</span>
        </div>
        ${p.variants.length > 1 ? `<details class="variants"><summary>${p.variants.length} varianter</summary>
          <ul>${p.variants.map(([name, out]) => `<li class="${out ? "v-out" : ""}"><span>${esc(name)}</span><span>${out ? "Utsolgt" : "På lager"}</span></li>`).join("")}</ul>
        </details>` : ""}
        ${p.status === "out" || p.status === "partial" || wishersOf(key).length ? wishButton(key) : ""}
      </div>
    </div>`;
  }).join("") || `<p class="empty-msg">Ingen produkter passer filteret.</p>`;
  $("#shop-more").hidden = list.length <= shown.length;
  $("#shop-more").textContent = `Vis flere (${list.length - shown.length} til)`;
}

// ---------- Faner ----------

const TABS = ["stock", "loans", "ams", "news", "shop", "cards", "settings"];

function showTab(tab) {
  state.tab = TABS.includes(tab) ? tab : "stock";
  store("bf.tab", state.tab);
  document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === state.tab));
  for (const t of TABS) $(`#tab-${t}`).hidden = state.tab !== t;
  if (state.tab === "ams" && !state.amsLive && !state.amsBusy) refreshAms();
  if (state.tab === "news") renderNews();
  if (state.tab === "shop") renderShop();
  if (state.tab === "loans") renderLoans();
  if (state.tab === "cards") renderCards();
  if (state.tab === "settings") renderSettings();
  // Faner med søkefelt: markøren rett i feltet (ikke på berøringsskjerm, der tastaturet ville sprette opp).
  const search = { stock: "#q", shop: "#shop-q" }[state.tab];
  if (search && !matchMedia("(pointer: coarse)").matches) $(search).focus({ preventScroll: true });
  else if (document.activeElement?.matches("input, select, textarea")) document.activeElement.blur();
}

// ---------- Demo ----------

// Eksempelspoler bygget fra Bambus offisielle fargeliste, for å vise hvordan siden ser ut.
function demoDoc() {
  const picks = [
    ["GFA00-A0", "Philippe", "in"], ["GFA00-B3", "Niklas", "in"], ["GFA01-B0", "Peter", "in"],
    ["GFA05-P5", "Philippe", "out"], ["GFG02-G0", "Niklas", "in"], ["GFA00-M2", "Peter", "in"],
    ["GFA16-N0", "Philippe", "in"], ["GFA09-K0", "Niklas", "empty"], ["GFB01-W0", "Peter", "out"],
    ["GFA17-B1", "Philippe", "in"], ["GFA08-Y1", "Niklas", "in"], ["GFU02-R0", "Peter", "in"],
    ["GFA50-G7", "Philippe", "in"], ["GFA01-B6", "Niklas", "in"],
  ];
  const now = Date.now();
  const spools = picks.map(([key, owner, status], i) => {
    const entry = state.colorNames[key];
    if (!entry) return null;
    const [materialId, code] = key.split("-");
    const at = new Date(now - i * 7.3e6).toISOString();
    return {
      id: `DEMO${i}`, owner, status, note: i === 3 ? "Står i printeren" : "",
      added: at, lastScan: at, scans: 1,
      history: [{ at, action: status === "empty" ? "out" : status, by: owner }],
      blocks: buildBlocks({ materialId, variantId: `${materialId.slice(2)}-${code}`, detailedType: entry[1], colors: entry[2] }),
    };
  }).filter(Boolean);
  const tray = (key, slot, remain) => {
    const entry = state.colorNames[key];
    if (!entry) return { slot, empty: true };
    return { slot, type: entry[1].split(" ")[0], subBrand: entry[1], color: entry[2][0].slice(1), cols: entry[2].map((c) => c.slice(1)), infoIdx: key.split("-")[0], remain };
  };
  const unit = (unitNo, keys, humidity) => ({
    unit: unitNo, humidity, temp: 24.5,
    trays: keys.map((k, i) => (k ? tray(k, i, [82, 45, 100, 12][i]) : { slot: i, empty: true })),
  });
  const printer = (name, model, units) => ({ name, model, online: true, reported: true, ams: units, external: [] });
  const ams = {
    Philippe: { updated: new Date(now - 6e5).toISOString(), printers: [printer("Verkstedet", "X1C", [
      unit(0, ["GFA00-A0", "GFA00-B3", "GFA01-B0", null], 18),
      unit(1, ["GFG02-G0", "GFA05-P5", "GFA00-M2", "GFA08-Y1"], 22),
    ])] },
    Niklas: { updated: new Date(now - 3.6e6).toISOString(), printers: [printer("Garasjen", "P1S", [unit(0, ["GFA16-N0", "GFB01-W0", null, "GFA50-G7"], 31)])] },
  };
  const libSpool = (key, net, location = "") => {
    const e = state.colorNames[key];
    return e && { vendor: "Bambu Lab", name: e[0], type: e[1].split(" ")[0], filamentId: key.split("-")[0], color: e[2][0].slice(1).padEnd(8, "F"), colors: [], net, total: 1000, rfid: "", note: "", location };
  };
  const library = {
    Philippe: { updated: new Date(now - 6e5).toISOString(), spools: [
      libSpool("GFA00-A0", 820, "Verkstedet A1"), libSpool("GFA00-B3", 450, "Verkstedet A2"), libSpool("GFA01-D0", 1000),
      libSpool("GFA05-P5", 640), libSpool("GFG02-G0", 300), libSpool("GFA00-K0", 0),
    ].filter(Boolean) },
    Peter: { updated: new Date(now - 8.6e7).toISOString(), spools: [libSpool("GFA08-Y1", 900), libSpool("GFU02-R0", 760), libSpool("GFA06-R0", 210)].filter(Boolean) },
  };
  return {
    version: 1,
    users: ["Philippe", "Niklas", "Peter"].map((name, i) => ({ name, color: USER_COLORS[i], shareAms: i < 2, shareLibrary: i !== 1 })),
    spools, ams, library,
  };
}

// ---------- Oppstart ----------

for (const key of ["q", "status", "sort"]) {
  const el = $("#" + key);
  const saved = store("bf." + key);
  if ((key === "status" || key === "sort") && saved !== "") state.filters[key] = saved === "all" ? "" : saved;
  el.value = state.filters[key];
  el.addEventListener("input", () => {
    state.filters[key] = el.value;
    if (key === "status" || key === "sort") store("bf." + key, el.value || "all");
    render();
  });
}

document.addEventListener("click", (e) => {
  const wish = e.target.closest("[data-wish]");
  if (wish) {
    e.preventDefault();
    return toggleWish(wish.dataset.wish, wish);
  }
  const tab = e.target.closest(".tab");
  if (tab) return showTab(tab.dataset.tab);
  const uTab = e.target.closest("#u-tabs .sub-tab");
  if (uTab) return showUsersTab(uTab.dataset.utab);
  const subTab = e.target.closest(".sub-tab");
  if (subTab) {
    state.newsSub = subTab.dataset.sub;
    store("bf.newsSub", state.newsSub);
    return renderNews();
  }
  const shopCat = e.target.closest('.chip[data-group="shopcat"]');
  if (shopCat) {
    state.shop.cat = state.shop.cat === shopCat.dataset.value ? "" : shopCat.dataset.value;
    state.shop.limit = 60;
    return renderShop();
  }
  if (e.target.closest("#shop-more")) {
    state.shop.limit += 120;
    return renderShop();
  }
  const typeTab = e.target.closest(".type-tab");
  if (typeTab) {
    state.filters.type = typeTab.dataset.type;
    return render();
  }
  const ams = e.target.closest("button[data-ams]");
  if (ams) return amsAction(ams.dataset.ams, ams);
  const c = e.target.closest(".chip");
  if (c) {
    state.filters[c.dataset.group] = state.filters[c.dataset.group] === c.dataset.value ? "" : c.dataset.value;
    return render();
  }
  const card = e.target.closest(".card, #activity-list li");
  if (card) return openDetail(card.dataset.id);
  const rm = e.target.closest("[data-remove]");
  if (rm) return removeUser(rm.dataset.remove, rm);
  const reset = e.target.closest("[data-reset]");
  if (reset) return resetPassword(reset.dataset.reset, reset);
  const send = e.target.closest("[data-send]");
  if (send) return sendPassword(send.dataset.send, send);
  const ok = e.target.closest("[data-approve]");
  if (ok) return approve(ok.dataset.approve, ok);
  const no = e.target.closest("[data-reject]");
  if (no) return reject(no.dataset.reject, no);
  const cardRm = e.target.closest("[data-card-remove]");
  if (cardRm) return cardAction("remove", cardRm.dataset.cardRemove, "", cardRm);
  const goto = e.target.closest("[data-goto]");
  if (goto) return showTab(goto.dataset.goto);
  const approveBtn = e.target.closest("[data-approve-out]");
  if (approveBtn) return approveCheckout(approveBtn.dataset.approveOut, document.querySelector(`[data-pending-to="${CSS.escape(approveBtn.dataset.approveOut)}"]`)?.value || "", approveBtn);
  const loanBtn = e.target.closest("[data-loan]");
  if (loanBtn) return loanAction(loanBtn.dataset.loan, loanBtn.dataset.spool, loanBtn);
  const pub = e.target.closest("[data-open]");
  if (pub) openPublic(pub.dataset.open);
});
// Husk hvilke typer som er åpne i «Alle typer», så de ikke lukkes ved oppdatering.
document.addEventListener("toggle", (e) => {
  const d = e.target;
  if (d.matches?.("details[data-fold]")) return setFolded(d.dataset.fold, !d.open);
  if (!d.matches?.("details.all-type")) return;
  if (d.open) state.openTypes.add(d.dataset.type); else state.openTypes.delete(d.dataset.type);
}, true);
$("#shop-q").addEventListener("input", (e) => {
  state.shop.q = e.target.value;
  state.shop.limit = 60;
  renderShop();
});
for (const [id, key] of [["#shop-status", "status"], ["#shop-sort", "sort"]]) {
  $(id).value = state.shop[key];
  $(id).addEventListener("input", (e) => {
    state.shop[key] = e.target.value;
    store(key === "status" ? "bf.shopStatus" : "bf.shopSort", e.target.value);
    state.shop.limit = 60;
    renderShop();
  });
}
$("#d-form").addEventListener("submit", saveDetail);
$("#u-form").addEventListener("submit", addUser);
$("#account").addEventListener("click", openAccount);
$("#gate-login").addEventListener("click", openLogin);
$("#rk-form").addEventListener("submit", saveRekey);
$("#rk-close").addEventListener("click", () => $("#rekey").close());
$("#login form").addEventListener("submit", login);
$("#forgot form").addEventListener("submit", forgot);
$("#register form").addEventListener("submit", registerUser);
$("#u-list").addEventListener("change", (e) => e.target.matches(".u-email") && saveEmail(e.target.dataset.email, e.target));
$("#tab-settings").addEventListener("change", (e) => e.target.dataset.setting && saveSetting(e.target.dataset.setting, e.target));
$("#tab-cards").addEventListener("change", (e) => {
  const t = e.target;
  if (t.dataset.cardUser !== undefined) cardAction("user", t.dataset.cardUser, t.value, t);
  if (t.dataset.cardLabel !== undefined) cardAction("label", t.dataset.cardLabel, t.value, t);
});
$("#account-dialog form").addEventListener("submit", accountAction);
$("#password form").addEventListener("submit", changePassword);
$("#password").addEventListener("cancel", (e) => $("#password").dataset.forced && e.preventDefault());
$("#setup-form").addEventListener("submit", setup);
$("#su-done").addEventListener("click", setupDone);
$("#users").addEventListener("close", () => (freshPasswords = []));
$("#open-users").addEventListener("click", openUsers);
$("#refresh").addEventListener("click", () => (state.tab === "ams" ? Promise.all([refresh(), refreshAms()]) : refresh()));
$("#ams-me").addEventListener("change", (e) => e.target.dataset.ams?.startsWith("share") && amsAction(e.target.dataset.ams, e.target));
$("#bambu form").addEventListener("submit", bambuSubmit);
setInterval(() => document.visibilityState === "visible" && bambuToken() && refreshAms(), AMS_REFRESH_MS);
if (DEMO) document.body.classList.add("demo");
renderAccount();
if (!DEMO) setInterval(() => document.visibilityState === "visible" && refresh(), REFRESH_MS);

fetch("data/colors.json")
  .then((r) => (r.ok ? r.json() : {}))
  .catch(() => ({}))
  .then((names) => {
    state.colorNames = names;
    for (const [key, [name, type, colors]] of Object.entries(names)) {
      const idx = key.split("-")[0];
      if (colors[0]) state.colorIndex[`${idx}|${colors[0].toUpperCase()}`] ||= [name, type];
    }
    Promise.all([refresh(), loadCatalog(), loadStore()]).then(() => {
      showTab(TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : store("bf.tab"));
      // Hent AMS i bakgrunnen, så et delt øyeblikksbilde holdes oppdatert uansett fane.
      if (bambuToken() && state.tab !== "ams") refreshAms();
    });
  });
