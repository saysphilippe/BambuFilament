// BambuFilament-proxy (Cloudflare Worker)
//
// Bambu sitt sky-API sender ikke CORS-headere, og MQTT kan ikke nås fra en
// nettleser. Denne Workeren videresender derfor innlogging og AMS-forespørsler
// fra github.io-siden. Den lagrer ingenting om Bambu: Bambu-tokenen sendes med fra
// brukerens nettleser i hver forespørsel.
//
// Workeren tar også imot registreringer (/register) og sender midlertidige passord
// på e-post (/reset, via Gmail). Til det lagrer den GitHub-tokenen til siden i KV
// (RESET_KV), lagt inn av siden når administrator er innlogget (/reset-token).

import { connect } from "cloudflare:sockets";

const API = "https://api.bambulab.com";
const MQTT_HOST = "us.mqtt.bambulab.com";
const MQTT_PORT = 8883;
const REPORT_TIMEOUT_MS = 9000;

// Bare nettsiden på github.io. Ved lokal testing (wrangler dev) legges ekstra
// adresser til via DEV_ORIGINS i worker/.dev.vars, som ikke brukes ved publisering.
const SITE_ORIGIN = "https://saysphilippe.github.io";
const allowedOrigins = (env) => [SITE_ORIGIN, ...String(env?.DEV_ORIGINS || "").split(",").map((o) => o.trim()).filter(Boolean)];

// ---------- HTTP ----------

// origin er alltid kontrollert av kalleren (enten en godkjent adresse eller SITE_ORIGIN).
function cors(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...cors(origin) },
  });
}

async function bambu(path, { method = "GET", body, token } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "BambuFilament/1.0",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { error: text.slice(0, 200) }; }
  return { status: res.status, data, headers: res.headers };
}

// Rate limiting per IP (Cloudflare Workers Rate Limiting, se wrangler.toml).
// Origin-sjekken stopper bare nettlesere, så uten dette kunne hvem som helst
// bruke proxyen til å prøve innlogginger mot Bambu.
const LIMITS = {
  "/login": "AUTH_LIMIT", "/send-code": "AUTH_LIMIT", "/tfa": "AUTH_LIMIT", "/refresh": "AUTH_LIMIT",
  "/ams": "DATA_LIMIT", "/library": "DATA_LIMIT",
  "/sitemap": "STORE_LIMIT", "/store-product": "STORE_LIMIT",
  "/reset": "AUTH_LIMIT", "/register": "AUTH_LIMIT", "/reset-token": "AUTH_LIMIT",
};

