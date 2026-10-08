// Innlogging uten server: GitHub-tokenen som gir skrivetilgang lagres kryptert
// per bruker (AES-256-GCM, nøkkel fra passordet med PBKDF2-SHA256). Riktig
// passord dekrypterer tokenen; feil passord feiler på GCM-sjekken.

// OWASP-anbefaling for PBKDF2-HMAC-SHA256 (2023). Eldre nøkler bruker antallet som er lagret i dem.
const ITERATIONS = 600000;
export const MIN_PASSWORD = 12;

// De krypterte nøklene ligger i et offentlig repo og kan angripes offline,
// så vanlige og lett gjettbare passord avvises.
const COMMON = [
  "password", "passord", "qwerty", "123456", "letmein", "welcome", "velkommen", "admin", "iloveyou",
  "sommer", "vinter", "fotball", "bambulab", "bambu", "filament", "printer", "abc123", "monkey", "dragon",
  "hemmelig", "norge", "oslo", "bergen", "trondheim",
];

export function passwordProblem(pw, user = "") {
  if (pw.length < MIN_PASSWORD) return `Passordet må ha minst ${MIN_PASSWORD} tegn.`;
  const low = pw.toLowerCase();
  if (new Set(pw).size < 5) return "Passordet har for få forskjellige tegn.";
  if (user && low.includes(user.toLowerCase())) return "Passordet kan ikke inneholde brukernavnet.";
  if (COMMON.some((w) => low.includes(w))) return "Passordet inneholder et vanlig ord. Velg noe mindre forutsigbart, gjerne flere tilfeldige ord.";
  if (/^(.)\1+$/.test(pw) || /^(0123456789|1234567890|abcdefghij)/.test(low)) return "Passordet er for enkelt.";
  return "";
}

const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const unb64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

async function deriveKey(password, salt, iterations) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptToken(token, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, ITERATIONS);
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(token));
  return { salt: b64(salt), iv: b64(iv), data: b64(data), iter: ITERATIONS };
}

// Returnerer tokenen, eller null ved feil passord.
export async function decryptToken(cred, password) {
  try {
    // Midlertidige passord sendt på e-post (fra Workeren) er lange og tilfeldige
    // (ca. 79 bit), så de bruker HKDF i stedet for PBKDF2. Se worker/src/index.js.
    if (cred.kdf === "hkdf") {
      const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "HKDF", false, ["deriveKey"]);
      const key = await crypto.subtle.deriveKey(
        { name: "HKDF", hash: "SHA-256", salt: unb64(cred.salt), info: new TextEncoder().encode("BambuFilament reset") },
        base, { name: "AES-GCM", length: 256 }, false, ["decrypt"],
      );
      const data = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(cred.iv) }, key, unb64(cred.data));
      return new TextDecoder().decode(data);
    }
    // Antall runder kommer fra delte data: avvis urimelige verdier (ellers kan nettleseren låses).
    const iter = Number(cred.iter || ITERATIONS);
    if (!Number.isInteger(iter) || iter < 100000 || iter > 2000000) return null;
    const key = await deriveKey(password, unb64(cred.salt), iter);
    const data = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(cred.iv) }, key, unb64(cred.data));
    return new TextDecoder().decode(data);
  } catch {
    return null;
  }
}

// Midlertidig passord, f.eks. "k7mq-x4tp-9hzr" (uten tegn som er lette å forveksle).
export function randomPassword() {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const s = Array.from(bytes, (b) => chars[b % chars.length]).join("");
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}
