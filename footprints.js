// Fotavtrykk (land pattern) for pakketyper, tegnet slik bransjen gjør det: sett ovenfra, i
// målestokk (mm), med kobberpads, borehull for hullmonterte deler, silketrykk-omriss og
// markering av pinne 1. Målene er nominelle etter IPC-7351, som KiCads standardbibliotek.
// Brukes på kortene (lite) og i detaljvinduet (med pinnenummer og mål).

const COPPER = "#c99a2e", COPPER_EDGE = "#8a6a1c";

// ---------- Byggeklosser (alt i mm) ----------

// To pads i hver ende (chip-motstander, kondensatorer, SMD-dioder).
const chip = (c, pw, ph, bw, bh, polar = false) => ({
  pads: [{ n: 1, x: -c, y: 0, w: pw, h: ph }, { n: 2, x: c, y: 0, w: pw, h: ph }],
  body: { w: bw, h: bh }, polar, pitch: 2 * c, pad: [pw, ph],
});

// To rader med pads (SOIC, TSSOP, MSOP, SOT-23-5/6). Pinne 1 øverst til venstre, nummerert mot klokka.
function dual(n, pitch, rowX, pw, ph, bw, bh) {
  const per = n / 2, pads = [];
  for (let i = 0; i < per; i++) pads.push({ n: i + 1, x: -rowX, y: (i - (per - 1) / 2) * pitch, w: pw, h: ph });
  for (let i = 0; i < per; i++) pads.push({ n: per + i + 1, x: rowX, y: ((per - 1) / 2 - i) * pitch, w: pw, h: ph });
  return { pads, body: { w: bw, h: bh }, pin1: true, pitch, pad: [pw, ph] };
}

// Hullmontert DIP: 2,54 mm mellom pinnene, 7,62 mm mellom radene, pinne 1 med firkantet pad.
function dip(n) {
  const per = n / 2, pads = [];
  for (let i = 0; i < per; i++) pads.push({ n: i + 1, x: -3.81, y: (i - (per - 1) / 2) * 2.54, w: 1.6, h: 1.6, shape: i ? "round" : "rect", drill: 0.8 });
  for (let i = 0; i < per; i++) pads.push({ n: per + i + 1, x: 3.81, y: ((per - 1) / 2 - i) * 2.54, w: 1.6, h: 1.6, shape: "round", drill: 0.8 });
  return { pads, body: { w: 6.35, h: per * 2.54 + 0.4 }, notch: true, pitch: 2.54, pad: [1.6, 1.6], drill: 0.8 };
}

// Pads på alle fire sider (QFN, QFP). Pinne 1 øverst på venstre side, mot klokka.
function quad(n, pitch, body, padL, padW, padCenter, exposed = 0) {
  const per = n / 4, pads = [], off = (i) => (i - (per - 1) / 2) * pitch;
  for (let i = 0; i < per; i++) pads.push({ n: i + 1, x: -padCenter, y: off(i), w: padL, h: padW });
  for (let i = 0; i < per; i++) pads.push({ n: per + i + 1, x: off(i), y: padCenter, w: padW, h: padL });
  for (let i = 0; i < per; i++) pads.push({ n: 2 * per + i + 1, x: padCenter, y: -off(i), w: padL, h: padW });
  for (let i = 0; i < per; i++) pads.push({ n: 3 * per + i + 1, x: -off(i), y: -padCenter, w: padW, h: padL });
  if (exposed) pads.push({ n: n + 1, x: 0, y: 0, w: exposed, h: exposed, ep: true });
  return { pads, body: { w: body, h: body }, pin1: true, pitch, pad: [padL, padW] };
}

// Hullmonterte pinner på rekke (TO-92, TO-220 …). Pinne 1 firkantet.
function inline(n, pitch, padW, padH, drill, bw, bh, bodyY = 0, tab = 0) {
  const pads = [];
  for (let i = 0; i < n; i++) pads.push({ n: i + 1, x: (i - (n - 1) / 2) * pitch, y: 0, w: padW, h: padH, shape: i ? "oval" : "rect", drill });
  return { pads, body: { w: bw, h: bh, y: bodyY }, tab, pitch, pad: [padW, padH], drill };
}

