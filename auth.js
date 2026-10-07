// Innlogging uten server: GitHub-tokenen som gir skrivetilgang lagres kryptert
// per bruker (AES-256-GCM, nøkkel fra passordet med PBKDF2-SHA256). Riktig
// passord dekrypterer tokenen; feil passord feiler på GCM-sjekken.

const ITERATIONS = 310000;
export const MIN_PASSWORD = 10;

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
    const key = await deriveKey(password, unb64(cred.salt), cred.iter || ITERATIONS);
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