export default {
  async fetch(request, env) {
    const allowed = allowedOrigins(env);
    const sent = request.headers.get("Origin") || "";
    // Ukjent opprinnelse behandles som github.io-adressen i CORS-svar, så nettlesere avviser svaret.
    const origin = allowed.includes(sent) ? sent : SITE_ORIGIN;
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
    if (request.method !== "POST") return json({ error: "Bruk POST" }, 405, origin);
    if (!allowed.includes(sent)) return json({ error: "Ukjent opprinnelse" }, 403, origin);

    const path = new URL(request.url).pathname;
    const limiter = env?.[LIMITS[path]];
    if (limiter) {
      const ip = request.headers.get("CF-Connecting-IP") || "ukjent";
      const { success } = await limiter.limit({ key: `${path}:${ip}` });
      if (!success) return json({ error: "For mange forsøk. Vent et minutt og prøv igjen." }, 429, origin);
    }
    const body = await request.json().catch(() => ({}));
    const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");

    try {
      switch (path) {
        case "/login": return json(await login(body, env), 200, origin);
        case "/send-code": {
          // Én kode per e-postadresse per minutt, i tillegg til grensen per IP.
          const email = String(body.email || "").toLowerCase();
          if (env?.EMAIL_LIMIT && !(await env.EMAIL_LIMIT.limit({ key: email })).success) {
            return json({ error: "Det er nettopp sendt en kode. Vent et minutt." }, 429, origin);
          }
          return json(await sendCode(body, env), 200, origin);
        }
        case "/reset":
        case "/register": {
          // Én e-post per bruker/adresse per minutt. Nøkkelen er det som ble skrevet inn,
          // så svaret er det samme om brukeren finnes eller ikke.
          const who = String((path === "/reset" ? body.who : body.email) || "").trim().toLowerCase().slice(0, 100);
          if (env?.EMAIL_LIMIT && !(await env.EMAIL_LIMIT.limit({ key: `${path}:${who}` })).success) {
            return json({ error: "Det er nettopp sendt en e-post. Vent et minutt." }, 429, origin);
          }
          return json(path === "/reset" ? await sendReset(who, env) : await register(body, env), 200, origin);
        }
        case "/reset-token":
          if (!token) return json({ error: "Mangler GitHub-token" }, 401, origin);
          return json(await saveResetToken(token, env), 200, origin);
        case "/tfa": return json(await tfa(body), 200, origin);
        case "/refresh": return json(await refresh(body), 200, origin);
        case "/ams":
          if (!token) return json({ error: "Mangler Bambu-token" }, 401, origin);
          return json(await ams(token), 200, origin);
        case "/library":
          if (!token) return json({ error: "Mangler Bambu-token" }, 401, origin);
          return json(await library(token), 200, origin);
        case "/sitemap": return await sitemap(origin);
        case "/store-product": return await storeProduct(body, origin);
        default: return json({ error: "Ukjent endepunkt" }, 404, origin);
      }
    } catch (err) {
      return json({ error: err.message || String(err) }, err.status || 502, origin);
    }
  },
};

// ---------- Innlogging ----------

function fail(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

// Billett for /send-code: signert med en hemmelig nøkkel (TICKET_SECRET, satt med
// `wrangler secret put`) og gyldig i 10 minutter. Den utstedes bare når Bambu ber om
// e-postkode etter en innlogging, så proxyen ikke kan brukes til å sende Bambu-e-post
// til vilkårlige adresser.
const TICKET_MS = 10 * 60 * 1000;

async function hmac(secret, text) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(text)));
  return btoa(String.fromCharCode(...sig)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function makeTicket(email, env) {
  if (!env?.TICKET_SECRET) throw fail("Proxyen mangler TICKET_SECRET", 500);
  const exp = Date.now() + TICKET_MS;
  return `${exp}.${await hmac(env.TICKET_SECRET, `${email.toLowerCase()}|${exp}`)}`;
}

async function checkTicket(email, ticket, env) {
  const [exp, sig] = String(ticket || "").split(".");
  if (!env?.TICKET_SECRET || !exp || !sig || Number(exp) < Date.now()) return false;
  const expected = await hmac(env.TICKET_SECRET, `${email.toLowerCase()}|${exp}`);
  // Sammenligning i konstant tid
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

// Steg 1: e-post + passord. Steg 2 (hvis Bambu ber om det): e-post + kode fra e-post.
async function login({ account, password, code }, env) {
  if (typeof account !== "string" || !account || (!password && !code)) throw fail("Mangler e-post og passord eller kode");
  const body = code ? { account, code: String(code) } : { account, password: String(password), apiError: "" };
  const { status, data } = await bambu("/v1/user-service/user/login", { method: "POST", body });
  if (data.accessToken) return { token: data.accessToken, refreshToken: data.refreshToken || "", expiresIn: data.expiresIn || null };
  if (data.loginType === "verifyCode") return { step: "code", ticket: await makeTicket(account, env) };
  if (data.loginType === "tfa") return { step: "tfa", tfaKey: data.tfaKey };
  throw fail(data.error || data.message || `Innlogging feilet (${status})`, status === 200 ? 400 : status);
}

async function sendCode({ email, ticket }, env) {
  if (typeof email !== "string" || !email) throw fail("Mangler e-post");
  if (!(await checkTicket(email, ticket, env))) throw fail("Logg inn med e-post og passord først.", 403);
  const { status, data } = await bambu("/v1/user-service/user/sendemail/code", {
    method: "POST",
    body: { email, type: "codeLogin" },
  });
  if (status >= 400) throw fail(data.error || data.message || `Kunne ikke sende kode (${status})`, status);
  return { sent: true };
}

// Tofaktor med autentiseringsapp. Bambu krever en CSRF-nøkkel først, og tokenen kommer som cookie.
async function tfa({ tfaKey, tfaCode }) {
  if (!tfaKey || !tfaCode) throw fail("Mangler kode");
  const csrfRes = await fetch("https://bambulab.com/api/csrf", { headers: { "User-Agent": "BambuFilament/1.0" } });
  const csrfCookies = csrfRes.headers.getSetCookie ? csrfRes.headers.getSetCookie().join(";") : csrfRes.headers.get("Set-Cookie") || "";
  const csrf = (csrfCookies.match(/bbl_csrf_token=([^;]+)/) || [])[1];
  if (!csrf) throw fail(`Fikk ikke CSRF-nøkkel fra Bambu (${csrfRes.status})`, 502);
  const res = await fetch("https://bambulab.com/api/sign-in/tfa", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "BambuFilament/1.0",
      "x-bbl-csrf-token": csrf,
      Cookie: `bbl_csrf_token=${csrf}`,
    },
    body: JSON.stringify({ tfaKey, tfaCode }),
  });
  const cookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get("Set-Cookie") || ""];
  const all = cookies.join(";");
  const match = all.match(/(?:^|[;,\s])token=([^;]+)/);
  if (!match) throw fail(`Feil kode (${res.status})`, 401);
  const refreshMatch = all.match(/(?:^|[;,\s])refreshToken=([^;]+)/);
  return { token: match[1], refreshToken: refreshMatch ? refreshMatch[1] : "" };
}

