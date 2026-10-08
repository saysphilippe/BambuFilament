// BambuFilament – RFID-leser for Bambu Lab-spoler (ESP32 + RC522)
//
// Leser MIFARE Classic-brikken på en Bambu Lab-spole, utleder sektornøklene
// fra brikkens UID (HKDF-SHA256, se github.com/Bambu-Research-Group/RFID-Tag-Guide)
// og legger rådataene inn i spools.json i GitHub-repoet BambuFilament-data. Web-appen på
// github.io tolker blokkene og viser oversikten.
//
// Flere kan dele én leser: tapp RFID-kortet ditt (en vanlig MIFARE-brikke eller -kort) først,
// så registreres spolene de neste minuttene på deg. Kortene ligger i
// spools.json ("cards": { UID: { user, label, added } }). Et nytt kort registreres uten navn;
// navnet legges til under «RFID-kort» på siden. Valgfri OLED-skjerm (SSD1306) viser hvem
// som bruker leseren og hva som skjer.
//
// Biblioteker i tillegg: Adafruit SSD1306 og Adafruit GFX (bare hvis skjermen brukes).
//
// Ingen knapper: leseren avgjør selv. Ny spole eller spole som er ute -> innsjekk.
// Spole som er inne -> utsjekk hvis det er minst checkoutMinutes siden den ble
// sjekket inn; ellers skjer ingenting. Samme brikke igjen innen IGNORE_REPEAT_MS ignoreres.
//
// Biblioteker: MFRC522 (GithubCommunity), ArduinoJson 7. Kort: ESP32 Dev Module.

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <SPI.h>
#include <MFRC522.h>
#include <ArduinoJson.h>
#include <time.h>
#include "mbedtls/md.h"
#include "mbedtls/base64.h"
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include "config.h"
#include "worker_roots.h"

static const int SECTORS = 5;               // Bambu-dataene ligger i sektor 0–4 (blokk 0–19)
static const int BLOCKS = SECTORS * 4;
static const int MAX_TRIES = 3;             // nye forsøk ved 409 (noen andre lagret samtidig)
static const int MAX_HISTORY = 10;          // antall hendelser per spole (holder spools.json liten)
// Største svar fra GitHub som behandles. Base64-innholdet, den dekodede teksten og
// JSON-dokumentet må få plass i minnet samtidig (ca. 280 kB ledig). Delte AMS- og
// bibliotekdata ligger i shared.json, som leseren ikke henter, så spools.json holdes liten.
static const int MAX_RESPONSE_BYTES = 120000;
static const unsigned long IGNORE_REPEAT_MS = 6000;  // samme brikke igjen innen 6 s ignoreres
#ifndef CHECKOUT_AFTER_MINUTES
#define CHECKOUT_AFTER_MINUTES 10
#endif
#ifndef CARD_SESSION_SECONDS
#define CARD_SESSION_SECONDS 60
#endif
// OLED-skjerm (SSD1306 128x64, I2C). PIN_OLED_SDA -1 = ingen skjerm.
#ifndef PIN_OLED_SDA
#define PIN_OLED_SDA -1
#define PIN_OLED_SCL -1
#endif
#ifndef OLED_ADDRESS
#define OLED_ADDRESS 0x3C
#endif

static const uint8_t MASTER_SALT[16] = {
  0x9a, 0x75, 0x9c, 0xf2, 0xc4, 0xf7, 0xca, 0xff,
  0x22, 0x2c, 0xb9, 0x76, 0x9b, 0x41, 0xbc, 0x96
};
static const uint8_t KDF_INFO[7] = { 'R', 'F', 'I', 'D', '-', 'A', 0 };

MFRC522 rfid(PIN_RC522_SS, PIN_RC522_RST);
Adafruit_SSD1306 oled(128, 64, &Wire, -1);
bool hasOled = false;

String lastUid;
unsigned long lastUidAt = 0;
// Resultat av en skanning: lagret innsjekk/utsjekk, ingenting (for kort tid siden innsjekk), eller feil.
enum ScanResult { SCAN_IN, SCAN_OUT, SCAN_NOOP, SCAN_FAIL };
long waitMinutes = 0;                       // ved SCAN_NOOP: minutter til utsjekk blir mulig

String cardUser;                            // bruker fra personlig brikke, gjelder til cardUntil
unsigned long cardUntil = 0;
// Tidsvinduer, i minutter. Settes på siden under Innstillinger; Workeren sender dem med når
// et kort tappes (utsjekk-vinduet brukes av Workeren selv). Verdiene i config.h er standard.
float cardMinutes = CARD_SESSION_SECONDS / 60.0;
long checkoutMinutes = CHECKOUT_AFTER_MINUTES;
unsigned long cardMs() { return (unsigned long)(cardMinutes * 60000.0); }

