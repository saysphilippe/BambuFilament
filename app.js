import { parseTag, cssColor, buildBlocks } from "./bambu.js";
import { encryptToken, decryptToken, randomPassword, MIN_PASSWORD } from "./auth.js";

const REPO = "saysphilippe/BambuFilament";
const BRANCH = "main";
const PATH = "data/spools.json";
const API = `https://api.github.com/repos/${REPO}/contents/${PATH}`;
const REFRESH_MS = 120000;
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
  tab: "stock",
  amsLive: null,
  amsBusy: false,
  amsError: "",
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

function loadSession() {
  try { return JSON.parse(store("bf.session") || "null"); } catch { return null; }
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

async function loadDoc() {
  try {
    const res = await fetch(`${API}?ref=${BRANCH}`, {
      headers: headers({ Accept: "application/vnd.github.raw+json" }),
      cache: "no-store",
    });
    if (res.ok) return await res.json();
    if (res.status === 404) return { version: 1, users: [], spools: [] };
  } catch { /* faller tilbake til kopien på github.io */ }
  const res = await fetch(`${PATH}?t=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Kunne ikke hente ${PATH} (${res.status})`);
  return res.json();
}

// Henter siste versjon, lar mutate endre den, og lagrer. Prøver på nytt ved konflikt.
async function saveDoc(mutate, message) {
  if (DEMO) throw new Error("Demo-modus: endringer lagres ikke.");
  if (!token()) throw new Error("Logg inn for å kunne endre.");
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${API}?ref=${BRANCH}`, { headers: headers({ Accept: "application/vnd.github+json" }), cache: "no-store" });
    let doc = { version: 1, users: [], spools: [] }, sha;
    if (res.ok) {
      const meta = await res.json();
      sha = meta.sha;
      doc = JSON.parse(decodeBase64(meta.content));
    } else if (res.status !== 404) {
      throw new Error(`GitHub svarte ${res.status} ved henting`);
    }
    doc.users ||= [];
    doc.spools ||= [];
    const error = mutate(doc);
    if (error) throw new Error(error);
    const put = await fetch(API, {
      method: "PUT",
      headers: headers({ Accept: "application/vnd.github+json", "Content-Type": "application/json" }),
      body: JSON.stringify({ message, branch: BRANCH, sha, content: encodeBase64(JSON.stringify(doc, null, 2) + "\n") }),
    });
    if (put.ok) {
      setDoc(doc);
      return doc;
    }
    if (put.status === 401) {
      setSession(null);
      throw new Error("Innloggingen er ikke lenger gyldig (tokenen er utløpt eller trukket tilbake). Logg inn på nytt.");
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
  const code = tag?.variantId.split("-")[1];
  const official = tag && state.colorNames[`${tag.materialId}-${code}`];
  return {
    ...spool,
    status: statusOf(spool),
    tag,
    colorName: official?.[0] || "",
    typeName: official?.[1] || tag?.detailedType || "Ukjent type",
    family: family(tag),
  };
}

function setDoc(doc) {
  state.doc = { ...doc, users: doc.users || [], spools: doc.spools || [], ams: doc.ams || {} };
  state.spools = state.doc.spools.map(enrich);
}

function addEvent(spool, action) {
  spool.history = [...(spool.history || []), { at: new Date().toISOString(), action, by: userName() }].slice(-30);
}

// Brukere fra listen, pluss eiere som finnes på spoler uten å være lagt inn.
function users() {
  const list = state.doc.users.map((u) => ({ ...u, known: true }));
  for (const s of state.spools) {
    if (s.owner && !list.some((u) => u.name === s.owner)) list.push({ name: s.owner, color: "#8a8f8b", known: false });
  }
  return list;
}

const userColor = (name) => users().find((u) => u.name === name)?.color || "#8a8f8b";

async function refresh() {
  setSync("Henter…");
  try {
    setDoc(DEMO ? demoDoc() : await loadDoc());
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
const hueOf = (s) => (s.tag ? FAMILIES.findIndex((f) => f[0] === s.family) * 1000 + hsl(s.tag.colors[0]).h : 1e9);

function filtered() {
  const { q, owner, type, family: fam, status, sort } = state.filters;
  const needle = q.trim().toLowerCase();
  const list = state.spools.filter((s) =>
    (!owner || s.owner === owner) &&
    (!type || s.typeName === type) &&
    (!fam || s.family === fam) &&
    (!status || s.status === status) &&
    (!needle || [title(s), s.typeName, s.colorName, s.tag?.colors.join(" "), s.owner, s.note].join(" ").toLowerCase().includes(needle))
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
  const all = users();
  const inStock = state.spools.filter((s) => s.status === "in");
  const kg = inStock.reduce((sum, s) => sum + (s.tag?.weight || 0), 0) / 1000;
  $("#stats").innerHTML =
    `<div class="stat"><b>${inStock.length}</b><span>på lager</span></div>` +
    `<div class="stat"><b>${state.spools.filter((s) => s.status === "out").length}</b><span>tatt ut</span></div>` +
    `<div class="stat"><b>${kg.toLocaleString("nb-NO", { maximumFractionDigits: 1 })} kg</b><span>på lager (nominelt)</span></div>` +
    all.map((u) => `<div class="stat owner-stat" style="--owner:${u.color}"><b>${inStock.filter((s) => s.owner === u.name).length}</b><span>${esc(u.name)}</span></div>`).join("");

  // Filtre
  const f = state.filters;
  $("#owner-chips").innerHTML = chip("owner", "", "Alle", !f.owner) +
    all.map((u) => chip("owner", u.name, u.name, f.owner === u.name, u.color)).join("");
  const presentFamilies = new Set(state.spools.map((s) => s.family));
  $("#family-chips").innerHTML = chip("family", "", "Alle farger", !f.family) +
    FAMILIES.filter(([k]) => presentFamilies.has(k)).map(([k, label, c]) => chip("family", k, label, f.family === k, c)).join("");
  const types = [...new Set(state.spools.map((s) => s.typeName))].sort();
  $("#type").innerHTML = `<option value="">Alle typer</option>` +
    types.map((t) => `<option${t === f.type ? " selected" : ""}>${esc(t)}</option>`).join("");

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
      <span class="what">${esc(title(e.spool))} <span class="muted">${esc(e.spool.typeName)}</span></span>
      <span class="who">${esc(e.by || "")} · ${fmtTime(e.at)}</span>
    </li>`).join("");

  // Spoler
  const list = filtered();
  $("#count").textContent = `${list.length} ${list.length === 1 ? "spole" : "spoler"}`;
  $("#grid").innerHTML = list.length
    ? list.map((s) => `
      <button class="card status-${s.status}" data-id="${esc(s.id)}" style="--owner:${userColor(s.owner)}">
        <div class="swatch" style="background:${swatch(s.tag)}">
          ${s.status !== "in" ? `<span class="badge badge-${s.status}">${STATUS[s.status]}</span>` : ""}
        </div>
        <div class="owner-bar"><span class="owner-dot"></span>${esc(s.owner || "Ingen eier")}</div>
        <div class="card-body">
          <div class="card-title">${esc(title(s))}</div>
          <div class="card-type">${esc(s.typeName)}</div>
          <div class="card-meta">
            <span class="hex">${esc(s.tag?.colors.map((c) => c.slice(0, 7)).join(" / ") || "")}</span>
            ${s.tag ? `<span>${s.tag.weight} g</span>` : ""}
          </div>
          ${s.note ? `<div class="card-note">${esc(s.note)}</div>` : ""}
        </div>
      </button>`).join("")
    : `<p class="empty-msg">${state.spools.length ? "Ingen spoler passer filteret." : `Ingen spoler ennå. Skann en spole med leseren${DEMO ? "" : `, eller <a href="?demo">se demo med eksempeldata</a>`}.`}</p>`;
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
    ["Produsert", fmtDate(t.productionDate)],
    ["Bambu-ID", `${t.materialId} · ${t.variantId}`],
  ] : [["Data", "Kunne ikke tolke brikken"]];
  rows.push(["Lagt inn", fmtDate(s.added)], ["Sist skannet", `${fmtDate(s.lastScan)} (${s.scans || 1}×)`]);
  $("#d-rows").innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("");
  $("#d-history").innerHTML = (s.history || []).slice().reverse()
    .map((e) => `<li><span class="act act-${esc(e.action)}">${ACTION[e.action] || esc(e.action)}</span> ${esc(e.by || "")} · ${fmtTime(e.at)}</li>`)
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
  $("#detail").showModal();
}