// Fornyer tilgangsnøkkelen uten ny innlogging.
async function refresh({ refreshToken }) {
  if (!refreshToken) throw fail("Mangler refresh-token", 401);
  const { status, data } = await bambu("/v1/user-service/user/refreshtoken", { method: "POST", body: { refreshToken } });
  if (!data.accessToken) throw fail(data.error || data.message || `Kunne ikke fornye innloggingen (${status})`, 401);
  return { token: data.accessToken, refreshToken: data.refreshToken || refreshToken, expiresIn: data.expiresIn || null };
}

// ---------- Filamentbibliotek (Filament Manager i Bambu Studio / Handy) ----------

async function library(token) {
  const spools = [];
  for (let offset = 0, page = 0; page < 20; page++) {
    const { status, data } = await bambu(`/v1/design-user-service/my/filament/v2?offset=${offset}&limit=100`, { token });
    if (status === 401) throw fail("Bambu-innloggingen er utløpt. Koble til på nytt.", 401);
    if (status >= 400) throw fail(data?.error || `Kunne ikke hente filamentbiblioteket (${status})`, status);
    const hits = (data.hits || []).filter((h) => h && typeof h === "object");
    spools.push(...hits);
    offset += hits.length;
    if (!hits.length || typeof data.total !== "number" || offset >= data.total) break;
  }
  const hex = (c) => (typeof c === "string" ? c.replace(/^#/, "").toUpperCase() : "");
  return {
    updated: new Date().toISOString(),
    spools: spools.map((s) => ({
      vendor: s.filamentVendor || "",
      name: s.filamentName || s.displayName || "",
      type: s.filamentType || "",
      filamentId: s.filamentId || "",
      color: hex(s.color),
      colors: Array.isArray(s.colors) ? s.colors.map(hex).filter(Boolean) : [],
      net: Number(s.netWeight) || 0,
      total: Number(s.totalNetWeight) || 0,
      rfid: (s.RFID || "").toUpperCase(),
      note: s.note || "",
      // trayIdName er Bambu sin variant-ID (f.eks. "A01-G7"), ikke plasseringen.
      variant: s.trayIdName || "",
      device: s.deviceName || "",
    })),
  };
}

// Nettstedskartet til Bambu-butikken, for katalogskriptet når butikken avviser GitHub sine servere.
async function sitemap(origin) {
  const res = await fetch("https://eu.store.bambulab.com/sitemap_products_1.xml", {
    headers: { "User-Agent": "Mozilla/5.0 (BambuFilament catalog)" },
  });
  return new Response(res.body, {
    status: res.status,
    headers: { "Content-Type": "application/xml; charset=utf-8", ...cors(origin) },
  });
}

// Produkt med lagerstatus per SKU fra Bambu-butikken (EU), for katalogskriptet.
async function storeProduct({ seoCode }, origin) {
  if (!/^[a-z0-9-]+$/.test(seoCode || "")) throw fail("Ugyldig produkt");
  const res = await fetch(`https://eu-store-api.bambulab.com/mall-goods/product/queryDrawer?seoCode=${seoCode}`, {
    headers: {
      Accept: "application/json",
      "Bbl-Locale": "en-US",
      "X-BBL-STORE-REGION": "EU",
      "X-BBL-TIME-ZONE": "Europe/Oslo",
      "User-Agent": "Mozilla/5.0 (BambuFilament catalog)",
    },
  });
  return new Response(res.body, { status: res.status, headers: { "Content-Type": "application/json", ...cors(origin) } });
}

// ---------- AMS ----------

async function userId(token) {
  const pref = await bambu("/v1/design-user-service/my/preference", { token });
  if (pref.status === 401) throw fail("Bambu-innloggingen er utløpt. Koble til på nytt.", 401);
  if (pref.data?.uid) return String(pref.data.uid);
  // Eldre tokener er JWT med brukernavn.
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    if (payload.username) return payload.username.replace(/^u_/, "");
  } catch { /* ignorer */ }
  throw fail("Fant ikke Bambu-bruker-ID", 502);
}

async function ams(token) {
  const bind = await bambu("/v1/iot-service/api/user/bind", { token });
  if (bind.status === 401) throw fail("Bambu-innloggingen er utløpt. Koble til på nytt.", 401);
  if (bind.status >= 400) throw fail(bind.data?.error || `Kunne ikke hente printere (${bind.status})`, bind.status);
  const devices = bind.data.devices || [];
  const online = devices.filter((d) => d.online).map((d) => d.dev_id);

  let reports = {};
  if (online.length) {
    const uid = await userId(token);
    reports = await fetchReports(`u_${uid}`, token, online);
  }

  return {
    updated: new Date().toISOString(),
    printers: devices.map((d) => ({
      id: d.dev_id,
      name: d.name,
      model: d.dev_product_name || d.dev_model_name || "",
      online: !!d.online,
      ...normalize(reports[d.dev_id]),
    })),
  };
}

const intOrNull = (v) => (v === undefined || v === null || v === "" ? null : Number(v));

function tray(t, slot) {
  if (!t || (!t.tray_type && !t.tray_info_idx)) return { slot, empty: true };
  return {
    slot,
    type: t.tray_type || "",
    subBrand: t.tray_sub_brands || "",
    color: t.tray_color || "",
    cols: Array.isArray(t.cols) ? t.cols : [],
    infoIdx: t.tray_info_idx || "",
    remain: intOrNull(t.remain),
    weight: intOrNull(t.tray_weight),
    nozzleMin: intOrNull(t.nozzle_temp_min),
    nozzleMax: intOrNull(t.nozzle_temp_max),
    uuid: t.tray_uuid && !/^0+$/.test(t.tray_uuid) ? t.tray_uuid : "",
  };
}

function normalize(report) {
  if (!report) return { ams: [], external: [], reported: false };
  const units = report.ams?.ams || [];
  const external = [].concat(report.vir_slot || report.vt_tray || []).map((t, i) => tray(t, i));
  return {
    reported: true,
    ams: units.map((u) => ({
      unit: Number(u.id),
      humidity: intOrNull(u.humidity_raw ?? u.humidity),
      humidityLevel: intOrNull(u.humidity),
      temp: u.temp !== undefined ? Number(u.temp) : null,
      trays: (u.tray || []).map((t) => tray(t, Number(t.id))),
    })),
    external,
  };
}

// ---------- Minimal MQTT 3.1.1-klient over TLS ----------

const enc = new TextEncoder();
const dec = new TextDecoder();

function str(s) {
  const b = enc.encode(s);
  return [b.length >> 8, b.length & 255, ...b];
}

function packet(type, body) {
  const len = [];
  let n = body.length;
  do {
    let byte = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) byte |= 128;
    len.push(byte);
  } while (n > 0);
  return new Uint8Array([type, ...len, ...body]);
}

