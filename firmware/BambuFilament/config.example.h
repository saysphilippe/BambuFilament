// Kopier denne filen til config.h og fyll inn dine verdier.
// config.h er i .gitignore og blir aldri lastet opp til GitHub.
#pragma once

#define WIFI_SSID     "MittWiFi"
#define WIFI_PASSWORD "passord"

// Fine-grained token fra https://github.com/settings/personal-access-tokens
// KUN repoet saysphilippe/BambuFilament-data, rettighet "Contents: Read and write".
// Lag en egen token for hver leser, så den kan trekkes tilbake alene.
#define GITHUB_TOKEN  "github_pat_..."
#define GITHUB_REPO   "saysphilippe/BambuFilament-data"
#define GITHUB_BRANCH "main"
#define GITHUB_PATH   "spools.json"

// Hvem som skanner når ingen personlig brikke er skannet, og eier av nye spoler da.
// Deler flere leseren, kan den stå tom (""): da må eieren av spolen godkjenne hvem som tok den.
#define OWNER         "Philippe"

// Hvor lenge en personlig brikke gjelder etter skanning (sekunder).
#define CARD_SESSION_SECONDS 60

// RC522 (SPI) mot ESP32 DevKit: SCK=18, MISO=19, MOSI=23, i tillegg:
#define PIN_RC522_SS  5
#define PIN_RC522_RST 22

// LED-er (anode via 220–330 Ω til pinnen, katode til GND). -1 = ingen LED.
// Tre rolige blink: grønn = sjekket inn, rød = sjekket ut. Begge raskt = feil.
#define PIN_LED_IN    25   // grønn: Innsjekk
#define PIN_LED_OUT   26   // rød/gul: Utsjekk

// Innebygd LED på ESP32 DevKit, lyser mens brikken leses og lagres. -1 = ikke bruk.
#define PIN_LED_BUSY  2

// Skann en spole som er inne på nytt etter så mange minutter = utsjekk.
#define CHECKOUT_AFTER_MINUTES 10

// OLED-skjerm SSD1306 128x64 (I2C): VCC 3V3, GND, SDA og SCL til pinnene under.
// (GPIO 22 brukes av RC522, så SCL ligger på GPIO 4.) -1 = ingen skjerm.
#define PIN_OLED_SDA  21
#define PIN_OLED_SCL  4
#define OLED_ADDRESS  0x3C
