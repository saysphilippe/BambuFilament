// Datablad og koblingsskjema for elektroniske komponenter i komponentbiblioteket.
//
// Delenummeret finnes i tittelen (eller Mouser-nummeret). Ut fra det velges en mal for typisk
// bruk (transistor som bryter, spenningsregulator, 555-oscillator, I2C-modul osv.) og en
// pinnerekkefølge. Skjemaene er inline SVG med currentColor, så de virker i lyst og mørkt tema.
// Stil: strøm øverst, jord nederst, signal fra venstre mot høyre, verdier på alle deler.

// ---------- Delenummer ----------

// Mønstre for delenumre vi kjenner igjen, med type og pinnerekkefølge.
// pins: rekkefølgen sett forfra (TO-92: flat side mot deg, bena ned; TO-220: forsiden, bena ned).
const PARTS = [
  // NPN
  [/\b(PN2222A?|2N2222A?|MMBT2222A?)\b/i, { kind: "npn", pkg: "TO-92", pins: ["E", "B", "C"], note: "Opptil 600 mA. MMBT2222 er SOT-23: 1 = B, 2 = E, 3 = C." }],
  [/\b(2N3904|MMBT3904)\b/i, { kind: "npn", pkg: "TO-92", pins: ["E", "B", "C"], note: "Opptil 200 mA." }],
  [/\b(BC54[6-9][A-C]?|BC33[78](-\d+)?)\b/i, { kind: "npn", pkg: "TO-92", pins: ["C", "B", "E"], note: "Opptil 100 mA (BC337: 800 mA). Merk: C-B-E, motsatt av 2N2222." }],
  [/\b(S8050|S9013|S9014|S9018|SS8050)\b/i, { kind: "npn", pkg: "TO-92", pins: ["E", "B", "C"], note: "S8050: opptil 500 mA." }],
  [/\b(TIP12[0-2]|TIP3[15][A-C]?|TIP41[A-C]?|BD13[5-9]|MJE13005)\b/i, { kind: "npn", pkg: "TO-220", pins: ["B", "C", "E"], note: "Effekttransistor. TIP120–122 er Darlington (ca. 1,4 V fall B–E)." }],
  [/\b2SC\d{3,4}\b/i, { kind: "npn", pkg: "TO-92", pins: ["E", "C", "B"], note: "Japanske 2SC-transistorer har ofte E-C-B. Sjekk databladet." }],
  // PNP
  [/\b(2N3906|MMBT3906)\b/i, { kind: "pnp", pkg: "TO-92", pins: ["E", "B", "C"], note: "Opptil 200 mA." }],
  [/\b(2N2907A?)\b/i, { kind: "pnp", pkg: "TO-92", pins: ["E", "B", "C"], note: "Opptil 600 mA." }],
  [/\b(BC55[6-9][A-C]?|BC32[78](-\d+)?)\b/i, { kind: "pnp", pkg: "TO-92", pins: ["C", "B", "E"], note: "Merk: C-B-E." }],
  [/\b(S8550|S9012|S9015|SS8550)\b/i, { kind: "pnp", pkg: "TO-92", pins: ["E", "B", "C"], note: "S8550: opptil 500 mA." }],
  [/\b(TIP12[5-7]|TIP3[26][A-C]?|TIP42[A-C]?)\b/i, { kind: "pnp", pkg: "TO-220", pins: ["B", "C", "E"], note: "Effekttransistor (PNP)." }],
  // N-MOSFET
  [/\b(IRLZ44N?|IRLZ34N?|IRLB8721|IRL540N?|IRL3705N?|IRLR7843)\b/i, { kind: "nmos", pkg: "TO-220", pins: ["G", "D", "S"], logic: true, note: "Logikknivå: slår helt på med 3,3–5 V på gate." }],
  [/\b(IRF520N?|IRF540N?|IRFZ44N?|IRF3205|IRF840|IRFP\d+|IRF1404)\b/i, { kind: "nmos", pkg: "TO-220", pins: ["G", "D", "S"], logic: false, note: "Ikke logikknivå: trenger ca. 10 V på gate for å slå helt på. Fra 3,3 V blir den varm. Bruk IRLZ44N eller en gate-driver." }],
  [/\b(AO3400A?|SI2302|SI2300|A2SHB|AO3402)\b/i, { kind: "nmos", pkg: "SOT-23", pins: ["G", "S", "D"], logic: true, note: "Logikknivå, SMD. Pinne 1 = G, 2 = S, 3 = D." }],
  [/\b(2N7000|2N7002)\b/i, { kind: "nmos", pkg: "TO-92", pins: ["S", "G", "D"], logic: true, note: "Små laster, opptil 200 mA. 2N7002 er SOT-23." }],
  [/\bBS170\b/i, { kind: "nmos", pkg: "TO-92", pins: ["D", "G", "S"], logic: true, note: "Merk: D-G-S, motsatt av 2N7000." }],
  // P-MOSFET
  [/\b(AO3401A?|SI2301|A1SHB|AO3407)\b/i, { kind: "pmos", pkg: "SOT-23", pins: ["G", "S", "D"], note: "P-kanal, SMD. Pinne 1 = G, 2 = S, 3 = D." }],
  [/\b(IRF9540N?|IRF9Z34N?|IRF4905|IRF5305)\b/i, { kind: "pmos", pkg: "TO-220", pins: ["G", "D", "S"], note: "P-kanal, ikke logikknivå." }],
  // Spenningsregulatorer
  [/\b(L?M?78(0[5-9]|1[25]|24)|LM78\d\d|L78\d\d)\b/i, { kind: "reg78", pkg: "TO-220", pins: ["IN", "GND", "OUT"], note: "Inn minst ca. 2 V over utgangen. Effekttap = (Vinn − Vut) × strøm, så bruk kjøleribbe." }],
  [/\b(AMS1117|LM1117|LD1117)(-?\d\.\d|-ADJ)?\b/i, { kind: "reg1117", pkg: "SOT-223", pins: ["GND/ADJ", "OUT", "IN"], note: "Lavt spenningsfall (ca. 1,1 V). Kjøleflaten (tab) er OUT." }],
  [/\bLM317\b/i, { kind: "lm317", pkg: "TO-220", pins: ["ADJ", "OUT", "IN"], note: "Justerbar: Vut = 1,25 × (1 + R2/R1)." }],
  // IC-er
  [/\b(NE555|LM555|NA555|SA555|TLC555|ICM7555)\b/i, { kind: "ne555", pkg: "DIP-8", pins: ["GND", "TRIG", "OUT", "RESET", "CTRL", "THR", "DIS", "VCC"], note: "Pinne 1 er ved prikken/hakket, tell mot klokka sett ovenfra." }],
  [/\b(PC817|EL817|LTV817|PC817C)\b/i, { kind: "opto", pkg: "DIP-4", pins: ["A", "K", "E", "C"], note: "Galvanisk skille mellom to kretser. LED-side: 1 = anode, 2 = katode." }],
  [/\b(ULN2003A?|ULN2803A?)\b/i, { kind: "uln", pkg: "DIP-16", pins: [], note: "7 Darlington-drivere med innebygde flyback-dioder. COM (pinne 9) til lastens pluss." }],
  // Dioder
  [/\b(1N400[1-7]|1N540[0-8]|M7|UF400\d)\b/i, { kind: "diode", pkg: "DO-41", pins: ["A", "K"], note: "Stripen er katoden (K)." }],
  [/\b(1N58(1[7-9])|SS(1[0-9]|3[0-9]|5[0-9])|SB560|SR560)\b/i, { kind: "schottky", pkg: "DO-41/SMA", pins: ["A", "K"], note: "Schottky: lavt spenningsfall (ca. 0,3–0,5 V). Stripen er katoden." }],
  [/\b(1N4148|LL4148)\b/i, { kind: "signaldiode", pkg: "DO-35", pins: ["A", "K"], note: "Signaldiode, opptil 300 mA. Stripen er katoden." }],
  // Moduler og sensorer
  [/\b(BME280|BMP280|BME680|AHT[12]0|SHT3[01]|SHT4\d|INA219|INA226|MPU-?6050|MPU-?9250|ADS1115|PCA9685|SSD1306|SH1106|BH1750|VL53L0X|MAX30102|PCF8574|DS3231|HTU21D|SCD4\d|ENS160|LM75A?|CJMCU-?\d+)\b/i, { kind: "i2c", pins: ["VCC", "GND", "SCL", "SDA"], note: "I2C: SDA og SCL trenger pull-up (de fleste moduler har det innebygd)." }],
  [/\b(HC-?SR04P?|RCWL-?1601|US-?100|JSN-?SR04T)\b/i, { kind: "hcsr04", pins: ["VCC", "TRIG", "ECHO", "GND"], note: "ECHO gir 5 V. Bruk spenningsdeler (1 kΩ / 2 kΩ) inn til en 3,3 V-pinne." }],
  [/\b(DS18B20)\b/i, { kind: "ds18b20", pkg: "TO-92", pins: ["GND", "DQ", "VDD"], note: "1-Wire: 4,7 kΩ pull-up fra DQ til 3,3 V. Flere sensorer kan dele samme ledning." }],
  [/\b(DHT11|DHT22|AM2302)\b/i, { kind: "dht", pins: ["VCC", "DATA", "NC", "GND"], note: "10 kΩ pull-up på DATA (moduler har den ofte). Les maks hvert 2. sekund." }],
  [/\b(LM2596S?|MP1584(EN)?|XL4015|XL6009|MT3608|MINI-?360)\b/i, { kind: "buck", pins: ["IN+", "IN−", "OUT+", "OUT−"], note: "Juster utgangsspenningen med potmeteret FØR du kobler til lasten." }],
  [/\b(TP4056)\b/i, { kind: "tp4056", pins: ["IN+", "IN−", "B+", "B−", "OUT+", "OUT−"], note: "Lader én Li-ion-celle (4,2 V). Versjonen med OUT+/OUT− har beskyttelse (DW01)." }],
  [/\b(WS2812B?|SK6812|WS2811|NeoPixel)\b/i, { kind: "ws2812", pins: ["5V", "DIN", "GND"], note: "330 Ω i serie på data og 1000 µF over strømmen. 3,3 V-data fungerer ofte, ellers bruk nivåomformer." }],
  [/\b(RC522|MFRC-?522)\b/i, { kind: "spi-rc522", pins: [], note: "3,3 V, ikke 5 V. Se koblingsskjemaet i leserbyggeren." }],
];

