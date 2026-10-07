// Tolker rådataene fra en Bambu Lab RFID-brikke (blokk 0–19 som hex).
// Blokkoppsett: https://github.com/Bambu-Research-Group/RFID-Tag-Guide/blob/main/BambuLabRfid.md
// Alle tall er little endian.

function hexToBytes(hex) {
  const clean = (hex || "").replace(/[^0-9a-fA-F]/g, "");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

function toHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
}

export function parseTag(blocksHex) {
  const data = hexToBytes(blocksHex);
  if (data.length < 18 * 16) return null;
  const view = new DataView(data.buffer);
  const block = (n) => data.subarray(n * 16, n * 16 + 16);
  const u16 = (n, pos) => view.getUint16(n * 16 + pos, true);
  const f32 = (n, pos) => view.getFloat32(n * 16 + pos, true);
  const str = (bytes) => String.fromCharCode(...bytes).replace(/\0/g, " ").trim();

  const colors = ["#" + toHex(block(5).subarray(0, 4))];
  const b16 = block(16);
  if (b16[0] === 0x02 && b16[1] === 0x00 && u16(16, 2) >= 2) {
    colors.push("#" + toHex(b16.subarray(4, 8).slice().reverse()));
  }

  const date = str(block(12)).split("_").map(Number);
  const productionDate = date.length >= 5 && date.every((n) => !isNaN(n))
    ? new Date(Date.UTC(date[0], date[1] - 1, date[2], date[3], date[4]))
    : null;

  return {
    uid: toHex(block(0).subarray(0, 4)),
    variantId: str(block(1).subarray(0, 8)),
    materialId: str(block(1).subarray(8, 16)),
    type: str(block(2)),
    detailedType: str(block(4)),
    colors,
    weight: u16(5, 4),
    diameter: Math.round(f32(5, 8) * 100) / 100,
    dryingTemp: u16(6, 0),
    dryingHours: u16(6, 2),
    bedTemp: u16(6, 6),
    hotendMax: u16(6, 8),
    hotendMin: u16(6, 10),
    nozzleDiameter: Math.round(f32(8, 12) * 10) / 10,
    trayUid: toHex(block(9)),
    spoolWidth: u16(10, 4) / 100,
    productionDate,
    length: u16(14, 4),
  };
}

// Lager rådata i samme format som en ekte brikke (brukes av demo-modus).
export function buildBlocks({ materialId, variantId, detailedType, colors, weight = 1000 }) {
  const data = new Uint8Array(20 * 16);
  const view = new DataView(data.buffer);
  const put = (block, pos, text, len = 16) => {
    for (let i = 0; i < Math.min(text.length, len); i++) data[block * 16 + pos + i] = text.charCodeAt(i);
  };
  const rgba = (hex) => hexToBytes(hex.replace("#", "").padEnd(8, "F"));
  const type = detailedType.split(/[ -]/)[0];
  const hot = { PLA: [190, 230, 55, 8, 55], PETG: [230, 260, 65, 8, 70], ABS: [240, 270, 80, 8, 90], ASA: [240, 270, 80, 8, 90], TPU: [220, 240, 55, 8, 35] }[type] || [220, 260, 60, 8, 60];

  put(1, 0, variantId, 8);
  put(1, 8, materialId, 8);
  put(2, 0, type);
  put(4, 0, detailedType);
  data.set(rgba(colors[0]), 5 * 16);
  view.setUint16(5 * 16 + 4, weight, true);
  view.setFloat32(5 * 16 + 8, 1.75, true);
  view.setUint16(6 * 16 + 0, hot[4], true);
  view.setUint16(6 * 16 + 2, hot[3], true);
  view.setUint16(6 * 16 + 6, hot[2], true);
  view.setUint16(6 * 16 + 8, hot[1], true);
  view.setUint16(6 * 16 + 10, hot[0], true);
  view.setFloat32(8 * 16 + 12, 0.2, true);
  const d = new Date();
  put(12, 0, [d.getFullYear(), d.getMonth() + 1, d.getDate(), 8, 0].map((n) => String(n).padStart(2, "0")).join("_"));
  if (colors.length > 1) {
    view.setUint16(16 * 16, 2, true);
    view.setUint16(16 * 16 + 2, 2, true);
    data.set(rgba(colors[1]).reverse(), 16 * 16 + 4);
  }
  return toHex(data);
}

// "#RRGGBBAA" -> CSS-farge
export function cssColor(hex) {
  // Fargene kan komme fra delte data, så bare gyldig hex slippes gjennom til CSS.
  if (!/^#?[0-9a-f]{6}([0-9a-f]{2})?$/i.test(hex || "")) return "#cccccc";
  const h = hex.replace("#", "");
  const a = parseInt(h.substr(6, 2) || "FF", 16) / 255;
  return a >= 0.99 ? "#" + h.substr(0, 6) : `rgba(${parseInt(h.substr(0, 2), 16)},${parseInt(h.substr(2, 2), 16)},${parseInt(h.substr(4, 2), 16)},${a.toFixed(2)})`;
}