const connectPacket = (clientId, user, pass) =>
  packet(0x10, [...str("MQTT"), 4, 0xc2, 0, 60, ...str(clientId), ...str(user), ...str(pass)]);
const subscribePacket = (id, topic) => packet(0x82, [id >> 8, id & 255, ...str(topic), 0]);
const publishPacket = (topic, payload) => packet(0x30, [...str(topic), ...enc.encode(payload)]);

// Kobler til Bambu sin MQTT-broker, ber hver printer om full status (pushall)
// og venter på svarene. Returnerer { serienummer: print-objekt }.
async function fetchReports(user, token, serials) {
  const socket = connect({ hostname: MQTT_HOST, port: MQTT_PORT }, { secureTransport: "on" });
  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();
  const reports = {};
  let buffer = new Uint8Array(0);
  let connected = false;

  const deadline = Date.now() + REPORT_TIMEOUT_MS;
  const timeout = (ms) => new Promise((r) => setTimeout(() => r({ timeout: true }), ms));

  try {
    await writer.write(connectPacket(`bf_${crypto.randomUUID().slice(0, 12)}`, user, token));

    while (Date.now() < deadline && Object.keys(reports).length < serials.length) {
      const chunk = await Promise.race([reader.read(), timeout(deadline - Date.now())]);
      if (chunk.timeout || chunk.done) break;
      const merged = new Uint8Array(buffer.length + chunk.value.length);
      merged.set(buffer);
      merged.set(chunk.value, buffer.length);
      buffer = merged;

      // Les ut alle hele pakker i bufferet.
      while (buffer.length >= 2) {
        let mult = 1, len = 0, i = 1, byte;
        do {
          if (i >= buffer.length) break;
          byte = buffer[i++];
          len += (byte & 127) * mult;
          mult *= 128;
        } while (byte & 128);
        if (byte & 128 || i + len > buffer.length) break;
        const header = buffer[0];
        const type = header >> 4;
        const body = buffer.subarray(i, i + len);
        buffer = buffer.slice(i + len);

        if (type === 2) {
          if (body[1] !== 0) throw fail(body[1] === 5 ? "Bambu avviste MQTT-innloggingen (utløpt token?)" : `MQTT-feil ${body[1]}`, 401);
          connected = true;
          let id = 1;
          for (const sn of serials) {
            await writer.write(subscribePacket(id++, `device/${sn}/report`));
            await writer.write(publishPacket(`device/${sn}/request`, JSON.stringify({ pushing: { sequence_id: "0", command: "pushall" } })));
          }
        } else if (type === 3) {
          const qos = (header >> 1) & 3;
          const topicLen = (body[0] << 8) | body[1];
          const topic = dec.decode(body.subarray(2, 2 + topicLen));
          const sn = topic.split("/")[1];
          try {
            const msg = JSON.parse(dec.decode(body.subarray(2 + topicLen + (qos ? 2 : 0))));
            if (msg.print?.ams) reports[sn] = msg.print;
          } catch { /* ufullstendig eller annen melding */ }
        }
      }
    }
    if (!connected) throw fail("Fikk ikke kontakt med Bambu sin MQTT-server", 504);
  } finally {
    try { await writer.write(new Uint8Array([0xe0, 0])); } catch { /* DISCONNECT */ }
    try { await socket.close(); } catch { /* ignorer */ }
  }
  return reports;
}

