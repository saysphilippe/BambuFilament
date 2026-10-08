// Engangsimport: leser JSON-filene i en lokal kopi av BambuFilament-data og lager SQL som
// legger alt inn i databasen (tabellen records). Kjør:
//   node scripts/import-d1.mjs ../BambuFilament-data > import.sql
//   cd worker && npx wrangler d1 execute filament-universet --remote --file ../import.sql
import { readFile } from "node:fs/promises";
import { toRecords } from "../worker/src/records.js";

const dir = process.argv[2] || "../BambuFilament-data";
const now = new Date().toISOString();
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const lines = [];
for (const file of ["spools", "loans", "shared", "activity"]) {
  let doc;
  try {
    doc = JSON.parse(await readFile(`${dir}/${file}.json`, "utf8"));
  } catch {
    console.error(`(fant ikke ${file}.json – hopper over)`);
    continue;
  }
  const recs = toRecords(file, doc);
  console.error(`${file}: ${recs.length} poster`);
  for (const r of recs) {
    lines.push(`INSERT OR REPLACE INTO records (coll, id, data, updated) VALUES (${q(r.coll)}, ${q(r.id)}, ${q(JSON.stringify(r.data))}, ${q(now)});`);
  }
}
console.log(lines.join("\n"));
