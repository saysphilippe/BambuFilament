// Viser forslag til forbedringer og ønskede språk fra Filament og elektronikk universet.
//
// Kilde (første som virker):
//   1. Databasen direkte (D1, bare lesing) med wrangler – krever innlogging hos Cloudflare
//      (npx wrangler login), altså bare for den som eier Workeren.
//   2. Den nattlige sikkerhetskopien (backup/ideas.json i det private repoet BambuFilament-data,
//      skrevet av Workeren kl. 03 UTC) med GitHub CLI – krever tilgang til repoet (gh auth login).
//      Opptil ett døgn gammel.
//
// Bruk:
//   node scripts/forslag.mjs            åpne forslag (nye og godkjente) og ønskede språk
//   node scripts/forslag.mjs --alle     alle forslag, også ferdige og avviste
//   node scripts/forslag.mjs --kopi     les bare sikkerhetskopien
//   node scripts/forslag.mjs --json     rådata
import { execFileSync, execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const REPO = "saysphilippe/BambuFilament-data";
const args = process.argv.slice(2);
const all = args.includes("--alle"), json = args.includes("--json"), copyOnly = args.includes("--kopi");
const GH = ["C:/Program Files/GitHub CLI/gh.exe", "/usr/bin/gh", "/opt/homebrew/bin/gh"].find((p) => existsSync(p)) || "gh";

// Leser postene rett fra D1 (SELECT, endrer ingenting).
function readLive() {
  const cwd = fileURLToPath(new URL("../worker/", import.meta.url));
  const sql = "SELECT coll, data FROM records WHERE coll IN ('ideas','langreqs')";
  const out = execSync(`npx wrangler d1 execute filament-universet --remote --json --command "${sql}"`, { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"], timeout: 90000 });
  const rows = JSON.parse(out.slice(out.indexOf("[")))[0]?.results || [];
  const data = (coll) => rows.filter((r) => r.coll === coll).map((r) => JSON.parse(r.data));
  return { live: true, ideas: data("ideas"), langs: data("langreqs") };
}

function readBackup(file) {
  try {
    const out = execFileSync(GH, ["api", `repos/${REPO}/contents/backup/${file}.json`, "-H", "Accept: application/vnd.github.raw"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
    return JSON.parse(out);
  } catch (err) {
    const msg = String(err.stderr || err.message);
    if (/404|Not Found/.test(msg)) throw new Error(`Fant ikke backup/${file}.json i ${REPO}. Sikkerhetskopien kjøres kl. 03 UTC; finnes ikke filen etter det, sjekk Workerens logg.`);
    throw new Error(`Kunne ikke lese ${REPO}: ${msg.trim()} (er du logget inn med gh auth login?)`);
  }
}

let doc;
if (!copyOnly) {
  try {
    doc = readLive();
  } catch (err) {
    console.error(`(Fikk ikke lest databasen direkte, bruker sikkerhetskopien: ${String(err.stderr || err.message).trim().split(/\r?\n/)[0]})`);
  }
}
try {
  doc ||= readBackup("ideas");
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const ideas = (doc.ideas || []).filter((i) => i?.title);
const langs = (doc.langs || []).filter((l) => l?.name);
if (json) {
  console.log(JSON.stringify({ live: !!doc.live, backedUp: doc.backedUp, ideas, langs }, null, 2));
  process.exit(0);
}

const STATUS = { new: "Nytt", approved: "Godkjent", rejected: "Avvist", done: "Ferdig" };
const day = (iso) => (iso ? String(iso).slice(0, 10) : "");
console.log(doc.live ? "Rett fra databasen" : `Sikkerhetskopi fra ${doc.backedUp || "ukjent tid"}`);

const shown = ideas
  .filter((i) => all || i.status === "new" || i.status === "approved")
  .sort((a, b) => (b.likes?.length || 0) - (a.likes?.length || 0) || String(b.at).localeCompare(String(a.at)));
console.log(`\n== Forslag til forbedringer (${shown.length}${all ? "" : ` åpne av ${ideas.length}`}) ==`);
for (const i of shown) {
  console.log(`\n[${STATUS[i.status] || i.status}] ${i.title}  – ${i.by}, ${day(i.at)}${i.likes?.length ? `, +1 fra ${i.likes.join(", ")}` : ""}`);
  if (i.text) console.log(`  ${String(i.text).replace(/\n/g, "\n  ")}`);
  if (i.reply) console.log(`  Svar (${i.replyBy || "admin"}, ${day(i.replyAt)}): ${i.reply}`);
}
if (!shown.length) console.log("Ingen.");

console.log(`\n== Ønskede språk (${langs.length}) ==`);
for (const l of [...langs].sort((a, b) => (b.votes?.length || 0) - (a.votes?.length || 0))) {
  const n = l.votes?.length || 0;
  console.log(`${l.name}: ${n} ${n === 1 ? "stemme" : "stemmer"} (${(l.votes || []).join(", ")}) – ønsket av ${l.by}, ${day(l.at)}`);
}
if (!langs.length) console.log("Ingen.");
