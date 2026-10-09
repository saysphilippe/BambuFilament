# CLAUDE.md – Filament og elektronikk universet

Felles oversikt over Bambu Lab-filament (RFID-skannet) og elektronikkomponenter (importert fra
AliExpress, Mouser og LCSC) for en lukket vennegjeng. Se `CONTRIBUTING.md` for oppsett og flyt.

## Oppbygning

- `index.html`, `app.js` (filament, innlogging, innstillinger), `parts.js` (komponenter, import,
  handlekurv), `categories.js` (kategorier og poengbasert klassifisering), `circuits.js`
  (datablad, pinner, koblingsskjema), `packages.js` (pakketyper med SVG), `pack.js` (stk per pakke),
  `auth.js` (kryptert innlogging), `style.css`.
- `worker/` – Cloudflare Worker: Bambu-proxy, D1-database (`records`: coll/id/data), e-post,
  lesere. `worker/src/records.js` deles med nettsiden.
- `firmware/` – ESP32-leser. `docs/leserbygger.html` – byggeveiledning.
- Data: D1 via Workeren; brukerliste i repoet BambuFilament-auth; e-post/mobil i BambuFilament-data.

## Regler

- All tekst brukerne ser, og kommentarer, skrives på norsk.
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