async function saveDetail(e) {
  e.preventDefault();
  const form = e.target;
  const id = state.selected;
  const action = e.submitter?.value;
  if (action === "close") return $("#detail").close();
  if (action === "delete" && !confirm("Slette spolen fra oversikten?")) return;

  const fields = {
    name: form.elements.name.value.trim(),
    owner: form.elements.owner.value,
    status: action === "in" || action === "out" ? action : form.elements.status.value,
    note: form.elements.note.value.trim(),
  };
  form.querySelectorAll("button").forEach((b) => (b.disabled = true));
  try {
    await saveDoc((doc) => {
      if (action === "delete") { doc.spools = doc.spools.filter((s) => s.id !== id); return; }
      const spool = doc.spools.find((s) => s.id === id);
      if (!spool) return "Spolen finnes ikke lenger.";
      if (fields.status !== statusOf(spool)) addEvent(spool, fields.status);
      Object.assign(spool, fields);
    }, `${{ delete: "Slettet", in: "Innsjekk", out: "Utsjekk" }[action] || "Oppdaterte"} spole ${id.slice(0, 8)} (${userName()})`);
    render();
    $("#detail").close();
  } catch (err) {
    $("#d-error").textContent = err.message;
  } finally {
    form.querySelectorAll("button").forEach((b) => (b.disabled = false));
  }
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
    const note = [u.admin && "admin", !u.known && "ikke i brukerlisten", u.known && !u.cred && "ingen innlogging", u.mustChange && "må bytte passord"].filter(Boolean).join(", ");
    return `<li style="--owner:${u.color}">
      <span class="owner-dot"></span>
      <span class="u-name">${esc(u.name)}${note ? ` <span class="muted">(${note})</span>` : ""}</span>
      <span class="muted">${count} ${count === 1 ? "spole" : "spoler"}</span>
      ${u.known ? `
        <button type="button" class="btn btn-small" data-reset="${esc(u.name)}" ${canEdit ? "" : "disabled"} title="Lag nytt midlertidig passord">Nytt passord</button>
        <button type="button" class="btn btn-danger btn-small" data-remove="${esc(u.name)}" ${!canEdit || why !== "Fjern bruker" ? "disabled" : ""} title="${why}">Fjern</button>` : ""}
    </li>`;
  }).join("") || "<li class='muted'>Ingen brukere ennå</li>";
  $("#u-fresh").innerHTML = freshPasswords.length
    ? `<p><b>Midlertidige passord.</b> Gi dem til brukerne nå, de vises bare denne ene gangen. Brukeren må bytte passord ved første innlogging.</p>
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
  $("#users").showModal();
}

async function addUser(e) {
  e.preventDefault();
  const form = e.target;
  const name = form.elements.name.value.trim();
  const color = form.elements.color.value;
  if (!name) return;
  $("#u-error").textContent = "";
  try {
    const temp = randomPassword();
    const cred = await encryptToken(token(), temp);
    await saveDoc((doc) => {
      if (!adminIn(doc)) return ADMIN_ONLY;
      if (doc.users.some((u) => u.name.toLowerCase() === name.toLowerCase())) return `${name} finnes allerede.`;
      doc.users.push({ name, color, cred, mustChange: true });
    }, `La til bruker ${name} (${userName()})`);
    freshPasswords.push([name, temp]);
    form.elements.name.value = "";
    render();
    renderUsers();
  } catch (err) {
    $("#u-error").textContent = err.message;
  }
}

async function resetPassword(name) {
  if (!confirm(`Lage nytt midlertidig passord for ${name}? Det gamle slutter å virke.`)) return;
  $("#u-error").textContent = "";
  try {
    const temp = randomPassword();
    const cred = await encryptToken(token(), temp);
    await saveDoc((doc) => {
      if (!adminIn(doc)) return ADMIN_ONLY;
      const u = doc.users.find((x) => x.name === name);
      if (!u) return `${name} finnes ikke lenger.`;
      u.cred = cred;
      u.mustChange = true;
    }, `Nytt passord for ${name} (${userName()})`);
    freshPasswords = freshPasswords.filter(([n]) => n !== name).concat([[name, temp]]);
    if (name === userName()) {
      $("#users").close();
      openChangePassword(true);
    }
    renderUsers();
  } catch (err) {
    $("#u-error").textContent = err.message;
  }
}

async function removeUser(name) {
  if (!confirm(`Fjerne ${name} fra brukerlisten?`)) return;
  $("#u-error").textContent = "";
  try {
    await saveDoc((doc) => {
      if (!adminIn(doc)) return ADMIN_ONLY;
      if (name === userName()) return "Du kan ikke fjerne deg selv.";
      if (doc.spools.some((s) => s.owner === name)) return `${name} eier fortsatt spoler. Flytt eller slett dem først.`;
      doc.users = doc.users.filter((u) => u.name !== name);
    }, `Fjernet bruker ${name} (${userName()})`);
    freshPasswords = freshPasswords.filter(([n]) => n !== name);
    if (state.filters.owner === name) state.filters.owner = "";
    render();
    renderUsers();
  } catch (err) {
    $("#u-error").textContent = err.message;
  }
}

// ---------- Innlogging ----------

function renderAccount() {
  $("#account-label").textContent = session ? session.user : "Logg inn";
  $("#account").classList.toggle("logged-in", !!session);
  $("#account").hidden = DEMO;
}

function setSession(value) {
  session = value;
  store("bf.session", value ? JSON.stringify(value) : "");
  state.amsLive = null;
  state.amsError = "";
  renderAccount();
  render();
  if (value && state.tab === "ams") refreshAms();
}

function openAccount() {
  if (!session) return openLogin();
  $("#a-name").textContent = session.user;
  $("#account-dialog").showModal();
}

function openLogin() {
  const withLogin = state.doc.users.filter((u) => u.cred);
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
  const tok = user?.cred && (await decryptToken(user.cred, $("#l-password").value));
  if (!tok) {
    $("#l-error").textContent = "Feil passord.";
    return;
  }
  store("bf.lastUser", name);
  setSession({ user: name, token: tok });
  $("#login").close();
  if (user.mustChange) openChangePassword(true);
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
  if (pw.length < MIN_PASSWORD) return ($("#p-error").textContent = `Passordet må ha minst ${MIN_PASSWORD} tegn.`);
  if (pw !== $("#p-repeat").value) return ($("#p-error").textContent = "Passordene er ikke like.");
  $("#p-error").textContent = "Lagrer…";
  try {
    const cred = await encryptToken(token(), pw);
    await saveDoc((doc) => {
      const u = doc.users.find((x) => x.name === userName());
      if (!u) return "Brukeren din finnes ikke lenger.";
      u.cred = cred;
      u.mustChange = false;
    }, `Byttet passord (${userName()})`);
    freshPasswords = freshPasswords.filter(([n]) => n !== userName());
    dlg.close();
  } catch (err) {
    $("#p-error").textContent = err.message;
  }
}

// Første oppsett: ingen brukere har innlogging ennå.
function openSetup() {
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
    const res = await fetch(`https://api.github.com/repos/${REPO}`, { headers: { Authorization: `Bearer ${tok}` } });
    const repo = res.ok ? await res.json() : null;
    if (!repo?.permissions?.push) throw new Error("Tokenen har ikke skrivetilgang til repoet.");
    $("#su-error").textContent = "Krypterer og lagrer…";
    const created = [];
    for (const [i, name] of names.entries()) {
      const temp = randomPassword();
      created.push({ name, color: USER_COLORS[i % USER_COLORS.length], cred: await encryptToken(tok, temp), temp, admin: i === 0 });
    }
    session = { user: names[0], token: tok };
    await saveDoc((doc) => {
      if (doc.users.some((u) => u.cred)) return "Oppsettet er allerede gjort. Last siden på nytt.";
      for (const { name, color, cred, admin } of created) {
        const existing = doc.users.find((u) => u.name === name);
        if (existing) Object.assign(existing, { cred, admin, mustChange: true });
        else doc.users.push({ name, color, cred, admin, mustChange: true });
      }
    }, `Første oppsett: ${names.join(", ")}`);
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
  openChangePassword(true);
}

