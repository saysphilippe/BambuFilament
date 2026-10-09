// Pakketyper (kapsling) for komponenter: gjenkjenning fra tittel, variant og delenummer,
// og en liten SVG-illustrasjon av hver type. Illustrasjonene bruker currentColor for
// konturen, så de virker i lyst og mørkt tema; metall (bein og flater) er grått.

// Mønster -> pakkenavn. Første treff vinner, så de mest spesifikke står først.
const PKG_RULES = [
  [/\bTO-?247\b/i, "TO-247"], [/\bTO-?3P\b/i, "TO-3P"], [/\bTO-?3\b(?!\d)/i, "TO-3"],
  [/\bTO-?263\b|\bD2-?PAK\b/i, "TO-263"], [/\bTO-?252\b|\bD-?PAK\b/i, "TO-252"],
  [/\bTO-?220(F|AB)?\b/i, "TO-220"], [/\bTO-?126\b/i, "TO-126"], [/\bTO-?92\b/i, "TO-92"],
  [/\bSOT-?223\b/i, "SOT-223"], [/\bSOT-?89\b/i, "SOT-89"], [/\bSOT-?23-?6\b/i, "SOT-23-6"], [/\bSOT-?23-?5\b/i, "SOT-23-5"],
  [/\bSOT-?23\b/i, "SOT-23"], [/\bSOT-?363\b|\bSC-?70\b/i, "SOT-363"],
  [/\bSOD-?123\b/i, "SOD-123"], [/\bSOD-?323\b/i, "SOD-323"], [/\bSOD-?80\b|\bMiniMELF\b|\bLL-?34\b/i, "SOD-80"],
  [/\b(SMA|DO-?214AC)\b/i, "SMA"], [/\b(SMB|DO-?214AA)\b/i, "SMB"], [/\b(SMC|DO-?214AB)\b/i, "SMC"],
  [/\bDO-?41\b/i, "DO-41"], [/\bDO-?35\b/i, "DO-35"], [/\bDO-?201(AD)?\b/i, "DO-201"], [/\bDO-?15\b/i, "DO-15"],
  [/\b(TSSOP|HTSSOP)-?(\d{1,2})\b/i, (m) => `TSSOP-${m[2]}`], [/\bMSOP-?(\d{1,2})\b/i, (m) => `MSOP-${m[1]}`],
  [/\b(SOIC|SOP|SO)-?(\d{1,2})\b/i, (m) => `SOIC-${m[2]}`],
  [/\b(L?QFP|TQFP)-?(\d{2,3})\b/i, (m) => `${m[1].toUpperCase()}-${m[2]}`],
  [/\b(V?QFN|DFN)-?(\d{1,2})\b/i, (m) => `${m[1].toUpperCase()}-${m[2]}`],
  [/\b(P?DIP|DIL)-?(\d{1,2})\b/i, (m) => `DIP-${m[2]}`],
  [/\b(0201|0402|0603|0805|1206|1210|1812|2010|2512)\b(?!\s*(mm|pcs|stk|v\b))/i, (m) => m[1]],
  [/\b(3|5|8|10)\s?mm\b.*\b(led|diode)s?\b|\b(led|diode)s?\b.*\b(3|5|8|10)\s?mm\b/i, (m) => `LED ${m[1] || m[4]} mm`],
  [/\b18650\b/i, "18650"], [/\b21700\b/i, "21700"], [/\bCR2032\b/i, "CR2032"],
];

export function findPackage(...texts) {
  const t = texts.filter(Boolean).join(" ");
  for (const [re, name] of PKG_RULES) {
    const m = t.match(re);
    if (m) return typeof name === "function" ? name(m) : name;
  }
  return "";
}