// Delenumre i fritekst som ikke matcher en mal, men som likevel er verdt et databladsøk.
const GENERIC_MPN = /\b([A-Z]{1,5}[0-9]{2,6}[A-Z0-9-]{0,8})\b/g;
const NOT_MPN = /^(USB|PCS|PC|DIY|LED|DC|AC|AWG|M[0-9]+|[0-9]+(MM|CM|M|V|A|W|MAH|PCS|K|UF|NF|PF)|TYPE|CH|NO|NEW|IP[0-9]+|X[0-9]+|A[0-9]|ESP|V[0-9]+)$/;

export function findPart(title, mpn = "") {
  const text = `${mpn} ${title}`;
  for (const [re, info] of PARTS) {
    const m = text.match(re);
    if (m) return { mpn: m[0].toUpperCase().replace(/\s+/g, ""), ...info };
  }
  return null;
}

function candidateMpns(title, mpn) {
  const out = [];
  if (mpn) out.push(mpn);
  for (const m of String(title || "").toUpperCase().matchAll(GENERIC_MPN)) {
    const t = m[1];
    if (/[A-Z]/.test(t) && /[0-9]/.test(t) && !NOT_MPN.test(t) && !out.includes(t)) out.push(t);
    if (out.length >= 3) break;
  }
  return out;
}

