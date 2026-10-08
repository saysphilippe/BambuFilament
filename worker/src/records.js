// Oversetting mellom «filene» siden kjenner (spools, loans, shared, activity) og postene i
// databasen (tabellen records: coll, id, data). Brukes av Workeren, importen og sikkerhetskopien.

export const FILE_COLLS = {
  spools: ["spools", "cards", "settings"],
  loans: ["loans"],
  shared: ["ams", "library", "wishes"],
  activity: ["logins", "seen"],
};

const MAX_LOGINS = 500;

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
  throw new Error(`Ukjent fil: ${file}`);
}
