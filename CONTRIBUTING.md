# Bidra til Filament og elektronikk universet

Velkommen! Her er det du trenger for å jobbe med koden på din egen maskin, og hvordan endringer
kommer ut på nettsiden.

## Slik henger det sammen

| Del | Hvor | Publiseres |
|---|---|---|
| Nettsiden (`index.html`, `app.js`, `parts.js`, `style.css` …) | dette repoet | automatisk fra `main` (GitHub Pages, jobben *Publiser nettsiden*) |
| Workeren (API, database, innlogging mot Bambu, e-post) | `worker/` | automatisk fra `main` når `worker/` endres (jobben *Publiser Workeren*) |
| Leseren (ESP32 + RC522) | `firmware/` | flashes for hånd, se [leserbyggeren](docs/leserbygger.html) |
| Brukerliste | repoet `BambuFilament-auth` (offentlig) | – |
| Spoler, lån, komponenter, handlekurv | Cloudflare D1 bak Workeren | – |
| E-post/mobil, sikkerhetskopier | repoet `BambuFilament-data` (privat) | – |

Ingen hemmeligheter ligger i dette repoet. `firmware/BambuFilament/config.h` og
`worker/sett-*.cmd` er i `.gitignore`.

## Kom i gang

Du trenger [Node.js 22](https://nodejs.org) og Git.

```bash
git clone https://github.com/saysphilippe/BambuFilament.git
cd BambuFilament
```

### 1. Bare nettsiden, med eksempeldata (enklest)

```bash
npx http-server -p 8765 -c-1 .
```

Åpne <http://127.0.0.1:8765/?demo>. Demoen har eksempelspoler, komponenter og handlekurv og
lagrer ingenting, så du kan prøve alt fritt.

### 2. Nettsiden mot en lokal Worker og database

Kjør Workeren lokalt i et eget vindu (første gang: lag den lokale databasen):

```bash
cd worker
npx wrangler d1 execute filament-universet --local --file schema.sql   # bare første gang
npx wrangler dev --local                                               # starter på http://127.0.0.1:8787
```

`worker/.dev.vars` slipper inn `127.0.0.1:8765` og gir testnøkkelen `local-test`.
Start nettsiden som i punkt 1 og åpne <http://127.0.0.1:8765/?dev=DittNavn>. Da er du logget
inn mot den lokale Workeren som «DittNavn». `?dev` virker bare på 127.0.0.1/localhost.

Den lokale databasen er tom. Bruk Importer-fanen i Komponenter eller demoen for å få data.
Brukerlisten hentes fortsatt fra det offentlige auth-repoet.

### 3. Leseren

Se `docs/leserbygger.html` (eller den publiserte siden). Du trenger en lesernøkkel fra Philippe
(`node scripts/reader-key.mjs ny "Navn"`); GitHub-tokener brukes ikke i leserne.

## Arbeidsflyt

Alle med skrivetilgang kan publisere selv – det er ingen godkjenning fra andre.

1. Hent siste versjon: `git switch main && git pull --rebase`
2. Lag gjerne en gren for større endringer: `git switch -c min-endring`
3. Gjør endringen og test den lokalt (demoen og helst mobilbredde, ca. 390 px).
4. Push. Små endringer kan gå rett til `main`; større kan gå som pull request som du merger selv
   når sjekken er grønn.
5. Jobben *Sjekk* kjører automatisk (syntaks i alle skript, gyldig HTML-oppsett). Er den rød,
   rett feilen før du merger.
6. Etter push/merge til `main` publiseres nettsiden (og Workeren, hvis `worker/` er endret)
   automatisk i løpet av et par minutter. Følg med under *Actions* i repoet.

Katalogjobben pusher også til `main` flere ganger om dagen, så kjør alltid `git pull --rebase`
før du pusher.

Ødela du noe? Rull tilbake med `git revert <commit>` og push – da publiseres forrige versjon.

Du trenger ikke kjøre `scripts/bump-version.mjs` – versjonsnummeret settes ved publisering.

## Regler i koden

- **Norsk** i alt brukerne ser, og i kommentarer.
- **Escape alt** som kommer fra data før det havner i HTML (`esc`), og farger går gjennom `safeColor`.
  Nettsiden har en streng CSP: bare egne skript, ingen inline-skript.
- **Ingen hemmeligheter** i koden eller i commits. Secrets i Workeren settes med `wrangler secret put`.
- **Mobil først:** sjekk at siden ikke blir bredere enn skjermen, og at knapper er store nok.
- **Databasen** (`records`-tabellen) har én post per vare/spole/lån; skriv bare postene som endres
  (`/db/patch`). Nye samlinger må legges inn i `worker/src/records.js`, og da må Workeren publiseres.
- **Ikke rør andres data** fra koden uten at det er tydelig for brukeren (eier, handlekurv osv.).

## Spørsmål

Ta kontakt med Philippe, eller lag en issue i repoet.