// Aksiale komponenter (dioder, motstander) med pinneavstand s.
const axial = (s, d, drill, bw, bh) => ({
  pads: [{ n: 1, x: -s / 2, y: 0, w: d, h: d, shape: "rect", drill }, { n: 2, x: s / 2, y: 0, w: d, h: d, shape: "round", drill }],
  body: { w: bw, h: bh }, polar: true, pitch: s, pad: [d, d], drill, axialLeads: true,
});

// ---------- Fotavtrykk per pakke ----------

const CHIPS = {
  "0201": chip(0.32, 0.46, 0.4, 0.6, 0.3), "0402": chip(0.485, 0.59, 0.64, 1.0, 0.5),
  "0603": chip(0.825, 0.8, 0.95, 1.6, 0.8), "0805": chip(0.9125, 1.025, 1.4, 2.0, 1.25),
  "1206": chip(1.4625, 1.125, 1.75, 3.2, 1.6), "1210": chip(1.4625, 1.125, 2.65, 3.2, 2.5),
  "1812": chip(2.1, 1.3, 3.4, 4.5, 3.2), "2010": chip(2.4, 1.4, 2.65, 5.0, 2.5), "2512": chip(2.8625, 1.525, 3.35, 6.3, 3.2),
};

const FIXED = {
  "SOT-23": { pads: [{ n: 1, x: -1.1375, y: -0.95, w: 1.475, h: 0.6 }, { n: 2, x: -1.1375, y: 0.95, w: 1.475, h: 0.6 }, { n: 3, x: 1.1375, y: 0, w: 1.475, h: 0.6 }], body: { w: 1.3, h: 2.9 }, pin1: true, pitch: 0.95, pad: [1.475, 0.6] },
  "SOT-23-5": dual(6, 0.95, 1.1375, 1.325, 0.6, 1.6, 2.9),
  "SOT-23-6": dual(6, 0.95, 1.1375, 1.325, 0.6, 1.6, 2.9),
  "SOT-363": dual(6, 0.65, 0.95, 0.9, 0.4, 1.25, 2.0),
  "SOT-89": { pads: [{ n: 1, x: -1.5, y: 1.7, w: 0.7, h: 1.2 }, { n: 2, x: 0, y: 1.7, w: 0.7, h: 1.2 }, { n: 3, x: 1.5, y: 1.7, w: 0.7, h: 1.2 }, { n: 2, x: 0, y: -0.6, w: 1.8, h: 2.8, ep: true }], body: { w: 4.5, h: 2.5 }, pin1: true, pitch: 1.5, pad: [0.7, 1.2] },
  "SOT-223": { pads: [{ n: 1, x: -3.15, y: -2.3, w: 2.0, h: 1.5 }, { n: 2, x: -3.15, y: 0, w: 2.0, h: 1.5 }, { n: 3, x: -3.15, y: 2.3, w: 2.0, h: 1.5 }, { n: 4, x: 3.15, y: 0, w: 2.0, h: 3.8, ep: true }], body: { w: 3.5, h: 6.5 }, pin1: true, pitch: 2.3, pad: [2.0, 1.5] },
  "TO-252": { pads: [{ n: 1, x: -2.28, y: 4.7, w: 1.6, h: 3.0 }, { n: 3, x: 2.28, y: 4.7, w: 1.6, h: 3.0 }, { n: 2, x: 0, y: -1.6, w: 6.4, h: 5.8, ep: true }], body: { w: 6.6, h: 6.1, y: -0.6 }, pin1: true, pitch: 4.56, pad: [1.6, 3.0] },
  "TO-263": { pads: [{ n: 1, x: -2.54, y: 6.6, w: 1.8, h: 3.5 }, { n: 3, x: 2.54, y: 6.6, w: 1.8, h: 3.5 }, { n: 2, x: 0, y: -1.8, w: 10.8, h: 9.4, ep: true }], body: { w: 10.2, h: 9.2, y: -1.2 }, pin1: true, pitch: 5.08, pad: [1.8, 3.5] },
  "SOD-123": chip(1.635, 0.91, 1.22, 2.7, 1.6, true), "SOD-323": chip(1.05, 0.6, 0.45, 1.7, 1.25, true),
  "SOD-80": chip(1.75, 1.2, 1.9, 3.5, 1.5, true), "SMA": chip(2.0, 1.5, 1.7, 4.3, 2.6, true),
  "SMB": chip(2.15, 2.0, 2.5, 4.6, 3.6, true), "SMC": chip(3.4, 2.4, 3.3, 6.9, 5.9, true),
  "DO-35": axial(7.62, 1.6, 0.8, 3.8, 1.8), "DO-41": axial(10.16, 2.0, 1.0, 5.2, 2.7),
  "DO-15": axial(12.7, 2.4, 1.2, 7.6, 3.6), "DO-201": axial(15.24, 3.0, 1.5, 9.5, 5.3),
  "TO-92": { ...inline(3, 1.27, 1.05, 1.5, 0.75, 4.8, 3.8, -0.6), flatFront: true },
  "TO-220": inline(3, 2.54, 1.905, 2.0, 1.2, 10.0, 4.6, -1.4, 1.3),
  "TO-126": inline(3, 2.28, 1.8, 2.0, 1.2, 8.0, 3.2, -1.0),
  "TO-247": inline(3, 5.45, 2.5, 3.0, 1.4, 16.0, 5.0, -1.5, 1.8),
  "TO-3P": inline(3, 5.45, 2.5, 3.0, 1.4, 15.6, 4.8, -1.5, 1.6),
};