export function datasheetLinks(q) {
  const e = encodeURIComponent(q);
  return [
    { label: "Alldatasheet", url: `https://www.alldatasheet.com/view.jsp?Searchword=${e}` },
    { label: "Octopart", url: `https://octopart.com/search?q=${e}` },
    { label: "Mouser", url: `https://www.mouser.com/c/?q=${e}` },
  ];
}

// ---------- SVG-byggeklosser ----------

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const A = "var(--accent)";

function svg(w, h, body, label) {
  return `<svg class="schematic" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}">
    <g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" font-family="system-ui, sans-serif">${body}</g></svg>`;
}
const wire = (...pts) => `<polyline points="${pts.map((p) => p.join(",")).join(" ")}"/>`;
const dot = (x, y) => `<circle cx="${x}" cy="${y}" r="3.2" fill="currentColor" stroke="none"/>`;
const text = (x, y, s, { anchor = "start", size = 12, weight = 400, muted = false, color } = {}) =>
  `<text x="${x}" y="${y}" fill="${color || "currentColor"}" stroke="none" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}"${muted ? ' fill-opacity=".72"' : ""}>${esc(s)}</text>`;

// Motstand (IEC-boks) mellom to punkter, vannrett eller loddrett. Verdien står ved siden av.
function res(x1, y1, x2, y2, value, side = 1) {
  const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
  if (y1 === y2) {
    return wire([x1, y1], [cx - 18, cy]) + wire([cx + 18, cy], [x2, y2]) + `<rect x="${cx - 18}" y="${cy - 7}" width="36" height="14" rx="1"/>` + text(cx, cy - 12 * side - (side > 0 ? 0 : -4), value, { anchor: "middle", size: 11, muted: true });
  }
  return wire([x1, y1], [cx, cy - 18]) + wire([cx, cy + 18], [x2, y2]) + `<rect x="${cx - 7}" y="${cy - 18}" width="14" height="36" rx="1"/>` + text(cx + 12 * side, cy + 4, value, { anchor: side > 0 ? "start" : "end", size: 11, muted: true });
}

// Kondensator, loddrett. polar: + på oversiden.
function cap(x, y1, y2, value, polar = false) {
  const cy = (y1 + y2) / 2;
  return wire([x, y1], [x, cy - 4]) + wire([x, cy + 4], [x, y2]) +
    `<line x1="${x - 11}" y1="${cy - 4}" x2="${x + 11}" y2="${cy - 4}"/>` +
    (polar ? `<path d="M${x - 11} ${cy + 6} Q${x} ${cy + 1} ${x + 11} ${cy + 6}"/>` + text(x - 16, cy - 7, "+", { size: 11 }) : `<line x1="${x - 11}" y1="${cy + 4}" x2="${x + 11}" y2="${cy + 4}"/>`) +
    text(x + 16, cy + 4, value, { size: 11, muted: true });
}

// Diode/LED fra anode (a) til katode (k), vannrett eller loddrett.
function diode(ax, ay, kx, ky, { led = false, label = "", color = "currentColor" } = {}) {
  const cx = (ax + kx) / 2, cy = (ay + ky) / 2;
  let s = "";
  if (ay === ky) {
    const d = kx > ax ? 1 : -1;
    s += wire([ax, ay], [cx - 8 * d, cy]) + wire([cx + 8 * d, cy], [kx, ky]);
    s += `<polygon points="${cx - 8 * d},${cy - 8} ${cx - 8 * d},${cy + 8} ${cx + 8 * d},${cy}" stroke="${color}"/>`;
    s += `<line x1="${cx + 8 * d}" y1="${cy - 8}" x2="${cx + 8 * d}" y2="${cy + 8}" stroke="${color}"/>`;
    if (label) s += text(cx, cy - 14, label, { anchor: "middle", size: 11, muted: true });
  } else {
    const d = ky > ay ? 1 : -1;
    s += wire([ax, ay], [cx, cy - 8 * d]) + wire([cx, cy + 8 * d], [kx, ky]);
    s += `<polygon points="${cx - 8},${cy - 8 * d} ${cx + 8},${cy - 8 * d} ${cx},${cy + 8 * d}" stroke="${color}"/>`;
    s += `<line x1="${cx - 8}" y1="${cy + 8 * d}" x2="${cx + 8}" y2="${cy + 8 * d}" stroke="${color}"/>`;
    if (label) s += text(cx + 14, cy + 4, label, { size: 11, muted: true });
  }
  if (led) {
    const ox = ay === ky ? cx : cx + 10, oy = ay === ky ? cy - 10 : cy;
    s += `<path d="M${ox + 2} ${oy - 4} l7 -7 m-5 0 h5 v5 M${ox + 9} ${oy + 1} l7 -7 m-5 0 h5 v5" stroke-width="1.5"/>`;
  }
  return s;
}

const gnd = (x, y) => wire([x, y], [x, y + 6]) + `<line x1="${x - 11}" y1="${y + 6}" x2="${x + 11}" y2="${y + 6}"/><line x1="${x - 7}" y1="${y + 11}" x2="${x + 7}" y2="${y + 11}"/><line x1="${x - 3}" y1="${y + 16}" x2="${x + 3}" y2="${y + 16}"/>`;
const vcc = (x, y, label) => `<line x1="${x - 11}" y1="${y}" x2="${x + 11}" y2="${y}"/>` + text(x, y - 7, label, { anchor: "middle", size: 11, weight: 600 });

// Bipolar transistor. Pinner: b, c, e. Fremhevet med aksentfarge.
function bjt(x, y, pnp = false) {
  const top = pnp ? "E" : "C", bot = pnp ? "C" : "E";
  let s = `<circle cx="${x}" cy="${y}" r="24" stroke="${A}"/>`;
  s += `<line x1="${x - 8}" y1="${y - 14}" x2="${x - 8}" y2="${y + 14}" stroke-width="3" stroke="${A}"/>`;
  s += wire([x - 32, y], [x - 8, y]);
  s += wire([x - 8, y - 6], [x + 8, y - 18], [x + 8, y - 40]);
  s += wire([x - 8, y + 6], [x + 8, y + 18], [x + 8, y + 40]);
  s += pnp
    ? `<polygon points="${x - 4},${y - 9} ${x - 0.8},${y - 16.4} ${x + 4},${y - 10}" fill="currentColor"/>`
    : `<polygon points="${x + 6},${y + 16.5} ${x - 2},${y + 15.5} ${x + 2.8},${y + 9.1}" fill="currentColor"/>`;
  s += text(x - 22, y - 6, "B", { size: 10, muted: true }) + text(x + 14, y - 26, top, { size: 10, muted: true }) + text(x + 14, y + 34, bot, { size: 10, muted: true });
  return s;
}