// ---------- AMS ----------

const AMS_REFRESH_MS = 5 * 60 * 1000;          // Bambu anbefaler ikke hyppigere "pushall"
const SNAPSHOT_MAX_AGE_MS = 6 * 60 * 60 * 1000; // delt øyeblikksbilde fornyes minst så ofte

const bambuKey = () => `bf.bambu.${userName()}`;
function bambuToken() {
  try { return JSON.parse(store(bambuKey()) || "null")?.token || ""; } catch { return ""; }
}

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
    state.amsLive = await proxy("/ams", {}, tok);
    await publishSnapshot();
  } catch (err) {
    state.amsError = err.message;
    if (err.status === 401) store(bambuKey(), "");
  }
  state.amsBusy = false;
  renderAms();
}

// Lagrer øyeblikksbildet i repoet hvis brukeren deler og innholdet er endret.
async function publishSnapshot() {
  const me = state.doc.users.find((u) => u.name === userName());
  if (!me?.shareAms || !state.amsLive) return;
  const snap = snapshot(state.amsLive);
  const old = state.doc.ams?.[me.name];
  const fresh = old && Date.now() - new Date(old.updated).getTime() < SNAPSHOT_MAX_AGE_MS;
  if (sameSnapshot(old, snap) && fresh) return;
  await saveDoc((doc) => {
    doc.ams ||= {};
    doc.ams[me.name] = snap;
  }, `AMS-oppdatering (${me.name})`);
}

