// Oversetting mellom «filene» siden kjenner (spools, loans, shared, activity) og postene i
// databasen (tabellen records: coll, id, data). Brukes av Workeren, importen og sikkerhetskopien.

export const FILE_COLLS = {
  spools: ["spools", "cards", "settings"],
  loans: ["loans"],
  shared: ["ams", "library", "wishes"],
  activity: ["logins", "seen"],
  // Komponentbiblioteket: én post per vare fra en ordre (AliExpress, Mouser) eller lagt inn for hånd.
  // partreqs: handlekurven – én post per vare noen trenger fra en annens (eller eget) lager.
  // partprefs: per bruker (id = navn) – kategorier eieren har skjult fra komponentbiblioteket.
  // partcats: felles kategorier (id = kategori-id): nye kategorier og nye navn på de innebygde.
  // projects: prosjekter med stykkliste (eget lager, venners deler via partreqs.projectId, innkjøp).
  parts: ["parts", "partreqs", "partprefs", "partcats", "projects"],
  // Meldinger mellom brukere (teksten er kryptert til mottakerne, se auth.js), og per bruker
  // (id = navn) når innboksen sist ble lest og hvilke meldinger som er skjult. presence (id = navn):
  // når brukeren sist hadde siden åpen (oppdateres hvert 2. minutt), for «pålogget nå».
  messages: ["messages", "msgread", "presence"],
  // Forslag til forbedringer (id = tidspunkt + tilfeldig), se ideas.js. langreqs (id = språknavn
  // med små bokstaver): språk brukerne ønsker at siden oversettes til, med stemmer, se i18n.js.
  ideas: ["ideas", "langreqs"],
  // Tekster endret i Innstillinger → Oversettelser (id = hash av den norske teksten i koden), se i18n.js.
  i18n: ["texts"],
};

const MAX_LOGINS = 500;

// Kompakt lageroversikt over komponentene (for Claude-skillen «elektronikk-design»):
// ett element per produkt og eier (flere kjøp av samme vare slått sammen), med antall igjen i stk.
// Brukes av «Eksporter lager for Claude» på siden og av /inventory i Workeren.
export function inventory(partsDoc, extra = () => ({})) {
  const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
  const n = (v, d) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Number(v) : d);
  const groups = new Map();
  for (const p of partsDoc?.parts || []) {
    if (!p?.id || p.deleted) continue;
    const key = [p.owner, p.source, p.itemId || norm(p.mpn) || norm(p.title), norm(p.variant)].join("|");
    (groups.get(key) || groups.set(key, []).get(key)).push(p);
  }
  const items = [];
  for (const list of groups.values()) {
    const units = (p) => n(p.qty, 1) * n(p.pack, 1);
    const have = list.reduce((s, p) => s + n(p.left, units(p)), 0);
    const bought = list.reduce((s, p) => s + units(p), 0);
    const p = list.sort((a, b) => String(b.orderDate || "").localeCompare(String(a.orderDate || "")))[0];
    items.push({
      owner: p.owner || "", title: String(p.title || "").slice(0, 200), variant: p.variant || "", mpn: p.mpn || "",
      category: p.category || "", pkg: p.pkg || p.pkgFixed || "", have, bought, purchases: list.length,
      location: p.location || "", note: String(p.note || "").slice(0, 200), source: p.source || "",
      url: p.url || "", datasheet: p.datasheet || "", ids: list.map((x) => x.id), ...extra(p),
    });
  }
  items.sort((a, b) => a.category.localeCompare(b.category) || a.owner.localeCompare(b.owner) || a.title.localeCompare(b.title));
  return { version: 1, exported: new Date().toISOString(), owners: [...new Set(items.map((i) => i.owner).filter(Boolean))].sort(), count: items.length, items };
}

