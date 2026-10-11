---
name: elektronikk-design
description: Design en ny elektronisk krets eller et prosjekt ut fra komponentene som faktisk finnes i lageret til Filament og elektronikk universet (alle eiere). Bruk når brukeren vil lage, planlegge eller bygge en krets, velge komponenter, lage stykkliste (BOM), finne erstatninger for en del, eller spør «har vi noe som kan …» om elektronikk.
---

# Elektronikkdesign med lageret til Filament og elektronikk universet

Du hjelper en i vennegjengen med å designe en krets, og bruker **det som allerede ligger i
skuffene** før noe kjøpes. Svar på norsk.

## 1. Hent lageret

Kjør fra roten av repoet `BambuFilament`:

```bash
node scripts/lager.mjs --summary          # oversikt: antall varer per kategori og eier
node scripts/lager.mjs --have ams1117 "logic level" esp32   # søk (ett søk per ord/frase)
node scripts/lager.mjs --owner Philippe --cat semi --have mosfet
node scripts/lager.mjs --json lm317       # alle felter, for nøyaktig sjekk
```

Skriptet henter lageret selv, i denne rekkefølgen:
1. `--file <lager.json>` hvis brukeren har en eksportfil.
2. Miljøvariabelen `BF_INVENTORY_KEY` (Claude-nøkkel, bare lesetilgang).
3. Nyeste `lager-*.json` i Nedlastinger.

Finnes ingen av dem: be brukeren enten lage en Claude-nøkkel på siden
(**Innstillinger → Konto og varsler → Lag ny Claude-nøkkel**) og lagre den som `BF_INVENTORY_KEY`,
eller trykke **Komponenter → Eksporter lager for Claude**. **Be aldri om at nøkkelen limes inn i
chatten**, og skriv den aldri ut. Lagrer du en kopi (`--save`), legg den utenfor repoet og ikke i git.

Feltene per vare: `owner`, `have` (stk igjen), `bought`, `part` (gjenkjent delenummer), `mpn`,
`kind` (npn, nmos, ldo, buck, ne555, i2c, …), `pkg`, `pins` (pinnerekkefølge pinne 1→n),
`category`, `location` (skuff/sted), `title`, `datasheet`, `url`.

## 2. Forstå oppgaven (kort)

Finn ut det som avgjør komponentvalget: forsyning (spenning, batteri/USB/nett), strøm og effekt,
signalnivå (3,3 V eller 5 V), grensesnitt (I2C, SPI, UART, PWM), miljø, størrelse, THT eller SMD.
Spør bare om det som faktisk mangler, maks 2–3 spørsmål. Gjør ellers fornuftige antakelser og si dem.

## 3. Velg komponenter: lager først

Del kretsen i funksjonsblokker (forsyning, styring, sensorer, drivere, kontakter). For hver blokk:

1. **Søk bredt** i lageret: delenummer, funksjon (`ldo`, `buck`, `mosfet`, `relé`, `oled`), og kjente
   alternativer (f.eks. 3,3 V-regulator: AMS1117-3.3, XC6206, HT7333, MCP1700, ME6211, LM1117).
2. **Prioriter**: (a) brukerens egne deler, (b) en venns deler, (c) kjøp. Ved flere treff: velg den
   med nok `have`, riktig pakke (THT til breadboard, SMD til kretskort) og best margin.
3. **Sjekk nøyaktig før du foreslår en del:**
   - **Delenummeret må stemme eksakt.** Et siffer gjør en annen brikke: CD4016 ≠ CD4014,
     LM358 ≠ LM393, IRLZ44N (logikknivå) ≠ IRFZ44N (trenger 10 V på gate), 2N7000 ≠ 2N7002 (pakke og
     pinner). Har tittelen flere delenumre (blandingssett, «Assorted Kit», «LM358 LM393 … NE555»),
     er det et sett. Si det og at varianten må sjekkes.
   - **Pinnerekkefølge per pakke** (`pins`): 2N2222 og BC547 har motsatt rekkefølge (E-B-C vs C-B-E).
     MMBT3904 (SOT-23, B-E-C) er ikke som 2N3904 (TO-92, E-B-C). Siden viser KiCad-symbol med riktig
     rekkefølge (f.eks. `Device:Q_NMOS_GSD`). Bruk det i skjemaet.
   - **Spenning og logikknivå**: 5 V-moduler mot 3,3 V-mikrokontrollere (ESP32) trenger nivåomformer
     eller spenningsdeler. MOSFET fra 3,3 V-GPIO må være logikknivå.
   - **Strøm og varme**: LDO-tap = (Vinn − Vut) × I. Over ca. 0,5–1 W: velg buck (LM2596, MP1584,
     MT3608 for boost) og si fra.
   - **Antall**: `have` må dekke behovet (pluss reserve for SMD).