async function setShare(share) {
  state.amsError = "";
  try {
    await saveDoc((doc) => {
      const u = doc.users.find((x) => x.name === userName());
      if (!u) return "Brukeren din finnes ikke.";
      u.shareAms = share;
      doc.ams ||= {};
      if (share && state.amsLive) doc.ams[u.name] = snapshot(state.amsLive);
      if (!share) delete doc.ams[u.name];
    }, `${share ? "Deler" : "Sluttet å dele"} AMS-data (${userName()})`);
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
        <div><b>Koble til Bambu-kontoen din</b><p class="hint">Innloggingen gjelder bare denne nettleseren. Bambu-passordet lagres ikke.</p></div>
        <button class="btn btn-primary" data-ams="connect">Koble til</button>
      </div>`;
  } else {
    panel.innerHTML = `
      <div class="ams-me-row">
        <div>
          <b>Bambu-konto tilkoblet</b>
          <div class="muted">${state.amsBusy ? "Henter AMS-data…" : state.amsLive ? `Oppdatert ${fmtTime(state.amsLive.updated)}` : ""}</div>
        </div>
        <label class="switch"><input type="checkbox" data-ams="share" ${meUser?.shareAms ? "checked" : ""}> Del AMS-data med alle</label>
        <button class="btn" data-ams="refresh" ${state.amsBusy ? "disabled" : ""}>Oppdater</button>
        <button class="btn btn-danger" data-ams="disconnect">Koble fra</button>
      </div>`;
  }
  if (state.amsError) panel.innerHTML += `<p class="error">${esc(state.amsError)}</p>`;

  const sections = users().map((u) => {
    const live = u.name === me && state.amsLive;
    const data = live || state.doc.ams?.[u.name];
    if (!data) return "";
    const tag = live ? (u.shareAms ? "Ditt · deles med alle" : "Ditt · bare synlig for deg") : `Delt ${fmtTime(data.updated)}`;
    return `<section class="ams-owner" style="--owner:${u.color}">
      <h2><span class="owner-dot"></span>${esc(u.name)} <span class="muted">${tag}</span></h2>
      <div class="printers">${data.printers.map(renderPrinter).join("") || `<p class="muted">Ingen printere.</p>`}</div>
    </section>`;
  }).join("");
  $("#ams-list").innerHTML = sections || `<p class="empty-msg">Ingen AMS-data er delt ennå.</p>`;
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

function showBambuStep() {
  const s = bambuLogin.step;
  $("#b-step-password").hidden = s !== "password";
  $("#b-step-code").hidden = s === "password";
  $("#b-code-hint").textContent = s === "tfa"
    ? "Skriv inn koden fra autentiseringsappen din."
    : `Bambu har sendt en kode til ${bambuLogin.email}. Skriv den inn her.`;
  $("#b-error").textContent = "";
}

async function bambuSubmit(e) {
  e.preventDefault();
  if (e.submitter?.value === "cancel") return $("#bambu").close();
  const err = $("#b-error");
  err.textContent = "Kobler til…";
  try {
    let res;
    if (bambuLogin.step === "password") {
      bambuLogin.email = $("#b-email").value.trim();
      res = await proxy("/login", { account: bambuLogin.email, password: $("#b-password").value });
      if (res.step === "code") await proxy("/send-code", { email: bambuLogin.email });
    } else if (bambuLogin.step === "code") {
      res = await proxy("/login", { account: bambuLogin.email, code: $("#b-code").value.trim() });
    } else {
      res = await proxy("/tfa", { tfaKey: bambuLogin.tfaKey, tfaCode: $("#b-code").value.trim() });
    }
    if (res.token) {
      store(bambuKey(), JSON.stringify({ token: res.token, email: bambuLogin.email, at: new Date().toISOString() }));
      $("#b-password").value = "";
      $("#bambu").close();
      refreshAms();
      return;
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
  if (action === "share") await setShare(el.checked);
  if (action === "disconnect") {
    if (!confirm("Koble fra Bambu-kontoen i denne nettleseren?")) return;
    store(bambuKey(), "");
    state.amsLive = null;
    renderAms();
  }
}

// ---------- Faner ----------

function showTab(tab) {
  state.tab = tab === "ams" ? "ams" : "stock";
  store("bf.tab", state.tab);
  document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === state.tab));
  $("#tab-stock").hidden = state.tab !== "stock";
  $("#tab-ams").hidden = state.tab !== "ams";
  if (state.tab === "ams" && !state.amsLive && !state.amsBusy) refreshAms();
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
  return { version: 1, users: ["Philippe", "Niklas", "Peter"].map((name, i) => ({ name, color: USER_COLORS[i], shareAms: i < 2 })), spools, ams };
}

// ---------- Oppstart ----------

for (const key of ["q", "type", "status", "sort"]) {
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
  const tab = e.target.closest(".tab");
  if (tab) return showTab(tab.dataset.tab);
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
  if (rm) return removeUser(rm.dataset.remove);
  const reset = e.target.closest("[data-reset]");
  if (reset) resetPassword(reset.dataset.reset);
});
$("#d-form").addEventListener("submit", saveDetail);
$("#u-form").addEventListener("submit", addUser);
$("#account").addEventListener("click", openAccount);
$("#login form").addEventListener("submit", login);
$("#account-dialog form").addEventListener("submit", accountAction);
$("#password form").addEventListener("submit", changePassword);
$("#password").addEventListener("cancel", (e) => $("#password").dataset.forced && e.preventDefault());
$("#setup-form").addEventListener("submit", setup);
$("#su-done").addEventListener("click", setupDone);
$("#users").addEventListener("close", () => (freshPasswords = []));
$("#open-users").addEventListener("click", openUsers);
$("#refresh").addEventListener("click", () => (state.tab === "ams" ? Promise.all([refresh(), refreshAms()]) : refresh()));
$("#ams-me").addEventListener("change", (e) => e.target.dataset.ams === "share" && amsAction("share", e.target));
$("#bambu form").addEventListener("submit", bambuSubmit);
setInterval(() => document.visibilityState === "visible" && state.tab === "ams" && bambuToken() && refreshAms(), AMS_REFRESH_MS);
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
    refresh().then(() => showTab(location.hash === "#ams" ? "ams" : store("bf.tab")));
  });
