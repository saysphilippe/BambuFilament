// Søk i komponentlageret til Filament og elektronikk universet (alle eiere).
// Brukes av Claude-skillen «elektronikk-design» (.claude/skills/elektronikk-design/SKILL.md).
//
// Kilde (første som finnes):
//   --file <lager.json>            fil fra «Eksporter lager for Claude» på siden
//   miljøvariabelen BF_INVENTORY_KEY  Claude-nøkkel (Innstillinger → Konto og varsler)
//   nyeste lager-*.json i Nedlastinger
//
// Bruk:
//   node scripts/lager.mjs 555 lm317 "logic level"   søk (hvert ord eller hver frase gir egne treff)
//   node scripts/lager.mjs --summary                 antall per kategori og eier
//   node scripts/lager.mjs --owner Philippe --cat semi --have mosfet
//   node scripts/lager.mjs --save lager.json         lagre en lokal kopi (ikke legg den i git)
//   node scripts/lager.mjs --octopart LM2596S-5.0     slå opp hos Octopart (krever BF_INVENTORY_KEY):
//                                                    produsent, pakke, datablad, lager og pris hos forhandlerne
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const WORKER = "https://bambufilament-proxy.saysphilippe.workers.dev";
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
const flag = (name) => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };
const file = opt("--file"), save = opt("--save"), owner = opt("--owner"), cat = opt("--cat");
const octo = opt("--octopart");
const have = flag("--have"), summary = flag("--summary"), json = flag("--json");

if (octo) {
  if (!process.env.BF_INVENTORY_KEY) { console.error("--octopart krever BF_INVENTORY_KEY (Claude-nøkkel fra siden)."); process.exit(1); }
  const res = await fetch(`${WORKER}/octopart?mpn=${encodeURIComponent(octo)}&limit=5`, { headers: { Authorization: `Bearer ${process.env.BF_INVENTORY_KEY}` } });
  const r = await res.json().catch(() => ({}));
  if (!res.ok) { console.error(`Octopart-oppslaget feilet (${res.status}): ${r.error || "ukjent"}`); process.exit(1); }
  if (!r.configured) { console.error("Octopart er ikke satt opp i Workeren ennå (mangler Nexar-nøkler)."); process.exit(1); }
  if (json) { console.log(JSON.stringify(r, null, 1)); process.exit(0); }
  console.log(`Octopart «${r.mpn}»: ${r.hits} treff${r.cached ? " (mellomlager)" : ""}`);
  for (const p of r.parts) {
    console.log(`
${p.mpn} · ${p.maker}${p.pkg ? ` · ${p.pkg}` : ""}
  ${p.desc}
  Datablad: ${p.datasheet || "-"}
  ${p.url}`);
    for (const o of p.offers.slice(0, 5)) console.log(`  - ${o.seller}: ${o.price ?? "?"} ${o.currency}${o.qty > 1 ? ` (fra ${o.qty})` : ""}, lager ${o.stock ?? "?"}${o.sku ? `, ${o.sku}` : ""}`);
  }
  process.exit(0);
}

async function loadInventory() {
  if (file) return { data: JSON.parse(readFileSync(file, "utf8")), from: file };
  if (process.env.BF_INVENTORY_KEY) {
    const res = await fetch(`${WORKER}/inventory`, { headers: { Authorization: `Bearer ${process.env.BF_INVENTORY_KEY}` } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Workeren svarte ${res.status}: ${data.error || "ukjent feil"}. Lag en ny Claude-nøkkel på siden (Innstillinger → Konto og varsler).`);
    return { data, from: "Workeren (/inventory)" };
  }
  for (const dir of [join(homedir(), "Downloads"), join(homedir(), "Nedlastinger")]) {
    if (!existsSync(dir)) continue;
    const f = readdirSync(dir).filter((n) => /^lager-.*\.json$/.test(n)).map((n) => join(dir, n)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
    if (f) return { data: JSON.parse(readFileSync(f, "utf8")), from: f };
  }
  throw new Error("Fant ikke lageret. Sett BF_INVENTORY_KEY (Claude-nøkkel fra siden: Innstillinger → Konto og varsler), eller trykk «Eksporter lager for Claude» under Komponenter og bruk --file.");
}

// Delenummer og type fra sidens egen gjenkjenning (circuits.js), når eksporten ikke har det.
let findPart = null;
try { ({ findPart } = await import(new URL("../circuits.js", import.meta.url))); } catch { /* valgfritt */ }

const { data, from } = await loadInventory();
let items = (data.items || []).map((i) => {
  if (!i.part && findPart) { const f = findPart(i.title, i.mpn); if (f) Object.assign(i, { part: f.mpn, kind: f.kind, pins: f.pins?.join("-") || "", partPkg: f.pkg || "" }); }
  return i;
});
if (save) { writeFileSync(save, JSON.stringify(data, null, 1)); console.error(`Lagret ${data.count} varer i ${save}`); }
if (owner) items = items.filter((i) => i.owner.toLowerCase() === owner.toLowerCase());
if (cat) items = items.filter((i) => i.category === cat);
if (have) items = items.filter((i) => i.have > 0);

console.error(`Lager fra ${from}, eksportert ${data.exported}: ${data.count} varer, eiere: ${(data.owners || []).join(", ")}`);
if (summary) {
  const t = {};
  for (const i of items) { const k = i.categoryName || i.category || "?"; (t[k] ||= {})[i.owner] = ((t[k] ||= {})[i.owner] || 0) + 1; }
  for (const [k, v] of Object.entries(t).sort()) console.log(`${k.padEnd(34)} ${Object.entries(v).map(([o, n]) => `${o}: ${n}`).join(", ")}`);
  process.exit(0);
}
const terms = args.map((a) => a.toLowerCase());
const hay = (i) => `${i.part || ""} ${i.mpn} ${i.title} ${i.variant} ${i.kind || ""} ${i.pkg} ${i.categoryName || i.category}`.toLowerCase();
const show = (list) => {
  if (json) return console.log(JSON.stringify(list, null, 1));
  for (const i of list) {
    console.log([i.owner.padEnd(10), `${String(i.have).padStart(5)} stk`, (i.part || i.mpn || "-").padEnd(14), (i.pkg || i.partPkg || "").padEnd(9), (i.kind || "").padEnd(11), i.pins ? `pinner ${i.pins}`.padEnd(14) : "".padEnd(14), i.title.slice(0, 80), i.location ? `[${i.location}]` : ""].join(" | "));
  }
};
if (!terms.length) { show(items.slice(0, 60)); if (items.length > 60) console.error(`… ${items.length - 60} til. Søk med ord, eller bruk --json.`); }
for (const t of terms) {
  const hits = items.filter((i) => hay(i).includes(t)).sort((a, b) => b.have - a.have);
  console.log(`\n== «${t}»: ${hits.length} treff ==`);
  show(hits.slice(0, 40));
}