// Hele dokumentet -> poster { coll, id, data }.
export function toRecords(file, doc) {
  const out = [];
  const add = (coll, id, data) => out.push({ coll, id: String(id), data });
  if (file === "spools") {
    for (const s of doc.spools || []) if (s?.id) add("spools", s.id, s);
    for (const [uid, c] of Object.entries(doc.cards || {})) add("cards", uid, c);
    if (doc.settings && typeof doc.settings === "object") add("settings", "settings", doc.settings);
  } else if (file === "loans") {
    for (const l of doc.loans || []) if (l?.id) add("loans", l.id, l);
  } else if (file === "shared") {
    for (const [k, v] of Object.entries(doc.ams || {})) add("ams", k, v);
    for (const [k, v] of Object.entries(doc.library || {})) add("library", k, v);
    for (const [k, v] of Object.entries(doc.wishes || {})) add("wishes", k, v);
  } else if (file === "activity") {
    for (const l of doc.logins || []) if (l?.at) add("logins", `${l.at}|${l.user || ""}`, l);
    for (const [k, v] of Object.entries(doc.seen || {})) add("seen", k, v);
  } else if (file === "parts") {
    for (const p of doc.parts || []) if (p?.id) add("parts", p.id, p);
    for (const q of doc.requests || []) if (q?.id) add("partreqs", q.id, q);
    for (const [owner, pref] of Object.entries(doc.prefs || {})) add("partprefs", owner, pref);
    for (const [id, c] of Object.entries(doc.cats || {})) add("partcats", id, c);
    for (const x of doc.projects || []) if (x?.id) add("projects", x.id, x);
  } else if (file === "messages") {
    for (const m of doc.messages || []) if (m?.id) add("messages", m.id, m);
    for (const [name, r] of Object.entries(doc.read || {})) add("msgread", name, r);
    for (const [name, r] of Object.entries(doc.presence || {})) add("presence", name, r);
  } else if (file === "ideas") {
    for (const i of doc.ideas || []) if (i?.id) add("ideas", i.id, i);
    for (const l of doc.langs || []) if (l?.id) add("langreqs", l.id, l);
  } else if (file === "i18n") {
    for (const t of doc.texts || []) if (t?.id) add("texts", t.id, t);
  }
  return out;
}

// Poster -> dokumentet i samme form som de gamle JSON-filene.
export function fromRecords(file, rows) {
  const by = (coll) => rows.filter((r) => r.coll === coll);
  const map = (coll) => Object.fromEntries(by(coll).map((r) => [r.id, r.data]));
  if (file === "spools") {
    return {
      version: 1,
      spools: by("spools").map((r) => r.data).sort((a, b) => String(a.added || "").localeCompare(String(b.added || ""))),
      cards: map("cards"),
      settings: by("settings")[0]?.data || {},
    };
  }
  if (file === "loans") return { version: 1, loans: by("loans").map((r) => r.data).sort((a, b) => String(a.at).localeCompare(String(b.at))) };
  if (file === "shared") return { version: 1, ams: map("ams"), library: map("library"), wishes: map("wishes") };
  if (file === "activity") {
    const logins = by("logins").map((r) => r.data).sort((a, b) => String(a.at).localeCompare(String(b.at))).slice(-MAX_LOGINS);
    return { version: 1, logins, seen: map("seen") };
  }
  if (file === "parts") return { version: 1, parts: by("parts").map((r) => r.data), requests: by("partreqs").map((r) => r.data), prefs: map("partprefs"), cats: map("partcats"), projects: by("projects").map((r) => r.data) };
  if (file === "messages") return { version: 1, messages: by("messages").map((r) => r.data).sort((a, b) => String(a.at).localeCompare(String(b.at))), read: map("msgread"), presence: map("presence") };
  if (file === "ideas") return { version: 1, ideas: by("ideas").map((r) => r.data), langs: by("langreqs").map((r) => r.data) };
  if (file === "i18n") return { version: 1, texts: by("texts").map((r) => r.data) };
  throw new Error(`Ukjent fil: ${file}`);
}
