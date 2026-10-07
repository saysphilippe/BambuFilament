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
| `data/spools.json` | Brukere og spoler (skrives av leseren og siden) |
| `data/colors.json` | Offisielle Bambu-fargenavn |
| `firmware/BambuFilament/` | ESP32-firmware |
