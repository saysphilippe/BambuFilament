// Forslag til forbedringer av siden. Alle innloggede kan foreslå og gi +1; administrator
// godkjenner eller avviser med en kommentar, og markerer forslag som ferdige.
//
// D1 (filen «ideas»): ideas { id, by, at, title, text, status, reply, replyBy, replyAt, likes: [navn] }
// status: new | approved | rejected | done

const STATUS = { new: "Nytt", approved: "Godkjent", rejected: "Avvist", done: "Ferdig" };
const VIEWS = [["open", "Åpne"], ["new", "Nye"], ["approved", "Godkjent"], ["done", "Ferdig"], ["rejected", "Avvist"], ["mine", "Mine"]];
const MAX_TITLE = 120;
const MAX_TEXT = 3000;

let ctx = null;
const istate = { ideas: [], loaded: false, view: "open", status: "", draft: { title: "", text: "" } };

const me = () => ctx.userName();
const admin = () => ctx.DEMO || ctx.isAdmin();
const clip = (t, n) => String(t || "").trim().slice(0, n);
const stamp = (iso) => (iso ? new Date(iso).toLocaleDateString("nb-NO", { day: "numeric", month: "short", year: "numeric" }) : "");

// Når brukeren sist så svarene på sine egne forslag (i nettleseren).
const seenKey = () => `bf.ideasSeen.${me()}`;
const answeredUnseen = () => {
  const seen = ctx.store(seenKey());
  return istate.ideas.filter((i) => i.by === me() && i.replyAt && i.replyAt > seen).length;
};
const badgeCount = () => (admin() ? istate.ideas.filter((i) => i.status === "new").length : 0) + answeredUnseen();

export async function loadIdeas() {
  if (ctx.DEMO || !ctx.token()) return;
  try {
    const { ideas } = await ctx.dbCall("/db/load", { files: ["ideas"] });
    istate.ideas = (ideas?.ideas || []).filter((i) => i?.id && i.title);
    istate.loaded = true;
    renderBadge();
    if ($dlg()?.open) render();
  } catch (err) {
    console.warn("Kunne ikke hente forslag:", err.message);
  }
}

async function save(idea) {
  if (!ctx.DEMO) await ctx.dbCall("/db/patch", { ops: [{ coll: "ideas", id: idea.id, data: idea }] });
}

const $dlg = () => document.getElementById("ideas");

function renderBadge() {
  const btn = document.getElementById("open-ideas");
  if (!btn) return;
  btn.hidden = !ctx.DEMO && !ctx.token();
  const n = ctx.token() || ctx.DEMO ? badgeCount() : 0;
  const b = btn.querySelector(".msg-badge");
  b.textContent = n ? String(n) : "";
  b.hidden = !n;
}

function visible() {
  const v = istate.view;
  const list = istate.ideas.filter((i) => v === "mine" ? i.by === me() : v === "open" ? i.status === "new" || i.status === "approved" : i.status === v);
  // Nyeste først, men godkjente med flest +1 øverst blant de åpne.
  return list.sort((a, b) => (v === "open" ? (b.likes?.length || 0) - (a.likes?.length || 0) : 0) || String(b.at).localeCompare(String(a.at)));
}