// ---------- Brukere: registrering og midlertidig passord på e-post ----------
//
// Brukerne logger inn ved å dekryptere GitHub-tokenen med passordet sitt (se auth.js).
// Workeren lager et tilfeldig passord, krypterer tokenen med det og lagrer resultatet
// som users[].reset i BambuFilament-auth. Det vanlige passordet virker fortsatt, så
// ingen kan stenge andre ute ved å be om nye passord. Siden krever passordbytte etter
// innlogging med det midlertidige passordet, og fjerner det da.
//
// E-postadresser og ventende registreringer ligger i contacts.json i det private
// data-repoet: { emails: { navn: adresse }, pending: [{ name, email, at }] }.

const DATA_REPO = "saysphilippe/BambuFilament-data";
const AUTH_REPO = "saysphilippe/BambuFilament-auth";
const SITE_URL = "https://saysphilippe.github.io/BambuFilament/";
const RESET_TTL_MS = 3600e3;
const MAX_PENDING = 20;
const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,38}[\p{L}\p{N}]$/u;

async function github(path, tok, init = {}) {
  return fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${tok}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "BambuFilament-proxy",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
  });
}

const toB64 = (bytes) => {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
const fromB64 = (text) => Uint8Array.from(atob(text.replace(/\s/g, "")), (c) => c.charCodeAt(0));
const utf8 = (text) => new TextEncoder().encode(text);

async function readJson(repo, path, tok) {
  const res = await github(`/repos/${repo}/contents/${path}?ref=main`, tok);
  if (res.status === 404) return { doc: null };
  if (!res.ok) throw fail(`GitHub svarte ${res.status} ved henting av ${path}`, 502);
  const meta = await res.json();
  return { doc: JSON.parse(new TextDecoder().decode(fromB64(meta.content))), sha: meta.sha };
}

// Henter, lar mutate endre (returnerer false = ikke lagre) og lagrer. Prøver på nytt ved konflikt.
async function updateJson(repo, path, tok, empty, mutate, message) {
  for (let attempt = 0; ; attempt++) {
    const { doc, sha } = await readJson(repo, path, tok);
    const next = doc || empty();
    if (mutate(next) === false) return false;
    const res = await github(`/repos/${repo}/contents/${path}`, tok, {
      method: "PUT",
      body: JSON.stringify({ message, branch: "main", sha, content: toB64(utf8(JSON.stringify(next, null, 2) + "\n")) }),
    });
    if (res.ok) return true;
    if (res.status !== 409 || attempt >= 2) throw fail(`GitHub svarte ${res.status} ved lagring`, 502);
  }
}

const emptyContacts = () => ({ version: 1, emails: {}, pending: [] });

async function siteToken(env) {
  const tok = await env.RESET_KV?.get("github-token");
  if (!tok || !env.GMAIL_USER || !env.GMAIL_APP_PASSWORD) throw fail("E-post er ikke satt opp ennå. Spør administrator.", 503);
  return tok;
}

// Siden sender tokenen sin hit når administrator er innlogget. Den godtas bare hvis den
// kan skrive til begge repoene (bare eieren kan lage en slik token).
async function saveResetToken(tok, env) {
  if (!env.RESET_KV) throw fail("RESET_KV er ikke satt opp", 500);
  if ((await env.RESET_KV.get("github-token")) === tok) return { ok: true };
  for (const repo of [AUTH_REPO, DATA_REPO]) {
    const res = await github(`/repos/${repo}`, tok);
    const info = res.ok ? await res.json() : null;
    if (!info?.permissions?.push) throw fail("Tokenen har ikke skrivetilgang til begge repoene", 403);
  }
  await env.RESET_KV.put("github-token", tok);
  return { ok: true };
}

// Passord som "k7mq-x4tp-9hzr-c2wd": 16 tegn fra 31 = ca. 79 bit.
function resetPassword() {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("").match(/.{4}/g).join("-");
}

// Samme format som auth.js leser (kdf "hkdf").
async function encryptReset(tok, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const base = await crypto.subtle.importKey("raw", utf8(password), "HKDF", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt, info: utf8("BambuFilament reset") },
    base, { name: "AES-GCM", length: 256 }, false, ["encrypt"],
  );
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, utf8(tok)));
  return { kdf: "hkdf", salt: toB64(salt), iv: toB64(iv), data: toB64(data) };
}