4. **Alternativer**: Finnes ikke delen, foreslå det nærmeste som finnes på lager, og si hva som
   endres (pinner, verdier, kode). Ellers foreslå kjøp: LCSC-nummer (C…) når du kjenner det, eller
   søkeord for AliExpress.
   Slå opp delen hos Octopart for å sjekke produsent, pakke, datablad og hvem som har den på lager
   (og til hvilken pris): `node scripts/lager.mjs --octopart <delenummer>`. Bruk bare treff der
   delenummeret stemmer eksakt.
5. Se `circuits.js` (PARTS, kicadPins, TYPICAL) for pinner, typiske koblinger og «Typical application»
   fra databladet som siden allerede kjenner. Datablad: feltet `datasheet`, ellers produsentens PDF.

## 4. Lever

Lag et kort svar med:

**Stykkliste (BOM)**, som tabell:

| Funksjon | Del | Pakke | Antall | Kilde | Sted / merknad |
|---|---|---|---|---|---|
| 3,3 V-regulator | AMS1117-3.3 | SOT-223 | 1 | Har selv (240 stk) | Skuff 3 |
| Bryter for last | IRLZ44N | TO-220 | 1 | **Lån fra Ola** (10 stk) | logikknivå |
| Temperatur | BME280-modul | modul | 1 | **Må kjøpes** | søk «BME280» hos LCSC eller AliExpress |

- **Koblingen**: pinne for pinne, eller et enkelt skjema (ASCII eller Mermaid). Ta med
  avkoblingskondensatorer, pull-up-er, flyback-dioder, verdier og pinnenumre.
- **KiCad**: symbol og fotavtrykk per del når det er relevant (`Package_TO_SOT_SMD:SOT-223-3_TabPin2`,
  `Device:Q_NMOS_GDS`). Advar der pakken har annen pinnerekkefølge.
- **Fra venner**: forklar at delene bes om på siden: **Komponenter → åpne varen → «Legg i handlekurv»**,
  deretter sendes handlekurven til eieren. Ikke skriv noe til lageret selv; skillen leser bare.
- **Antakelser og risiko**: hva du har antatt, og hva som bør måles eller testes først.

**Prosjekt-JSON til import**: Avslutt med stykklisten som én JSON-blokk brukeren kan lime inn på siden
(**Komponenter → Prosjekter → nytt prosjekt → «Importer stykkliste fra Claude»**). Siden viser hva som
legges til før noe lagres: egne deler reserveres, venners deler blir ønsker i handlekurven, resten
havner under «Må kjøpes». Bruk `ids` fra lageret (`--json` viser dem); siden velger kjøpet med mest igjen.

```json
{
  "name": "Værstasjon",
  "desc": "ESP32 med BME280 og OLED, drevet fra USB",
  "lines": [
    { "ids": ["ae:…"], "qty": 1, "label": "ESP32 DevKit V1", "note": "hjernen" },
    { "ids": ["ae:…", "ae:…"], "qty": 1, "label": "AMS1117-3.3" },
    { "buy": true, "label": "BME280-modul 3,3 V", "qty": 1, "url": "https://…", "price": 35 }
  ]
}
```

## Regler

- Les bare. Endre aldri lageret, bildene eller databasen fra denne skillen.
- Lageret er privat for vennegjengen. Ikke publiser eller del lagerinnholdet utenfor samtalen.
- Vær presis heller enn rask: heller «sjekk merkingen på brikken» enn en gjetning.
