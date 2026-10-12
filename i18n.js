// Språk. Siden er skrevet på norsk, og all tekst i koden er norsk. Velger brukeren et annet språk,
// oversettes teksten i nettleseren mens siden tegnes: tekstnoder og attributtene title, placeholder,
// aria-label og alt slås opp i ordlisten for språket (i18n-en.js). Tekst med variable deler
// (tall, navn) står der med {*}. Tekst som mangler i ordlisten, vises på norsk.
//
// Valget lagres på brukeren (users[].lang i users.json) og i nettleseren (bf.lang). Norsk er standard.
// Språk brukerne ønsker seg, ligger i D1-samlingen langreqs (fil «ideas»):
//   { id: navn med små bokstaver, name, by, at, votes: [navn] }

const FLAG_NO = `<svg viewBox="0 0 22 16" aria-hidden="true"><rect width="22" height="16" fill="#ba0c2f"/><path d="M6 0h4v16H6zM0 6h22v4H0z" fill="#fff"/><path d="M7 0h2v16H7zM0 7h22v2H0z" fill="#00205b"/></svg>`;
const FLAG_GB = `<svg viewBox="0 0 60 30" aria-hidden="true"><clipPath id="gb-c"><path d="M30 15h30v15zv15H0zH0V0zV0h30z"/></clipPath><path d="M0 0v30h60V0z" fill="#012169"/><path d="M0 0l60 30m0-30L0 30" stroke="#fff" stroke-width="6"/><path d="M0 0l60 30m0-30L0 30" clip-path="url(#gb-c)" stroke="#c8102e" stroke-width="4"/><path d="M30 0v30M0 15h60" stroke="#fff" stroke-width="10"/><path d="M30 0v30M0 15h60" stroke="#c8102e" stroke-width="6"/></svg>`;

export const LANGS = [
  { code: "no", name: "Norsk", flag: FLAG_NO },
  { code: "en", name: "English", flag: FLAG_GB },
];
const DICTS = { en: () => import("./i18n-en.js?v=20261009202254") };
const LOCALE = { no: "nb-NO", en: "en-GB" };
const KEY = "bf.lang";

const readLang = () => { try { return localStorage.getItem(KEY) || ""; } catch { return ""; } };
const known = (code) => LANGS.some((l) => l.code === code);
export const lang = known(readLang()) ? readLang() : "no";

// ---------- Oversettelse ----------

const exact = new Map();
const patterns = [];
const cache = new Map();
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function build(dict) {
  for (const [no, out] of Object.entries(dict)) {
    if (!no.includes("{*}")) { exact.set(no, out); continue; }
    const parts = no.split("{*}");
    const lit = parts.reduce((a, b) => (b.trim().length > a.trim().length ? b : a), "");
    if (!/[a-zæøå]/i.test(lit)) continue; // bare variabler: ville passet på alt
    // Mønstre med lite fast tekst («{*} av {*}») skal bare passe på korte variable deler, ellers
    // treffer de midt i lange setninger.
    const short = parts.join("").replace(/[^a-zæøå]/gi, "").length < 8;
    patterns.push({ re: new RegExp(`^${parts.map(reEsc).join("([\\s\\S]*?)")}$`), out, lit, short, len: no.length });
  }
  patterns.sort((a, b) => b.len - a.len);
}

function lookup(text, depth) {
  const hit = exact.get(text);
  if (hit !== undefined) return hit;
  for (const p of patterns) {
    if (!text.includes(p.lit)) continue;
    const m = p.re.exec(text);
    if (!m || (p.short && m.slice(1).some((x) => x.length > 30))) continue;
    let i = 1;
    // De variable delene kan selv være norsk tekst (f.eks. et nøstet uttrykk), så de slås også opp.
    return p.out.replace(/\{\*\}/g, () => {
      const part = m[i++] ?? "";
      return depth < 2 ? tr(part, depth + 1) : part;
    });
  }
  return null;
}