// who er brukernavn eller e-postadresse. Svaret er det samme om brukeren finnes eller
// ikke, så det ikke avslører hvilke adresser som er registrert.
async function sendReset(who, env) {
  const done = { ok: true };
  if (!who) throw fail("Skriv brukernavn eller e-post");
  const tok = await siteToken(env);

  const { doc: contacts } = await readJson(DATA_REPO, "contacts.json", tok);
  const emails = contacts?.emails || {};
  const name = Object.keys(emails).find((n) => n.toLowerCase() === who || String(emails[n]).toLowerCase() === who);
  const email = name && String(emails[name]).trim();
  if (!email || !EMAIL_RE.test(email)) return done;

  const password = resetPassword();
  const reset = { ...(await encryptReset(tok, password)), exp: new Date(Date.now() + RESET_TTL_MS).toISOString() };
  const saved = await updateJson(AUTH_REPO, "users.json", tok, () => ({ version: 1, users: [] }), (doc) => {
    const u = doc.users?.find((x) => x.name === name);
    if (!u) return false;
    u.reset = reset;
  }, `Midlertidig passord på e-post (${name})`);
  if (!saved) return done;

  await sendMail(env, email, "Midlertidig passord til BambuFilament", [
    `Hei ${name}!`,
    "",
    "Her er et midlertidig passord til BambuFilament:",
    "",
    `    ${password}`,
    "",
    `Logg inn på ${SITE_URL} som ${name} innen én time. Du blir bedt om å velge ditt eget passord.`,
    "",
    "Ba du ikke om dette, kan du se bort fra e-posten. Et passord du har fra før, virker fortsatt.",
  ].join("\n"));
  return done;
}