void readSettings(JsonDocument &doc) {
  float c = doc["cardMinutes"] | cardMinutes;
  long o = doc["checkoutMinutes"] | checkoutMinutes;
  if (c >= 0.25 && c <= 60) cardMinutes = c;
  if (o >= 1 && o <= 1440) checkoutMinutes = o;
}

// Hvem som skanner nå: brukeren fra brikken, ellers OWNER fra config.h (kan være tom = ukjent).
String currentUser() {
  if (cardUser.length() && millis() < cardUntil) return cardUser;
  return String(OWNER);
}

// ---------- OLED ----------

// Skjermens innebygde skrift er CP437: æ, å og Æ, Å finnes; ø/Ø vises som ö/Ö.
String forOled(const String &utf8) {
  String out;
  for (size_t i = 0; i < utf8.length(); i++) {
    uint8_t c = utf8[i];
    if (c < 0x80) { out += (char)c; continue; }
    if (c == 0xC3 && i + 1 < utf8.length()) {
      uint8_t d = utf8[++i];
      switch (d) {
        case 0xA6: out += (char)0x91; break;  // æ
        case 0x86: out += (char)0x92; break;  // Æ
        case 0xB8: out += (char)0x94; break;  // ø -> ö
        case 0x98: out += (char)0x99; break;  // Ø -> Ö
        case 0xA5: out += (char)0x86; break;  // å
        case 0x85: out += (char)0x8F; break;  // Å
        case 0xA9: out += (char)0x82; break;  // é
        default: out += '?';
      }
      continue;
    }
    while (i + 1 < utf8.length() && (utf8[i + 1] & 0xC0) == 0x80) i++;
    out += '?';
  }
  return out;
}

// Tre linjer: overskrift (stor skrift) og to linjer under.
void screen(const String &title, const String &line2 = "", const String &line3 = "") {
  if (!hasOled) return;
  oled.clearDisplay();
  oled.setTextColor(SSD1306_WHITE);
  oled.setTextSize(forOled(title).length() <= 10 ? 2 : 1);
  oled.setCursor(0, 0);
  oled.println(forOled(title));
  oled.setTextSize(1);
  oled.setCursor(0, 28);
  oled.println(forOled(line2));
  oled.setCursor(0, 44);
  oled.println(forOled(line3));
  oled.display();
}

// Hvileskjerm: hvem som bruker leseren (med nedtelling for kortet).
String lastIdle;
void showIdle(bool force = false) {
  if (!hasOled) return;
  bool card = cardUser.length() && millis() < cardUntil;
  String who = card ? cardUser + " (" + String((cardUntil - millis()) / 1000 + 1) + " s)"
                    : strlen(OWNER) ? String(OWNER) + " (standard)" : "ukjent";
  if (!force && who == lastIdle) return;
  lastIdle = who;
  screen("Skann spole", "Bruker: " + who, card ? "" : "Tapp kortet ditt først");
}

// ---------- LED ----------

void setLed(int pin, bool on) {
  if (pin >= 0) digitalWrite(pin, on ? HIGH : LOW);
}

// I hvile er begge LED-ene av.
void showMode() {
  setLed(PIN_LED_IN, false);
  setLed(PIN_LED_OUT, false);
}

// Innebygd LED lyser mens brikken leses og lagres.
void busy(bool on) {
  setLed(PIN_LED_BUSY, on);
}

// Lagret: grønn (innsjekk) eller rød (utsjekk) blinker rolig tre ganger.
void signalOk(bool checkedOut) {
  int pin = checkedOut ? PIN_LED_OUT : PIN_LED_IN;
  for (int i = 0; i < 3; i++) {
    setLed(pin, true); delay(250); setLed(pin, false); delay(250);
  }
  showMode();
}

// Ingenting endret (allerede sjekket inn): grønn blinker kort én gang.
void signalNoop() {
  setLed(PIN_LED_IN, true); delay(120); setLed(PIN_LED_IN, false);
  showMode();
}

// Feil: begge LED-ene blinker raskt.
void signalError() {
  for (int i = 0; i < 6; i++) {
    setLed(PIN_LED_IN, true); setLed(PIN_LED_OUT, true); delay(80);
    setLed(PIN_LED_IN, false); setLed(PIN_LED_OUT, false); delay(80);
  }
  showMode();
}