// MOSFET (anrikning). Pinner: g, d (oppe for N), s (nede for N).
function mos(x, y, p = false) {
  const top = p ? "S" : "D", bot = p ? "D" : "S";
  let s = `<circle cx="${x}" cy="${y}" r="24" stroke="${A}"/>`;
  s += wire([x - 32, y], [x - 14, y]) + `<line x1="${x - 14}" y1="${y - 14}" x2="${x - 14}" y2="${y + 14}"/>`;
  s += `<line x1="${x - 8}" y1="${y - 16}" x2="${x - 8}" y2="${y + 16}" stroke-width="3" stroke="${A}"/>`;
  s += wire([x - 8, y - 12], [x + 8, y - 12], [x + 8, y - 40]);
  s += wire([x - 8, y + 12], [x + 8, y + 12], [x + 8, y + 40]);
  s += wire([x - 8, y], [x + 8, y], [x + 8, y + 12]);
  s += p
    ? `<polygon points="${x + 2},${y} ${x - 4},${y - 4} ${x - 4},${y + 4}" fill="currentColor"/>`
    : `<polygon points="${x - 7},${y} ${x - 1},${y - 4} ${x - 1},${y + 4}" fill="currentColor"/>`;
  s += text(x - 22, y - 6, "G", { size: 10, muted: true }) + text(x + 14, y - 26, top, { size: 10, muted: true }) + text(x + 14, y + 34, bot, { size: 10, muted: true });
  return s;
}

// Last (f.eks. relé, motor eller LED-stripe) som en boks, loddrett.
const load = (x, y1, y2, label = "Last") => {
  const cy = (y1 + y2) / 2;
  return wire([x, y1], [x, cy - 20]) + wire([x, cy + 20], [x, y2]) + `<rect x="${x - 26}" y="${cy - 20}" width="52" height="40" rx="4" stroke-dasharray="4 3"/>` + text(x, cy + 4, label, { anchor: "middle", size: 11 });
};

// IC/modul som boks med pinner på sidene: left/right = [[navn, y], ...].
function chip(x, y, w, h, title, left = [], right = [], { accent = true, pinNums = null } = {}) {
  let s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" stroke="${accent ? A : "currentColor"}"/>`;
  s += text(x + w / 2, y + 18, title, { anchor: "middle", size: 12, weight: 700 });
  for (const [n, py, num] of left) s += wire([x - 14, py], [x, py]) + text(x + 6, py + 4, n, { size: 10 }) + (num ? text(x - 4, py - 4, num, { size: 9, muted: true, anchor: "end" }) : "");
  for (const [n, py, num] of right) s += wire([x + w, py], [x + w + 14, py]) + text(x + w - 6, py + 4, n, { size: 10, anchor: "end" }) + (num ? text(x + w + 4, py - 4, num, { size: 9, muted: true }) : "");
  return s;
}

// ---------- Maler ----------

const T = {};

T.npn = (p) => ({
  title: `${p.mpn} som bryter (lavside)`,
  caption: "GPIO høy slår på transistoren, så strøm går fra pluss gjennom lasten til jord. 1 kΩ begrenser basestrømmen, 10 kΩ holder transistoren av mens mikrokontrolleren starter. Ved induktiv last (relé, motor) må dioden over lasten være med.",
  svg: svg(520, 300, [
    vcc(300, 28, "+5–12 V"), wire([300, 28], [300, 60]),
    load(300, 60, 140, "Last"),
    dot(300, 60), dot(300, 140), wire([300, 60], [370, 60]), diode(370, 140, 370, 60, { label: "1N4007 (flyback)" }), wire([370, 140], [300, 140]),
    wire([300, 140], [300, 166]),
    bjt(292, 206),
    wire([300, 246], [300, 268]), gnd(300, 268),
    text(40, 210, "GPIO", { weight: 600 }), wire([80, 206], [100, 206]),
    res(100, 206, 200, 206, "1 kΩ"), wire([200, 206], [260, 206]), dot(230, 206),
    res(230, 206, 230, 268, "10 kΩ", -1), gnd(230, 268),
    text(330, 212, p.mpn, { size: 12, weight: 700, color: A }),
  ].join(""), `${p.mpn} som lavsidebryter styrt fra en GPIO`),
});

T.pnp = (p) => ({
  title: `${p.mpn} som bryter (høyside)`,
  caption: "GPIO lav slår på transistoren, så lasten får pluss. Virker direkte når lasten går på samme spenning som mikrokontrolleren (3,3–5 V). For høyere spenning trengs en NPN foran som drar basen ned.",
  svg: svg(520, 300, [
    vcc(300, 28, "+3,3–5 V"), wire([300, 28], [300, 74]), dot(300, 50), wire([300, 50], [230, 50]),
    bjt(292, 114, true),
    wire([300, 154], [300, 180]), load(300, 180, 252, "Last"), wire([300, 252], [300, 262]), gnd(300, 262),
    text(40, 118, "GPIO", { weight: 600 }), wire([80, 114], [100, 114]), res(100, 114, 200, 114, "1 kΩ"), wire([200, 114], [260, 114]), dot(230, 114),
    res(230, 114, 230, 50, "10 kΩ", -1),
    text(330, 120, p.mpn, { size: 12, weight: 700, color: A }),
  ].join(""), `${p.mpn} som høysidebryter`),
});

