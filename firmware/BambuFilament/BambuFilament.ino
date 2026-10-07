// BambuFilament – RFID-leser for Bambu Lab-spoler (ESP32 + RC522)
//
// Leser MIFARE Classic-brikken på en Bambu Lab-spole, utleder sektornøklene
// fra brikkens UID (HKDF-SHA256, se github.com/Bambu-Research-Group/RFID-Tag-Guide)
// og legger rådataene inn i spools.json i GitHub-repoet BambuFilament-data. Web-appen på
// github.io tolker blokkene og viser oversikten.
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
#include "config.h"
#include "github_roots.h"

static const int SECTORS = 5;               // Bambu-dataene ligger i sektor 0–4 (blokk 0–19)
static const int BLOCKS = SECTORS * 4;
static const int MAX_TRIES = 3;             // nye forsøk ved 409 (noen andre lagret samtidig)
static const int MAX_HISTORY = 10;          // antall hendelser per spole (holder spools.json liten)
// Største svar fra GitHub som behandles. Base64-innholdet, den dekodede teksten og
// JSON-dokumentet må få plass i minnet samtidig (ca. 280 kB ledig). Delte AMS- og
// bibliotekdata ligger i shared.json, som leseren ikke henter, så spools.json holdes liten.
static const int MAX_RESPONSE_BYTES = 120000;

static const uint8_t MASTER_SALT[16] = {
  0x9a, 0x75, 0x9c, 0xf2, 0xc4, 0xf7, 0xca, 0xff,
  0x22, 0x2c, 0xb9, 0x76, 0x9b, 0x41, 0xbc, 0x96
};
static const uint8_t KDF_INFO[7] = { 'R', 'F', 'I', 'D', '-', 'A', 0 };

MFRC522 rfid(PIN_RC522_SS, PIN_RC522_RST);

String lastUid;
unsigned long lastUidAt = 0;
bool checkOutMode = false;                  // false = innsjekk, true = utsjekk (velges med knappene)

// ---------- LED ----------

void setLed(int pin, bool on) {
  if (pin >= 0) digitalWrite(pin, on ? HIGH : LOW);
}

// LED-en for aktiv modus lyser fast.
void showMode() {
  setLed(PIN_LED_IN, !checkOutMode);
  setLed(PIN_LED_OUT, checkOutMode);
}

// Innebygd LED lyser mens brikken leses og lagres.
void busy(bool on) {
  setLed(PIN_LED_BUSY, on);
}