// Ny bruker ber om tilgang. Administrator godkjenner i brukeroversikten på siden.
async function register({ name, email }, env) {
  name = String(name || "").trim().replace(/\s+/g, " ");
  email = String(email || "").trim().toLowerCase();
  if (!NAME_RE.test(name)) throw fail("Brukernavnet må ha 2–40 tegn: bokstaver, tall, mellomrom, punktum, bindestrek eller understrek.");
  if (email.length > 100 || !EMAIL_RE.test(email)) throw fail("Skriv en gyldig e-postadresse.");
  const tok = await siteToken(env);

  const { doc: auth } = await readJson(AUTH_REPO, "users.json", tok);
  const lower = name.toLowerCase();
  if ((auth?.users || []).some((u) => String(u.name).toLowerCase() === lower)) throw fail("Brukernavnet er tatt. Velg et annet.", 409);

  let problem = "";
  const added = await updateJson(DATA_REPO, "contacts.json", tok, emptyContacts, (doc) => {
    doc.emails ||= {};
    doc.pending = Array.isArray(doc.pending) ? doc.pending : [];
    // Adressen er allerede i bruk: svar som vanlig, uten å avsløre det.
    if (Object.values(doc.emails).some((e) => String(e).toLowerCase() === email)) return false;
    if (doc.pending.some((p) => p.email === email)) return false;
    if (doc.pending.some((p) => p.name.toLowerCase() === lower)) { problem = "Brukernavnet er tatt. Velg et annet."; return false; }
    if (doc.pending.length >= MAX_PENDING) { problem = "Det er for mange ventende forespørsler. Prøv igjen senere."; return false; }
    doc.pending.push({ name, email, at: new Date().toISOString() });
  }, `Registrering: ${name}`);
  if (problem) throw fail(problem, 409);

  // Varsel til administrator; en feil her skal ikke stoppe registreringen.
  if (added) {
    await sendMail(env, env.GMAIL_USER, `Ny bruker venter: ${name}`, [
      `${name} (${email}) har bedt om tilgang til BambuFilament.`,
      "",
      `Godkjenn eller avvis under Brukere på ${SITE_URL}`,
    ].join("\n")).catch((err) => console.warn("Varsel feilet:", err.message));
  }
  return { ok: true };
}