T.nmos = (p) => ({
  title: `${p.mpn} som bryter (lavside)`,
  caption: `${p.logic === false ? "NB: ikke logikknivå, se merknaden over. " : ""}GPIO høy slår på MOSFET-en. 220 Ω demper ringing på gaten, 100 kΩ holder den av ved oppstart. Dioden over lasten tar opp spenningstoppen fra relé, motor eller magnetventil.`,
  svg: svg(520, 300, [
    vcc(300, 28, "+5–24 V"), wire([300, 28], [300, 60]),
    load(300, 60, 140, "Last"),
    dot(300, 60), dot(300, 140), wire([300, 60], [370, 60]), diode(370, 140, 370, 60, { label: "1N5819" }), wire([370, 140], [300, 140]),
    wire([300, 140], [300, 166]),
    mos(292, 206),
    wire([300, 246], [300, 268]), gnd(300, 268),
    text(40, 210, "GPIO", { weight: 600 }), wire([80, 206], [100, 206]),
    res(100, 206, 200, 206, "220 Ω"), wire([200, 206], [260, 206]), dot(230, 206),
    res(230, 206, 230, 268, "100 kΩ", -1), gnd(230, 268),
    text(330, 212, p.mpn, { size: 12, weight: 700, color: A }),
  ].join(""), `${p.mpn} som lavsidebryter`),
});

T.pmos = (p) => ({
  title: `${p.mpn} som bryter (høyside)`,
  caption: "Gaten dras til pluss av 10 kΩ, så MOSFET-en er av. Når GPIO går høy, trekker NPN-transistoren gaten ned og lasten får strøm. Slik kan 3,3 V styre en høyere spenning på plussiden.",
  svg: svg(560, 320, [
    vcc(320, 26, "+5–12 V"), wire([320, 26], [320, 74]), dot(320, 46), wire([320, 46], [240, 46], [240, 70]),
    mos(312, 114, true),
    wire([320, 154], [320, 190]), load(320, 190, 262, "Last"), wire([320, 262], [320, 280]), gnd(320, 280),
    res(240, 70, 240, 114, "10 kΩ", -1), dot(240, 114), wire([240, 114], [280, 114]),
    wire([240, 114], [240, 170]), bjt(232, 210), wire([240, 250], [240, 280]), gnd(240, 280),
    text(40, 214, "GPIO", { weight: 600 }), wire([80, 210], [100, 210]), res(100, 210, 180, 210, "1 kΩ"), wire([180, 210], [200, 210]),
    text(270, 216, "2N2222", { size: 10, muted: true }),
    text(350, 120, p.mpn, { size: 12, weight: 700, color: A }),
  ].join(""), `${p.mpn} som høysidebryter med NPN-driver`),
});

T.reg78 = (p) => {
  const out = (p.mpn.match(/78(\d\d)/) || [])[1];
  const v = out ? `${Number(out)} V` : "Vut";
  return {
    title: `${p.mpn}: fast spenning ${v}`,
    caption: `Inngangen må være minst ca. 2 V høyere enn ${v}. Kondensatorene står nær pinnene og hindrer at regulatoren svinger.`,
    svg: svg(520, 250, [
      text(20, 84, "Inn", { weight: 600 }), wire([50, 80], [180, 80]), dot(110, 80), cap(110, 80, 170, "330 nF"), gnd(110, 170),
      chip(194, 38, 132, 88, p.mpn, [["IN", 80, "1"]], [["OUT", 80, "3"]]),
      wire([260, 126], [260, 170]), text(266, 146, "GND (2)", { size: 10, muted: true }), gnd(260, 170),
      wire([340, 80], [480, 80]), dot(410, 80), cap(410, 80, 170, "100 nF"), gnd(410, 170), text(450, 72, v, { weight: 600 }),
    ].join(""), `${p.mpn} med kondensatorer på inn- og utgang`),
  };
};

T.reg1117 = (p) => {
  const v = (p.mpn.match(/(\d\.\d)/) || [])[1];
  return {
    title: `${p.mpn}: ${v ? `${v.replace(".", ",")} V` : "lavt spenningsfall"}`,
    caption: "Begge kondensatorene trengs, og utgangskondensatoren må være minst 10 µF, ellers kan regulatoren svinge. Typisk 5 V inn og 3,3 V ut.",
    svg: svg(520, 250, [
      text(20, 84, "5 V", { weight: 600 }), wire([50, 80], [180, 80]), dot(110, 80), cap(110, 80, 170, "10 µF", true), gnd(110, 170),
      chip(194, 38, 132, 88, p.mpn, [["IN", 80, "3"]], [["OUT", 80, "2"]]),
      wire([260, 126], [260, 170]), text(266, 146, "GND (1)", { size: 10, muted: true }), gnd(260, 170),
      wire([340, 80], [480, 80]), dot(410, 80), cap(410, 80, 170, "22 µF", true), gnd(410, 170), text(444, 72, v ? `${v.replace(".", ",")} V` : "Vut", { weight: 600 }),
    ].join(""), `${p.mpn} med kondensatorer`),
  };
};

T.lm317 = (p) => ({
  title: `${p.mpn}: justerbar spenning`,
  caption: "Vut = 1,25 V × (1 + R2 / R1). Med R1 = 240 Ω og R2 = 390 Ω blir det ca. 3,3 V; med R2 = 720 Ω ca. 5 V.",
  svg: svg(540, 290, [
    text(20, 84, "Inn", { weight: 600 }), wire([50, 80], [180, 80]), dot(110, 80), cap(110, 80, 170, "100 nF"), gnd(110, 170),
    chip(194, 38, 132, 88, p.mpn, [["IN", 80, "3"]], [["OUT", 80, "2"]]),
    wire([340, 80], [500, 80]), dot(400, 80), dot(460, 80), cap(460, 80, 170, "1 µF", true), gnd(460, 170), text(470, 72, "Vut", { weight: 600 }),
    res(400, 80, 400, 160, "R1 240 Ω"), dot(400, 160), wire([260, 126], [260, 160], [400, 160]), text(266, 146, "ADJ (1)", { size: 10, muted: true }),
    res(400, 160, 400, 250, "R2"), gnd(400, 250),
  ].join(""), `${p.mpn} med motstandsdeler`),
});

