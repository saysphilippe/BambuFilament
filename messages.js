// Meldinger mellom brukerne, og hvem som er pålogget.
//
// Teksten krypteres i nettleseren til den offentlige nøkkelen til hver mottaker og avsenderen
// (auth.js: sealMessage/openMessage), så bare de kan lese den, selv om alle innloggede kan hente
// postene fra databasen. Den private nøkkelen dekrypteres med passordet ved innlogging og holdes
// i innloggingen (session.mk).
//
// D1 (filen «messages»):
//   messages  { id, from, to: [navn], at, enc }        (enc = kryptert tekst og nøkler)
//   msgread   id = navn: { at, hidden: [id] }           (innboksen sist lest, skjulte meldinger)
//   presence  id = navn: { at, off }                    (siden åpen, oppdateres hvert 2. minutt)

import { sealMessage, openMessage } from "./auth.js?v=20261009202254";

const MAX_TEXT = 4000;
const MAX_HIDDEN = 1000;
const ONLINE_MS = 5 * 60 * 1000;
const POLL_MS = 60 * 1000;
const BEAT_MS = 2 * 60 * 1000;

let ctx = null;
const mstate = { messages: [], read: {}, presence: {}, loaded: false, view: "inbox", to: new Set(), draft: "", notify: true, plain: new Map(), status: "" };

const me = () => ctx.userName();
// Når innboksen var lest før vinduet ble åpnet: meldinger etter dette er merket «ny» til det lukkes.
let seenBefore = null;
const mine = (m) => m.from === me();
const toMe = (m) => Array.isArray(m.to) && m.to.includes(me()) && !mine(m);
const hidden = () => new Set(mstate.read[me()]?.hidden || []);
const inbox = () => { const h = hidden(); return mstate.messages.filter((m) => toMe(m) && !h.has(m.id)).reverse(); };
const sent = () => mstate.messages.filter(mine).reverse();
const unread = () => { const r = mstate.read[me()]?.at || ""; return inbox().filter((m) => m.at > r).length; };

// Brukere som kan motta meldinger (har nøkkelpar), utenom en selv.
const recipients = () => ctx.users().filter((u) => u.kp?.pub && u.name !== me());

// ---------- Pålogget / sist innlogget ----------

