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

// ---------- Nøkkelpar per bruker ----------
//
// Hver bruker har et ECDH-nøkkelpar (P-256). Den private nøkkelen er kryptert med
// passordet (som over), og GitHub-tokenen er kryptert til den offentlige nøkkelen
// ("box"). Når tokenen byttes, kan administrator kryptere den nye til alle brukernes
// offentlige nøkler uten å kjenne passordene, så ingen må bytte passord.
// Lagres som users[].kp = { pub, priv, box }.

const ECDH = { name: "ECDH", namedCurve: "P-256" };

async function boxKey(privateKey, publicKey, usage) {
  const bits = await crypto.subtle.deriveBits({ name: "ECDH", public: publicKey }, privateKey, 256);
  const base = await crypto.subtle.importKey("raw", bits, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: new TextEncoder().encode("BambuFilament box") },
    base, { name: "AES-GCM", length: 256 }, false, [usage],
  );
}

// Krypterer tokenen til en offentlig nøkkel (base64, rå P-256-punkt).
export async function sealToken(token, pub) {
  const recipient = await crypto.subtle.importKey("raw", unb64(pub), ECDH, false, []);
  const eph = await crypto.subtle.generateKey(ECDH, true, ["deriveBits"]);
  const key = await boxKey(eph.privateKey, recipient, "encrypt");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(token));
  return { epk: b64(await crypto.subtle.exportKey("raw", eph.publicKey)), iv: b64(iv), data: b64(data) };
}

// Nytt nøkkelpar for en bruker, med privat nøkkel kryptert med passordet.
// Returnerer { kp, key }: kp lagres i brukerlisten, key (privat nøkkel) holdes i innloggingen.
export async function newKeys(token, password) {
  const pair = await crypto.subtle.generateKey(ECDH, true, ["deriveBits"]);
  const pub = b64(await crypto.subtle.exportKey("raw", pair.publicKey));
  const key = b64(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  return { kp: { pub, priv: await encryptToken(key, password), box: await sealToken(token, pub) }, key };
}
export const makeKeys = async (token, password) => (await newKeys(token, password)).kp;

// Returnerer tokenen, eller null ved feil passord.
export async function openKeys(kp, password) {
  return (await openKeysFull(kp, password))?.token || null;
}

// Returnerer { token, key } (key = privat nøkkel for meldinger), eller null ved feil passord.
export async function openKeysFull(kp, password) {
  const pkcs8 = await openPrivate(kp, password);
  const token = pkcs8 && (await tokenFromKey(kp, pkcs8));
  return token ? { token, key: pkcs8 } : null;
}

async function tokenFromKey(kp, pkcs8) {
  try {
    const priv = await crypto.subtle.importKey("pkcs8", unb64(pkcs8), ECDH, false, ["deriveBits"]);
    const epk = await crypto.subtle.importKey("raw", unb64(kp.box.epk), ECDH, false, []);
    const key = await boxKey(priv, epk, "decrypt");
    const data = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(kp.box.iv) }, key, unb64(kp.box.data));
    return new TextDecoder().decode(data);
  } catch {
    return null;
  }
}

// Den private nøkkelen (pkcs8, base64), eller null ved feil passord. Holdes i innloggingen
// så meldinger kan leses uten å skrive passordet på nytt.
export async function openPrivate(kp, password) {
  try { return (await decryptToken(kp.priv, password)) || null; } catch { return null; }
}

// Samme nøkkelpar med nytt passord (og ny token), så meldinger kryptert til nøkkelen
// fortsatt kan leses etter passordbytte.
export async function rewrapKeys(token, privB64, pub, password) {
  return { pub, priv: await encryptToken(privB64, password), box: await sealToken(token, pub) };
}

// ---------- Meldinger ----------
//
// Teksten krypteres med en tilfeldig AES-nøkkel. Den nøkkelen krypteres til den offentlige
// nøkkelen til hver mottaker (og avsenderen), så bare de kan lese meldingen, selv om alle
// innloggede kan hente postene fra databasen.

async function msgKey(privateKey, publicKey, usage) {
  const bits = await crypto.subtle.deriveBits({ name: "ECDH", public: publicKey }, privateKey, 256);
  const base = await crypto.subtle.importKey("raw", bits, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: new TextEncoder().encode("BambuFilament melding") },
    base, { name: "AES-GCM", length: 256 }, false, [usage],
  );
}

// pubs: { navn: offentlig nøkkel }. Returnerer { iv, data, keys: { navn: { epk, iv, data } } }.
export async function sealMessage(text, pubs) {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const aes = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aes, new TextEncoder().encode(text));
  const keys = {};
  for (const [name, pub] of Object.entries(pubs)) {
    const recipient = await crypto.subtle.importKey("raw", unb64(pub), ECDH, false, []);
    const eph = await crypto.subtle.generateKey(ECDH, true, ["deriveBits"]);
    const k = await msgKey(eph.privateKey, recipient, "encrypt");
    const kiv = crypto.getRandomValues(new Uint8Array(12));
    keys[name] = {
      epk: b64(await crypto.subtle.exportKey("raw", eph.publicKey)),
      iv: b64(kiv),
      data: b64(await crypto.subtle.encrypt({ name: "AES-GCM", iv: kiv }, k, raw)),
    };
  }
  return { iv: b64(iv), data: b64(data), keys };
}

// Returnerer teksten, eller null hvis meldingen ikke kan åpnes med denne nøkkelen.
export async function openMessage(enc, me, privB64) {
  try {
    const box = enc?.keys?.[me];
    if (!box || !privB64) return null;
    const priv = await crypto.subtle.importKey("pkcs8", unb64(privB64), ECDH, false, ["deriveBits"]);
    const epk = await crypto.subtle.importKey("raw", unb64(box.epk), ECDH, false, []);
    const k = await msgKey(priv, epk, "decrypt");
    const raw = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(box.iv) }, k, unb64(box.data));
    const aes = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"]);
    const data = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(enc.iv) }, aes, unb64(enc.data));
    return new TextDecoder().decode(data);
  } catch {
    return null;
  }
}