// Personlig brikke gjenkjent: LED-ene blinker vekselvis to ganger.
void signalCard() {
  for (int i = 0; i < 2; i++) {
    setLed(PIN_LED_IN, true); setLed(PIN_LED_OUT, false); delay(200);
    setLed(PIN_LED_IN, false); setLed(PIN_LED_OUT, true); delay(200);
  }
  showMode();
}

// ---------- Nøkkelutledning ----------

void hmacSha256(const uint8_t *key, size_t keyLen, const uint8_t *data, size_t len, uint8_t out[32]) {
  mbedtls_md_hmac(mbedtls_md_info_from_type(MBEDTLS_MD_SHA256), key, keyLen, data, len, out);
}

// HKDF-SHA256(ikm = UID, salt = MASTER_SALT, info = "RFID-A\0") -> 16 nøkler à 6 byte.
void deriveKeys(const uint8_t *uid, size_t uidLen, uint8_t keys[16][6]) {
  uint8_t prk[32];
  hmacSha256(MASTER_SALT, sizeof(MASTER_SALT), uid, uidLen, prk);

  uint8_t okm[96];
  uint8_t t[32];
  uint8_t input[32 + sizeof(KDF_INFO) + 1];
  size_t tLen = 0;
  for (int i = 1, pos = 0; pos < 96; i++) {
    memcpy(input, t, tLen);
    memcpy(input + tLen, KDF_INFO, sizeof(KDF_INFO));
    input[tLen + sizeof(KDF_INFO)] = (uint8_t)i;
    hmacSha256(prk, 32, input, tLen + sizeof(KDF_INFO) + 1, t);
    tLen = 32;
    int n = min(32, 96 - pos);
    memcpy(okm + pos, t, n);
    pos += n;
  }
  for (int k = 0; k < 16; k++) memcpy(keys[k], okm + k * 6, 6);
}

// ---------- Hjelpere ----------

String toHex(const uint8_t *data, size_t len) {
  static const char *digits = "0123456789ABCDEF";
  String s;
  s.reserve(len * 2);
  for (size_t i = 0; i < len; i++) {
    s += digits[data[i] >> 4];
    s += digits[data[i] & 0x0F];
  }
  return s;
}

String isoNow() {
  time_t now = time(nullptr);
  if (now < 1700000000) return "";          // NTP ikke synkronisert ennå
  struct tm t;
  gmtime_r(&now, &t);
  char buf[25];
  strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &t);
  return String(buf);
}

// "2026-10-08T12:34:56Z" (også med millisekunder) -> sekunder siden 1970 (UTC). 0 ved feil.
time_t parseIso(const char *iso) {
  int y, mo, d, h, mi, se;
  if (!iso || sscanf(iso, "%d-%d-%dT%d:%d:%d", &y, &mo, &d, &h, &mi, &se) != 6) return 0;
  // Dager siden 1970-01-01 (Howard Hinnants days_from_civil).
  y -= mo <= 2;
  long era = (y >= 0 ? y : y - 399) / 400;
  long yoe = y - era * 400;
  long doy = (153 * (mo + (mo > 2 ? -3 : 9)) + 2) / 5 + d - 1;
  long doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
  long days = era * 146097 + doe - 719468;
  return (time_t)days * 86400 + h * 3600 + mi * 60 + se;
}

// Venter inntil 10 sekunder på at NTP har satt klokken.
bool waitForTime() {
  for (int i = 0; i < 100 && time(nullptr) < 1700000000; i++) delay(100);
  return time(nullptr) >= 1700000000;
}