// Oversetter én tekst. Mellomrom før og etter beholdes, og mellomrom inni slås sammen.
export function tr(s, depth = 0) {
  if (lang === "no" || !s) return s;
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s);
  const core = m[2].replace(/\s+/g, " ");
  if (!core || !/[a-zæøå]/i.test(core)) return s;
  let out = cache.get(core);
  if (out === undefined) {
    out = lookup(core, depth);
    if (cache.size > 30000) cache.clear();
    cache.set(core, out);
  }
  return out === null ? s : m[1] + out + m[3];
}

// ---------- Siden ----------

const ATTRS = ["title", "placeholder", "aria-label", "alt"];
const SKIP = new Set(["SCRIPT", "STYLE", "TEXTAREA", "CODE", "PRE", "KBD"]);
const written = new WeakMap(); // tekstnode -> det vi selv skrev sist, så vi ikke oversetter to ganger

const noTranslate = (el) => !!el.closest?.("[translate=no]");
const skipEl = (el) => !el || SKIP.has(el.tagName) || el.isContentEditable || noTranslate(el);

function doText(n) {
  const v = n.nodeValue;
  if (written.get(n) === v || skipEl(n.parentElement)) return;
  const t = tr(v);
  written.set(n, t);
  if (t !== v) n.nodeValue = t;
}

function doAttr(el, a) {
  const v = el.getAttribute(a);
  if (!v) return;
  const t = tr(v);
  if (t !== v) el.setAttribute(a, t);
}

function walk(root) {
  if (root.nodeType === 3) return doText(root);
  if (root.nodeType !== 1 || noTranslate(root)) return;
  // Tekstfelt (textarea) har plassholdertekst som skal oversettes, men ikke innholdet.
  for (const a of ATTRS) if (root.hasAttribute(a)) doAttr(root, a);
  if (skipEl(root)) return;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => {
      if (n.nodeType !== 1) return NodeFilter.FILTER_ACCEPT;
      if (n.getAttribute("translate") === "no") return NodeFilter.FILTER_REJECT;
      if (SKIP.has(n.tagName)) { for (const a of ATTRS) if (n.hasAttribute(a)) doAttr(n, a); return NodeFilter.FILTER_REJECT; }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    if (n.nodeType === 3) doText(n);
    else for (const a of ATTRS) if (n.hasAttribute(a)) doAttr(n, a);
  }
}

function start() {
  document.documentElement.lang = lang;
  walk(document.documentElement);
  new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === "childList") m.addedNodes.forEach(walk);
      else if (m.type === "characterData") doText(m.target);
      else if (!noTranslate(m.target)) doAttr(m.target, m.attributeName);
    }
  }).observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });

  // Datoer og tall formateres etter språket. Koden ber om "nb-NO"; det byttes ut her.
  const loc = (l) => (l === undefined || /^(nb|no|nn)\b/i.test(String(l)) ? LOCALE[lang] : l);
  for (const [proto, names] of [[Date.prototype, ["toLocaleDateString", "toLocaleTimeString", "toLocaleString"]], [Number.prototype, ["toLocaleString"]]]) {
    for (const name of names) {
      const orig = proto[name];
      proto[name] = function (l, o) { return orig.call(this, loc(l), o); };
    }
  }
  for (const name of ["alert", "confirm", "prompt"]) {
    const orig = window[name];
    window[name] = (msg, ...rest) => orig.call(window, tr(String(msg ?? "")), ...rest);
  }
}

if (lang !== "no") {
  try {
    build((await DICTS[lang]()).default);
    start();
  } catch (err) {
    console.warn("Fant ikke oversettelsen:", err.message);
  }
}

// ---------- Språkvalg øverst og ønskede språk ----------

let ctx = null;
const lstate = { reqs: [], loaded: false, msg: "" };
const $ = (s) => document.querySelector(s);
const me = () => ctx.userName();
const clip = (t, n) => String(t || "").replace(/\s+/g, " ").trim().slice(0, n);

