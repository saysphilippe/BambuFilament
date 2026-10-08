// Setter et nytt versjonsnummer på skript og stilark (?v=...), så nettlesere og
// GitHub Pages ikke serverer en gammel versjon etter en endring.
// Kjør før commit: node scripts/bump-version.mjs
import { readFile, writeFile } from "node:fs/promises";

const v = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
const files = {
  "index.html": [/(app\.js|style\.css)(\?v=\w+)?"/g, (_, f) => `${f}?v=${v}"`],
  "app.js": [/from "\.\/(bambu|auth)\.js(\?v=\w+)?"/g, (_, f) => `from "./${f}.js?v=${v}"`],
};
for (const [file, [re, fn]] of Object.entries(files)) {
  const text = await readFile(file, "utf8");
  await writeFile(file, text.replace(re, fn));
}
console.log(`Versjon ${v}`);