function card(i) {
  const e = ctx.esc;
  const liked = (i.likes || []).includes(me());
  const own = i.by === me();
  return `<article class="idea status-${e(i.status)}">
    <header class="idea-head">
      <span class="idea-status">${e(STATUS[i.status] || i.status)}</span>
      <h3>${e(i.title)}</h3>
    </header>
    ${i.text ? `<div class="idea-text">${e(i.text)}</div>` : ""}
    <p class="idea-meta muted"><span class="msg-dot" style="background:${ctx.userColor(i.by)}"></span>${e(i.by)} · ${e(stamp(i.at))}</p>
    ${i.reply || (i.status !== "new" && i.replyBy) ? `<div class="idea-reply"><b>${e(i.replyBy || "Administrator")}</b> <span class="muted">${e(stamp(i.replyAt))}</span>${i.reply ? `<div>${e(i.reply)}</div>` : ""}</div>` : ""}
    <footer class="idea-actions">
      <button type="button" class="btn btn-small${liked ? " btn-primary" : ""}" data-ilike="${e(i.id)}" ${own ? "disabled title=\"Ditt eget forslag\"" : ""} aria-pressed="${liked}">+1${i.likes?.length ? ` · ${i.likes.length}` : ""}</button>
      <span class="spacer"></span>
      ${own && i.status === "new" ? `<button type="button" class="btn btn-small" data-idel="${e(i.id)}">Trekk tilbake</button>` : ""}
    </footer>
    ${admin() ? `<div class="idea-admin">
      <textarea rows="2" maxlength="1000" placeholder="Kommentar til ${e(i.by)} (valgfritt) …" data-ireply="${e(i.id)}">${e(i.reply || "")}</textarea>
      <div class="idea-admin-btns">
        ${i.status !== "approved" ? `<button type="button" class="btn btn-small btn-primary" data-iset="approved" data-id="${e(i.id)}">Godkjenn</button>` : ""}
        ${i.status !== "rejected" ? `<button type="button" class="btn btn-small btn-danger" data-iset="rejected" data-id="${e(i.id)}">Avvis</button>` : ""}
        ${i.status !== "done" ? `<button type="button" class="btn btn-small" data-iset="done" data-id="${e(i.id)}">Ferdig</button>` : ""}
        ${i.status !== "new" ? `<button type="button" class="btn btn-small" data-iset="new" data-id="${e(i.id)}">Tilbake til ny</button>` : ""}
        <button type="button" class="btn btn-small" data-iset="" data-id="${e(i.id)}">Lagre kommentar</button>
      </div>
    </div>` : ""}
  </article>`;
}

function render() {
  const dlg = $dlg();
  if (!dlg) return;
  const e = ctx.esc;
  const count = (v) => istate.ideas.filter((i) => v === "mine" ? i.by === me() : v === "open" ? i.status === "new" || i.status === "approved" : i.status === v).length;
  const list = visible();
  const keep = document.activeElement?.closest?.("#ideas") ? document.activeElement.id : "";
  dlg.querySelector(".msg-wrap").innerHTML = `<div class="msg-head">
      <h2>Forslag til forbedringer</h2>
      <button type="button" class="icon-btn msg-close" data-iclose aria-label="Lukk" title="Lukk"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
    </div>
    <p class="hint">Har du en idé til hvordan siden kan bli bedre? Skriv den her. ${admin() ? "Du godkjenner eller avviser med en kommentar til den som foreslo." : "Administrator svarer med godkjent eller avvist og en kommentar."}</p>
    <form class="idea-form" data-iform>
      <input id="idea-title" type="text" maxlength="${MAX_TITLE}" placeholder="Kort tittel, f.eks. «Sortere komponenter etter pris»" value="${e(istate.draft.title)}" aria-label="Tittel">
      <textarea id="idea-text" rows="3" maxlength="${MAX_TEXT}" placeholder="Beskriv forslaget: hva skal det løse, og hvordan bør det virke?" aria-label="Beskrivelse">${e(istate.draft.text)}</textarea>
      <div class="d-buttons"><span class="spacer"></span><button type="submit" class="btn btn-primary">Send forslag</button></div>
    </form>
    ${istate.status ? `<p class="msg-status" role="status">${e(istate.status)}</p>` : ""}
    <div class="chips idea-tabs">${VIEWS.map(([v, label]) => `<button type="button" class="chip${istate.view === v ? " active" : ""}" data-iview="${v}">${label}${count(v) ? ` <span class="chip-n">${count(v)}</span>` : ""}</button>`).join("")}</div>
    ${list.length ? `<div class="idea-list">${list.map(card).join("")}</div>` : `<p class="hint msg-empty">Ingen forslag her ennå.</p>`}`;
  if (keep) dlg.querySelector(`#${keep}`)?.focus();
}

export async function openIdeas() {
  const dlg = $dlg();
  if (!dlg || (!ctx.DEMO && !ctx.token())) return;
  if (ctx.DEMO && !istate.loaded) demoData();
  istate.status = "";
  if (admin() && istate.ideas.some((i) => i.status === "new")) istate.view = "new";
  else if (answeredUnseen()) istate.view = "mine";
  if (!dlg.open) dlg.showModal();
  render();
  if (!istate.loaded) await loadIdeas();
  ctx.store(seenKey(), new Date().toISOString());
  renderBadge();
}