const time = (iso) => (iso ? new Date(iso).getTime() : 0);
function lastSeen(name) {
  const p = mstate.presence[name];
  return Math.max(time(p?.at), time(ctx.lastSeen(name)));
}
const isOnline = (name) => {
  const p = mstate.presence[name];
  return !!p && !p.off && Date.now() - time(p.at) < ONLINE_MS;
};
function ago(t) {
  if (!t) return "aldri";
  const min = Math.round((Date.now() - t) / 60000);
  if (min < 2) return "nå nettopp";
  if (min < 60) return `for ${min} min siden`;
  const h = Math.round(min / 60);
  if (h < 24) return `for ${h} t siden`;
  const d = Math.round(h / 24);
  if (d < 14) return `for ${d} ${d === 1 ? "dag" : "dager"} siden`;
  return `${new Date(t).toLocaleDateString("nb-NO", { day: "numeric", month: "short", year: "numeric" })}`;
}
function presenceHtml(name, short = false) {
  if (isOnline(name)) return `<span class="presence on" title="Har siden åpen nå"><i></i>Pålogget nå</span>`;
  const t = lastSeen(name);
  const exact = t ? new Date(t).toLocaleString("nb-NO", { dateStyle: "medium", timeStyle: "short" }) : "";
  return `<span class="presence" title="${ctx.esc(exact)}"><i></i>${short ? "" : "Sist innlogget "}${ago(t)}</span>`;
}
const stamp = (iso) => new Date(iso).toLocaleString("nb-NO", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

// ---------- Data ----------

export async function loadMessages() {
  if (ctx.DEMO || !ctx.token()) return;
  try {
    const { messages } = await ctx.dbCall("/db/load", { files: ["messages"] });
    mstate.messages = (messages?.messages || []).filter((m) => m?.id && m.from && Array.isArray(m.to) && m.at);
    mstate.read = messages?.read || {};
    mstate.presence = messages?.presence || {};
    mstate.loaded = true;
    renderBadge();
    if ($dlg().open) render();
  } catch (err) {
    console.warn("Kunne ikke hente meldinger:", err.message);
  }
}

async function patch(ops) {
  if (ctx.DEMO) return;
  await ctx.dbCall("/db/patch", { ops });
}

// Siden er åpen: lagres hvert 2. minutt så andre ser «Pålogget nå».
async function heartbeat(off = false) {
  const name = me();
  if (!name || ctx.DEMO || !ctx.token()) return;
  const data = { at: new Date().toISOString(), ...(off ? { off: true } : {}) };
  mstate.presence[name] = data;
  try { await patch([{ coll: "presence", id: name, data }]); } catch { /* prøves igjen neste gang */ }
}
// Ved utlogging (kalles før tokenen fjernes).
export const signOff = () => heartbeat(true);

async function saveRead(changes) {
  const data = { ...(mstate.read[me()] || {}), ...changes };
  data.hidden = (data.hidden || []).slice(-MAX_HIDDEN);
  mstate.read[me()] = data;
  await patch([{ coll: "msgread", id: me(), data }]);
}

async function textOf(m) {
  if (mstate.plain.has(m.id)) return mstate.plain.get(m.id);
  const text = ctx.DEMO ? m.text : await openMessage(m.enc, me(), ctx.msgKey());
  if (text !== null) mstate.plain.set(m.id, text);
  return text;
}

async function send() {
  const text = mstate.draft.trim();
  const to = [...mstate.to].filter((n) => recipients().some((u) => u.name === n));
  if (!to.length) throw new Error("Velg minst én mottaker.");
  if (!text) throw new Error("Skriv en melding.");
  if (text.length > MAX_TEXT) throw new Error(`Meldingen er for lang (høyst ${MAX_TEXT} tegn).`);
  const at = new Date().toISOString();
  const id = `${at.replace(/\D/g, "").slice(0, 14)}-${Math.random().toString(36).slice(2, 8)}`;
  const m = { id, from: me(), to, at };
  if (ctx.DEMO) m.text = text;
  else {
    const pubs = {};
    for (const u of ctx.users()) if (u.kp?.pub && (to.includes(u.name) || u.name === me())) pubs[u.name] = u.kp.pub;
    m.enc = await sealMessage(text, pubs);
    await patch([{ coll: "messages", id, data: m }]);
  }
  mstate.messages.push(m);
  mstate.plain.set(id, text);
  if (mstate.notify && !ctx.DEMO) ctx.proxy("/msg-notify", { to, from: me() }, ctx.token()).catch((err) => console.warn("Varsel feilet:", err.message));
  mstate.draft = "";
  mstate.to.clear();
  mstate.view = "sent";
  mstate.status = `Sendt til ${to.join(", ")}.`;
}

// ---------- Visning ----------

const $dlg = () => document.getElementById("messages");

function renderBadge() {
  const btn = document.getElementById("open-messages");
  if (!btn) return;
  btn.hidden = !ctx.DEMO && !ctx.token();
  const n = ctx.token() || ctx.DEMO ? unread() : 0;
  btn.querySelector(".msg-badge").textContent = n ? String(n) : "";
  btn.querySelector(".msg-badge").hidden = !n;
  btn.title = n ? `Meldinger (${n} uleste)` : "Meldinger";
}

function msgCard(m, text) {
  const others = m.to.filter((n) => n !== me());
  const toText = mine(m) ? `Til ${others.map((n) => `<b>${ctx.esc(n)}</b>`).join(", ")}` : `Til deg${others.length ? ` og ${others.map(ctx.esc).join(", ")}` : ""}`;
  const isNew = !mine(m) && m.at > (seenBefore ?? mstate.read[me()]?.at ?? "");
  const people = mine(m) ? others : [m.from];
  return `<article class="msg${isNew ? " new" : ""}">
    <header class="msg-meta">
      ${mine(m) ? "" : `<span class="msg-dot" style="background:${ctx.userColor(m.from)}"></span><b>${ctx.esc(m.from)}</b>`}
      <span class="muted">${toText}</span>
      <span class="msg-time muted">${ctx.esc(stamp(m.at))}</span>
    </header>
    <div class="msg-text">${text === null ? `<span class="muted">Kan ikke leses her. ${ctx.msgKey() ? "Meldingen ble sendt før nøkkelen din ble laget på nytt (passord tilbakestilt)." : "Logg inn på nytt for å lese meldinger."}</span>` : ctx.esc(text)}</div>
    <footer class="msg-actions">
      <span class="msg-people">${people.map((n) => `<span class="msg-person">${others.length > 1 || mine(m) ? `${ctx.esc(n)}: ` : ""}${presenceHtml(n)}</span>`).join("")}</span>
      <span class="spacer"></span>
      ${mine(m) ? `<button type="button" class="btn btn-small" data-msgdel="${ctx.esc(m.id)}">Slett</button>`
        : `<button type="button" class="btn btn-small" data-msghide="${ctx.esc(m.id)}">Skjul</button>
           ${others.length ? `<button type="button" class="btn btn-small" data-msgreply="${ctx.esc(m.id)}" data-all="1">Svar alle</button>` : ""}
           <button type="button" class="btn btn-small btn-primary" data-msgreply="${ctx.esc(m.id)}">Svar</button>`}
    </footer>
  </article>`;
}

function composeHtml() {
  const list = recipients().sort((a, b) => isOnline(b.name) - isOnline(a.name) || a.name.localeCompare(b.name, "nb"));
  const noKey = ctx.users().filter((u) => !u.kp?.pub && u.name !== me() && u.known !== false);
  const allOn = list.length && list.every((u) => mstate.to.has(u.name));
  return `<form class="msg-compose" data-msgform>
    <div class="msg-to-head"><span class="chip-label">Til</span><button type="button" class="linkbtn" data-msgall>${allOn ? "Fjern alle" : "Velg alle"}</button></div>
    <div class="msg-to">
      ${list.map((u) => `<label class="msg-rcpt${mstate.to.has(u.name) ? " on" : ""}"><input type="checkbox" data-msgto="${ctx.esc(u.name)}"${mstate.to.has(u.name) ? " checked" : ""}>
        <span class="msg-dot" style="background:${ctx.userColor(u.name)}"></span><span class="msg-rcpt-name">${ctx.esc(u.name)}</span>${presenceHtml(u.name, true)}</label>`).join("") || `<p class="hint">Ingen andre brukere kan motta meldinger ennå.</p>`}
    </div>
    ${noKey.length ? `<p class="hint">Kan ikke motta meldinger før de har logget inn: ${noKey.map((u) => ctx.esc(u.name)).join(", ")}.</p>` : ""}
    <label class="msg-text-label">Melding<textarea id="msg-text" rows="5" maxlength="${MAX_TEXT}" placeholder="Skriv en melding …">${ctx.esc(mstate.draft)}</textarea></label>
    <label class="switch"><input type="checkbox" data-msgnotify${mstate.notify ? " checked" : ""}> Varsle mottakerne på e-post eller WhatsApp (etter det de har valgt)</label>
    <p class="hint">Meldingen krypteres, så bare du og mottakerne kan lese den.</p>
    <div class="d-buttons"><span class="spacer"></span><button type="submit" class="btn btn-primary">Send</button></div>
  </form>`;
}

async function render() {
  const dlg = $dlg();
  if (!dlg) return;
  const n = unread();
  const online = ctx.users().filter((u) => u.name !== me() && isOnline(u.name)).map((u) => u.name);
  const tab = (v, label, count) => `<button type="button" class="chip${mstate.view === v ? " active" : ""}" data-msgview="${v}">${label}${count ? ` <span class="chip-n">${count}</span>` : ""}</button>`;
  const head = `<div class="msg-head">
      <h2>Meldinger</h2>
      <div class="chips">${tab("inbox", "Innboks", n)}${tab("sent", "Sendt")}${tab("new", "+ Ny melding")}</div>
      <button type="button" class="icon-btn msg-close" data-msgclose aria-label="Lukk" title="Lukk"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
    </div>
    <p class="msg-online muted">${online.length ? `<span class="presence on"><i></i></span>Pålogget nå: ${online.map(ctx.esc).join(", ")}` : "Ingen andre er pålogget nå."}
      · <button type="button" class="linkbtn" data-msgsettings>Varsler</button></p>
    ${mstate.status ? `<p class="msg-status" role="status">${ctx.esc(mstate.status)}</p>` : ""}
    ${!ctx.DEMO && !ctx.msgKey() ? `<p class="notice">For å lese meldinger må du logge inn på nytt én gang. <button type="button" class="btn btn-small" data-msgrelogin>Logg inn på nytt</button></p>` : ""}`;
  let body;
  if (mstate.view === "new") body = composeHtml();
  else {
    const list = mstate.view === "inbox" ? inbox() : sent();
    const texts = await Promise.all(list.slice(0, 200).map(textOf));
    body = list.length
      ? `<div class="msg-list">${list.slice(0, 200).map((m, i) => msgCard(m, texts[i])).join("")}</div>`
      : `<p class="hint msg-empty">${mstate.view === "inbox" ? "Ingen meldinger ennå." : "Du har ikke sendt noen meldinger."} <button type="button" class="linkbtn" data-msgview="new">Skriv en melding</button></p>`;
  }
  const keepFocus = document.activeElement?.id === "msg-text";
  dlg.querySelector(".msg-wrap").innerHTML = head + body;
  if (keepFocus) dlg.querySelector("#msg-text")?.focus();
}

export async function openMessages(view) {
  const dlg = $dlg();
  if (!dlg || (!ctx.DEMO && !ctx.token())) return;
  if (ctx.DEMO && !mstate.loaded) demoData();
  if (view) mstate.view = view;
  mstate.status = "";
  if (!dlg.open) dlg.showModal();
  await render();
  if (!mstate.loaded) await loadMessages();
  markRead();
}

// Innboksen er sett: uleste blir merket som lest (de beholder «ny»-merket til vinduet lukkes).
function markRead() {
  if (mstate.view !== "inbox" || !unread()) return;
  seenBefore ??= mstate.read[me()]?.at || "";
  saveRead({ at: inbox()[0].at }).catch(() => {});
  renderBadge();
}

function reply(m, all) {
  mstate.to = new Set([m.from, ...(all ? m.to : [])].filter((n) => n !== me()));
  mstate.view = "new";
  mstate.status = "";
  render().then(() => $dlg().querySelector("#msg-text")?.focus());
}

export function initMessages(c) {
  ctx = c;
  const dlg = document.createElement("dialog");
  dlg.id = "messages";
  dlg.className = "wide-dialog msg-dialog";
  dlg.tabIndex = -1;
  dlg.innerHTML = `<div class="msg-wrap"></div>`;
  document.body.append(dlg);
  dlg.addEventListener("close", () => {
    seenBefore = null;
    if (location.hash === "#messages") history.replaceState(null, "", location.pathname + location.search);
  });
  document.getElementById("open-messages")?.addEventListener("click", () => openMessages(unread() ? "inbox" : undefined));

  dlg.addEventListener("click", async (e) => {
    const t = e.target.closest("button, [data-msgview]");
    if (!t) return;
    if (t.dataset.msgclose !== undefined) return dlg.close();
    if (t.dataset.msgrelogin !== undefined) { dlg.close(); return ctx.relogin(); }
    if (t.dataset.msgsettings !== undefined) { dlg.close(); return ctx.openNotifySettings(); }
    if (t.dataset.msgview) {
      mstate.view = t.dataset.msgview;
      mstate.status = "";
      await render();
      markRead();
      if (mstate.view === "new") dlg.querySelector("#msg-text")?.focus();
      return;
    }
    if (t.dataset.msgall !== undefined) {
      const list = recipients().map((u) => u.name);
      mstate.to = list.every((n) => mstate.to.has(n)) ? new Set() : new Set(list);
      return render();
    }
    const find = (id) => mstate.messages.find((m) => m.id === id);
    if (t.dataset.msgreply) return reply(find(t.dataset.msgreply), !!t.dataset.all);
    if (t.dataset.msghide) {
      const h = [...hidden(), t.dataset.msghide];
      try { await saveRead({ hidden: h }); mstate.status = "Meldingen er skjult."; } catch (err) { mstate.status = err.message; }
      return render();
    }
    if (t.dataset.msgdel) {
      const id = t.dataset.msgdel;
      if (t.dataset.sure !== "1") { t.dataset.sure = "1"; t.textContent = "Slett for alle?"; t.classList.add("btn-danger"); return; }
      try {
        await patch([{ coll: "messages", id, data: null }]);
        mstate.messages = mstate.messages.filter((m) => m.id !== id);
        mstate.status = "Meldingen er slettet.";
      } catch (err) { mstate.status = err.message; }
      return render();
    }
  });
  dlg.addEventListener("change", (e) => {
    if (e.target.dataset.msgto) {
      const n = e.target.dataset.msgto;
      if (e.target.checked) mstate.to.add(n); else mstate.to.delete(n);
      e.target.closest(".msg-rcpt")?.classList.toggle("on", e.target.checked);
      const btn = dlg.querySelector("[data-msgall]");
      if (btn) btn.textContent = recipients().every((u) => mstate.to.has(u.name)) ? "Fjern alle" : "Velg alle";
    }
    if (e.target.hasAttribute("data-msgnotify")) mstate.notify = e.target.checked;
  });
  dlg.addEventListener("input", (e) => { if (e.target.id === "msg-text") mstate.draft = e.target.value; });
  dlg.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = dlg.querySelector(".msg-compose [type=submit]");
    btn.disabled = true;
    mstate.status = "Krypterer og sender …";
    try { await send(); }
    catch (err) { mstate.status = err.message; }
    btn.disabled = false;
    render();
  });

  renderBadge();
  setInterval(() => document.visibilityState === "visible" && loadMessages(), POLL_MS);
  setInterval(() => document.visibilityState === "visible" && heartbeat(), BEAT_MS);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { heartbeat(); loadMessages(); } });
}