T.ne555 = (p) => ({
  title: `${p.mpn}: blinker (astabil)`,
  caption: "Frekvens ≈ 1,44 / ((R1 + 2·R2) · C). Med 1 kΩ, 68 kΩ og 10 µF blinker LED-en ca. én gang i sekundet. Pinnenumrene står ved hver pinne.",
  svg: svg(560, 320, [
    vcc(150, 24, "+5–12 V"), wire([150, 24], [150, 40], [420, 40]), dot(150, 40),
    chip(200, 70, 150, 170, p.mpn,
      [["DIS", 110, "7"], ["THR", 160, "6"], ["TRIG", 200, "2"]],
      [["VCC", 100, "8"], ["RESET", 130, "4"], ["OUT", 170, "3"], ["CTRL", 200, "5"], ["GND", 228, "1"]]),
    wire([150, 40], [150, 50]), res(150, 50, 150, 110, "R1 1 kΩ", -1), dot(150, 110), wire([150, 110], [186, 110]),
    res(150, 110, 150, 160, "R2 68 kΩ", -1), dot(150, 160), wire([150, 160], [186, 160]), wire([150, 160], [150, 200], [186, 200]), dot(150, 200),
    wire([150, 200], [150, 220]), cap(150, 220, 290, "10 µF", true), gnd(150, 290),
    wire([364, 100], [400, 100], [400, 40]), dot(400, 40), wire([364, 130], [400, 130], [400, 100]), dot(400, 100),
    wire([364, 170], [420, 170]), res(420, 170, 490, 170, "330 Ω"), diode(490, 170, 490, 250, { led: true, color: A }), gnd(490, 250),
    wire([364, 200], [400, 200]), cap(400, 200, 268, "10 nF"), gnd(400, 268),
    wire([364, 228], [376, 228], [376, 290]), gnd(376, 290),
  ].join(""), `${p.mpn} koblet som astabil oscillator med LED`),
});

T.opto = (p) => ({
  title: `${p.mpn}: skille mellom to kretser`,
  caption: "Venstre side (mikrokontrolleren) og høyre side (den andre kretsen) har hver sin jord og ingen elektrisk forbindelse. GPIO høy tenner LED-en inni, og transistoren drar utgangen lav.",
  svg: svg(560, 280, [
    text(20, 84, "GPIO", { weight: 600 }), wire([60, 80], [80, 80]), res(80, 80, 170, 80, "330 Ω"), wire([170, 80], [200, 80]),
    chip(200, 50, 150, 150, p.mpn, [["A", 80, "1"], ["K", 170, "2"]], [["C", 80, "4"], ["E", 170, "3"]]),
    wire([186, 170], [140, 170], [140, 200]), gnd(140, 200), text(100, 240, "Jord 1", { size: 10, muted: true }),
    diode(240, 100, 240, 150, { led: true, color: A }),
    vcc(460, 30, "+V (krets 2)"), wire([460, 30], [460, 40]), res(460, 40, 460, 80, "10 kΩ"), dot(460, 80), wire([364, 80], [520, 80]), text(480, 72, "Ut", { weight: 600 }),
    wire([364, 170], [400, 170], [400, 200]), gnd(400, 200), text(380, 240, "Jord 2", { size: 10, muted: true }),
    `<line x1="290" y1="60" x2="290" y2="190" stroke-dasharray="3 4" stroke-width="1.5"/>`,
  ].join(""), `${p.mpn} med inngang fra GPIO og utgang med pull-up`),
});

T.diode = (p) => ({
  title: `${p.mpn} som flyback-diode`,
  caption: "Over en spole (relé, motor, magnetventil) leder dioden bort spenningstoppen når strømmen brytes. Katoden (stripen) vender mot pluss. Brukes også som polaritetsvern i serie med inngangen.",
  svg: svg(460, 240, [
    vcc(200, 26, "+V"), wire([200, 26], [200, 60]), dot(200, 60), wire([200, 60], [280, 60]),
    load(200, 60, 160, "Spole"), dot(200, 160), wire([200, 160], [280, 160]),
    diode(280, 160, 280, 60, { label: p.mpn, color: A }),
    wire([200, 160], [200, 190]), text(214, 196, "til transistor / MOSFET", { size: 11, muted: true }),
  ].join(""), `${p.mpn} over en spole`),
});
T.schottky = T.diode;
T.signaldiode = (p) => ({ ...T.diode(p), title: `${p.mpn} (signaldiode)` });

T.led = (p) => ({
  title: "LED med formotstand",
  caption: "R = (forsyning − LED-spenning) / strøm. Fra 3,3 V med rød LED (2,0 V) og 10 mA: (3,3 − 2,0) / 0,01 = 130 Ω, velg 150 Ω. Blå og hvit LED har ca. 3 V og trenger 5 V forsyning.",
  svg: svg(460, 200, [
    text(20, 84, "GPIO", { weight: 600 }), wire([60, 80], [90, 80]), res(90, 80, 200, 80, "150 Ω"), wire([200, 80], [260, 80]),
    diode(260, 80, 340, 80, { led: true, color: A }), wire([340, 80], [380, 80], [380, 120]), gnd(380, 120),
    text(300, 120, "langt bein = +", { size: 10, muted: true, anchor: "middle" }),
  ].join(""), "LED med formotstand fra en GPIO"),
});