const META = {
  "TO-92": "Liten plastpakke med tre bein, flat forside. Hullmontering.",
  "TO-220": "Effektpakke med metallflate og hull for kjøleribbe. Hullmontering.",
  "TO-126": "Middels effektpakke med hull. Hullmontering.",
  "TO-247": "Stor effektpakke for høy strøm. Hullmontering.",
  "TO-3P": "Stor effektpakke for høy strøm. Hullmontering.",
  "TO-3": "Metallhus for høy effekt, montert med skruer.",
  "TO-263": "D2PAK: overflatemontert effektpakke, flaten loddes til kortet.",
  "TO-252": "DPAK: mindre overflatemontert effektpakke.",
  "SOT-23": "Bitteliten SMD-pakke med tre bein (ca. 3 × 1,3 mm).",
  "SOT-23-5": "SOT-23 med fem bein.",
  "SOT-23-6": "SOT-23 med seks bein.",
  "SOT-363": "SC-70: enda mindre enn SOT-23, seks bein.",
  "SOT-89": "Liten SMD-effektpakke med flate under.",
  "SOT-223": "SMD-effektpakke med tre bein og bred flate (tab).",
  "SOD-123": "Liten SMD-diodepakke. Stripen er katoden.",
  "SOD-323": "Svært liten SMD-diodepakke. Stripen er katoden.",
  "SOD-80": "MiniMELF: sylindrisk SMD-diode. Stripen er katoden.",
  "SMA": "DO-214AC: SMD-diode/TVS. Stripen er katoden.",
  "SMB": "DO-214AA: større SMD-diode. Stripen er katoden.",
  "SMC": "DO-214AB: stor SMD-diode. Stripen er katoden.",
  "DO-41": "Aksial diode, hullmontering. Stripen er katoden.",
  "DO-35": "Liten aksial glassdiode. Stripen er katoden.",
  "DO-15": "Aksial diode, hullmontering. Stripen er katoden.",
  "DO-201": "Stor aksial diode for høy strøm. Stripen er katoden.",
  "18650": "Li-ion-celle, 18 mm × 65 mm, 3,6–4,2 V.",
  "21700": "Li-ion-celle, 21 mm × 70 mm, 3,6–4,2 V.",
  "CR2032": "Knappecelle, 3 V, 20 mm × 3,2 mm.",
};
const CHIP_MM = { "0201": "0,6 × 0,3", "0402": "1,0 × 0,5", "0603": "1,6 × 0,8", "0805": "2,0 × 1,25", "1206": "3,2 × 1,6", "1210": "3,2 × 2,5", "1812": "4,5 × 3,2", "2010": "5,0 × 2,5", "2512": "6,4 × 3,2" };

export function packageInfo(name) {
  if (!name) return "";
  if (CHIP_MM[name]) return `SMD-chip, ${CHIP_MM[name]} mm (tommekode ${name}).`;
  if (/^DIP-/.test(name)) return `${name.split("-")[1]} bein i to rader med 2,54 mm avstand. Hullmontering, passer i koblingsbrett.`;
  if (/^SOIC-/.test(name)) return `SMD med ${name.split("-")[1]} bein, 1,27 mm avstand.`;
  if (/^(TSSOP|MSOP)-/.test(name)) return `Tynn SMD med ${name.split("-")[1]} bein, 0,65 mm avstand.`;
  if (/QFP-/.test(name)) return `Firkantet SMD med ${name.split("-")[1]} bein på alle fire sider.`;
  if (/^(V?QFN|DFN)-/.test(name)) return `SMD uten bein: ${name.split("-")[1]} pads under kantene og en flate under.`;
  if (/^LED /.test(name)) return `${name.slice(4)} LED for hullmontering. Langt bein er anode (+).`;
  return META[name] || "";
}

// ---------- Illustrasjoner ----------
//
// Tegnet i et 64 × 64-rutenett. Kropp i mørk plast, metall i grått, kontur i currentColor.

const BODY = "#2b2d2c", METAL = "#a9b0ad", METAL_DARK = "#7d8582";
const leg = (x1, y1, x2, y2, w = 2.6) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${METAL}" stroke-width="${w}" stroke-linecap="round"/>`;
const dot1 = (x, y) => `<circle cx="${x}" cy="${y}" r="1.6" fill="#e6e8e7"/>`;