void connectWifi() {
  if (WiFi.status() == WL_CONNECTED) return;
  Serial.printf("Kobler til WiFi %s", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  for (int i = 0; i < 40 && WiFi.status() != WL_CONNECTED; i++) {
    delay(500);
    Serial.print('.');
  }
  Serial.println(WiFi.status() == WL_CONNECTED ? " OK" : " feilet");
}

// ---------- RFID ----------

// Leser blokk 0–19. Returnerer false hvis brikken ikke kunne leses. notBambu settes når
// brikken ikke er en Bambu-brikke i det hele tatt (feil i første sektor eller annen type),
// og da behandles den som en personlig brikke.
bool readTag(uint8_t blocks[BLOCKS][16], bool &notBambu) {
  notBambu = false;
  if (rfid.uid.size != 4) {
    Serial.println("Ikke en 4-byte MIFARE Classic-brikke.");
    notBambu = true;
    return false;
  }
  uint8_t keys[16][6];
  deriveKeys(rfid.uid.uidByte, rfid.uid.size, keys);
  memset(blocks, 0, BLOCKS * 16);

  for (int s = 0; s < SECTORS; s++) {
    MFRC522::MIFARE_Key key;
    memcpy(key.keyByte, keys[s], 6);
    byte trailer = s * 4 + 3;
    if (rfid.PCD_Authenticate(MFRC522::PICC_CMD_MF_AUTH_KEY_A, trailer, &key, &rfid.uid) != MFRC522::STATUS_OK) {
      Serial.printf("Autentisering feilet i sektor %d (ikke en Bambu-brikke?)\n", s);
      notBambu = s == 0;
      return false;
    }
    for (int b = 0; b < 3; b++) {
      byte block = s * 4 + b;
      byte buf[18];
      byte size = sizeof(buf);
      if (rfid.MIFARE_Read(block, buf, &size) != MFRC522::STATUS_OK) {
        Serial.printf("Lesing av blokk %d feilet\n", block);
        return false;
      }
      memcpy(blocks[block], buf, 16);
    }
  }
  return true;
}

// ---------- Workeren ----------
//
// Dataene ligger i en database bak Workeren (Filament Universet). Leseren sender én skanning
// eller ett kort om gangen, og Workeren avgjør inn/ut og lagrer – ingen konflikter med andre
// som lagrer samtidig. Tokenen er den samme som før (lesetilgang til BambuFilament-data holder).

#ifndef WORKER_URL
#define WORKER_URL "https://bambufilament-proxy.saysphilippe.workers.dev"
#endif

// POST til Workeren. Returnerer HTTP-status og fyller reply med svaret (JSON).
int workerPost(const char *path, JsonDocument &body, JsonDocument &reply) {
  connectWifi();
  if (WiFi.status() != WL_CONNECTED) return -1;
  // Sertifikatsjekk krever riktig klokke, så vent på NTP før tokenen sendes.
  if (!waitForTime()) {
    Serial.println("Klokken er ikke synkronisert (NTP) – kan ikke sjekke sertifikatet.");
    return -1;
  }
  WiFiClientSecure client;
  client.setCACert(WORKER_ROOT_CAS);        // sjekker at det faktisk er Workeren
  HTTPClient http;
  http.begin(client, String(WORKER_URL) + path);
  http.addHeader("Authorization", String("Bearer ") + GITHUB_TOKEN);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("User-Agent", "BambuFilament-ESP32");
  String payload;
  serializeJson(body, payload);
  int code = http.POST(payload);
  if (code > 0 && deserializeJson(reply, http.getStream())) reply.clear();
  http.end();
  if (code != 200) Serial.printf("Workeren svarte %d: %s\n", code, (const char *)(reply["error"] | ""));
  return code;
}

ScanResult uploadScan(const String &id, const String &blocksHex, String &summary) {
  JsonDocument body, reply;
  body["id"] = id;
  body["blocks"] = blocksHex;
  String by = currentUser();
  if (by.length()) body["user"] = by;
  if (strlen(OWNER)) body["owner"] = OWNER;
  if (workerPost("/reader/scan", body, reply) != 200) return SCAN_FAIL;
  String result = reply["result"] | "";
  if (result == "noop") {
    waitMinutes = reply["waitMinutes"] | 0;
    summary = "allerede sjekket inn";
    return SCAN_NOOP;
  }
  bool isNew = reply["isNew"] | false;
  summary = String(result == "out" ? "sjekket ut" : "sjekket inn") + (isNew ? ", ny spole" : "");
  return result == "out" ? SCAN_OUT : result == "in" ? SCAN_IN : SCAN_FAIL;
}

// RFID-kort: Workeren slår opp navnet (eller registrerer et nytt kort uten navn).
// Returnerer 1 = kort med navn (brukeren settes), 0 = kort uten navn, 2 = nytt kort, -1 = feil.
int handleCard(const String &uid) {
  JsonDocument body, reply;
  body["uid"] = uid;
  if (strlen(OWNER)) body["reader"] = OWNER;
  if (workerPost("/reader/card", body, reply) != 200) return -1;
  readSettings(reply);
  String status = reply["status"] | "";
  if (status == "known") {
    cardUser = reply["user"] | "";
    cardUntil = millis() + cardMs();
    Serial.printf("Kort %s: %s (i %.1f minutter)\n", uid.c_str(), cardUser.c_str(), cardMinutes);
    return 1;
  }
  if (status == "new") {
    Serial.printf("Nytt kort %s registrert – legg til navn under RFID-kort på siden.\n", uid.c_str());
    return 2;
  }
  return 0;
}

// ---------- Arduino ----------

void setup() {
  Serial.begin(115200);
  for (int pin : { PIN_LED_IN, PIN_LED_OUT, PIN_LED_BUSY }) {
    if (pin >= 0) pinMode(pin, OUTPUT);
  }
  if (PIN_OLED_SDA >= 0) {
    Wire.begin(PIN_OLED_SDA, PIN_OLED_SCL);
    hasOled = oled.begin(SSD1306_SWITCHCAPVCC, OLED_ADDRESS);
    if (hasOled) {
      oled.cp437(true);
      screen("Starter", "Kobler til WiFi ...");
    } else {
      Serial.println("Fant ikke OLED-skjermen.");
    }
  }
  SPI.begin();
  rfid.PCD_Init();
  Serial.print("RC522 versjon: 0x");
  Serial.println(rfid.PCD_ReadRegister(MFRC522::VersionReg), HEX);

  busy(true);
  connectWifi();
  configTime(0, 0, "pool.ntp.org", "time.google.com");
  busy(false);
  if (WiFi.status() == WL_CONNECTED) {
    showMode();
    showIdle(true);
  } else {
    screen("Ingen WiFi", WIFI_SSID, "Sjekk config.h");
    signalError();
  }
  Serial.println("Klar – tapp kortet ditt (valgfritt) og skann en Bambu-spole.");
}

void loop() {
  if (!rfid.PICC_IsNewCardPresent() || !rfid.PICC_ReadCardSerial()) {
    showIdle();
    delay(50);
    return;
  }

  String uid = toHex(rfid.uid.uidByte, rfid.uid.size);
  if (uid == lastUid && millis() - lastUidAt < IGNORE_REPEAT_MS) {
    rfid.PICC_HaltA();
    return;
  }
  lastUid = uid;
  lastUidAt = millis();
  Serial.printf("Brikke %s funnet\n", uid.c_str());
  busy(true);
  screen("Leser ...", uid);

  uint8_t blocks[BLOCKS][16];
  bool notBambu = false;
  bool ok = readTag(blocks, notBambu);
  rfid.PICC_HaltA();
  rfid.PCD_StopCrypto1();

  if (!ok && notBambu) {
    // RFID-kort: hvem som skanner de neste sekundene.
    screen("Kort", uid, "Slår opp ...");
    int known = handleCard(uid);
    busy(false);
    if (known == 1) {
      screen("Hei " + cardUser + "!", "Skann spoler nå", "Gjelder " + String(cardMs() / 1000) + " s etter hver");
      signalCard();
    } else if (known == 2) {
      screen("Nytt kort", uid, "Gi det navn på siden");
      signalError();
    } else if (known == 0) {
      screen("Uten navn", uid, "Gi det navn på siden");
      signalError();
    } else {
      screen("Feil", "Kunne ikke slå opp", "kortet. Prøv igjen.");
      signalError();
    }
    delay(1500);
    showIdle(true);
    return;
  }
  if (!ok) {
    busy(false);
    screen("Feil", "Kunne ikke lese", "spolen. Prøv igjen.");
    signalError();
    delay(1500);
    showIdle(true);
    return;
  }

  // Tray UID (blokk 9) er unik per spole; UID-en til brikken brukes hvis den mangler.
  bool hasTrayUid = false;
  for (int i = 0; i < 16; i++) hasTrayUid |= blocks[9][i] != 0;
  String id = hasTrayUid ? toHex(blocks[9], 16) : uid;

  char type[17] = {0};
  memcpy(type, blocks[4], 16);
  Serial.printf("%s, farge #%s – lagrer...\n", type, toHex(blocks[5], 3).c_str());

  // Hver spole som tappes mens et kort er aktivt, starter kortets 60 sekunder på nytt.
  if (cardUser.length() && millis() < cardUntil) cardUntil = millis() + cardMs();

  String summary;
  ScanResult result = uploadScan(id, toHex(&blocks[0][0], BLOCKS * 16), summary);
  busy(false);
  String who = currentUser();
  String what = String(type).substring(0, 21);
  if (result == SCAN_IN || result == SCAN_OUT) {
    Serial.printf("Lagret (%s).\n", summary.c_str());
    screen(result == SCAN_OUT ? "Sjekket ut" : "Sjekket inn", what, who.length() ? "av " + who : "av ukjent");
    signalOk(result == SCAN_OUT);
  } else if (result == SCAN_NOOP) {
    Serial.printf("Allerede sjekket inn – utsjekk mulig om %ld min.\n", waitMinutes);
    screen("Er inne", what, "Utsjekk om " + String(waitMinutes) + " min");
    signalNoop();
  } else {
    screen("Ikke lagret", "Sjekk WiFi og", "prøv igjen.");
    signalError();
  }
  delay(1500);
  showIdle(true);
}