// Moduler: kortet til venstre, modulen til høyre, rette ledninger på samme høyde.
function moduleWiring(p, rows, title, caption, { board = "ESP32", modName = p.mpn } = {}) {
  const ROW = 32, top = 60, h = rows.length * ROW + 40;
  const colors = { pwr: "#d03b3b", gnd: "currentColor", sig: A, i2c: "#0e8f8f" };
  let s = chip(40, top - 30, 150, h, board, [], rows.map(([b, , , i]) => [b, top + i * ROW + 6]), { accent: false });
  s += chip(370, top - 30, 150, h, modName, rows.map(([, m, , i]) => [m, top + i * ROW + 6]), []);
  rows.forEach(([, , c, i, label]) => {
    const y = top + i * ROW + 6;
    s += `<line x1="204" y1="${y}" x2="356" y2="${y}" stroke="${colors[c] || A}" stroke-width="2.6"/>`;
    if (label) s += text(280, y - 6, label, { anchor: "middle", size: 10, muted: true });
  });
  return { title, caption, svg: svg(560, top + h - 10, s, `${modName} koblet til ${board}`) };
}
const rowsOf = (list) => list.map((r, i) => [r[0], r[1], r[2], i, r[3]]);

T.i2c = (p) => moduleWiring(p, rowsOf([["3V3", "VCC", "pwr"], ["GND", "GND", "gnd"], ["GPIO22", "SCL", "i2c", "I2C klokke"], ["GPIO21", "SDA", "i2c", "I2C data"]]),
  `${p.mpn} på I2C`, "Fire ledninger: strøm, jord og I2C. GPIO21/22 er standard på ESP32; på andre kort kan du velge pinner med Wire.begin(SDA, SCL). Flere I2C-moduler kan dele de samme to ledningene så lenge adressene er ulike.");
T.hcsr04 = (p) => {
  const r = moduleWiring(p, rowsOf([["5V", "VCC", "pwr"], ["GPIO5", "TRIG", "sig", "puls ut"], ["GPIO18", "ECHO", "sig", "via 1k/2k deler"], ["GND", "GND", "gnd"]]),
    `${p.mpn} avstandssensor`, "TRIG får en 10 µs puls, ECHO svarer med en puls som er like lang som lydens tur-retur. ECHO er 5 V: sett 1 kΩ i serie og 2 kΩ til jord før den går inn på ESP32 (HC-SR04P og RCWL-1601 tåler 3,3 V direkte).");
  return r;
};
T.ds18b20 = (p) => ({
  title: `${p.mpn} temperatursensor (1-Wire)`,
  caption: "Én dataledning med 4,7 kΩ pull-up til 3,3 V. Flere sensorer kan henges på samme ledning; hver har sin egen adresse.",
  svg: svg(480, 230, [
    vcc(140, 26, "3,3 V"), wire([140, 26], [140, 50], [330, 50]), dot(140, 50),
    res(140, 50, 140, 130, "4,7 kΩ", -1), dot(140, 130),
    text(20, 134, "GPIO4", { weight: 600 }), wire([70, 130], [330, 130]),
    chip(344, 30, 110, 140, p.mpn, [["VDD", 50, "3"], ["DQ", 130, "2"], ["GND", 158, "1"]]),
    wire([330, 158], [300, 158], [300, 185]), gnd(300, 185),
  ].join(""), `${p.mpn} med pull-up`),
});
T.dht = (p) => moduleWiring(p, rowsOf([["3V3", "VCC", "pwr"], ["GPIO4", "DATA", "sig", "10 kΩ pull-up"], ["GND", "GND", "gnd"]]),
  `${p.mpn} temperatur og fuktighet`, "Én dataledning. Har sensoren fire bein (ikke modul), trengs 10 kΩ fra DATA til VCC. DHT22 gir bedre nøyaktighet enn DHT11.");