// ctx: { esc, userName, isAdmin, dbCall, token, DEMO, userLang(), saveUserLang(code) }
export function initLang(c) {
  ctx = c;
  renderSwitch();
  $("#lang-switch").addEventListener("click", (e) => {
    const b = e.target.closest("[data-lang]");
    if (!b) return;
    if (b.dataset.lang === lang || b.dataset.lang === "more") openLang();
    else chooseLang(b.dataset.lang);
  });
  const dlg = $("#lang-dialog");
  dlg.addEventListener("click", onDialogClick);
  dlg.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.id === "lang-new") { e.preventDefault(); addRequest(); }
  });
}

// Kalles når brukerlisten er hentet: brukerens lagrede språk gjelder på alle enheter.
// Har brukeren ikke valgt noe, gjelder valget i nettleseren (standard norsk).
export function applyUserLang() {
  const want = ctx?.userLang?.();
  if (want && known(want) && want !== lang) switchTo(want);
}

function switchTo(code) {
  try { localStorage.setItem(KEY, code); } catch { /* ingen lagring */ }
  location.reload();
}

async function chooseLang(code) {
  if (!known(code) || code === lang) return;
  if (me() && ctx.token() && !ctx.DEMO) {
    try { await ctx.saveUserLang(code); } catch (err) { console.warn("Kunne ikke lagre språket:", err.message); }
  }
  switchTo(code);
}

export function langSelectHtml(id = "a-lang") {
  return `<select id="${id}">${LANGS.map((l) => `<option value="${l.code}"${l.code === lang ? " selected" : ""}>${l.name}</option>`).join("")}</select>`;
}
export const onLangSelect = (e) => chooseLang(e.target.value);

function renderSwitch() {
  const box = $("#lang-switch");
  if (!box) return;
  box.innerHTML = LANGS.map((l) => `<button type="button" class="lang-flag${l.code === lang ? " active" : ""}" data-lang="${l.code}" title="${l.code === lang ? "Språk" : l.name}" aria-label="${l.name}"${l.code === lang ? ' aria-current="true"' : ""}>${l.flag}</button>`).join("")
    + `<button type="button" class="lang-flag lang-more" data-lang="more" title="Ønsk et annet språk" aria-label="Ønsk et annet språk">+</button>`;
}

async function loadRequests() {
  if (ctx.DEMO || !ctx.token()) { lstate.loaded = true; return; }
  try {
    const { ideas } = await ctx.dbCall("/db/load", { files: ["ideas"] });
    lstate.reqs = (ideas?.langs || []).filter((r) => r?.id && r.name).map((r) => ({ ...r, name: clip(r.name, 40), votes: (Array.isArray(r.votes) ? r.votes : []).map((v) => clip(v, 40)) }));
    lstate.loaded = true;
  } catch (err) {
    lstate.msg = err.message;
  }
}

async function openLang() {
  lstate.msg = "";
  render();
  $("#lang-dialog").showModal();
  if (!lstate.loaded) { await loadRequests(); render(); }
}

