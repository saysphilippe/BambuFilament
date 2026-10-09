// Lesernøkler for ESP32-leserne. En nøkkel ("rk_...") virker bare på Workerens /reader/*,
// i motsetning til en GitHub-token, som også gir tilgang til data-repoet og hele databasen.
// Workeren lagrer bare SHA-256 av nøkkelen i KV (reader:<hash>). Kjør fra repo-roten:
//   node scripts/reader-key.mjs ny "Leser i garasjen"   -> skriver ut nøkkelen én gang
//   node scripts/reader-key.mjs liste
//   node scripts/reader-key.mjs slett "Leser i garasjen"
// Nøkkelen limes inn som READER_KEY i firmware/BambuFilament/config.h.
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const WORKER_DIR = new URL("../worker/", import.meta.url);
const KV = ["--binding", "RESET_KV", "--remote"];

// npx.cmd på Windows (PowerShell blokkerer npx.ps1); shell kreves for .cmd-filer.
function wrangler(...args) {
  const win = process.platform === "win32";
  const quoted = win ? args.map((a) => (/^[\w:./-]+$/.test(a) ? a : `"${a}"`)) : args;
  return execFileSync(win ? "npx.cmd" : "npx", ["wrangler", ...quoted], {
    cwd: WORKER_DIR, encoding: "utf8", shell: win, stdio: ["ignore", "pipe", "inherit"],
  });
}

async function readers() {
  const keys = JSON.parse(wrangler("kv", "key", "list", "--prefix", "reader:", ...KV));
  return keys.map((k) => ({ key: k.name, ...JSON.parse(wrangler("kv", "key", "get", k.name, ...KV) || "{}") }));
}

const [cmd, name] = process.argv.slice(2);
if (cmd === "ny" && name) {
  if (!/^[\p{L}\p{N} ._-]{1,40}$/u.test(name)) throw new Error("Navnet kan ha 1–40 tegn: bokstaver, tall, mellomrom, punktum, bindestrek, understrek.");
  if ((await readers()).some((r) => r.name === name)) throw new Error(`Det finnes allerede en leser som heter «${name}».`);
  const key = "rk_" + randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(key).digest("hex");
  // Verdien går via en fil, så navnet ikke må gjennom skallet.
  const dir = mkdtempSync(join(tmpdir(), "reader-key-"));
  try {
    writeFileSync(join(dir, "v.json"), JSON.stringify({ name, added: new Date().toISOString() }));
    wrangler("kv", "key", "put", `reader:${hash}`, "--path", join(dir, "v.json"), ...KV);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log(`\nLesernøkkel for «${name}» (vises bare nå):\n\n  #define READER_KEY "${key}"\n`);
} else if (cmd === "liste") {
  const list = await readers();
  if (!list.length) console.log("Ingen lesernøkler.");
  for (const r of list) console.log(`${r.name || "(uten navn)"}  –  lagt til ${r.added || "?"}`);
} else if (cmd === "slett" && name) {
  const hit = (await readers()).filter((r) => r.name === name);
  if (!hit.length) throw new Error(`Fant ingen leser som heter «${name}».`);
  for (const r of hit) wrangler("kv", "key", "delete", r.key, ...KV);
  console.log(`Slettet nøkkelen til «${name}». Leseren får «Ukjent lesernøkkel» fra nå av.`);
} else {
  console.log('Bruk: node scripts/reader-key.mjs ny "Navn" | liste | slett "Navn"');
}
