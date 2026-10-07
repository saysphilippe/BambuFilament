// BambuFilament-proxy (Cloudflare Worker)
//
// Bambu sitt sky-API sender ikke CORS-headere, og MQTT kan ikke nås fra en
// nettleser. Denne Workeren videresender derfor innlogging og AMS-forespørsler
// fra github.io-siden. Den lagrer ingenting: Bambu-tokenen sendes med fra
// brukerens nettleser i hver forespørsel.

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
        case "/login": return json(await login(body), 200, origin);
        case "/send-code": return json(await sendCode(body), 200, origin);
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

// Steg 1: e-post + passord. Steg 2 (hvis Bambu ber om det): e-post + kode fra e-post.
async function login({ account, password, code }) {
  if (!account || (!password && !code)) throw fail("Mangler e-post og passord eller kode");
  const body = code ? { account, code } : { account, password, apiError: "" };
  const { status, data } = await bambu("/v1/user-service/user/login", { method: "POST", body });
  if (data.accessToken) return { token: data.accessToken, refreshToken: data.refreshToken || "", expiresIn: data.expiresIn || null };
  if (data.loginType === "verifyCode") return { step: "code" };
  if (data.loginType === "tfa") return { step: "tfa", tfaKey: data.tfaKey };
  throw fail(data.error || data.message || `Innlogging feilet (${status})`, status === 200 ? 400 : status);
}

async function sendCode({ email }) {
  if (!email) throw fail("Mangler e-post");
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
      location: [s.deviceName, s.trayIdName].filter(Boolean).join(" "),
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
