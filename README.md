# BambuFilament

Felles oversikt over Bambu Lab-filament som ligger på lager (ikke i AMS). Spolene
skannes inn og ut med en egen RFID-leser (ESP32 + RC522), og oversikten vises på
**https://saysphilippe.github.io/BambuFilament/**.

Demo med eksempeldata: https://saysphilippe.github.io/BambuFilament/?demo

## Hvordan det henger sammen

```
Bambu-spole ──RFID──> ESP32 + RC522 ──HTTPS──> spools.json i BambuFilament-data
                                                       │
                              github.io-siden <────────┘  (leser og tolker)
```

- Bambu-brikkene er MIFARE Classic 1K. Sektornøklene utledes fra brikkens UID
  med HKDF-SHA256 ([Bambu Research Group](https://github.com/Bambu-Research-Group/RFID-Tag-Guide)).
- Leseren sender rådataene (blokk 0–19) til `spools.json` i [BambuFilament-data](https://github.com/saysphilippe/BambuFilament-data). Siden tolker dem
  og slår opp offisielle farge- og typenavn i `data/colors.json` (hentet fra
  Bambu Studio sin `filaments_color_codes.json`).
- Hver spole identifiseres med Tray UID (blokk 9), så samme spole telles aldri to ganger.

## Sikkerhet

- **Data og kode er adskilt.** Data ligger i
  [saysphilippe/BambuFilament-data](https://github.com/saysphilippe/BambuFilament-data): `spools.json`
  (brukere og spoler, også for leserne) og `shared.json` (delte AMS-data, bibliotek og venteliste). Den delte
  skrivetokenen og tokenene i leserne gjelder **bare** det repoet, så de kan ikke endre nettsidekoden.
- **Delte data kontrolleres** før de vises: farger må være gyldig hex, tall må være tall, og all tekst escapes.
- **Innloggingen** gjelder bare fanen, med mindre man velger «Husk meg» (30 dager).
- **Passord:** minst 12 tegn, ikke vanlige ord eller brukernavnet. PBKDF2-SHA256 med 600 000 runder.
- **Proxyen** har rate limiting per IP (innlogging 10 per minutt).
- **ESP32** sjekker GitHub-sertifikatet (rotsertifikater i `github_roots.h`).
- **Content-Security-Policy:** bare egne skript, og data sendes bare til GitHub, proxyen og Bambu sine bilde-CDN-er.
- **Passordbytte** krever nåværende passord (unntatt tvunget bytte etter midlertidig passord).
- **Beskyttet `main`** i begge repoene: tvungen push og sletting av greinen blir avvist, så historikken (sikkerhetskopien) ikke kan slettes.
- **E-postkoder fra Bambu** kan bare bes om med en signert billett fra en innlogging (`TICKET_SECRET` i Workeren) og maks én gang i minuttet per adresse.
- **Størrelse:** fritekst har lengdegrenser, historikken holder 10 hendelser per spole, og leseren avviser `spools.json` over 120 kB (omtrent 60–80 spoler).
- **Proxyen** godtar bare forespørsler fra `saysphilippe.github.io`. Lokal testing med `wrangler dev` bruker `worker/.dev.vars`.
- Alle GitHub Pages-sider under `saysphilippe.github.io` deler nettleserlagring. Ikke publiser andre Pages-sider på kontoen uten å tenke over det, eller gi BambuFilament et eget domene.

## Brukere og innlogging

Alle kan se oversikten. For å endre (sjekke inn og ut, redigere, administrere brukere)
må man logge inn.

Siden har ingen server. En GitHub-token med skrivetilgang til dette repoet lagres derfor
**kryptert per bruker** i `spools.json` (BambuFilament-data) (AES-256-GCM, nøkkel fra passordet med
PBKDF2-SHA256, 600 000 runder). Riktig passord låser opp tokenen i nettleseren.

- **Første oppsett:** åpne siden, trykk *Logg inn* og lim inn tokenen. Brukerne
  (Philippe, Niklas, Peter) opprettes med midlertidige passord, som vises én gang.
- Ved første innlogging må hver bruker velge sitt eget passord (minst 12 tegn).
- Første bruker i oppsettet (Philippe) er **administrator**. Bare administrator kan legge til og fjerne brukere og lage nye midlertidige passord. Alle kan bytte sitt eget passord.
- Admin-rollen håndheves i nettsiden. Alle innloggede deler samme skrivetoken, så den er en regel for vanlig bruk, ikke en sikkerhetsgrense.
- Bruk sterke passord. De krypterte dataene ligger i et offentlig repo.
- Bytter du GitHub-token, må alle få nye midlertidige passord (*Nytt passord* per bruker,
  eller tøm `users[].cred` og kjør første oppsett på nytt).

Tokenen lages på https://github.com/settings/personal-access-tokens/new:
*Only select repositories* → **`BambuFilament-data`** (ikke `BambuFilament`), *Repository permissions* → *Contents: Read and write*.

## AMS-fanen

Viser innholdet i AMS-ene til hver bruker: farge, type, gjenværende mengde og fuktighet.

- Hver bruker kobler til **sin egen Bambu-konto** i fanen. Innloggingen skjer med e-post og passord,
  pluss eventuelt kode på e-post eller fra autentiseringsapp. Bare Bambu-tilgangsnøkkelen lagres,
  og bare i brukerens egen nettleser. Bambu-passordet lagres aldri.
- Hver bruker velger selv **Del AMS-data med alle**. Da lagres et øyeblikksbilde (uten serienummer)
  i `shared.json` (BambuFilament-data) når brukeren har siden åpen og innholdet endrer seg. De andre ser siste
  delte bilde med tidspunkt.
- Bambu sitt API kan ikke kalles direkte fra en nettleser (ingen CORS, og MQTT krever TCP).
  Derfor går kallene via en liten **Cloudflare Worker** i `worker/`. Den videresender innlogging,
  printerliste og en `pushall`-forespørsel over Bambu sin sky-MQTT, og lagrer ingenting.

Publisere Workeren:

```
cd worker
npx wrangler login
npx wrangler secret put TICKET_SECRET   # tilfeldig hemmelighet, bare første gang
npx wrangler deploy
```

Sett så `PROXY_URL` i `app.js` til adressen `wrangler deploy` skriver ut.

## Våre lokale lager

Fanen samler alt som finnes i lagrene våre:

- **RFID**: spoler skannet inn med leseren. Kan sjekkes inn og ut og redigeres.
- **Bambu-bibliotek**: spoler fra Filament Manager til brukere som deler biblioteket.
- **I AMS**: spoler i AMS-ene til brukere som deler AMS, men som ikke finnes i biblioteket eller er skannet.

En spole som finnes flere steder (samme RFID / Tray UID) vises bare én gang. Plassering
(«Printer · AMS A1») hentes fra AMS-dataene.

## Butikk

Fanen **Butikk** viser alle produktene i Bambu Lab sin EU-butikk (rundt 1100): filament, printere,
AMS, hotend, plater, laser, reservedeler og Maker's Supply. Hvert produkt har pris, lagerstatus per
variant og lenke til produktsiden. Utsolgte produkter kan få «Jeg venter på denne», og havner da på
ventelisten under *Nytt fra Bambu*.

`scripts/update-store.mjs` henter dataene til `data/store.json` klokken 05 og 17 UTC, med få
samtidige kall og nye forsøk ved struping.

## Filamentbiblioteket

Samme Bambu-tilkobling henter også brukerens **filamentbibliotek** (Filament Manager i Bambu Studio
og Handy): spoler, farger, gjenværende vekt og hvor de står. Spoler med samme RFID (Tray UID) som
en spole i lageret får gjenværende vekt vist på kortet i *Lager*.

Hver bruker velger for seg om **AMS** og/eller **filamentbiblioteket** skal deles med alle
(to separate brytere).

## Nytt fra Bambu

Fanen viser nye filamenttyper og farger fra Bambu Lab, med lenke til produktsiden i
nettbutikken og en markering av om noen av oss allerede har fargen.

Workflowen `.github/workflows/catalog.yml` kjører `scripts/update-catalog.mjs` hver 6. time. Skriptet
- leser `filaments_color_codes.json` i Bambu Studio-repoet og historikken dens. Det gir
  datoen hver farge og type kom, med juli 2025 som utgangspunkt, og
- leser nettstedskartet til eu.store.bambulab.com for å finne produktsiden til hver type.

- henter lagerstatus per farge fra EU-butikken (*på lager*, *utsolgt* eller *ikke i butikken*).

Brukere kan trykke **«Jeg venter på denne»** på farger og typer som ikke kan kjøpes. Øverst i fanen
vises **«Det venter vi på»**, med hvem som venter. Når noe kommer på lager, flyttes det øverst og merkes.

Resultatet lagres i `data/catalog.json` og `data/colors.json`. Workflowen kan også kjøres
manuelt under *Actions* → *Oppdater Bambu-katalog* → *Run workflow*.

## Leseren

| Del | Kobles til ESP32 |
|---|---|
| RC522 SDA (SS) | GPIO 5 |
| RC522 SCK | GPIO 18 |
| RC522 MOSI | GPIO 23 |
| RC522 MISO | GPIO 19 |
| RC522 RST | GPIO 22 |
| RC522 3.3V / GND | 3V3 / GND (ikke 5 V) |
| Knapp **Innsjekk** | GPIO 32 ↔ GND |
| Knapp **Utsjekk** | GPIO 33 ↔ GND |
| Grønn LED (Innsjekk) | GPIO 25 → 220–330 Ω → LED → GND |
| Rød/gul LED (Utsjekk) | GPIO 26 → 220–330 Ω → LED → GND |

Bruk:
1. Trykk **Innsjekk** eller **Utsjekk**. LED-en for valgt modus lyser fast (starter i innsjekk).
2. Hold spolen mot leseren. Den innebygde LED-en lyser mens den leser og lagrer.
3. Tre rolige blink på modus-LED-en betyr lagret. Begge LED-ene blinker raskt ved feil
   (ikke en Bambu-brikke, ingen WiFi eller GitHub-feil). Se seriellmonitoren (115200) for detaljer.

### Flashe firmware

1. Arduino IDE med ESP32-kortpakken. Biblioteker: **MFRC522** (GithubCommunity) og **ArduinoJson** 7.
2. Kopier `firmware/BambuFilament/config.example.h` til `config.h` og fyll inn WiFi,
   GitHub-token og `OWNER` (må være likt brukernavnet på siden, for eksempel `Niklas`).
3. Kort: *ESP32 Dev Module*. Last opp.

`config.h` ligger i `.gitignore` og blir aldri lastet opp.

## Filer

| Fil | Innhold |
|---|---|
| `index.html`, `style.css`, `app.js` | Nettsiden |
| `bambu.js` | Tolking av brikkedata |
| `auth.js` | Kryptering av token og passord |
| `worker/` | Cloudflare Worker som videresender til Bambu sitt sky-API (AMS, bibliotek) og butikken |
| `firmware/BambuFilament/github_roots.h` | Rotsertifikater for api.github.com |
| `spools.json` i BambuFilament-data | Brukere og spoler (skrives av leserne og siden) |
| `shared.json` i BambuFilament-data | Delte AMS-data, bibliotek og venteliste (bare siden) |
| `data/colors.json` | Offisielle Bambu-fargenavn |
| `data/catalog.json` | Bambu-katalogen med datoer og produktsider |
| `scripts/update-catalog.mjs` | Henter filamentkatalogen (GitHub Actions, hver 6. time) |
| `scripts/update-store.mjs` | Henter hele butikken med lagerstatus (GitHub Actions, to ganger i døgnet) |
| `scripts/bambu-store.mjs` | Felles oppslag mot Bambu-butikken |
| `data/store.json` | Alle butikkprodukter med pris og lagerstatus |
| `firmware/BambuFilament/` | ESP32-firmware |