// Ved inn- og utlogging.
export function messagesSession() {
  mstate.loaded = false;
  mstate.plain.clear();
  mstate.messages = [];
  renderBadge();
  if (ctx.token()) { heartbeat(); loadMessages().then(() => { if (location.hash === "#messages") openMessages("inbox"); }); }
  else $dlg()?.open && $dlg().close();
}

function demoData() {
  const names = ctx.users().map((u) => u.name).filter((n) => n !== me());
  const [a = "Kari", b = "Ola"] = names;
  const t = (min) => new Date(Date.now() - min * 60000).toISOString();
  mstate.messages = [
    { id: "d1", from: a, to: [me(), b], at: t(60 * 26), text: "Hei! Noen som har PETG-CF til overs? Trenger ca. 200 g til et braketprosjekt." },
    { id: "d2", from: me(), to: [a], at: t(60 * 25), text: "Jeg har en halv rull. Kan sjekke den ut til deg i morgen." },
    { id: "d3", from: b, to: [me()], at: t(14), text: "Fikk du ESP32-ene fra AliExpress? Jeg kan låne to hvis du har ekstra." },
  ];
  mstate.presence = { [a]: { at: t(1) }, [b]: { at: t(60 * 5) } };
  mstate.read = { [me()]: { at: t(60 * 24) } };
  mstate.loaded = true;
}