// Lagret: LED-en for aktiv modus blinker rolig tre ganger.
void signalOk() {
  int pin = checkOutMode ? PIN_LED_OUT : PIN_LED_IN;
  for (int i = 0; i < 3; i++) {
    setLed(pin, false); delay(250); setLed(pin, true); delay(250);
  }
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

void setMode(bool checkOut) {
  checkOutMode = checkOut;
  Serial.println(checkOut ? "Modus: UTSJEKK" : "Modus: INNSJEKK");
  showMode();
}

// Knappene er koblet mellom pinnen og GND (INPUT_PULLUP), så trykket = LOW.
void checkButtons() {
  if (PIN_BUTTON_IN >= 0 && digitalRead(PIN_BUTTON_IN) == LOW) setMode(false);
  else if (PIN_BUTTON_OUT >= 0 && digitalRead(PIN_BUTTON_OUT) == LOW) setMode(true);
  else return;
  // Vent til knappen slippes, så ett trykk gir én hendelse.
  while ((PIN_BUTTON_IN >= 0 && digitalRead(PIN_BUTTON_IN) == LOW) ||
         (PIN_BUTTON_OUT >= 0 && digitalRead(PIN_BUTTON_OUT) == LOW)) delay(10);
  delay(50);
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

// Leser blokk 0–19. Returnerer false hvis brikken ikke er en Bambu-brikke.
bool readTag(uint8_t blocks[BLOCKS][16]) {
  if (rfid.uid.size != 4) {
    Serial.println("Ikke en 4-byte MIFARE Classic-brikke.");
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

// ---------- GitHub ----------

String apiUrl() {
  return String("https://api.github.com/repos/") + GITHUB_REPO + "/contents/" + GITHUB_PATH;
}

void addHeaders(HTTPClient &http) {
  http.addHeader("Authorization", String("Bearer ") + GITHUB_TOKEN);
  http.addHeader("Accept", "application/vnd.github+json");
  http.addHeader("User-Agent", "BambuFilament-ESP32");
  http.addHeader("X-GitHub-Api-Version", "2022-11-28");
}

// Henter spools.json. Returnerer HTTP-status; fyller doc og sha ved 200.
int fetchSpools(WiFiClientSecure &client, JsonDocument &doc, String &sha) {
  HTTPClient http;
  http.begin(client, apiUrl() + "?ref=" + GITHUB_BRANCH);
  addHeaders(http);
  int code = http.GET();
  if (code != 200) {
    http.end();
    return code;
  }
  int size = http.getSize();
  if (size > MAX_RESPONSE_BYTES) {
    Serial.printf("spools.json er for stor for leseren (%d byte, maks %d).\n", size, MAX_RESPONSE_BYTES);
    http.end();
    return -4;
  }
  JsonDocument meta;
  DeserializationError err = deserializeJson(meta, http.getStream());
  http.end();
  if (err) return -1;

  sha = meta["sha"].as<String>();
  String b64 = meta["content"].as<String>();
  b64.replace("\n", "");
  size_t outLen = 0;
  size_t cap = b64.length() * 3 / 4 + 4;
  uint8_t *raw = (uint8_t *)malloc(cap);
  if (!raw) return -2;
  int rc = mbedtls_base64_decode(raw, cap, &outLen, (const uint8_t *)b64.c_str(), b64.length());
  if (rc == 0) err = deserializeJson(doc, (const char *)raw, outLen);
  free(raw);
  return (rc == 0 && !err) ? 200 : -3;
}

// Lagrer spools.json. Returnerer HTTP-status (200/201 = OK, 409 = konflikt).
int putSpools(WiFiClientSecure &client, JsonDocument &doc, const String &sha, const String &message) {
  String json;
  serializeJsonPretty(doc, json);
  size_t cap = 4 * ((json.length() + 2) / 3) + 1;
  uint8_t *b64 = (uint8_t *)malloc(cap);
  if (!b64) return -2;
  size_t b64Len = 0;
  mbedtls_base64_encode(b64, cap, &b64Len, (const uint8_t *)json.c_str(), json.length());
  json = String();

  JsonDocument body;
  body["message"] = message;
  body["branch"] = GITHUB_BRANCH;
  body["content"] = (const char *)b64;
  if (sha.length()) body["sha"] = sha;
  String payload;
  serializeJson(body, payload);
  free(b64);

  HTTPClient http;
  http.begin(client, apiUrl());
  addHeaders(http);
  http.addHeader("Content-Type", "application/json");
  int code = http.PUT(payload);
  http.end();
  return code;
}

bool uploadScan(const String &id, const String &blocksHex, bool checkOut, String &summary) {
  connectWifi();
  if (WiFi.status() != WL_CONNECTED) return false;

  // Sertifikatsjekk krever riktig klokke, så vent på NTP før tokenen sendes.
  if (!waitForTime()) {
    Serial.println("Klokken er ikke synkronisert (NTP) – kan ikke sjekke GitHub-sertifikatet.");
    return false;
  }
  WiFiClientSecure client;
  client.setCACert(GITHUB_ROOT_CAS);        // sjekker at det faktisk er GitHub

  for (int attempt = 1; attempt <= MAX_TRIES; attempt++) {
    JsonDocument doc;
    String sha;
    int code = fetchSpools(client, doc, sha);
    if (code == 404) {
      doc["version"] = 1;
      doc["spools"].to<JsonArray>();
    } else if (code != 200) {
      Serial.printf("Henting av spools.json feilet: %d\n", code);
      return false;
    }

    JsonArray spools = doc["spools"].is<JsonArray>() ? doc["spools"].as<JsonArray>() : doc["spools"].to<JsonArray>();
    String now = isoNow();
    JsonObject spool;
    for (JsonObject s : spools) {
      if (s["id"] == id) { spool = s; break; }
    }
    bool isNew = spool.isNull();
    if (isNew) {
      spool = spools.add<JsonObject>();
      spool["id"] = id;
      spool["owner"] = OWNER;
      spool["note"] = "";
      spool["added"] = now;
      spool["scans"] = 0;
    }
    const char *action = checkOut ? "out" : "in";
    spool["status"] = action;
    spool["blocks"] = blocksHex;
    spool["lastScan"] = now;
    spool["scans"] = spool["scans"].as<int>() + 1;

    JsonArray history = spool["history"].is<JsonArray>() ? spool["history"].as<JsonArray>() : spool["history"].to<JsonArray>();
    JsonObject event = history.add<JsonObject>();
    event["at"] = now;
    event["action"] = action;
    event["by"] = OWNER;
    while (history.size() > MAX_HISTORY) history.remove(0);

    summary = String(checkOut ? "sjekket ut" : "sjekket inn") + (isNew ? ", ny spole" : "");
    code = putSpools(client, doc, sha, String(checkOut ? "Utsjekk " : "Innsjekk ") + id.substring(0, 8) + " (" + OWNER + ")");
    if (code == 200 || code == 201) return true;
    Serial.printf("Lagring feilet: %d (forsøk %d)\n", code, attempt);
    if (code != 409) return false;
    delay(500);
  }
  return false;
}

// ---------- Arduino ----------

void setup() {
  Serial.begin(115200);
  for (int pin : { PIN_LED_IN, PIN_LED_OUT, PIN_LED_BUSY }) {
    if (pin >= 0) pinMode(pin, OUTPUT);
  }
  if (PIN_BUTTON_IN >= 0) pinMode(PIN_BUTTON_IN, INPUT_PULLUP);
  if (PIN_BUTTON_OUT >= 0) pinMode(PIN_BUTTON_OUT, INPUT_PULLUP);
  SPI.begin();
  rfid.PCD_Init();
  Serial.print("RC522 versjon: 0x");
  Serial.println(rfid.PCD_ReadRegister(MFRC522::VersionReg), HEX);

  busy(true);
  connectWifi();
  configTime(0, 0, "pool.ntp.org", "time.google.com");
  busy(false);
  if (WiFi.status() == WL_CONNECTED) showMode(); else signalError();
  Serial.println("Klar – hold en Bambu-spole mot leseren. Modus: INNSJEKK.");
}

void loop() {
  checkButtons();
  if (!rfid.PICC_IsNewCardPresent() || !rfid.PICC_ReadCardSerial()) {
    delay(50);
    return;
  }

  String uid = toHex(rfid.uid.uidByte, rfid.uid.size);
  if (uid == lastUid && millis() - lastUidAt < 5000) {
    rfid.PICC_HaltA();
    return;
  }
  lastUid = uid;
  lastUidAt = millis();
  Serial.printf("Brikke %s funnet\n", uid.c_str());
  busy(true);

  uint8_t blocks[BLOCKS][16];
  bool ok = readTag(blocks);
  rfid.PICC_HaltA();
  rfid.PCD_StopCrypto1();

  if (!ok) {
    busy(false);
    signalError();
    return;
  }

  // Tray UID (blokk 9) er unik per spole; UID-en til brikken brukes hvis den mangler.
  bool hasTrayUid = false;
  for (int i = 0; i < 16; i++) hasTrayUid |= blocks[9][i] != 0;
  String id = hasTrayUid ? toHex(blocks[9], 16) : uid;

  char type[17] = {0};
  memcpy(type, blocks[4], 16);
  Serial.printf("%s, farge #%s – lagrer...\n", type, toHex(blocks[5], 3).c_str());

  String summary;
  bool saved = uploadScan(id, toHex(&blocks[0][0], BLOCKS * 16), checkOutMode, summary);
  busy(false);
  if (saved) {
    Serial.printf("Lagret (%s).\n", summary.c_str());
    signalOk();
  } else {
    signalError();
  }
}