function spec(name) {
  if (CHIPS[name]) return CHIPS[name];
  if (FIXED[name]) return FIXED[name];
  const n = Number((name.match(/-(\d+)$/) || [])[1]) || 0;
  if (/^DIP-/.test(name) && n >= 4) return dip(n);
  if (/^SOIC-/.test(name) && n >= 4) return dual(n, 1.27, 2.475, 1.95, 0.6, 3.9, (n / 2) * 1.27 + 0.1);
  if (/^TSSOP-/.test(name) && n >= 4) return dual(n, 0.65, 2.8625, 1.475, 0.4, 4.4, (n / 2) * 0.65 + 0.4);
  if (/^MSOP-/.test(name) && n >= 4) return n >= 10 ? dual(n, 0.5, 2.2, 1.47, 0.3, 3.0, 3.0) : dual(n, 0.65, 2.2, 1.47, 0.41, 3.0, 3.0);
  if (/^(V?QFN|DFN)-/.test(name) && n >= 8) {
    const body = n <= 16 ? 3 : n <= 24 ? 4 : n <= 32 ? 5 : n <= 48 ? 7 : n <= 56 ? 8 : 9;
    return quad(n - (n % 4), 0.5, body, 0.8, 0.25, body / 2 - 0.05, body - 1.6);
  }
  if (/QFP-/.test(name) && n >= 16) {
    const [pitch, body] = n <= 32 ? [0.8, 7] : n <= 44 ? [0.8, 10] : n <= 48 ? [0.5, 7] : n <= 64 ? [0.5, 10] : n <= 100 ? [0.5, 14] : [0.5, 20];
    return quad(n - (n % 4), pitch, body, 1.5, pitch * 0.6, body / 2 + 0.75);
  }
  const led = name.match(/^LED (\d+) mm$/);
  if (led) {
    const d = Number(led[1]);
    return { pads: [{ n: 1, x: -1.27, y: 0, w: 1.8, h: 1.8, shape: "rect", drill: 0.9 }, { n: 2, x: 1.27, y: 0, w: 1.8, h: 1.8, shape: "round", drill: 0.9 }], body: { w: d, h: d }, ledRing: d, pitch: 2.54, pad: [1.8, 1.8], drill: 0.9, note: "Pad 1 (firkantet) er katode K, pad 2 er anode A; den flate kanten på F.SilkS er katodesiden." };
  }
  return null;
}