function render() {
  const e = ctx.esc;
  const logged = !!(me() && (ctx.token() || ctx.DEMO));
  const reqs = [...lstate.reqs].sort((a, b) => b.votes.length - a.votes.length || a.name.localeCompare(b.name));
  $("#lang-body").innerHTML = `
    <h2>Språk</h2>
    <div class="lang-choices">${LANGS.map((l) => `<button type="button" class="btn lang-choice${l.code === lang ? " active" : ""}" data-pick="${l.code}"><span class="lang-flag-img" translate="no">${l.flag}</span><span translate="no">${l.name}</span>${l.code === lang ? " ✓" : ""}</button>`).join("")}</div>
    <p class="hint">${logged ? "Norsk er standard. Valget lagres på brukeren din, så det følger deg på alle enheter. Du kan også endre det under kontoen din." : "Norsk er standard. Valget lagres i denne nettleseren."}</p>
    <h3>Ønsker du et annet språk?</h3>
    <p class="hint">Alle ser ønskene. Står språket der fra før, gi det heller en stemme.</p>
    ${reqs.length ? `<ul class="lang-reqs">${reqs.map((r) => {
      const mine = r.votes.includes(me());
      return `<li><b translate="no">${e(r.name)}</b> <span class="hint">${r.votes.length} ${r.votes.length === 1 ? "stemme" : "stemmer"}</span> <span class="hint lang-voters" translate="no">${e(r.votes.join(", "))}</span>
        <span class="spacer"></span>
        ${logged ? `<button type="button" class="btn btn-small${mine ? " active" : ""}" data-vote="${e(r.id)}">${mine ? "✓ Du har stemt" : "Jeg vil også ha dette"}</button>` : ""}
        ${logged && ctx.isAdmin() ? `<button type="button" class="btn btn-small btn-danger" data-reqdel="${e(r.id)}">Fjern</button>` : ""}</li>`;
    }).join("")}</ul>` : `<p class="hint">${lstate.loaded ? "Ingen har ønsket seg et annet språk ennå." : "Henter…"}</p>`}
    ${logged ? `<div class="lang-add"><input id="lang-new" type="text" maxlength="40" placeholder="F.eks. Svensk" aria-label="Språk du ønsker"><button type="button" class="btn btn-primary" data-reqadd>Ønsk språket</button></div>` : `<p class="hint">Logg inn for å ønske et språk.</p>`}
    <p class="hint" role="status">${e(lstate.msg)}</p>
    <div class="d-buttons"><span class="spacer"></span><button value="close" class="btn">Lukk</button></div>`;
}

async function saveReq(r) {
  if (!ctx.DEMO) await ctx.dbCall("/db/patch", { ops: [{ coll: "langreqs", id: r.id, data: r }] });
}

async function addRequest() {
  const name = clip($("#lang-new")?.value, 40);
  if (!name) return;
  const id = name.toLowerCase();
  if (LANGS.some((l) => l.name.toLowerCase() === id || l.code === id) || ["engelsk", "english", "norwegian", "bokmål"].includes(id)) {
    lstate.msg = "Det språket finnes allerede.";
    return render();
  }
  const old = lstate.reqs.find((r) => r.id === id);
  if (old) {
    if (!old.votes.includes(me())) old.votes.push(me());
    lstate.msg = `«${old.name}» var allerede ønsket. Stemmen din er lagt til.`;
    await persist(old);
    return;
  }
  const r = { id, name: name[0].toUpperCase() + name.slice(1), by: me(), at: new Date().toISOString(), votes: [me()] };
  lstate.reqs.push(r);
  lstate.msg = `Takk! «${r.name}» er lagt til.`;
  await persist(r);
}

async function persist(r) {
  try { await saveReq(r); } catch (err) { lstate.msg = err.message; }
  render();
}

async function onDialogClick(e) {
  const t = e.target.closest("button");
  if (!t) return;
  if (t.dataset.pick) { e.preventDefault(); chooseLang(t.dataset.pick); }
  else if (t.hasAttribute("data-reqadd")) { e.preventDefault(); addRequest(); }
  else if (t.dataset.vote) {
    e.preventDefault();
    const r = lstate.reqs.find((x) => x.id === t.dataset.vote);
    if (!r) return;
    r.votes = r.votes.includes(me()) ? r.votes.filter((v) => v !== me()) : [...r.votes, me()];
    lstate.msg = "";
    if (r.votes.length) return persist(r);
    // Ingen stemmer igjen: ønsket fjernes.
    lstate.reqs = lstate.reqs.filter((x) => x !== r);
    try { if (!ctx.DEMO) await ctx.dbCall("/db/patch", { ops: [{ coll: "langreqs", id: r.id, data: null }] }); } catch (err) { lstate.msg = err.message; }
    render();
  } else if (t.dataset.reqdel) {
    e.preventDefault();
    lstate.reqs = lstate.reqs.filter((x) => x.id !== t.dataset.reqdel);
    try { if (!ctx.DEMO) await ctx.dbCall("/db/patch", { ops: [{ coll: "langreqs", id: t.dataset.reqdel, data: null }] }); } catch (err) { lstate.msg = err.message; }
    render();
  }
}