T.buck = (p) => ({
  title: `${p.mpn}: spenningsomformer`,
  caption: "Kobles mellom strømkilden og det som skal ha strøm. Juster potmeteret med et multimeter på utgangen FØR lasten kobles til, og pass på at pluss og minus ikke byttes.",
  svg: svg(560, 200, [
    text(20, 64, "Strømkilde", { weight: 600 }), text(20, 80, "f.eks. 12 V", { size: 11, muted: true }),
    `<line x1="110" y1="60" x2="196" y2="60" stroke="#d03b3b" stroke-width="2.6"/>`, `<line x1="110" y1="130" x2="196" y2="130" stroke-width="2.6"/>`,
    chip(210, 30, 150, 130, p.mpn, [["IN+", 60], ["IN−", 130]], [["OUT+", 60], ["OUT−", 130]]),
    `<line x1="374" y1="60" x2="460" y2="60" stroke="#d03b3b" stroke-width="2.6"/>`, `<line x1="374" y1="130" x2="460" y2="130" stroke-width="2.6"/>`,
    text(470, 64, "Last", { weight: 600 }), text(470, 80, "f.eks. 5 V", { size: 11, muted: true }),
    `<circle cx="285" cy="95" r="8"/>`, `<path d="M281 99 l8 -8"/>`, text(285, 120, "juster", { anchor: "middle", size: 10, muted: true }),
  ].join(""), `${p.mpn} mellom strømkilde og last`),
});
T.tp4056 = (p) => ({
  title: `${p.mpn}: lader for Li-ion`,
  caption: "USB eller 5 V inn, cellen på B+/B−, og det som skal ha strøm på OUT+/OUT−. Rød LED lyser under lading, blå/grønn når cellen er full.",
  svg: svg(560, 220, [
    text(20, 64, "5 V / USB", { weight: 600 }),
    `<line x1="100" y1="60" x2="196" y2="60" stroke="#d03b3b" stroke-width="2.6"/>`, `<line x1="100" y1="150" x2="196" y2="150" stroke-width="2.6"/>`,
    chip(210, 30, 150, 150, p.mpn, [["IN+", 60], ["IN−", 150]], [["B+", 60], ["B−", 90], ["OUT+", 125], ["OUT−", 155]]),
    `<line x1="374" y1="60" x2="440" y2="60" stroke="#d03b3b" stroke-width="2.6"/>`, `<line x1="374" y1="90" x2="440" y2="90" stroke-width="2.6"/>`,
    `<rect x="440" y="50" width="70" height="50" rx="8"/>`, text(475, 80, "18650", { anchor: "middle", size: 12, weight: 600 }),
    `<line x1="374" y1="125" x2="440" y2="125" stroke="#d03b3b" stroke-width="2.6"/>`, `<line x1="374" y1="155" x2="440" y2="155" stroke-width="2.6"/>`,
    text(450, 144, "Til kretsen", { size: 12, weight: 600 }),
  ].join(""), `${p.mpn} med celle og last`),
});
T.ws2812 = (p) => ({
  title: `${p.mpn}: adresserbare LED-er`,
  caption: "Strøm fra en egen 5 V-forsyning (ca. 60 mA per LED på full hvit), felles jord med mikrokontrolleren, og 330 Ω i serie på dataledningen. 1000 µF over strømmen tar opp strømstøt.",
  svg: svg(560, 230, [
    vcc(470, 26, "5 V forsyning"), wire([470, 26], [470, 60], [380, 60]), dot(430, 60), cap(430, 60, 160, "1000 µF", true),
    text(20, 104, "GPIO", { weight: 600 }), wire([60, 100], [90, 100]), res(90, 100, 200, 100, "330 Ω"), wire([200, 100], [366, 100]),
    chip(240, 40, 126, 140, p.mpn, [], [], { accent: true }), text(303, 84, "5V", { size: 10, anchor: "middle" }), text(303, 118, "DIN", { size: 10, anchor: "middle" }), text(303, 152, "GND", { size: 10, anchor: "middle" }),
    wire([366, 60], [380, 60]), wire([366, 160], [470, 160], [470, 180]), dot(430, 160), gnd(470, 180),
    text(20, 200, "Felles GND mellom forsyning og mikrokontroller", { size: 11, muted: true }),
  ].join(""), `${p.mpn} med motstand og kondensator`),
});
T.uln = (p) => ({
  title: `${p.mpn}: driver for releer og steppermotorer`,
  caption: "Hver inngang (IN1–IN7) styrer en utgang (OUT1–OUT7) som drar lasten til jord, opptil 500 mA per kanal. COM til lastens pluss gir innebygd flyback-beskyttelse. Vanlig for 28BYJ-48-steppermotor.",
  svg: svg(520, 230, [
    text(20, 84, "GPIO", { weight: 600 }), wire([60, 80], [170, 80]), text(120, 72, "IN1…", { size: 10, muted: true }),
    chip(184, 50, 140, 130, p.mpn, [["IN1", 80, "1"], ["GND", 160, "8"]], [["OUT1", 80, "16"], ["COM", 120, "9"]]),
    wire([170, 160], [150, 160], [150, 190]), gnd(150, 190),
    vcc(440, 26, "+5–12 V"), wire([440, 26], [440, 40]), load(440, 40, 80, ""), wire([338, 80], [440, 80]),
    wire([338, 120], [470, 120], [470, 34], [440, 34]), dot(440, 34),
  ].join(""), `${p.mpn} med last`),
});
T["spi-rc522"] = (p) => moduleWiring(p, rowsOf([["GPIO5", "SDA", "sig", "chip select"], ["GPIO18", "SCK", "sig", "SPI klokke"], ["GPIO23", "MOSI", "sig", "data ut"], ["GPIO19", "MISO", "sig", "data inn"], ["GPIO22", "RST", "sig", "reset"], ["GND", "GND", "gnd"], ["3V3", "3.3V", "pwr", "ikke 5 V"]]),
  `${p.mpn} RFID-leser (SPI)`, "Samme kobling som Filament og elektronikk universet-leseren. IRQ brukes ikke.");

// Komponenttyper uten delenummer: motstand, kondensator, LED, potmeter.
const GENERIC = [
  [/\bleds?\b(?!.*\b(strip|bulb|lamp|light|module|panel|matrix|ws281))/i, () => ({ mpn: "LED", kind: "led", pins: ["A (+)", "K (−)"], note: "Langt bein er anode (+). Flat kant på kanten er katoden." })],
  [/\b(1N4148)\b/i, null],
];

// ---------- Inngang ----------

// Alt detaljvinduet trenger: delenummer, datablad, pinner og koblingsskjema.
export function componentInfo(part) {
  const found = findPart(part.title, part.mpn) || (() => {
    for (const [re, make] of GENERIC) if (make && re.test(part.title)) return make();
    return null;
  })();
  const mpns = found ? [found.mpn] : candidateMpns(part.title, part.mpn);
  if (!found && !mpns.length) return null;
  const query = found?.mpn === "LED" ? "" : mpns[0];
  const circuit = found && T[found.kind] ? T[found.kind](found) : null;
  return {
    mpn: found?.mpn === "LED" ? "" : mpns[0] || "",
    others: found ? [] : mpns.slice(1),
    datasheets: query ? datasheetLinks(query) : [],
    pkg: found?.pkg || "",
    pins: found?.pins || [],
    note: found?.note || "",
    circuit,
  };
}

// HTML for detaljvinduet.
export function componentHtml(part) {
  const info = componentInfo(part);
  if (!info) return "";
  const pins = info.pins.length
    ? `<div class="pinout"><span class="hint">${info.pkg ? `${esc(info.pkg)}, pinner sett forfra:` : "Pinner på modulen:"}</span>${info.pins.map((p, i) => `<span class="pin"><b>${i + 1}</b>${esc(p)}</span>`).join("")}</div>`
    : "";
  return `<section class="component-info">
    <h3>Datablad og kobling${info.mpn ? ` · <span class="mpn">${esc(info.mpn)}</span>` : ""}</h3>
    ${info.datasheets.length ? `<p class="ds-links">Datablad: ${info.datasheets.map((d) => `<a href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.label)} ↗</a>`).join(" · ")}${info.others.length ? ` <span class="hint">(fant også ${info.others.map(esc).join(", ")})</span>` : ""}</p>` : ""}
    ${pins}
    ${info.note ? `<p class="hint">${esc(info.note)}</p>` : ""}
    ${info.circuit ? `<figure class="schematic-fig"><figcaption><b>${esc(info.circuit.title)}</b></figcaption><div class="schematic-wrap">${info.circuit.svg}</div><figcaption>${esc(info.circuit.caption)}</figcaption></figure>` : ""}
  </section>`;
}