function art(name) {
  const n = Number((name.match(/-(\d+)$/) || [])[1]) || 0;
  if (name === "TO-92") return `${leg(24, 34, 22, 60)}${leg(32, 34, 32, 60)}${leg(40, 34, 42, 60)}
    <path d="M18 34 V18 a14 14 0 0 1 28 0 V34 Z" fill="${BODY}" stroke="currentColor" stroke-width="1"/>`;
  if (/^TO-(220|126|247|3P)$/.test(name)) {
    const big = /247|3P/.test(name);
    return `${leg(22, 40, 22, 62, big ? 3.4 : 2.6)}${leg(32, 40, 32, 62, big ? 3.4 : 2.6)}${leg(42, 40, 42, 62, big ? 3.4 : 2.6)}
      ${name === "TO-126" ? "" : `<rect x="${big ? 12 : 16}" y="2" width="${big ? 40 : 32}" height="20" rx="1.5" fill="${METAL}" stroke="currentColor" stroke-width="1"/><circle cx="32" cy="11" r="${big ? 4 : 3.5}" fill="var(--surface, #fff)" stroke="${METAL_DARK}"/>`}
      <rect x="${big ? 12 : 16}" y="${name === "TO-126" ? 10 : 18}" width="${big ? 40 : 32}" height="${name === "TO-126" ? 30 : 24}" rx="1.5" fill="${BODY}" stroke="currentColor" stroke-width="1"/>
      ${name === "TO-126" ? `<circle cx="32" cy="18" r="3" fill="var(--surface, #fff)" stroke="${METAL_DARK}"/>` : ""}`;
  }
  if (name === "TO-3") return `<ellipse cx="32" cy="32" rx="28" ry="18" fill="${METAL}" stroke="currentColor"/><circle cx="10" cy="32" r="3" fill="var(--surface, #fff)"/><circle cx="54" cy="32" r="3" fill="var(--surface, #fff)"/><circle cx="32" cy="32" r="12" fill="${METAL_DARK}" stroke="currentColor"/>`;
  if (/^TO-(263|252)$/.test(name)) {
    const w = name === "TO-263" ? 40 : 30;
    return `<rect x="${32 - w / 2 + 4}" y="6" width="${w - 8}" height="10" fill="${METAL}" stroke="currentColor" stroke-width="1"/>
      <rect x="${32 - w / 2}" y="14" width="${w}" height="30" rx="1.5" fill="${BODY}" stroke="currentColor" stroke-width="1"/>
      ${leg(32 - w / 4, 44, 32 - w / 4, 56, 4)}${leg(32 + w / 4, 44, 32 + w / 4, 56, 4)}`;
  }
  if (/^SOT-23/.test(name) || name === "SOT-363") {
    const pins = name === "SOT-23" ? [[24, 1], [40, 1], [32, -1]] : (name.endsWith("5") ? [[22, 1], [32, 1], [42, 1], [24, -1], [40, -1]] : [[22, 1], [32, 1], [42, 1], [22, -1], [32, -1], [42, -1]]);
    return pins.map(([x, d]) => leg(x, d > 0 ? 40 : 24, x, d > 0 ? 50 : 14, 3)).join("") + `<rect x="14" y="22" width="36" height="20" rx="2" fill="${BODY}" stroke="currentColor" stroke-width="1"/>${dot1(19, 37)}`;
  }
  if (name === "SOT-89") return `${leg(22, 40, 22, 54, 4)}${leg(42, 40, 42, 54, 4)}<rect x="26" y="34" width="12" height="22" fill="${METAL}" stroke="currentColor" stroke-width="1"/><rect x="14" y="16" width="36" height="26" rx="2" fill="${BODY}" stroke="currentColor" stroke-width="1"/>`;
  if (name === "SOT-223") return `<rect x="18" y="4" width="28" height="10" fill="${METAL}" stroke="currentColor" stroke-width="1"/>${leg(20, 44, 20, 58, 3.6)}${leg(32, 44, 32, 58, 3.6)}${leg(44, 44, 44, 58, 3.6)}<rect x="12" y="12" width="40" height="32" rx="2" fill="${BODY}" stroke="currentColor" stroke-width="1"/>`;
  if (/^(SOD|SMA|SMB|SMC)/.test(name) && name !== "SOD-80") {
    const w = name === "SMC" ? 40 : name === "SMB" ? 34 : 30;
    return `<rect x="${32 - w / 2 - 6}" y="26" width="${w + 12}" height="12" fill="${METAL}" stroke="currentColor" stroke-width="1"/><rect x="${32 - w / 2}" y="20" width="${w}" height="24" rx="2" fill="${BODY}" stroke="currentColor" stroke-width="1"/><rect x="${32 - w / 2 + 3}" y="20" width="4" height="24" fill="#e6e8e7"/>`;
  }
  if (/^(DO-|SOD-80)/.test(name)) {
    const glass = name === "DO-35" || name === "SOD-80";
    const w = name === "DO-201" ? 30 : name === "DO-35" || name === "SOD-80" ? 18 : 24, h = name === "DO-201" ? 18 : glass ? 9 : 12;
    return `${name === "SOD-80" ? "" : leg(2, 32, 62, 32)}<rect x="${32 - w / 2}" y="${32 - h / 2}" width="${w}" height="${h}" rx="${h / 2}" fill="${glass ? "#c9662f" : BODY}" fill-opacity="${glass ? 0.85 : 1}" stroke="currentColor" stroke-width="1"/><rect x="${32 + w / 2 - 6}" y="${32 - h / 2}" width="3" height="${h}" fill="${glass ? BODY : "#e6e8e7"}"/>`;
  }
  if (/^DIP-/.test(name) || /^(SOIC|TSSOP|MSOP)-/.test(name)) {
    const per = Math.max(2, Math.min(n / 2, 14)), dip = /^DIP/.test(name);
    const h = Math.max(24, per * 4 + 6), y0 = 32 - h / 2, bw = dip ? 28 : 22;
    let s = "";
    for (let i = 0; i < per; i++) {
      const y = y0 + 5 + i * ((h - 10) / Math.max(1, per - 1));
      s += leg(32 - bw / 2 - (dip ? 7 : 6), y, 32 - bw / 2, y, dip ? 2.6 : 2) + leg(32 + bw / 2, y, 32 + bw / 2 + (dip ? 7 : 6), y, dip ? 2.6 : 2);
    }
    return s + `<rect x="${32 - bw / 2}" y="${y0}" width="${bw}" height="${h}" rx="2" fill="${BODY}" stroke="currentColor" stroke-width="1"/><path d="M${32 - 4} ${y0} a4 4 0 0 0 8 0" fill="none" stroke="#e6e8e7" stroke-width="1.2"/>${dot1(32 - bw / 2 + 5, y0 + 6)}`;
  }
  if (/QFP-|QFN-|DFN-/.test(name)) {
    const qfn = /QFN|DFN/.test(name), side = Math.min(Math.max(2, Math.round(n / 4)), 10);
    let s = "";
    for (let i = 0; i < side; i++) {
      const p = 18 + i * (28 / Math.max(1, side - 1));
      if (qfn) s += `<rect x="${p - 1.2}" y="12" width="2.4" height="4" fill="${METAL}"/><rect x="${p - 1.2}" y="48" width="2.4" height="4" fill="${METAL}"/><rect x="12" y="${p - 1.2}" width="4" height="2.4" fill="${METAL}"/><rect x="48" y="${p - 1.2}" width="4" height="2.4" fill="${METAL}"/>`;
      else s += leg(p, 6, p, 14, 1.6) + leg(p, 50, p, 58, 1.6) + leg(6, p, 14, p, 1.6) + leg(50, p, 58, p, 1.6);
    }
    return `<rect x="${qfn ? 12 : 14}" y="${qfn ? 12 : 14}" width="${qfn ? 40 : 36}" height="${qfn ? 40 : 36}" rx="2" fill="${BODY}" stroke="currentColor" stroke-width="1"/>${s}${dot1(qfn ? 18 : 20, qfn ? 18 : 20)}`;
  }
  if (CHIP_MM[name]) {
    const scale = { "0201": 0.5, "0402": 0.6, "0603": 0.72, "0805": 0.82, "1206": 1, "1210": 1, "1812": 1.1, "2010": 1.15, "2512": 1.25 }[name];
    const w = 34 * scale, h = (name === "1210" || name === "1812" ? 22 : 16) * scale;
    return `<rect x="${32 - w / 2}" y="${32 - h / 2}" width="${w}" height="${h}" rx="1" fill="${BODY}" stroke="currentColor" stroke-width="1"/><rect x="${32 - w / 2}" y="${32 - h / 2}" width="${w * 0.2}" height="${h}" fill="${METAL}"/><rect x="${32 + w / 2 - w * 0.2}" y="${32 - h / 2}" width="${w * 0.2}" height="${h}" fill="${METAL}"/>`;
  }
  if (/^LED /.test(name)) return `${leg(27, 40, 27, 62)}${leg(37, 40, 37, 56)}<path d="M20 40 V22 a12 12 0 0 1 24 0 V40 Z" fill="#e5484d" fill-opacity=".85" stroke="currentColor" stroke-width="1"/><rect x="18" y="38" width="28" height="4" rx="1" fill="#e5484d" stroke="currentColor" stroke-width="1"/>`;
  if (name === "18650" || name === "21700") return `<rect x="10" y="20" width="44" height="24" rx="4" fill="#3b6fd8" stroke="currentColor" stroke-width="1"/><rect x="54" y="27" width="4" height="10" rx="1" fill="${METAL}"/><text x="30" y="36" font-size="9" font-weight="700" fill="#fff" text-anchor="middle" font-family="system-ui, sans-serif">${name}</text>`;
  if (name === "CR2032") return `<circle cx="32" cy="32" r="22" fill="${METAL}" stroke="currentColor"/><circle cx="32" cy="32" r="16" fill="none" stroke="${METAL_DARK}"/><text x="32" y="36" font-size="9" font-weight="700" fill="${BODY}" text-anchor="middle" font-family="system-ui, sans-serif">+</text>`;
  return "";
}

export function packageSvg(name, size = 64) {
  const a = art(name);
  if (!a) return "";
  return `<svg class="pkg-art" viewBox="0 0 64 64" width="${size}" height="${size}" role="img" aria-label="${name.replace(/"/g, "")}">${a}</svg>`;
}