// ---------- Tegning ----------

const fmt = (v) => String(Math.round(v * 100) / 100).replace(".", ",");

export function hasFootprint(name) {
  return !!spec(name);
}

// size: bredde i px. detail: pinnenummer og mål i figuren.
export function footprintSvg(name, size = 64, { detail = false } = {}) {
  const s = spec(name);
  if (!s) return "";
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const grow = (x1, y1, x2, y2) => { minX = Math.min(minX, x1); maxX = Math.max(maxX, x2); minY = Math.min(minY, y1); maxY = Math.max(maxY, y2); };
  for (const p of s.pads) grow(p.x - p.w / 2, p.y - p.h / 2, p.x + p.w / 2, p.y + p.h / 2);
  const by = s.body.y || 0;
  grow(-s.body.w / 2, by - s.body.h / 2, s.body.w / 2, by + s.body.h / 2);
  if (s.ledRing) grow(-s.ledRing / 2 - 0.6, -s.ledRing / 2 - 0.6, s.ledRing / 2 + 0.6, s.ledRing / 2 + 0.6);
  const span = Math.max(maxX - minX, maxY - minY);
  const m = span * 0.12 + (detail ? span * 0.08 : 0);
  const vb = [minX - m, minY - m, maxX - minX + 2 * m, maxY - minY + 2 * m + (detail ? span * 0.14 : 0)];
  const line = Math.max(span / 90, 0.04);
  let g = "";
  // Silketrykk: omriss av komponenten (KiCad-stil: tynn strek)
  if (s.ledRing) {
    const r = s.ledRing / 2;
    // Flat kant på katodesiden (pinne 1, venstre), slik LED-er er merket
    g += `<path d="M ${-r * 0.866} ${-r / 2} A ${r} ${r} 0 1 1 ${-r * 0.866} ${r / 2} Z" fill="none" stroke="currentColor" stroke-width="${line * 1.5}"/>`;
  } else if (s.flatFront) {
    const r = s.body.w / 2;
    g += `<path d="M ${-r} ${by + s.body.h / 2 - 0.4} A ${r} ${r} 0 1 1 ${r} ${by + s.body.h / 2 - 0.4} Z" fill="none" stroke="currentColor" stroke-width="${line * 1.5}"/>`;
  } else {
    g += `<rect x="${-s.body.w / 2}" y="${by - s.body.h / 2}" width="${s.body.w}" height="${s.body.h}" fill="none" stroke="currentColor" stroke-width="${line * 1.5}"/>`;
  }
  if (s.tab) g += `<line x1="${-s.body.w / 2}" y1="${by - s.body.h / 2 + s.tab}" x2="${s.body.w / 2}" y2="${by - s.body.h / 2 + s.tab}" stroke="currentColor" stroke-width="${line}"/>`;
  // DIP: halvsirkel-hakk i kortenden ved pinne 1
  if (s.notch) g += `<path d="M -0.8 ${-s.body.h / 2} A 0.8 0.8 0 0 0 0.8 ${-s.body.h / 2}" fill="none" stroke="currentColor" stroke-width="${line * 1.5}"/>`;
  // Dioder: katodestrek ved pinne 1 (venstre), inne i omrisset
  if (s.polar) { const kx = -s.body.w / 2 + s.body.w * 0.16; g += `<line x1="${kx}" y1="${by - s.body.h / 2}" x2="${kx}" y2="${by + s.body.h / 2}" stroke="currentColor" stroke-width="${line * 3}"/>`; }
  if (s.axialLeads) g += `<line x1="${-s.pitch / 2}" y1="0" x2="${s.pitch / 2}" y2="0" stroke="currentColor" stroke-width="${line}" stroke-dasharray="${line * 3} ${line * 2}"/>`;
  // Pinne 1-markering: prikk utenfor pinne 1
  const p1 = s.pads.find((p) => p.n === 1);
  if (p1 && (s.pin1 || s.notch)) {
    const dx = p1.x < 0 ? -1 : 1;
    const horizontal = p1.w >= p1.h;
    const cx = horizontal ? p1.x - dx * (p1.w / 2 + span * 0.05) : p1.x;
    const cy = horizontal ? p1.y : p1.y + (p1.y < 0 ? -1 : 1) * (p1.h / 2 + span * 0.05);
    g += `<circle cx="${cx}" cy="${cy}" r="${Math.max(span * 0.025, 0.12)}" fill="currentColor"/>`;
  }
  // Kobberpads (og borehull for hullmonterte)
  for (const p of s.pads) {
    const rx = p.shape === "round" ? p.w / 2 : p.shape === "oval" ? Math.min(p.w, p.h) / 2 : Math.min(p.w, p.h) * 0.12;
    g += `<rect x="${p.x - p.w / 2}" y="${p.y - p.h / 2}" width="${p.w}" height="${p.h}" rx="${rx}" fill="${COPPER}" stroke="${COPPER_EDGE}" stroke-width="${line * 0.6}"${p.ep ? ' fill-opacity=".85"' : ""}/>`;
    if (p.drill) g += `<circle cx="${p.x}" cy="${p.y}" r="${p.drill / 2}" fill="var(--surface, #fff)" stroke="${COPPER_EDGE}" stroke-width="${line * 0.4}"/>`;
    if (detail && !p.ep && s.pads.length <= 40) {
      const fs = Math.min(p.w, p.h, s.pitch || 1) * 0.55;
      g += `<text x="${p.x}" y="${p.y + fs * 0.36}" font-size="${fs}" font-family="ui-monospace, Consolas, monospace" font-weight="700" text-anchor="middle" fill="#2a2108">${p.n}</text>`;
    }
  }
  // Mål: pinneavstand under figuren
  if (detail && s.pitch) {
    const y = maxY + m * 0.6 + span * 0.04;
    const fs = vb[2] * 0.065; // samme størrelse på skjermen uansett pakke
    g += `<text x="${(minX + maxX) / 2}" y="${y + fs}" font-size="${fs}" font-family="ui-monospace, Consolas, monospace" text-anchor="middle" fill="currentColor">P${fmt(s.pitch)} mm</text>`;
  }
  const h = Math.round(size * (vb[3] / vb[2]));
  return `<svg class="fp-art" viewBox="${vb.map((v) => +v.toFixed(3)).join(" ")}" width="${size}" height="${Math.min(h, size * 1.6)}" role="img" aria-label="Fotavtrykk ${name.replace(/"/g, "")}">${g}</svg>`;
}