export function initIdeas(c) {
  ctx = c;
  const dlg = document.createElement("dialog");
  dlg.id = "ideas";
  dlg.className = "wide-dialog msg-dialog idea-dialog";
  dlg.tabIndex = -1;
  dlg.innerHTML = `<div class="msg-wrap"></div>`;
  document.body.append(dlg);
  dlg.addEventListener("close", () => { if (location.hash === "#ideas") history.replaceState(null, "", location.pathname + location.search); });
  document.getElementById("open-ideas")?.addEventListener("click", openIdeas);

  dlg.addEventListener("input", (e) => {
    if (e.target.id === "idea-title") istate.draft.title = e.target.value;
    if (e.target.id === "idea-text") istate.draft.text = e.target.value;
  });
  dlg.addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = clip(istate.draft.title, MAX_TITLE), text = clip(istate.draft.text, MAX_TEXT);
    if (!title) { istate.status = "Skriv en kort tittel."; return render(); }
    const at = new Date().toISOString();
    const idea = { id: `${at.replace(/\D/g, "").slice(0, 14)}-${Math.random().toString(36).slice(2, 7)}`, by: me(), at, title, text, status: "new", likes: [] };
    try {
      await save(idea);
      istate.ideas.push(idea);
      istate.draft = { title: "", text: "" };
      istate.view = "mine";
      istate.status = "Takk! Forslaget er sendt.";
    } catch (err) { istate.status = err.message; }
    render();
  });
  dlg.addEventListener("click", async (e) => {
    const t = e.target.closest("button");
    if (!t) return;
    if (t.hasAttribute("data-iclose")) return dlg.close();
    if (t.dataset.iview) { istate.view = t.dataset.iview; istate.status = ""; return render(); }
    const find = (id) => istate.ideas.find((i) => i.id === id);
    try {
      if (t.dataset.ilike) {
        const i = find(t.dataset.ilike);
        const likes = new Set(i.likes || []);
        if (likes.has(me())) likes.delete(me()); else likes.add(me());
        await save(Object.assign(i, { likes: [...likes] }));
      } else if (t.dataset.idel) {
        if (t.dataset.sure !== "1") { t.dataset.sure = "1"; t.textContent = "Sikker?"; t.classList.add("btn-danger"); return; }
        if (!ctx.DEMO) await ctx.dbCall("/db/patch", { ops: [{ coll: "ideas", id: t.dataset.idel, data: null }] });
        istate.ideas = istate.ideas.filter((i) => i.id !== t.dataset.idel);
        istate.status = "Forslaget er trukket tilbake.";
      } else if (t.hasAttribute("data-iset") && admin()) {
        const i = find(t.dataset.id);
        const reply = clip(dlg.querySelector(`[data-ireply="${CSS.escape(i.id)}"]`)?.value, 1000);
        Object.assign(i, { reply, replyBy: me(), replyAt: new Date().toISOString(), ...(t.dataset.iset ? { status: t.dataset.iset } : {}) });
        await save(i);
        istate.status = t.dataset.iset ? `«${i.title}» er ${STATUS[i.status].toLowerCase()}.` : "Kommentaren er lagret.";
      } else return;
    } catch (err) { istate.status = err.message; }
    render();
    renderBadge();
  });

  renderBadge();
  setInterval(() => document.visibilityState === "visible" && ctx.token() && loadIdeas(), 5 * 60 * 1000);
}

// Ved inn- og utlogging.
export function ideasSession() {
  istate.loaded = false;
  istate.ideas = [];
  renderBadge();
  if (ctx.token()) loadIdeas().then(() => { if (location.hash === "#ideas") openIdeas(); });
  else $dlg()?.open && $dlg().close();
}

function demoData() {
  const names = ctx.users().map((u) => u.name);
  const [a = "Kari", b = "Ola"] = names;
  const t = (d) => new Date(Date.now() - d * 864e5).toISOString();
  istate.ideas = [
    { id: "i1", by: a, at: t(1), title: "Varsel når en spole er nesten tom", text: "Det hadde vært fint å få beskjed når en spole jeg har lånt ut er under 100 g.", status: "new", likes: [b] },
    { id: "i2", by: b, at: t(6), title: "Sortere komponenter etter pris per stk", text: "", status: "approved", reply: "God idé, den tar vi.", replyBy: me(), replyAt: t(5), likes: [a] },
    { id: "i3", by: me(), at: t(20), title: "Mørkt tema", text: "Siden følger allerede systemets tema?", status: "rejected", reply: "Siden bruker allerede mørkt tema når telefonen eller PC-en gjør det.", replyBy: a, replyAt: t(19), likes: [] },
    { id: "i4", by: a, at: t(30), title: "Skanne RFID med mobilen", text: "", status: "done", reply: "Lagt inn i september.", replyBy: me(), replyAt: t(25), likes: [b, me()] },
  ];
  istate.loaded = true;
}
