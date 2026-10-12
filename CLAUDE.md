# CLAUDE.md – Filament og elektronikk universet

Felles oversikt over Bambu Lab-filament (RFID-skannet) og elektronikkomponenter (importert fra
AliExpress, Mouser og LCSC) for en lukket vennegjeng. Se `CONTRIBUTING.md` for oppsett og flyt.

## Oppbygning

- `index.html`, `app.js` (filament, innlogging, innstillinger), `parts.js` (komponenter, import,
  handlekurv), `categories.js` (kategorier og poengbasert klassifisering), `circuits.js`
  (datablad, pinner, koblingsskjema), `packages.js` (pakketyper med SVG), `pack.js` (stk per pakke),
  `auth.js` (kryptert innlogging og meldinger), `i18n.js` + `i18n-en.js` (språk), `messages.js` (meldinger mellom brukere, kryptert
  til mottakernes nøkler; «pålogget nå» via D1-samlingen presence), `style.css`.
- `worker/` – Cloudflare Worker: Bambu-proxy, D1-database (`records`: coll/id/data), e-post,
  lesere. `worker/src/records.js` deles med nettsiden.
- `firmware/` – ESP32-leser. `docs/leserbygger.html` – byggeveiledning.
- Data: D1 via Workeren; brukerliste i repoet BambuFilament-auth; e-post/mobil i BambuFilament-data.

## Claude-skill

- `.claude/skills/elektronikk-design/SKILL.md`: designe kretser ut fra lageret (alle eiere). Leser lageret med
  `node scripts/lager.mjs` via Claude-nøkkel (`BF_INVENTORY_KEY`, Workerens `/inventory`) eller eksportfil
  (`lager-*.json`, aldri i git). `inventory()` i `worker/src/records.js` lager oversikten.

## Regler

- All tekst brukerne ser, og kommentarer, skrives på norsk.
- Flerspråklig (`i18n.js`): siden oversettes i nettleseren fra norsk via ordlisten `i18n-en.js`
  (norsk tekst -> engelsk, `{*}` for variable deler). Ny eller endret tekst må også legges inn der,
  ellers vises den på norsk. Brukerdata som ikke skal oversettes, merkes med `translate="no"`.
  Språkvalget lagres i `users[].lang`; ønskede språk i D1-samlingen `langreqs` (fil «ideas»).
  Ordlisten er gruppert etter område (underfanene i Innstillinger → Oversettelser). Tekster endret
  der (norsk og engelsk) ligger i D1-samlingen `texts` (fil «i18n») og går foran ordlisten.
- Escape data før HTML (`esc`), farger via `safeColor`. Ingen inline-skript (CSP). Bildelenker
  bare fra godkjente verter (`safeImg`).
- Mobil: siden skal aldri bli bredere enn skjermen (sjekk på ca. 390 px). Rader som rulles
  sidelengs trenger `min-width: 0` på grid-/flex-forelderen.
- Versjonsnummer settes automatisk ved publisering (`.github/workflows/pages.yml`); nye moduler
  som importeres fra `app.js`/`parts.js` må legges inn i `scripts/bump-version.mjs`.
- Nye D1-samlinger: legg dem i `FILE_COLLS` i `worker/src/records.js` og publiser Workeren.
- Kategorier satt for hånd (`catManual`), bilder satt for hånd (`imgManual`) og pakkestørrelse
  satt for hånd (`packManual`) skal aldri overskrives av automatikk.
- Antall er i stk: `kjøpt antall × pakkestørrelse`. «Igjen» og handlekurv regnes i stk.

## Fallgruver

- Regex med `\b`, `\d` osv. blir ødelagt hvis de sendes gjennom skallet (`node -e`, heredoc i
  template-strenger). Bruk Edit/Write-verktøyene eller en `.mjs`-fil skrevet med Write.
- `load()` i parts.js er async; ikke tegn på nytt i en løkke på løftet den gir.
- AliExpress sperrer ved for mange søk («unusual traffic»). Kjør søk sakte og stopp ved sperre.
- Bakgrunnsfaner i Chrome bremser tidtakere kraftig; tunge løkker må gå i en aktiv fane.

## Publisering

Alle med skrivetilgang publiserer selv: push/merge til `main` publiserer nettsiden
(`pages.yml`) og Workeren når `worker/` endres (`worker.yml`). `check.yml` kjører syntakssjekk
på alt. Kjør `git pull --rebase` før push (katalogjobben pusher til `main`).

## Test

- `node --check` på endrede filer.
- Demoen (`/?demo`) i headless Chrome via DevTools-protokollen, også på 390 px bredde.
- Lokal Worker: `cd worker && npx wrangler dev --local`, nettsiden på `127.0.0.1:8765/?dev=Navn`.