// ---------- KiCad-navn ----------
//
// Navnet på tilsvarende fotavtrykk i KiCads standardbibliotek («Bibliotek:Fotavtrykk»).
// hint: «R», «C», «L», «D» eller «LED» for chip-størrelser (0603 osv.), som KiCad skiller på.
const METRIC = { "0201": "0603", "0402": "1005", "0603": "1608", "0805": "2012", "1206": "3216", "1210": "3225", "1812": "4532", "2010": "5025", "2512": "6332" };
const SOIC_LEN = { 8: "4.9", 14: "8.7", 16: "9.9" };
const TSSOP_LEN = { 8: "3", 14: "5", 16: "5", 20: "6.5", 24: "7.8", 28: "9.7" };
const kfmt = (v) => String(Math.round(v * 100) / 100);

export function kicadName(name, hint = "R") {
  const s = spec(name);
  if (!s) return "";
  const n = Number((name.match(/-(\d+)$/) || [])[1]) || 0;
  if (METRIC[name]) {
    const lib = { R: "Resistor_SMD", C: "Capacitor_SMD", L: "Inductor_SMD", D: "Diode_SMD", LED: "LED_SMD" }[hint] || "Resistor_SMD";
    return `${lib}:${hint === "LED" ? "LED" : hint}_${name}_${METRIC[name]}Metric`;
  }
  const fixed = {
    "SOT-23": "Package_TO_SOT_SMD:SOT-23", "SOT-23-5": "Package_TO_SOT_SMD:SOT-23-5", "SOT-23-6": "Package_TO_SOT_SMD:SOT-23-6",
    "SOT-363": "Package_TO_SOT_SMD:SOT-363_SC-70-6", "SOT-89": "Package_TO_SOT_SMD:SOT-89-3", "SOT-223": "Package_TO_SOT_SMD:SOT-223-3_TabPin2",
    "TO-252": "Package_TO_SOT_SMD:TO-252-2", "TO-263": "Package_TO_SOT_SMD:TO-263-2",
    "SOD-123": "Diode_SMD:D_SOD-123", "SOD-323": "Diode_SMD:D_SOD-323", "SOD-80": "Diode_SMD:D_MiniMELF",
    "SMA": "Diode_SMD:D_SMA", "SMB": "Diode_SMD:D_SMB", "SMC": "Diode_SMD:D_SMC",
    "DO-35": "Diode_THT:D_DO-35_SOD27_P7.62mm_Horizontal", "DO-41": "Diode_THT:D_DO-41_SOD81_P10.16mm_Horizontal",
    "DO-15": "Diode_THT:D_DO-15_P12.70mm_Horizontal", "DO-201": "Diode_THT:D_DO-201AD_P15.24mm_Horizontal",
    "TO-92": "Package_TO_SOT_THT:TO-92_Inline", "TO-220": "Package_TO_SOT_THT:TO-220-3_Vertical", "TO-126": "Package_TO_SOT_THT:TO-126-3_Vertical",
    "TO-247": "Package_TO_SOT_THT:TO-247-3_Vertical", "TO-3P": "Package_TO_SOT_THT:TO-3P-3_Vertical",
  }[name];
  if (fixed) return fixed;
  if (/^DIP-/.test(name)) return `Package_DIP:DIP-${n}_W7.62mm`;
  if (/^SOIC-/.test(name)) return `Package_SO:SOIC-${n}_3.9x${SOIC_LEN[n] || kfmt(n / 2 * 1.27 + 0.1)}mm_P1.27mm`;
  if (/^TSSOP-/.test(name)) return `Package_SO:TSSOP-${n}_4.4x${TSSOP_LEN[n] || kfmt(n / 2 * 0.65 + 0.4)}mm_P0.65mm`;
  if (/^MSOP-/.test(name)) return `Package_SO:MSOP-${n}_3x3mm_P${n >= 10 ? "0.5" : "0.65"}mm`;
  if (/QFN-|DFN-/.test(name)) { const b = s.body.w, ep = s.pads.find((p) => p.ep); return `Package_DFN_QFN:${name.split("-")[0]}-${n}-1EP_${b}x${b}mm_P${kfmt(s.pitch)}mm${ep ? `_EP${kfmt(ep.w)}x${kfmt(ep.w)}mm` : ""}`; }
  if (/QFP-/.test(name)) return `Package_QFP:${name.split("-")[0]}-${n}_${s.body.w}x${s.body.w}mm_P${kfmt(s.pitch)}mm`;
  const led = name.match(/^LED (\d+) mm$/);
  if (led) return `LED_THT:LED_D${led[1]}.0mm`;
  return "";
}

// Tekst under fotavtrykket i detaljvinduet, med KiCads betegnelser.
export function footprintCaption(name, hint) {
  const s = spec(name);
  if (!s) return "";
  const parts = [];
  if (s.pad) parts.push(`Pad (F.Cu) ${fmt(s.pad[0])} × ${fmt(s.pad[1])} mm`);
  if (s.drill) parts.push(`Drill ${fmt(s.drill)} mm`);
  if (s.pitch) parts.push(`Pitch P${fmt(s.pitch)} mm`);
  const mark = s.note ? ` ${s.note}` : (s.pin1 || s.notch) ? " Pin 1 er markert med prikk på F.SilkS." : s.polar ? " Katoden (pin 1) er markert med strek på F.SilkS." : "";
  return `${parts.join(" · ")}. Sett ovenfra, nominelle mål (IPC-7351).${mark}`;
}
