// Pakkestørrelse: hvor mange stk én kjøpt enhet inneholder («12pcs», «100PCS/lot», «Pack of 10»).
// Varianten er mest presis (den er det som faktisk ble valgt); tittelen brukes bare når den
// ikke lister flere valg («1/3/5pcs», «20-100PCS»). Mouser og LCSC oppgir antall stk direkte.

const UNIT = "(?:pcs|pc|pieces?|stk|units?|sets?|pairs?|rolls?|sheets?)";
const VARIANT_RES = [
  new RegExp(`(?:^|[^\\d.])(\\d{1,6})\\s*-?\\s*${UNIT}\\b`, "i"),
  /(?:pack|lot|bag|box|set)\s*(?:of)?\s*(\d{1,6})\b/i,
  /\b(\d{1,6})\s*-?\s*(?:pack|pk)\b/i,
  /\bx\s*(\d{1,4})\b(?!\s*(?:mm|cm|m\b))/i,
];
const TITLE_RES = [
  new RegExp(`(?:^|[^\\d.\\/~-])(\\d{1,6})\\s*-?\\s*${UNIT}\\s*(?:\\/\\s*(?:lot|set|pack|bag|box))?\\b`, "i"),
  /\b(?:pack|lot|bag|box|set)\s+of\s+(\d{1,6})\b/i,
  /\b(\d{1,6})\s*-?\s*(?:pack|pk)\b/i,
];
// Flere valg i samme tittel: «1/3/5pcs», «10-100PCS», «20~50pcs», «1-10PCS».
const CHOICES = new RegExp(`\\d+\\s*(?:pcs|pc)?\\s*[\\/~-]\\s*\\d+\\s*(?:[\\/~-]\\s*\\d+\\s*)*${UNIT}`, "i");

export function detectPack(variant = "", title = "") {
  for (const re of VARIANT_RES) {
    const m = String(variant).match(re);
    if (m) return sane(m[1]);
  }
  const t = String(title);
  if (CHOICES.test(t)) return 1;
  for (const re of TITLE_RES) {
    const m = t.match(re);
    if (m) return sane(m[1]);
  }
  return 1;
}

const sane = (n) => {
  n = Number(n);
  return Number.isFinite(n) && n >= 1 && n <= 100000 ? Math.round(n) : 1;
};
