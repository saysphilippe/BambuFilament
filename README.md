# BambuFilament

Felles oversikt over Bambu Lab-filament som ligger på lager (ikke i AMS). Spolene
skannes inn og ut med en egen RFID-leser (ESP32 + RC522), og oversikten vises på
**https://saysphilippe.github.io/BambuFilament/**.

Demo med eksempeldata: https://saysphilippe.github.io/BambuFilament/?demo

## Hvordan det henger sammen

```
Bambu-spole ──RFID──> ESP32 + RC522 ──HTTPS──> data/spools.json i dette repoet
                                                       │
                              github.io-siden <────────┘  (leser og tolker)
```

- Bambu-brikkene er MIFARE Classic 1K. Sektornøklene utledes fra brikkens UID
  med HKDF-SHA256 ([Bambu Research Group](https://github.com/Bambu-Research-Group/RFID-Tag-Guide)).
- Leseren sender rådataene (blokk 0–19) til `data/spools.json`. Siden tolker dem
  og slår opp offisielle farge- og typenavn i `data/colors.json` (hentet fra
  Bambu Studio sin `filaments_color_codes.json`).
- Hver spole identifiseres med Tray UID (blokk 9), så samme spole telles aldri to ganger.

## Brukere og innlogging

Alle kan se oversikten. For å endre (sjekke inn og ut, redigere, administrere brukere)
må man logge inn.

Siden har ingen server. En GitHub-token med skrivetilgang til dette repoet lagres derfor
**kryptert per bruker** i `data/spools.json` (AES-256-GCM, nøkkel fra passordet med
PBKDF2-SHA256, 310 000 runder). Riktig passord låser opp tokenen i nettleseren.

- **Første oppsett:** åpne siden, trykk *Logg inn* og lim inn tokenen. Brukerne
  (Philippe, Niklas, Peter) opprettes med midlertidige passord, som vises én gang.
- Ved første innlogging må hver bruker velge sitt eget passord (minst 10 tegn).
- Første bruker i oppsettet (Philippe) er **administrator**. Bare administrator kan legge til og fjerne brukere og lage nye midlertidige passord. Alle kan bytte sitt eget passord.
- Admin-rollen håndheves i nettsiden. Alle innloggede deler samme skrivetoken, så den er en regel for vanlig bruk, ikke en sikkerhetsgrense.
- Bruk sterke passord. De krypterte dataene ligger i et offentlig repo.
- Bytter du GitHub-token, må alle få nye midlertidige passord (*Nytt passord* per bruker,
  eller tøm `users[].cred` og kjør første oppsett på nytt).

Tokenen lages på https://github.com/settings/personal-access-tokens/new:
*Only select repositories* → `BambuFilament`, *Repository permissions* → *Contents: Read and write*.

## AMS-fanen

Viser innholdet i AMS-ene til hver bruker: farge, type, gjenværende mengde og fuktighet.

- Hver bruker kobler til **sin egen Bambu-konto** i fanen. Innloggingen skjer med e-post og passord,
  pluss eventuelt kode på e-post eller fra autentiseringsapp. Bare Bambu-tilgangsnøkkelen lagres,
  og bare i brukerens egen nettleser. Bambu-passordet lagres aldri.
- Hver bruker velger selv **Del AMS-data med alle**. Da lagres et øyeblikksbilde (uten serienummer)
  i `data/spools.json` når brukeren har siden åpen og innholdet endrer seg. De andre ser siste
  delte bilde med tidspunkt.
- Bambu sitt API kan ikke kalles direkte fra en nettleser (ingen CORS, og MQTT krever TCP).
  Derfor går kallene via en liten **Cloudflare Worker** i `worker/`. Den videresender innlogging,
  printerliste og en `pushall`-forespørsel over Bambu sin sky-MQTT, og lagrer ingenting.

Publisere Workeren:

```
cd worker
npx wrangler login
npx wrangler deploy
```

Sett så `PROXY_URL` i `app.js` til adressen `wrangler deploy` skriver ut.

## Filamentbiblioteket

Samme Bambu-tilkobling henter også brukerens **filamentbibliotek** (Filament Manager i Bambu Studio
og Handy): spoler, farger, gjenværende vekt og hvor de står. Spoler med samme RFID (Tray UID) som
en spole i lageret får gjenværende vekt vist på kortet i *Lager*.

Hver bruker velger for seg om **AMS** og/eller **filamentbiblioteket** skal deles med alle
(to separate brytere).

## Nytt fra Bambu

Fanen viser nye filamenttyper og farger fra Bambu Lab, med lenke til produktsiden i
nettbutikken og en markering av om noen av oss allerede har fargen.

Workflowen `.github/workflows/catalog.yml` kjører `scripts/update-catalog.mjs` daglig. Skriptet
- leser `filaments_color_codes.json` i Bambu Studio-repoet og historikken dens. Det gir
  datoen hver farge og type kom, med juli 2025 som utgangspunkt, og
- leser nettstedskartet til eu.store.bambulab.com for å finne produktsiden til hver type.

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
| `worker/` | Cloudflare Worker som videresender til Bambu sitt sky-API (AMS) |
| `data/spools.json` | Brukere og spoler (skrives av leseren og siden) |
| `data/colors.json` | Offisielle Bambu-fargenavn |
| `data/catalog.json` | Bambu-katalogen med datoer og produktsider |
| `scripts/update-catalog.mjs` | Henter katalogen (kjøres daglig av GitHub Actions) |
| `firmware/BambuFilament/` | ESP32-firmware |