// ---------- SMTP (Gmail) ----------
//
// Gmail med app-passord (secrets GMAIL_USER og GMAIL_APP_PASSWORD), over TLS på port 465.

const SMTP_TIMEOUT_MS = 15000;

const encodeHeader = (text) => (/^[\x20-\x7e]*$/.test(text) ? text : `=?UTF-8?B?${toB64(utf8(text))}?=`);

async function sendMail(env, to, subject, text) {
  const from = String(env.GMAIL_USER).trim();
  const socket = connect({ hostname: "smtp.gmail.com", port: 465 }, { secureTransport: "on" });
  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  // Leser et helt svar (flere linjer "250-..." avsluttes med "250 ...").
  async function reply() {
    for (;;) {
      const lines = buf.split("\r\n");
      const end = lines.slice(0, -1).findIndex((l) => /^\d{3}( |$)/.test(l));
      if (end >= 0) {
        buf = lines.slice(end + 1).join("\r\n");
        return lines.slice(0, end + 1).join("\n");
      }
      const { value, done } = await reader.read();
      if (done) throw fail("E-posttjeneren lukket forbindelsen", 502);
      buf += decoder.decode(value, { stream: true });
    }
  }
  async function step(line, code) {
    if (line !== null) await writer.write(utf8(line + "\r\n"));
    const r = await reply();
    if (!r.startsWith(code)) throw fail(`Kunne ikke sende e-post (${r.split("\n").pop().slice(0, 120)})`, 502);
  }

  const message = [
    `From: ${encodeHeader("BambuFilament")} <${from}>`,
    `To: <${to}>`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${new Date().toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${crypto.randomUUID()}@bambufilament>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    toB64(utf8(text)).match(/.{1,76}/g).join("\r\n"),
  ].join("\r\n");

  const talk = async () => {
    await step(null, "220");
    await step("EHLO bambufilament", "250");
    // Google viser app-passordet med mellomrom ("abcd efgh ..."), men de er ikke en del av det.
    const pass = String(env.GMAIL_APP_PASSWORD).replace(/\s/g, "");
    await step(`AUTH PLAIN ${toB64(utf8(`\0${from}\0${pass}`))}`, "235");
    await step(`MAIL FROM:<${from}>`, "250");
    await step(`RCPT TO:<${to}>`, "250");
    await step("DATA", "354");
    await step(`${message}\r\n.`, "250");
    await writer.write(utf8("QUIT\r\n")).catch(() => {});
  };
  let timer;
  try {
    await Promise.race([
      talk(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(fail("E-posttjeneren svarte ikke", 504)), SMTP_TIMEOUT_MS); }),
    ]);
  } finally {
    clearTimeout(timer);
    socket.close().catch(() => {});
  }
}
