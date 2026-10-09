// Datablad og koblingsskjema for elektroniske komponenter i komponentbiblioteket.
//
// Delenummeret finnes i tittelen (eller Mouser-nummeret). Ut fra det velges en mal for typisk
// bruk (transistor som bryter, spenningsregulator, 555-oscillator, I2C-modul osv.) og en
// pinnerekkefølge. Skjemaene er inline SVG med currentColor, så de virker i lyst og mørkt tema.
// Stil: strøm øverst, jord nederst, signal fra venstre mot høyre, verdier på alle deler.

// ---------- Delenummer ----------

// Mønstre for delenumre vi kjenner igjen, med type og pinnerekkefølge.
// pins: rekkefølgen sett forfra (TO-92: flat side mot deg, bena ned; TO-220: forsiden, bena ned).
const PARTS = [
  // NPN
  [/\b(PN2222A?|2N2222A?|MMBT2222A?)\b/i, { kind: "npn", pkg: "TO-92", pins: ["E", "B", "C"], note: "Opptil 600 mA. MMBT2222 er SOT-23: 1 = B, 2 = E, 3 = C." }],
  [/\b(2N3904|MMBT3904)\b/i, { kind: "npn", pkg: "TO-92", pins: ["E", "B", "C"], note: "Opptil 200 mA." }],
  [/\b(BC54[6-9][A-C]?|BC33[78](-\d+)?)\b/i, { kind: "npn", pkg: "TO-92", pins: ["C", "B", "E"], note: "Opptil 100 mA (BC337: 800 mA). Merk: C-B-E, motsatt av 2N2222." }],
  [/\b(S8050|S9013|S9014|S9018|SS8050)\b/i, { kind: "npn", pkg: "TO-92", pins: ["E", "B", "C"], note: "S8050: opptil 500 mA." }],
  [/\b(TIP12[0-2]|TIP3[15][A-C]?|TIP41[A-C]?|BD13[5-9]|MJE13005)\b/i, { kind: "npn", pkg: "TO-220", pins: ["B", "C", "E"], note: "Effekttransistor. TIP120–122 er Darlington (ca. 1,4 V fall B–E)." }],
  [/\b2SC\d{3,4}\b/i, { kind: "npn", pkg: "TO-92", pins: ["E", "C", "B"], note: "Japanske 2SC-transistorer har ofte E-C-B. Sjekk databladet." }],
  // PNP
  [/\b(2N3906|MMBT3906)\b/i, { kind: "pnp", pkg: "TO-92", pins: ["E", "B", "C"], note: "Opptil 200 mA." }],
  [/\b(2N2907A?)\b/i, { kind: "pnp", pkg: "TO-92", pins: ["E", "B", "C"], note: "Opptil 600 mA." }],
  [/\b(BC55[6-9][A-C]?|BC32[78](-\d+)?)\b/i, { kind: "pnp", pkg: "TO-92", pins: ["C", "B", "E"], note: "Merk: C-B-E." }],
  [/\b(S8550|S9012|S9015|SS8550)\b/i, { kind: "pnp", pkg: "TO-92", pins: ["E", "B", "C"], note: "S8550: opptil 500 mA." }],
  [/\b(TIP12[5-7]|TIP3[26][A-C]?|TIP42[A-C]?)\b/i, { kind: "pnp", pkg: "TO-220", pins: ["B", "C", "E"], note: "Effekttransistor (PNP)." }],
  // N-MOSFET
  [/\b(IRLZ44N?|IRLZ34N?|IRLB8721|IRL540N?|IRL3705N?|IRLR7843)\b/i, { kind: "nmos", pkg: "TO-220", pins: ["G", "D", "S"], logic: true, note: "Logikknivå: slår helt på med 3,3–5 V på gate." }],
  [/\b(IRF520N?|IRF540N?|IRFZ44N?|IRF3205|IRF840|FQP\d+N\d+\w*|IRFP\d+|IRF1404)\b/i, { kind: "nmos", pkg: "TO-220", pins: ["G", "D", "S"], logic: false, note: "Ikke logikknivå: trenger ca. 10 V på gate for å slå helt på. Fra 3,3 V blir den varm. Bruk IRLZ44N eller en gate-driver." }],
  [/\b(AO3400A?|SI2302|SI2300|A2SHB|AO3402)\b/i, { kind: "nmos", pkg: "SOT-23", pins: ["G", "S", "D"], logic: true, note: "Logikknivå, SMD. Pinne 1 = G, 2 = S, 3 = D." }],
  [/\b(2N7000\w*|2N7002\w*)\b/i, { kind: "nmos", pkg: "TO-92", pins: ["S", "G", "D"], logic: true, note: "Små laster, opptil 200 mA. 2N7002 er SOT-23." }],
  [/\bBS170\b/i, { kind: "nmos", pkg: "TO-92", pins: ["D", "G", "S"], logic: true, note: "Merk: D-G-S, motsatt av 2N7000." }],
  // P-MOSFET
  [/\b(AO3401A?|SI2301|A1SHB|AO3407)\b/i, { kind: "pmos", pkg: "SOT-23", pins: ["G", "S", "D"], note: "P-kanal, SMD. Pinne 1 = G, 2 = S, 3 = D." }],
  [/\b(IRF9540N?|IRF9Z34N?|IRF4905|IRF5305)\b/i, { kind: "pmos", pkg: "TO-220", pins: ["G", "D", "S"], note: "P-kanal, ikke logikknivå." }],
  // Spenningsregulatorer
  [/\b(L?M?78(0[5-9]|1[25]|24)|LM78\d\d|L78\d\d)\b/i, { kind: "reg78", pkg: "TO-220", pins: ["IN", "GND", "OUT"], note: "Inn minst ca. 2 V over utgangen. Effekttap = (Vinn − Vut) × strøm, så bruk kjøleribbe." }],
  [/\b(AMS1117|LM1117|LD1117)(-?\d\.\d|-ADJ)?\b/i, { kind: "reg1117", pkg: "SOT-223", pins: ["GND/ADJ", "OUT", "IN"], note: "Lavt spenningsfall (ca. 1,1 V). Kjøleflaten (tab) er OUT." }],
  [/\bLM317\b/i, { kind: "lm317", pkg: "TO-220", pins: ["ADJ", "OUT", "IN"], note: "Justerbar: Vut = 1,25 × (1 + R2/R1)." }],
  // IC-er
  [/\b(NE555|LM555|NA555|SA555|TLC555|ICM7555)\b/i, { kind: "ne555", pkg: "DIP-8", pins: ["GND", "TRIG", "OUT", "RESET", "CTRL", "THR", "DIS", "VCC"], note: "Pinne 1 er ved prikken/hakket, tell mot klokka sett ovenfra." }],
  [/\b(PC817|EL817|LTV817|PC817C)\b/i, { kind: "opto", pkg: "DIP-4", pins: ["A", "K", "E", "C"], note: "Galvanisk skille mellom to kretser. LED-side: 1 = anode, 2 = katode." }],
  [/\b(ULN2003A?|ULN2803A?)\b/i, { kind: "uln", pkg: "DIP-16", pins: [], note: "7 Darlington-drivere med innebygde flyback-dioder. COM (pinne 9) til lastens pluss." }],
  // Dioder
  [/\b(1N400[1-7]|1N540[0-8]|M7|UF400\d)\b/i, { kind: "diode", pkg: "DO-41", pins: ["A", "K"], note: "Stripen er katoden (K)." }],
  [/\b(1N58(1[7-9])|SS(1[0-9]|3[0-9]|5[0-9])|SB560|SR560)\b/i, { kind: "schottky", pkg: "DO-41/SMA", pins: ["A", "K"], note: "Schottky: lavt spenningsfall (ca. 0,3–0,5 V). Stripen er katoden." }],
  [/\b(1N4148\w*|LL4148)\b/i, { kind: "signaldiode", pkg: "DO-35", pins: ["A", "K"], note: "Signaldiode, opptil 300 mA. Stripen er katoden." }],
  // Flere transistorer og MOSFET-er
  [/\b(MMBT4401|2N4401|2N5551|MMBT5551)\b/i, { kind: "npn", pkg: "TO-92", pins: ["E", "B", "C"], note: "Opptil 600 mA. MMBT-versjonen er SOT-23: 1 = B, 2 = E, 3 = C." }],
  [/\b(BC8[14][67]\w*)\b/i, { kind: "npn", pkg: "SOT-23", pins: ["B", "E", "C"], note: "SMD-utgaven av BC547/BC337. Pinne 1 = B, 2 = E, 3 = C." }],
  [/\b(2N4403|2N5401|MMBT4403|MMBT5401)\b/i, { kind: "pnp", pkg: "TO-92", pins: ["E", "B", "C"], note: "PNP. MMBT-versjonen er SOT-23: 1 = B, 2 = E, 3 = C." }],
  [/\b(BC8[05][67]\w*)\b/i, { kind: "pnp", pkg: "SOT-23", pins: ["B", "E", "C"], note: "PNP, SMD. Pinne 1 = B, 2 = E, 3 = C." }],
  [/\b(IRFZ34N?\w*|IRF710\w*|IRF3710\w*|IRF2907Z?\w*|IRF530N?\w*)\b/i, { kind: "nmos", pkg: "TO-220", pins: ["G", "D", "S"], logic: false, note: "Ikke logikknivå: trenger ca. 10 V på gate for å slå helt på." }],
  [/\b(FQP47P06|FQP27P06|NDP6020P|IRF9530N?)\b/i, { kind: "pmos", pkg: "TO-220", pins: ["G", "D", "S"], note: "P-kanal effekt-MOSFET. NDP6020P er logikknivå (slår på ved ca. −4,5 V på gate)." }],
  [/\b(DMP2045U\w*|DMG3415U\w*|DMP3098L\w*)\b/i, { kind: "pmos", pkg: "SOT-23", pins: ["G", "S", "D"], note: "P-kanal, logikknivå, SMD. Pinne 1 = G, 2 = S, 3 = D." }],
  // Tyristorer og triacer
  [/\b(2N506[0-4]|BT169\w*|MCR100\w*|MCR22\w*|PCR406\w*|CR02AM)\b/i, { kind: "scr", pkg: "TO-92", pins: ["K", "G", "A"], note: "Følsom tyristor (SCR): tenner på ca. 0,2 mA gatestrøm og holder seg på til strømmen gjennom den brytes." }],
  [/\b(BT151\w*|BT152\w*|TYN6\d\d\w*|TYN1\d\d\d\w*|C106\w*|S6006\w*)\b/i, { kind: "scr", pkg: "TO-220", pins: ["K", "A", "G"], note: "Effekt-tyristor. Merk: K-A-G på TO-220 (C106 i TO-126 har samme rekkefølge)." }],
  [/\b(BT13[6-9]\w*|BTA1[0-9]\w*|BTA2[0-9]\w*|BTA4\d\w*|BTB1\d\w*|T435\w*)\b/i, { kind: "triac", pkg: "TO-220", pins: ["MT1", "MT2", "G"], note: "Triac for vekselstrøm. Kjøleflaten er koblet til MT2 (unntatt BTA, som er isolert)." }],
  [/\b(MAC97A\d|Z0[14]0\d\w*|BT131\w*)\b/i, { kind: "triac", pkg: "TO-92", pins: [], note: "Liten triac (opptil ca. 0,6–1 A). Pinnerekkefølgen varierer mellom produsenter – sjekk databladet." }],
  [/\b(MOC30[2-8]\d\w*)\b/i, { kind: "triac", pkg: "DIP-6", pins: ["A", "K", "NC", "MT1", "NC", "MT2"], note: "Optotriac: styrer en triac fra en mikrokontroller med galvanisk skille. MOC304x/306x har nullgjennomgangsdetektor." }],
  // Operasjonsforsterkere og komparatorer
  [/\b(LM358\w*|LM2904\w*|TL07[24]\w*|TL08[24]\w*|NE5532\w*|LM1458\w*|LMC662\w*|MCP600[24]\w*|LM833\w*|OPA2\d+\w*|TLV2\d+\w*)\b/i, { kind: "opamp", pkg: "DIP-8", pins: ["OUT A", "IN− A", "IN+ A", "V−", "IN+ B", "IN− B", "OUT B", "V+"], note: "To operasjonsforsterkere i samme brikke (TL074/TL084 og LM324 har fire). Ubrukte forsterkere: koble som spenningsfølger." }],
  [/\b(UA741\w*|LM741\w*|OP07\w*|CA3140\w*)\b/i, { kind: "opamp", pkg: "DIP-8", pins: ["OFFSET", "IN−", "IN+", "V−", "OFFSET", "OUT", "V+", "NC"], note: "Én operasjonsforsterker. 741 trenger helst ±5 V eller mer og går ikke helt til forsyningsspenningene." }],
  [/\b(LM324\w*|LM2902\w*)\b/i, { kind: "opamp", pkg: "DIP-14", pins: ["OUT1", "IN1−", "IN1+", "V+", "IN2+", "IN2−", "OUT2", "OUT3", "IN3−", "IN3+", "GND", "IN4+", "IN4−", "OUT4"], note: "Fire operasjonsforsterkere, kan gå på én forsyning (3–32 V)." }],
  [/\b(LM393\w*|LM2903\w*|LM311\w*)\b/i, { kind: "comparator", pkg: "DIP-8", pins: ["OUT A", "IN− A", "IN+ A", "GND", "IN+ B", "IN− B", "OUT B", "V+"], note: "To komparatorer med åpen kollektor-utgang: trenger pull-up på utgangen." }],
  [/\b(LM339\w*|LM2901\w*)\b/i, { kind: "comparator", pkg: "DIP-14", pins: ["OUT2", "OUT1", "V+", "IN1−", "IN1+", "IN2−", "IN2+", "IN3−", "IN3+", "IN4−", "IN4+", "GND", "OUT4", "OUT3"], note: "Fire komparatorer med åpen kollektor-utgang: trenger pull-up." }],
  // Logikk, tellere og timere
  [/\b((?:SN)?74HC595\w*|(?:SN)?74HCT595\w*)\b/i, { kind: "hc595", pkg: "DIP-16", pins: ["Q1", "Q2", "Q3", "Q4", "Q5", "Q6", "Q7", "GND", "Q7'", "MR", "SHCP", "STCP", "OE", "DS", "Q0", "VCC"], note: "8-bit skiftregister: 3 pinner fra mikrokontrolleren gir 8 utganger, og flere kan kjedes via Q7'." }],
  [/\b((?:SN)?74HC14\w*|(?:SN)?74LS14\w*|CD40106\w*|CD4093\w*)\b/i, { kind: "schmitt", pkg: "DIP-14", pins: ["1A", "1Y", "2A", "2Y", "3A", "3Y", "GND", "4Y", "4A", "5Y", "5A", "6Y", "6A", "VCC"], note: "Schmitt-trigger: gir rene digitale flanker fra trege eller støyete signaler (knapper, sensorer). CD4093 er NAND-utgaven med annen pinnerekkefølge." }],
  [/\b(CD4017\w*|HEF4017\w*|HCF4017\w*)\b/i, { kind: "cd4017", pkg: "DIP-16", pins: ["Q5", "Q1", "Q0", "Q2", "Q6", "Q7", "Q3", "VSS", "Q8", "Q4", "Q9", "CO", "EN", "CLK", "RST", "VDD"], note: "Dekadeteller: ti utganger som går høye én etter én for hver klokkepuls." }],
  [/\b(NE556\w*|LM556\w*)\b/i, { kind: "ne555", pkg: "DIP-14", pins: ["DIS1", "THR1", "CTRL1", "RST1", "OUT1", "TRIG1", "GND", "TRIG2", "OUT2", "RST2", "CTRL2", "THR2", "DIS2", "VCC"], note: "To 555-timere i én brikke. Koblingen under gjelder hver av dem; pinnenumrene for 556 står i listen over." }],
  [/\b((?:SN|HD)?74(?:HC|HCT|LS|AC|ACT)\d{2,3}\w*|CD40\d\d\w*|CD45\d\d\w*|HEF40\d\d\w*)\b/i, { kind: "logic", pkg: "DIP-14", pins: [], note: "Standard logikk-IC. De fleste 14-pinners har VCC på pinne 14 og GND på pinne 7; 16-pinners har VCC på 16 og GND på 8. Sjekk databladet." }],
  // Referanser, regulatorer, strøm og lyd
  [/\b(TL431\w*|LM431\w*|AZ431\w*)\b/i, { kind: "tl431", pkg: "TO-92", pins: ["REF", "ANODE", "KATODE"], note: "Justerbar spenningsreferanse/«programmerbar zener»: holder REF på 2,495 V." }],
  [/\b(XC6206\w*|HT7[35]\d\d\w*|MCP1700\w*|MCP1702\w*|AP2112\w*|ME6211\w*|RT9013\w*|LP2985\w*)\b/i, { kind: "ldo", pkg: "SOT-23", pins: [], note: "LDO-regulator med lavt spenningsfall og lite hvilestrøm. Pinnerekkefølgen varierer: XC6206 (SOT-23) 1 = GND, 2 = OUT, 3 = IN; HT7333/MCP1700 (TO-92) 1 = GND, 2 = IN, 3 = OUT." }],
  [/\b(ICL7660\w*|TC7660\w*|LT1054\w*)\b/i, { kind: "icl7660", pkg: "DIP-8", pins: ["NC", "CAP+", "GND", "CAP−", "VOUT", "LV", "OSC", "V+"], note: "Ladepumpe: lager negativ spenning (f.eks. −5 V fra +5 V) med to kondensatorer." }],
  [/\b(LM386\w*)\b/i, { kind: "lm386", pkg: "DIP-8", pins: ["GAIN", "IN−", "IN+", "GND", "VOUT", "VS", "BYPASS", "GAIN"], note: "Liten lydforsterker for høyttaler (0,3–1 W), forsyning 4–12 V." }],
  [/\b(1N47[2-6]\d\w*|1N52\d\d\w*|BZX55\w*|BZX79\w*|BZX84\w*|ZMM\d+\w*)\b|\bzener\b/i, { kind: "zener", pkg: "DO-41", pins: ["A", "K"], note: "Zenerdiode: leder bakover ved zenerspenningen. Stripen er katoden, og den vender mot pluss." }],
  [/\b(KBP\d{3}\w*|KBPC\d+\w*|KBL\d+\w*|GBU\d+\w*|DB10\d\w*|MB[0-9]{1,2}[FS]\w*|DF\d{2}S\w*|bridge rectifier)\b/i, { kind: "bridge", pins: [], note: "Likeretterbro: gjør vekselstrøm (~) om til likestrøm (+ og −). Pinnene er merket på huset." }],
  [/\b(CH340[CGEKN]?\w*|CP210[2-4]\w*|FT232\w*|PL2303\w*)\b/i, { kind: "usbserial", pins: [], note: "USB til seriell (UART). Kobles i kryss: TX til RX og RX til TX, og felles GND." }],
  [/\b(MAX7219\w*|MAX7221\w*)\b/i, { kind: "max7219", pins: [], note: "Driver for 8×8 LED-matrise eller 8 sju-segment-sifre. Én motstand (RSET) setter strømmen for alle LED-ene." }],
  [/(?<![-\w])(B58\d\dW?|1N58\d\dW|MBR\d{3,5}\w*|SB\d{3,4}\w*|SR\d{3,4})\b/i, { kind: "schottky", pkg: "SOD-123", pins: ["A", "K"], note: "Schottky: lavt spenningsfall (ca. 0,3–0,5 V). Stripen er katoden." }],
  // Moduler og sensorer
  [/\b(BME280|BMP280|BME680|AHT[12]0|SHT3[01]|SHT4\d|INA219|INA226|MPU-?6050|MPU-?9250|ADS1115|ADS1015|PCA9685|TCA9548A?|QMC5883L?|HMC5883L?|HDC1080\w*|TCA9534\w*|VEML\d+|TSL2561|APDS-?9960|MLX90614|CCS811|SGP[34]0|VL53L1X|INA3221|SI7021|BMP180|MCP4725|PAJ7620|SSD1306|SH1106|BH1750|VL53L0X|MAX30102|PCF8574|DS3231|DS1307|DS1337\w*|AT24C\d+\w*|24C\d\d\w*|MCP23017\w*|MCP23008\w*|HTU21D|SCD4\d|ENS160|LM75A?|CJMCU-?\d+)\b/i, { kind: "i2c", pins: ["VCC", "GND", "SCL", "SDA"], note: "I2C: SDA og SCL trenger pull-up (de fleste moduler har det innebygd)." }],
  [/\b(HC-?SR04P?|RCWL-?1601|US-?100|JSN-?SR04T)\b/i, { kind: "hcsr04", pins: ["VCC", "TRIG", "ECHO", "GND"], note: "ECHO gir 5 V. Bruk spenningsdeler (1 kΩ / 2 kΩ) inn til en 3,3 V-pinne." }],
  [/\b(DS18B20)\b/i, { kind: "ds18b20", pkg: "TO-92", pins: ["GND", "DQ", "VDD"], note: "1-Wire: 4,7 kΩ pull-up fra DQ til 3,3 V. Flere sensorer kan dele samme ledning." }],
  [/\b(DHT11|DHT22|AM2302)\b/i, { kind: "dht", pins: ["VCC", "DATA", "NC", "GND"], note: "10 kΩ pull-up på DATA (moduler har den ofte). Les maks hvert 2. sekund." }],
  [/\b(LM2596S?|MP1584(EN)?|XL4015|XL6009|MT3608|MINI-?360)\b/i, { kind: "buck", pins: ["IN+", "IN−", "OUT+", "OUT−"], note: "Juster utgangsspenningen med potmeteret FØR du kobler til lasten." }],
  [/\b(TP4056)\b/i, { kind: "tp4056", pins: ["IN+", "IN−", "B+", "B−", "OUT+", "OUT−"], note: "Lader én Li-ion-celle (4,2 V). Versjonen med OUT+/OUT− har beskyttelse (DW01)." }],
  [/\b(WS2812B?|SK6812|WS2811|NeoPixel)\b/i, { kind: "ws2812", pins: ["5V", "DIN", "GND"], note: "330 Ω i serie på data og 1000 µF over strømmen. 3,3 V-data fungerer ofte, ellers bruk nivåomformer." }],
  [/\b(NRF24L01\w*)/i, { kind: "nrf24", pins: ["GND", "VCC", "CE", "CSN", "SCK", "MOSI", "MISO", "IRQ"], note: "Bare 3,3 V. Sett 10 µF rett over VCC og GND på modulen, ellers mister den pakker (særlig PA/LNA-versjonen)." }],
  [/\b(SX127[68]\w*|RFM9[5-8]\w*|RA-0[12]\w*|E19-\w+|RFM69\w*|LoRa module)/i, { kind: "lora", pins: [], note: "3,3 V og SPI. Koble aldri til strøm uten antenne, det kan ødelegge senderen." }],
  [/\b(E32-\w+|E220-\w+|LoRa UART)/i, { kind: "loraUart", pins: ["M0", "M1", "RXD", "TXD", "AUX", "VCC", "GND"], note: "LoRa med UART: M0 og M1 til GND gir vanlig sendemodus." }],
  [/\b(HX711)\b/i, { kind: "hx711", pins: ["E+", "E−", "A−", "A+", "GND", "DT", "SCK", "VCC"], note: "Lastcellefargene varierer; vanligst er rød E+, svart E−, hvit A−, grønn A+. Bytt A+ og A− hvis vekten viser negativt." }],
  [/\b(MAX98357A?)\b/i, { kind: "i2samp", pins: ["LRC", "BCLK", "DIN", "GAIN", "SD", "GND", "VIN"], note: "I2S-forsterker med DAC: digital lyd inn, høyttaler ut. 3 W på 4 Ω fra 5 V." }],
  [/\b(SG90|MG90S|MG996R?|MG995|servo motor|micro servo)\b/i, { kind: "servo", pins: ["GND (brun)", "V+ (rød)", "PWM (oransje)"], note: "Servoen trekker strømtopper: gi den egen 5 V og koble GND sammen med ESP32." }],
  [/\b(A4988|DRV8825|TMC2208|TMC2209|TMC2130|StepStick)\b/i, { kind: "stepper", pins: [], note: "Still strømgrensen med potmeteret før motoren kobles til, og koble aldri motoren til eller fra mens driveren har strøm." }],
  [/\b(L298N|L293D?|MX1508|TB6612\w*|DRV8833\w*|SN754410\w*|motor driver)\b/i, { kind: "motordriver", pins: [], note: "Egen strøm til motorene, felles GND med mikrokontrolleren." }],
  [/\b(ST7789\w*|ST7735\w*|ILI9341\w*|ILI9488\w*|GC9A01\w*|TFT display)/i, { kind: "tft", pins: ["GND", "VCC", "SCL", "SDA", "RES", "DC", "CS", "BLK"], note: "SPI-skjerm. SCL/SDA på disse er egentlig SPI-klokke og -data (ikke I2C). Bruk TFT_eSPI eller Adafruit-biblioteket." }],
  [/\b(e-?paper|e-?ink|GDEM\w+|GDEY\w+|GDEW\w+|EPD)\b/i, { kind: "epaper", pins: ["BUSY", "RST", "DC", "CS", "CLK", "DIN", "GND", "VCC"], note: "E-papir holder bildet uten strøm. Oppdater sjelden (helst ikke oftere enn hvert 3. minutt) og la den sove mellom oppdateringene." }],
  [/\b(SIM800L?|SIM900A?|A7670\w*|SIM7600\w*)\b/i, { kind: "gsm", pins: ["NET", "VCC", "RST", "RXD", "TXD", "GND"], note: "Trenger 3,7–4,2 V og tåler strømtopper på 2 A: bruk en Li-ion-celle eller en egen regulator, ikke 3,3 V fra ESP32." }],
  [/\b(MAX485\w*|RS-?485\w*|MAX3485\w*|SP3485\w*)\b/i, { kind: "rs485", pins: ["RO", "RE", "DE", "DI", "VCC", "B", "A", "GND"], note: "RS-485 tåler lange kabler (hundrevis av meter). A til A og B til B, og 120 Ω i hver ende av kabelen." }],
  [/\b(HC-?SR50[15]|AM312|RCWL-?0516|LD1020|LD2410\w*|PIR (motion )?sensor|radar sensor)\b/i, { kind: "pir", pins: ["VCC", "OUT", "GND"], note: "Utgangen går høy når noe beveger seg (3,3 V, trygt for ESP32). HC-SR501 trenger ca. ett minutt på å stabilisere seg etter oppstart." }],
  [/\b(SS49E|AH49E|49E|US1881|A3144\w*|OH137|KY-003|hall (effect )?sensor)\b/i, { kind: "hall", pins: ["VCC", "GND", "OUT"], note: "SS49E/49E gir analog spenning (halvparten av VCC uten magnet). US1881 og A3144 er digitale brytere med åpen kollektor: trenger 10 kΩ pull-up." }],
  [/\b(ACS712\w*|TEMT6000|ALS-?PT19|MAX9814|MAX4466|GUVA-S12SD|soil moisture|MQ-?\d{1,3})\b/i, { kind: "analog", pins: ["VCC", "GND", "OUT"], note: "Analog utgang. På ESP32: bruk GPIO32–39 (ADC1), fordi ADC2 ikke virker når WiFi er på." }],
  [/\b(relay module|\d-?channel relay|SRD-05VDC\w*)/i, { kind: "relay", pins: ["DC+", "DC−", "IN", "COM", "NO", "NC"], note: "Mange relémoduler er aktive lave: releet trekker når IN er LOW." }],
  [/\b(TM1637|TM1638)\b/i, { kind: "tm16", pins: [], note: "Sju-segment-modul med egen driver: to eller tre signalledninger, ikke SPI eller I2C." }],
  [/\b(MCP2515)\b/i, { kind: "can", pins: ["INT", "SCK", "SI", "SO", "CS", "GND", "VCC"], note: "CAN-buss via SPI. Mange moduler har 8 MHz krystall; det må settes i biblioteket. 120 Ω-terminering bare i endene av bussen." }],
  [/\b(LCD ?1602|LCD ?2004|1602A|2004A)\b/i, { kind: "lcdi2c", pins: ["GND", "VCC", "SDA", "SCL"], note: "Gjelder skjermer med I2C-ryggsekk (PCF8574, adresse 0x27 eller 0x3F). Kontrasten justeres med potmeteret bak." }],
  [/\b(NTC|thermistor|MF52\w*)\b/i, { kind: "ntc", pins: [], note: "NTC: motstanden synker når temperaturen stiger. 10 kΩ ved 25 °C, B-verdi ca. 3950." }],
  [/\b(RC522|MFRC-?522)\b/i, { kind: "spi-rc522", pins: [], note: "3,3 V, ikke 5 V. Se koblingsskjemaet i leserbyggeren." }],
];

// Delenumre i fritekst som ikke matcher en mal, men som likevel er verdt et databladsøk.
const GENERIC_MPN = /\b([A-Z]{1,5}[0-9]{2,6}[A-Z0-9-]{0,8})\b/g;
const NOT_MPN = /^(USB|PCS|PC|DIY|LED|DC|AC|AWG|M[0-9]+|[0-9]+(MM|CM|M|V|A|W|MAH|PCS|K|UF|NF|PF)|TYPE|CH|NO|NEW|IP[0-9]+|X[0-9]+|A[0-9]|ESP|V[0-9]+)$/;

const PHRASE_NAME = { relay: "Relémodul", motordriver: "Motordriver", pir: "Bevegelsessensor", hall: "Hallsensor", tft: "TFT-skjerm", lora: "LoRa-modul", loraUart: "LoRa UART", servo: "Servo", analog: "Analog sensor", bridge: "Likeretterbro", zener: "Zenerdiode", epaper: "E-papir", ntc: "NTC" };
export function findPart(title, mpn = "") {
  const text = `${mpn} ${title}`;
  for (const [re, info] of PARTS) {
    const m = text.match(re);
    // Treff på en beskrivelse («relay module», «servo motor») vises med et norsk navn i stedet.
    if (m) return { mpn: /\s/.test(m[0].trim()) ? PHRASE_NAME[info.kind] || m[0].trim() : m[0].toUpperCase(), ...info };
  }
  return null;
}

function candidateMpns(title, mpn) {
  const out = [];
  if (mpn) out.push(mpn);
  for (const m of String(title || "").toUpperCase().matchAll(GENERIC_MPN)) {
    const t = m[1];
    if (/[A-Z]/.test(t) && /[0-9]/.test(t) && !NOT_MPN.test(t) && !out.includes(t)) out.push(t);
    if (out.length >= 3) break;
  }
  return out;
}

export function datasheetLinks(q) {
  const e = encodeURIComponent(q);
  return [
    { label: "Alldatasheet", url: `https://www.alldatasheet.com/view.jsp?Searchword=${e}` },
    { label: "Octopart", url: `https://octopart.com/search?q=${e}` },
    { label: "Mouser", url: `https://www.mouser.com/c/?q=${e}` },
  ];
}

// ---------- SVG-byggeklosser ----------

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const A = "var(--accent)";

function svg(w, h, body, label) {
  return `<svg class="schematic" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}">
    <g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" font-family="system-ui, sans-serif">${body}</g></svg>`;
}
const wire = (...pts) => `<polyline points="${pts.map((p) => p.join(",")).join(" ")}"/>`;
const dot = (x, y) => `<circle cx="${x}" cy="${y}" r="3.2" fill="currentColor" stroke="none"/>`;
const text = (x, y, s, { anchor = "start", size = 12, weight = 400, muted = false, color } = {}) =>
  `<text x="${x}" y="${y}" fill="${color || "currentColor"}" stroke="none" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}"${muted ? ' fill-opacity=".72"' : ""}>${esc(s)}</text>`;

// Motstand (IEC-boks) mellom to punkter, vannrett eller loddrett. Verdien står ved siden av.
function res(x1, y1, x2, y2, value, side = 1) {
  const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
  if (y1 === y2) {
    return wire([x1, y1], [cx - 18, cy]) + wire([cx + 18, cy], [x2, y2]) + `<rect x="${cx - 18}" y="${cy - 7}" width="36" height="14" rx="1"/>` + text(cx, cy - 12 * side - (side > 0 ? 0 : -4), value, { anchor: "middle", size: 11, muted: true });
  }
  return wire([x1, y1], [cx, cy - 18]) + wire([cx, cy + 18], [x2, y2]) + `<rect x="${cx - 7}" y="${cy - 18}" width="14" height="36" rx="1"/>` + text(cx + 12 * side, cy + 4, value, { anchor: side > 0 ? "start" : "end", size: 11, muted: true });
}

// Kondensator, loddrett. polar: + på oversiden.
function cap(x, y1, y2, value, polar = false) {
  const cy = (y1 + y2) / 2;
  return wire([x, y1], [x, cy - 4]) + wire([x, cy + 4], [x, y2]) +
    `<line x1="${x - 11}" y1="${cy - 4}" x2="${x + 11}" y2="${cy - 4}"/>` +
    (polar ? `<path d="M${x - 11} ${cy + 6} Q${x} ${cy + 1} ${x + 11} ${cy + 6}"/>` + text(x - 16, cy - 7, "+", { size: 11 }) : `<line x1="${x - 11}" y1="${cy + 4}" x2="${x + 11}" y2="${cy + 4}"/>`) +
    text(x + 16, cy + 4, value, { size: 11, muted: true });
}

// Diode/LED fra anode (a) til katode (k), vannrett eller loddrett.
function diode(ax, ay, kx, ky, { led = false, label = "", color = "currentColor" } = {}) {
  const cx = (ax + kx) / 2, cy = (ay + ky) / 2;
  let s = "";
  if (ay === ky) {
    const d = kx > ax ? 1 : -1;
    s += wire([ax, ay], [cx - 8 * d, cy]) + wire([cx + 8 * d, cy], [kx, ky]);
    s += `<polygon points="${cx - 8 * d},${cy - 8} ${cx - 8 * d},${cy + 8} ${cx + 8 * d},${cy}" stroke="${color}"/>`;
    s += `<line x1="${cx + 8 * d}" y1="${cy - 8}" x2="${cx + 8 * d}" y2="${cy + 8}" stroke="${color}"/>`;
    if (label) s += text(cx, cy - 14, label, { anchor: "middle", size: 11, muted: true });
  } else {
    const d = ky > ay ? 1 : -1;
    s += wire([ax, ay], [cx, cy - 8 * d]) + wire([cx, cy + 8 * d], [kx, ky]);
    s += `<polygon points="${cx - 8},${cy - 8 * d} ${cx + 8},${cy - 8 * d} ${cx},${cy + 8 * d}" stroke="${color}"/>`;
    s += `<line x1="${cx - 8}" y1="${cy + 8 * d}" x2="${cx + 8}" y2="${cy + 8 * d}" stroke="${color}"/>`;
    if (label) s += text(cx + 14, cy + 4, label, { size: 11, muted: true });
  }
  if (led) {
    const ox = ay === ky ? cx : cx + 10, oy = ay === ky ? cy - 10 : cy;
    s += `<path d="M${ox + 2} ${oy - 4} l7 -7 m-5 0 h5 v5 M${ox + 9} ${oy + 1} l7 -7 m-5 0 h5 v5" stroke-width="1.5"/>`;
  }
  return s;
}

const gnd = (x, y) => wire([x, y], [x, y + 6]) + `<line x1="${x - 11}" y1="${y + 6}" x2="${x + 11}" y2="${y + 6}"/><line x1="${x - 7}" y1="${y + 11}" x2="${x + 7}" y2="${y + 11}"/><line x1="${x - 3}" y1="${y + 16}" x2="${x + 3}" y2="${y + 16}"/>`;
const vcc = (x, y, label) => `<line x1="${x - 11}" y1="${y}" x2="${x + 11}" y2="${y}"/>` + text(x, y - 7, label, { anchor: "middle", size: 11, weight: 600 });

// Bipolar transistor. Pinner: b, c, e. Fremhevet med aksentfarge.
function bjt(x, y, pnp = false) {
  const top = pnp ? "E" : "C", bot = pnp ? "C" : "E";
  let s = `<circle cx="${x}" cy="${y}" r="24" stroke="${A}"/>`;
  s += `<line x1="${x - 8}" y1="${y - 14}" x2="${x - 8}" y2="${y + 14}" stroke-width="3" stroke="${A}"/>`;
  s += wire([x - 32, y], [x - 8, y]);
  s += wire([x - 8, y - 6], [x + 8, y - 18], [x + 8, y - 40]);
  s += wire([x - 8, y + 6], [x + 8, y + 18], [x + 8, y + 40]);
  s += pnp
    ? `<polygon points="${x - 4},${y - 9} ${x - 0.8},${y - 16.4} ${x + 4},${y - 10}" fill="currentColor"/>`
    : `<polygon points="${x + 6},${y + 16.5} ${x - 2},${y + 15.5} ${x + 2.8},${y + 9.1}" fill="currentColor"/>`;
  s += text(x - 22, y - 6, "B", { size: 10, muted: true }) + text(x + 14, y - 26, top, { size: 10, muted: true }) + text(x + 14, y + 34, bot, { size: 10, muted: true });
  return s;
}

// MOSFET (anrikning). Pinner: g, d (oppe for N), s (nede for N).
function mos(x, y, p = false) {
  const top = p ? "S" : "D", bot = p ? "D" : "S";
  let s = `<circle cx="${x}" cy="${y}" r="24" stroke="${A}"/>`;
  s += wire([x - 32, y], [x - 14, y]) + `<line x1="${x - 14}" y1="${y - 14}" x2="${x - 14}" y2="${y + 14}"/>`;
  s += `<line x1="${x - 8}" y1="${y - 16}" x2="${x - 8}" y2="${y + 16}" stroke-width="3" stroke="${A}"/>`;
  s += wire([x - 8, y - 12], [x + 8, y - 12], [x + 8, y - 40]);
  s += wire([x - 8, y + 12], [x + 8, y + 12], [x + 8, y + 40]);
  s += wire([x - 8, y], [x + 8, y], [x + 8, y + 12]);
  s += p
    ? `<polygon points="${x + 2},${y} ${x - 4},${y - 4} ${x - 4},${y + 4}" fill="currentColor"/>`
    : `<polygon points="${x - 7},${y} ${x - 1},${y - 4} ${x - 1},${y + 4}" fill="currentColor"/>`;
  s += text(x - 22, y - 6, "G", { size: 10, muted: true }) + text(x + 14, y - 26, top, { size: 10, muted: true }) + text(x + 14, y + 34, bot, { size: 10, muted: true });
  return s;
}

// Last (f.eks. relé, motor eller LED-stripe) som en boks, loddrett.
const load = (x, y1, y2, label = "Last") => {
  const cy = (y1 + y2) / 2;
  return wire([x, y1], [x, cy - 20]) + wire([x, cy + 20], [x, y2]) + `<rect x="${x - 26}" y="${cy - 20}" width="52" height="40" rx="4" stroke-dasharray="4 3"/>` + text(x, cy + 4, label, { anchor: "middle", size: 11 });
};

// IC/modul som boks med pinner på sidene: left/right = [[navn, y], ...].
function chip(x, y, w, h, title, left = [], right = [], { accent = true, pinNums = null } = {}) {
  let s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" stroke="${accent ? A : "currentColor"}"/>`;
  s += text(x + w / 2, y + 18, title, { anchor: "middle", size: 12, weight: 700 });
  for (const [n, py, num] of left) s += wire([x - 14, py], [x, py]) + text(x + 6, py + 4, n, { size: 10 }) + (num ? text(x - 4, py - 4, num, { size: 9, muted: true, anchor: "end" }) : "");
  for (const [n, py, num] of right) s += wire([x + w, py], [x + w + 14, py]) + text(x + w - 6, py + 4, n, { size: 10, anchor: "end" }) + (num ? text(x + w + 4, py - 4, num, { size: 9, muted: true }) : "");
  return s;
}

// ---------- Maler ----------

const T = {};

T.npn = (p) => ({
  title: `${p.mpn} som bryter (lavside)`,
  caption: "GPIO høy slår på transistoren, så strøm går fra pluss gjennom lasten til jord. 1 kΩ begrenser basestrømmen, 10 kΩ holder transistoren av mens mikrokontrolleren starter. Ved induktiv last (relé, motor) må dioden over lasten være med.",
  svg: svg(520, 300, [
    vcc(300, 28, "+5–12 V"), wire([300, 28], [300, 60]),
    load(300, 60, 140, "Last"),
    dot(300, 60), dot(300, 140), wire([300, 60], [370, 60]), diode(370, 140, 370, 60, { label: "1N4007 (flyback)" }), wire([370, 140], [300, 140]),
    wire([300, 140], [300, 166]),
    bjt(292, 206),
    wire([300, 246], [300, 268]), gnd(300, 268),
    text(40, 210, "GPIO", { weight: 600 }), wire([80, 206], [100, 206]),
    res(100, 206, 200, 206, "1 kΩ"), wire([200, 206], [260, 206]), dot(230, 206),
    res(230, 206, 230, 268, "10 kΩ", -1), gnd(230, 268),
    text(330, 212, p.mpn, { size: 12, weight: 700, color: A }),
  ].join(""), `${p.mpn} som lavsidebryter styrt fra en GPIO`),
});

T.pnp = (p) => ({
  title: `${p.mpn} som bryter (høyside)`,
  caption: "GPIO lav slår på transistoren, så lasten får pluss. Virker direkte når lasten går på samme spenning som mikrokontrolleren (3,3–5 V). For høyere spenning trengs en NPN foran som drar basen ned.",
  svg: svg(520, 300, [
    vcc(300, 28, "+3,3–5 V"), wire([300, 28], [300, 74]), dot(300, 50), wire([300, 50], [230, 50]),
    bjt(292, 114, true),
    wire([300, 154], [300, 180]), load(300, 180, 252, "Last"), wire([300, 252], [300, 262]), gnd(300, 262),
    text(40, 118, "GPIO", { weight: 600 }), wire([80, 114], [100, 114]), res(100, 114, 200, 114, "1 kΩ"), wire([200, 114], [260, 114]), dot(230, 114),
    res(230, 114, 230, 50, "10 kΩ", -1),
    text(330, 120, p.mpn, { size: 12, weight: 700, color: A }),
  ].join(""), `${p.mpn} som høysidebryter`),
});

T.nmos = (p) => ({
  title: `${p.mpn} som bryter (lavside)`,
  caption: `${p.logic === false ? "NB: ikke logikknivå, se merknaden over. " : ""}GPIO høy slår på MOSFET-en. 220 Ω demper ringing på gaten, 100 kΩ holder den av ved oppstart. Dioden over lasten tar opp spenningstoppen fra relé, motor eller magnetventil.`,
  svg: svg(520, 300, [
    vcc(300, 28, "+5–24 V"), wire([300, 28], [300, 60]),
    load(300, 60, 140, "Last"),
    dot(300, 60), dot(300, 140), wire([300, 60], [370, 60]), diode(370, 140, 370, 60, { label: "1N5819" }), wire([370, 140], [300, 140]),
    wire([300, 140], [300, 166]),
    mos(292, 206),
    wire([300, 246], [300, 268]), gnd(300, 268),
    text(40, 210, "GPIO", { weight: 600 }), wire([80, 206], [100, 206]),
    res(100, 206, 200, 206, "220 Ω"), wire([200, 206], [260, 206]), dot(230, 206),
    res(230, 206, 230, 268, "100 kΩ", -1), gnd(230, 268),
    text(330, 212, p.mpn, { size: 12, weight: 700, color: A }),
  ].join(""), `${p.mpn} som lavsidebryter`),
});

T.pmos = (p) => ({
  title: `${p.mpn} som bryter (høyside)`,
  caption: "Gaten dras til pluss av 10 kΩ, så MOSFET-en er av. Når GPIO går høy, trekker NPN-transistoren gaten ned og lasten får strøm. Slik kan 3,3 V styre en høyere spenning på plussiden.",
  svg: svg(560, 320, [
    vcc(320, 26, "+5–12 V"), wire([320, 26], [320, 74]), dot(320, 46), wire([320, 46], [240, 46], [240, 70]),
    mos(312, 114, true),
    wire([320, 154], [320, 190]), load(320, 190, 262, "Last"), wire([320, 262], [320, 280]), gnd(320, 280),
    res(240, 70, 240, 114, "10 kΩ", -1), dot(240, 114), wire([240, 114], [280, 114]),
    wire([240, 114], [240, 170]), bjt(232, 210), wire([240, 250], [240, 280]), gnd(240, 280),
    text(40, 214, "GPIO", { weight: 600 }), wire([80, 210], [100, 210]), res(100, 210, 180, 210, "1 kΩ"), wire([180, 210], [200, 210]),
    text(270, 216, "2N2222", { size: 10, muted: true }),
    text(350, 120, p.mpn, { size: 12, weight: 700, color: A }),
  ].join(""), `${p.mpn} som høysidebryter med NPN-driver`),
});

T.reg78 = (p) => {
  const out = (p.mpn.match(/78(\d\d)/) || [])[1];
  const v = out ? `${Number(out)} V` : "Vut";
  return {
    title: `${p.mpn}: fast spenning ${v}`,
    caption: `Inngangen må være minst ca. 2 V høyere enn ${v}. Kondensatorene står nær pinnene og hindrer at regulatoren svinger.`,
    svg: svg(520, 250, [
      text(20, 84, "Inn", { weight: 600 }), wire([50, 80], [180, 80]), dot(110, 80), cap(110, 80, 170, "330 nF"), gnd(110, 170),
      chip(194, 38, 132, 88, p.mpn, [["IN", 80, "1"]], [["OUT", 80, "3"]]),
      wire([260, 126], [260, 170]), text(266, 146, "GND (2)", { size: 10, muted: true }), gnd(260, 170),
      wire([340, 80], [480, 80]), dot(410, 80), cap(410, 80, 170, "100 nF"), gnd(410, 170), text(450, 72, v, { weight: 600 }),
    ].join(""), `${p.mpn} med kondensatorer på inn- og utgang`),
  };
};

T.reg1117 = (p) => {
  const v = (p.mpn.match(/(\d\.\d)/) || [])[1];
  return {
    title: `${p.mpn}: ${v ? `${v.replace(".", ",")} V` : "lavt spenningsfall"}`,
    caption: "Begge kondensatorene trengs, og utgangskondensatoren må være minst 10 µF, ellers kan regulatoren svinge. Typisk 5 V inn og 3,3 V ut.",
    svg: svg(520, 250, [
      text(20, 84, "5 V", { weight: 600 }), wire([50, 80], [180, 80]), dot(110, 80), cap(110, 80, 170, "10 µF", true), gnd(110, 170),
      chip(194, 38, 132, 88, p.mpn, [["IN", 80, "3"]], [["OUT", 80, "2"]]),
      wire([260, 126], [260, 170]), text(266, 146, "GND (1)", { size: 10, muted: true }), gnd(260, 170),
      wire([340, 80], [480, 80]), dot(410, 80), cap(410, 80, 170, "22 µF", true), gnd(410, 170), text(444, 72, v ? `${v.replace(".", ",")} V` : "Vut", { weight: 600 }),
    ].join(""), `${p.mpn} med kondensatorer`),
  };
};

T.lm317 = (p) => ({
  title: `${p.mpn}: justerbar spenning`,
  caption: "Vut = 1,25 V × (1 + R2 / R1). Med R1 = 240 Ω og R2 = 390 Ω blir det ca. 3,3 V; med R2 = 720 Ω ca. 5 V.",
  svg: svg(540, 290, [
    text(20, 84, "Inn", { weight: 600 }), wire([50, 80], [180, 80]), dot(110, 80), cap(110, 80, 170, "100 nF"), gnd(110, 170),
    chip(194, 38, 132, 88, p.mpn, [["IN", 80, "3"]], [["OUT", 80, "2"]]),
    wire([340, 80], [500, 80]), dot(400, 80), dot(460, 80), cap(460, 80, 170, "1 µF", true), gnd(460, 170), text(470, 72, "Vut", { weight: 600 }),
    res(400, 80, 400, 160, "R1 240 Ω"), dot(400, 160), wire([260, 126], [260, 160], [400, 160]), text(266, 146, "ADJ (1)", { size: 10, muted: true }),
    res(400, 160, 400, 250, "R2"), gnd(400, 250),
  ].join(""), `${p.mpn} med motstandsdeler`),
});

T.ne555 = (p) => ({
  title: `${p.mpn}: blinker (astabil)`,
  caption: "Frekvens ≈ 1,44 / ((R1 + 2·R2) · C). Med 1 kΩ, 68 kΩ og 10 µF blinker LED-en ca. én gang i sekundet. Pinnenumrene står ved hver pinne.",
  svg: svg(560, 320, [
    vcc(150, 24, "+5–12 V"), wire([150, 24], [150, 40], [420, 40]), dot(150, 40),
    chip(200, 70, 150, 170, p.mpn,
      [["DIS", 110, "7"], ["THR", 160, "6"], ["TRIG", 200, "2"]],
      [["VCC", 100, "8"], ["RESET", 130, "4"], ["OUT", 170, "3"], ["CTRL", 200, "5"], ["GND", 228, "1"]]),
    wire([150, 40], [150, 50]), res(150, 50, 150, 110, "R1 1 kΩ", -1), dot(150, 110), wire([150, 110], [186, 110]),
    res(150, 110, 150, 160, "R2 68 kΩ", -1), dot(150, 160), wire([150, 160], [186, 160]), wire([150, 160], [150, 200], [186, 200]), dot(150, 200),
    wire([150, 200], [150, 220]), cap(150, 220, 290, "10 µF", true), gnd(150, 290),
    wire([364, 100], [400, 100], [400, 40]), dot(400, 40), wire([364, 130], [400, 130], [400, 100]), dot(400, 100),
    wire([364, 170], [420, 170]), res(420, 170, 490, 170, "330 Ω"), diode(490, 170, 490, 250, { led: true, color: A }), gnd(490, 250),
    wire([364, 200], [400, 200]), cap(400, 200, 268, "10 nF"), gnd(400, 268),
    wire([364, 228], [376, 228], [376, 290]), gnd(376, 290),
  ].join(""), `${p.mpn} koblet som astabil oscillator med LED`),
});

T.opto = (p) => ({
  title: `${p.mpn}: skille mellom to kretser`,
  caption: "Venstre side (mikrokontrolleren) og høyre side (den andre kretsen) har hver sin jord og ingen elektrisk forbindelse. GPIO høy tenner LED-en inni, og transistoren drar utgangen lav.",
  svg: svg(560, 280, [
    text(20, 84, "GPIO", { weight: 600 }), wire([60, 80], [80, 80]), res(80, 80, 170, 80, "330 Ω"), wire([170, 80], [200, 80]),
    chip(200, 50, 150, 150, p.mpn, [["A", 80, "1"], ["K", 170, "2"]], [["C", 80, "4"], ["E", 170, "3"]]),
    wire([186, 170], [140, 170], [140, 200]), gnd(140, 200), text(100, 240, "Jord 1", { size: 10, muted: true }),
    diode(240, 100, 240, 150, { led: true, color: A }),
    vcc(460, 30, "+V (krets 2)"), wire([460, 30], [460, 40]), res(460, 40, 460, 80, "10 kΩ"), dot(460, 80), wire([364, 80], [520, 80]), text(480, 72, "Ut", { weight: 600 }),
    wire([364, 170], [400, 170], [400, 200]), gnd(400, 200), text(380, 240, "Jord 2", { size: 10, muted: true }),
    `<line x1="290" y1="60" x2="290" y2="190" stroke-dasharray="3 4" stroke-width="1.5"/>`,
  ].join(""), `${p.mpn} med inngang fra GPIO og utgang med pull-up`),
});

T.diode = (p) => ({
  title: `${p.mpn} som flyback-diode`,
  caption: "Over en spole (relé, motor, magnetventil) leder dioden bort spenningstoppen når strømmen brytes. Katoden (stripen) vender mot pluss. Brukes også som polaritetsvern i serie med inngangen.",
  svg: svg(460, 240, [
    vcc(200, 26, "+V"), wire([200, 26], [200, 60]), dot(200, 60), wire([200, 60], [280, 60]),
    load(200, 60, 160, "Spole"), dot(200, 160), wire([200, 160], [280, 160]),
    diode(280, 160, 280, 60, { label: p.mpn, color: A }),
    wire([200, 160], [200, 190]), text(214, 196, "til transistor / MOSFET", { size: 11, muted: true }),
  ].join(""), `${p.mpn} over en spole`),
});
T.schottky = T.diode;
T.signaldiode = (p) => ({ ...T.diode(p), title: `${p.mpn} (signaldiode)` });

T.led = (p) => ({
  title: "LED med formotstand",
  caption: "R = (forsyning − LED-spenning) / strøm. Fra 3,3 V med rød LED (2,0 V) og 10 mA: (3,3 − 2,0) / 0,01 = 130 Ω, velg 150 Ω. Blå og hvit LED har ca. 3 V og trenger 5 V forsyning.",
  svg: svg(460, 200, [
    text(20, 84, "GPIO", { weight: 600 }), wire([60, 80], [90, 80]), res(90, 80, 200, 80, "150 Ω"), wire([200, 80], [260, 80]),
    diode(260, 80, 340, 80, { led: true, color: A }), wire([340, 80], [380, 80], [380, 120]), gnd(380, 120),
    text(300, 120, "langt bein = +", { size: 10, muted: true, anchor: "middle" }),
  ].join(""), "LED med formotstand fra en GPIO"),
});

// ---------- Flere symboler ----------

// Tyristor (SCR), loddrett: anode øverst, katode nederst, gate ut til venstre fra katodesiden.
function scrSym(x, ya, yk) {
  const cy = (ya + yk) / 2;
  let s = wire([x, ya], [x, cy - 9]) + wire([x, cy + 9], [x, yk]);
  s += `<polygon points="${x - 10},${cy - 9} ${x + 10},${cy - 9} ${x},${cy + 9}" stroke="${A}"/><line x1="${x - 10}" y1="${cy + 9}" x2="${x + 10}" y2="${cy + 9}" stroke="${A}" stroke-width="2.5"/>`;
  s += wire([x - 3, cy + 9], [x - 16, cy + 20], [x - 34, cy + 20]);
  return { s, gate: [x - 34, cy + 20] };
}

// Triac, loddrett: MT2 øverst, MT1 nederst, gate ut til venstre nederst.
function triacSym(x, y2, y1) {
  const cy = (y2 + y1) / 2;
  let s = wire([x, y2], [x, cy - 10]) + wire([x, cy + 10], [x, y1]);
  s += `<line x1="${x - 14}" y1="${cy - 10}" x2="${x + 14}" y2="${cy - 10}" stroke="${A}" stroke-width="2.5"/><line x1="${x - 14}" y1="${cy + 10}" x2="${x + 14}" y2="${cy + 10}" stroke="${A}" stroke-width="2.5"/>`;
  s += `<polygon points="${x - 14},${cy - 10} ${x},${cy - 10} ${x - 7},${cy + 10}" stroke="${A}"/><polygon points="${x},${cy + 10} ${x + 14},${cy + 10} ${x + 7},${cy - 10}" stroke="${A}"/>`;
  s += wire([x - 10, cy + 10], [x - 20, cy + 22], [x - 36, cy + 22]);
  return { s, gate: [x - 36, cy + 22] };
}

// Operasjonsforsterker/komparator: trekant med − øverst og + nederst. Gir pinnepunktene.
function opampSym(x, y, label) {
  let s = `<polygon points="${x},${y - 34} ${x},${y + 34} ${x + 64},${y}" stroke="${A}"/>`;
  s += text(x + 6, y - 14, "−", { size: 14, weight: 700 }) + text(x + 6, y + 22, "+", { size: 14, weight: 700 });
  if (label) s += text(x + 22, y + 4, label, { size: 10, weight: 700, color: A });
  return { s, minus: [x, y - 17], plus: [x, y + 17], out: [x + 64, y], top: [x + 26, y - 21], bottom: [x + 26, y + 21] };
}

T.scr = (p) => {
  const t = scrSym(320, 140, 214);
  return {
    title: `${p.mpn}: tyristor som låsende bryter`,
    caption: "Et kort trykk på «Tenn» (eller en puls fra en GPIO via 1 kΩ) slår på tyristoren, og den forblir på selv om knappen slippes. Den slås av først når strømmen brytes med «Av». 1 kΩ fra gate til katode hindrer at støy tenner den. Med vekselstrøm slukker den av seg selv ved hver nullgjennomgang.",
    svg: svg(560, 290, [
      vcc(320, 26, "+5–12 V"), wire([320, 26], [320, 40]),
      `<circle cx="320" cy="52" r="3"/>`, wire([320, 55], [334, 62]), `<circle cx="320" cy="72" r="3"/>`, text(344, 66, "Av (NC)", { size: 10, muted: true }),
      wire([320, 75], [320, 86]), load(320, 86, 140, "Last"),
      t.s, wire([320, 214], [320, 240]), gnd(320, 240),
      wire(t.gate, [240, t.gate[1]]), res(160, t.gate[1], 240, t.gate[1], "1 kΩ"), dot(260, t.gate[1]),
      wire([260, t.gate[1]], [260, 222]), res(260, 222, 260, 262, "1 kΩ", -1), gnd(260, 262),
      wire([160, t.gate[1]], [120, t.gate[1]]), `<circle cx="112" cy="${t.gate[1]}" r="3"/>`, wire([108, t.gate[1] - 4], [98, t.gate[1] - 14]), `<circle cx="92" cy="${t.gate[1]}" r="3"/>`,
      text(80, t.gate[1] - 20, "Tenn", { size: 10, muted: true, anchor: "middle" }), wire([89, t.gate[1]], [60, t.gate[1]], [60, 40], [320, 40]), dot(320, 40),
      text(340, 182, p.mpn, { size: 12, weight: 700, color: A }), text(340, 150, "A", { size: 10, muted: true }), text(340, 210, "K", { size: 10, muted: true }), text(282, t.gate[1] - 6, "G", { size: 10, muted: true }),
    ].join(""), `${p.mpn} som låsende bryter med tenn- og av-knapp`),
  };
};

T.triac = (p) => {
  const mains = !/^MOC/i.test(p.mpn);
  const t = triacSym(420, 120, 200);
  return {
    title: mains ? `${p.mpn}: styre 230 V med optotriac` : `${p.mpn}: styre en triac fra GPIO`,
    caption: "FARE: 230 V. Lavspenningssiden (venstre for streken) er skilt fra nettspenningen inne i optotriacen; ingen ledning skal gå på tvers. Pinne 6 går via 330 Ω til lastsiden av triacen, pinne 4 til gate. Bruk en snubber (100 Ω + 100 nF X2) over triacen for induktive laster. Gjør slike koblinger bare hvis du er kvalifisert, og alltid i lukket boks.",
    svg: svg(580, 280, [
      text(20, 124, "GPIO", { weight: 600 }), wire([60, 120], [80, 120]), res(80, 120, 160, 120, "330 Ω"), wire([160, 120], [184, 120]),
      chip(184, 90, 120, 120, mains ? "MOC3021" : p.mpn, [["A", 120, "1"], ["K", 180, "2"]], [["MT2", 120, "6"], ["MT1", 180, "4"]], { accent: !mains }),
      wire([170, 180], [140, 180], [140, 204]), gnd(140, 204),
      `<line x1="244" y1="56" x2="244" y2="88" stroke-dasharray="4 4" stroke-width="1.5"/><line x1="244" y1="212" x2="244" y2="262" stroke-dasharray="4 4" stroke-width="1.5"/>`,
      text(236, 262, "lavspenning", { size: 10, muted: true, anchor: "end" }), text(252, 262, "230 V", { size: 10, weight: 700, color: "#d03b3b" }),
      wire([318, 120], [330, 120]), res(330, 120, 400, 120, "330 Ω"), wire([400, 120], [420, 120]), dot(420, 120),
      wire([318, 180], [360, 180], [360, t.gate[1]], t.gate),
      vcc(420, 40, "L (230 V)"), wire([420, 40], [420, 56]), load(420, 56, 112, "Last"), wire([420, 112], [420, 120]),
      t.s, wire([420, 200], [420, 236]), text(420, 252, "N", { anchor: "middle", weight: 700 }),
      text(446, 164, mains ? p.mpn : "triac", { size: 12, weight: 700, color: A }),
    ].join(""), `${p.mpn} med optotriac fra GPIO`),
  };
};

T.opamp = (p) => {
  const o = opampSym(240, 150, p.mpn.length < 7 ? p.mpn : "");
  return {
    title: `${p.mpn}: ikke-inverterende forsterker`,
    caption: "Forsterkning = 1 + R2 / R1. Med 10 kΩ og 100 kΩ blir den 11 ganger. Uten R1 og R2 (utgangen rett til −) blir den en spenningsfølger (buffer). V+ og V− er forsyningen; med én forsyning går V− til jord. Sett 100 nF fra V+ til jord tett ved brikken.",
    svg: svg(520, 250, [
      o.s,
      text(24, 171, "Inn", { weight: 600 }), wire([60, 167], o.plus),
      wire(o.out, [430, 150]), dot(380, 150), text(440, 154, "Ut", { weight: 600 }),
      wire(o.minus, [200, 133], [200, 70]), dot(200, 110), wire([200, 70], [250, 70]), res(250, 70, 350, 70, "R2 100 kΩ"), wire([350, 70], [380, 70], [380, 150]),
      wire([200, 110], [140, 110]), res(140, 110, 140, 180, "R1 10 kΩ", -1), gnd(140, 180),
      wire(o.top, [266, 104]), text(274, 112, "V+", { size: 10, muted: true }), wire(o.bottom, [266, 200]), gnd(266, 200), text(274, 196, "V−", { size: 10, muted: true }),
    ].join(""), `${p.mpn} koblet som ikke-inverterende forsterker`),
  };
};

T.comparator = (p) => {
  const o = opampSym(240, 140, p.mpn.length < 7 ? p.mpn : "");
  return {
    title: `${p.mpn}: terskelbryter (komparator)`,
    caption: "Utgangen går lav når inngangen er over terskelen fra potmeteret, ellers dras den høy av 10 kΩ. Utgangen er åpen kollektor og kan derfor dras til 3,3 V for en ESP32 selv om brikken går på 5 V.",
    svg: svg(560, 280, [
      o.s, wire(o.top, [266, 96]), text(274, 104, "V+", { size: 10, muted: true }),
      text(30, 127, "Inn", { weight: 600 }), wire([60, 123], o.minus),
      vcc(140, 180, "V+"), res(140, 182, 140, 230, "10 kΩ pot"), wire([140, 230], [140, 246]), gnd(140, 246), wire([152, 206], [180, o.plus[1]], o.plus),
      text(70, 214, "terskel", { size: 10, muted: true }),
      vcc(380, 40, "3,3 V"), wire([380, 40], [380, 60]), res(380, 60, 380, 120, "10 kΩ"), dot(380, 140), wire(o.out, [460, 140]), text(470, 144, "GPIO", { weight: 600 }), wire([380, 120], [380, 140]),
      wire(o.bottom, [266, 190]), gnd(266, 190),
    ].join(""), `${p.mpn} som terskelbryter`),
  };
};

T.hc595 = (p) => ({
  title: `${p.mpn}: 8 utganger fra 3 pinner`,
  caption: "Data skiftes inn bit for bit på DS med klokke på SHCP, og vises på Q0–Q7 når STCP går høy (shiftOut + latch). OE til jord og MR til VCC. 100 nF ved VCC. Kjed flere ved å koble Q7' til DS på neste brikke.",
  svg: svg(560, 300, [
    text(20, 84, "GPIO23", { weight: 600, size: 11 }), wire([76, 80], [176, 80]), text(92, 74, "data", { size: 10, muted: true }),
    text(20, 124, "GPIO18", { weight: 600, size: 11 }), wire([76, 120], [176, 120]), text(92, 114, "klokke", { size: 10, muted: true }),
    text(20, 164, "GPIO5", { weight: 600, size: 11 }), wire([76, 160], [176, 160]), text(92, 154, "latch", { size: 10, muted: true }),
    chip(190, 50, 130, 210, p.mpn, [["DS", 80, "14"], ["SHCP", 120, "11"], ["STCP", 160, "12"], ["OE", 200, "13"], ["MR", 236, "10"]], [["Q0", 76, "15"], ["Q1", 100, "1"], ["Q2", 124, "2"], ["Q3", 148, "3"], ["…Q7", 172, "7"], ["Q7'", 236, "9"]]),
    wire([176, 200], [150, 200], [150, 222]), gnd(150, 222),
    vcc(120, 236, "VCC"), wire([120, 236], [176, 236]),
    ...[76, 100, 124, 148, 172].map((y) => res(334, y, 410, y, "", 1) + diode(410, y, 450, y, { led: true, color: A }) + wire([450, y], [470, y])),
    wire([470, 76], [470, 196]), gnd(470, 196), text(372, 64, "220 Ω", { size: 10, muted: true, anchor: "middle" }),
    text(338, 262, "til neste 595 (DS)", { size: 10, muted: true }),
  ].join(""), `${p.mpn} med LED-er på utgangene`),
});

T.schmitt = (p) => ({
  title: `${p.mpn}: avprelling av knapp`,
  caption: "RC-leddet (10 kΩ + 100 nF) jevner ut prelling fra knappen, og Schmitt-triggeren gjør det til en ren flanke. 74HC14 inverterer: utgangen er høy når knappen trykkes.",
  svg: svg(540, 250, [
    vcc(120, 30, "VCC"), wire([120, 30], [120, 44]), res(120, 44, 120, 104, "10 kΩ", -1), dot(120, 120), wire([120, 104], [120, 120]),
    wire([120, 120], [80, 120], [80, 140]), `<circle cx="80" cy="146" r="3"/>`, wire([80, 149], [94, 162]), `<circle cx="80" cy="170" r="3"/>`, wire([80, 173], [80, 186]), gnd(80, 186), text(40, 162, "knapp", { size: 10, muted: true }),
    wire([120, 120], [200, 120]), res(200, 120, 260, 120, "10 kΩ"), dot(280, 120), wire([260, 120], [300, 120]), cap(280, 120, 186, "100 nF"), gnd(280, 186),
    `<polygon points="300,96 300,144 346,120" stroke="${A}"/><circle cx="351" cy="120" r="5" stroke="${A}"/>`, text(310, 124, "⌐", { size: 11 }),
    wire([356, 120], [420, 120]), text(430, 124, "GPIO", { weight: 600 }), text(300, 166, `${p.mpn} (pinne 1 → 2)`, { size: 10, muted: true }),
  ].join(""), `${p.mpn} som avprelling`),
});

T.cd4017 = (p) => ({
  title: `${p.mpn}: løpelys med 555`,
  caption: "En 555 (eller en GPIO) gir klokkepulser på CLK, og CD4017 tenner Q0–Q9 én etter én. EN og RST til jord for fri løping; koble Q4 til RST for å telle bare fem. Én felles motstand holder fordi bare én LED lyser om gangen.",
  svg: svg(560, 300, [
    chip(40, 90, 110, 100, "NE555", [], [["OUT", 140, "3"]], { accent: false }), text(95, 210, "astabil, ~2 Hz", { size: 10, muted: true, anchor: "middle" }),
    wire([164, 140], [216, 140]),
    chip(230, 50, 130, 210, p.mpn, [["CLK", 140, "14"], ["EN", 200, "13"], ["RST", 236, "15"]], [["Q0", 76, "3"], ["Q1", 100, "2"], ["Q2", 124, "4"], ["Q3", 148, "7"], ["…Q9", 172, "11"]]),
    wire([216, 200], [196, 200], [196, 236], [216, 236]), wire([196, 236], [196, 254]), gnd(196, 254),
    ...[76, 100, 124, 148, 172].map((y) => diode(374, y, 424, y, { led: true, color: A }) + wire([424, y], [450, y])),
    wire([450, 76], [450, 200]), res(450, 200, 450, 250, "470 Ω"), gnd(450, 250),
  ].join(""), `${p.mpn} drevet av en 555`),
});

T.logic = (p) => ({
  title: `${p.mpn}: strøm og avkobling`,
  caption: "Alle logikk-IC-er trenger 100 nF så nær VCC-pinnen som mulig. Ubrukte innganger kobles til VCC eller GND (aldri flytende), særlig på CMOS (40xx, 74HC). 74HC går på 2–6 V, 74LS på 5 V, 40xx på 3–15 V.",
  svg: svg(480, 230, [
    vcc(180, 30, "VCC (pinne 14/16)"), wire([180, 30], [180, 70]), dot(180, 50), wire([180, 50], [300, 50]), cap(300, 50, 110, "100 nF"), gnd(300, 110),
    chip(130, 70, 120, 110, p.mpn, [], [], { accent: true }), text(190, 140, "logikk", { size: 11, muted: true, anchor: "middle" }),
    wire([180, 180], [180, 200]), gnd(180, 200), text(196, 196, "GND (pinne 7/8)", { size: 10, muted: true }),
    text(40, 110, "ubrukte", { size: 10, muted: true }), text(40, 124, "innganger →", { size: 10, muted: true }), text(40, 138, "VCC/GND", { size: 10, muted: true }),
  ].join(""), `${p.mpn} med avkoblingskondensator`),
});

T.tl431 = (p) => ({
  title: `${p.mpn}: stabil referansespenning`,
  caption: "Vut = 2,495 V × (1 + R1 / R2). Uten R1/R2 (REF koblet rett til katoden) gir den 2,495 V. Seriemotstanden fra forsyningen må gi minst 1 mA gjennom TL431.",
  svg: svg(520, 280, [
    vcc(120, 30, "+5–12 V"), wire([120, 30], [120, 44]), res(120, 44, 120, 104, "1 kΩ", -1), dot(120, 120), wire([120, 104], [120, 120]),
    wire([120, 120], [400, 120]), dot(300, 120), text(420, 124, "Vut", { weight: 600 }),
    diode(120, 210, 120, 140, { color: A }), wire([120, 120], [120, 140]), wire([120, 210], [120, 236]), gnd(120, 236),
    text(104, 180, p.mpn, { size: 12, weight: 700, color: A, anchor: "end" }),
    res(300, 120, 300, 180, "R1"), dot(300, 180), res(300, 180, 300, 236, "R2"), gnd(300, 236),
    wire([300, 180], [180, 180], [134, 176]), text(186, 174, "REF", { size: 10, muted: true }),
  ].join(""), `${p.mpn} som spenningsreferanse`),
});

T.ldo = (p) => ({
  title: `${p.mpn}: LDO-regulator`,
  caption: "1 µF på inngangen og 1 µF på utgangen, tett inntil brikken (XC6206/MCP1700 er stabile med keramiske kondensatorer). Spenningsfallet er lite (ca. 0,1–0,3 V), så 3,3 V kan lages fra en Li-ion-celle.",
  svg: svg(520, 230, [
    text(20, 84, "Inn", { weight: 600 }), wire([50, 80], [180, 80]), dot(110, 80), cap(110, 80, 170, "1 µF"), gnd(110, 170),
    chip(194, 38, 132, 88, p.mpn, [["IN", 80]], [["OUT", 80]]),
    wire([260, 126], [260, 170]), text(266, 146, "GND", { size: 10, muted: true }), gnd(260, 170),
    wire([340, 80], [480, 80]), dot(410, 80), cap(410, 80, 170, "1 µF"), gnd(410, 170), text(450, 72, "3,3 V", { weight: 600 }),
  ].join(""), `${p.mpn} med kondensatorer`),
});

T.icl7660 = (p) => ({
  title: `${p.mpn}: negativ spenning`,
  caption: "Med to 10 µF-kondensatorer gir den −V+ ut (f.eks. −5 V fra +5 V) for små laster (under ca. 20 mA). Nyttig for operasjonsforsterkere som trenger ±5 V. Pass på polariteten på C2: pluss til jord.",
  svg: svg(520, 260, [
    vcc(120, 30, "+5 V"), wire([120, 30], [120, 60], [176, 60]),
    chip(190, 40, 130, 170, p.mpn, [["V+", 60, "8"], ["CAP+", 110, "2"], ["CAP−", 160, "4"], ["GND", 196, "3"]], [["VOUT", 110, "5"]]),
    wire([176, 110], [140, 110]), cap(140, 110, 160, "C1 10 µF", true), wire([140, 160], [176, 160]),
    wire([176, 196], [150, 196], [150, 220]), gnd(150, 220),
    wire([334, 110], [440, 110]), dot(400, 110), text(450, 114, "−5 V", { weight: 600 }),
    wire([400, 110], [400, 130]), cap(400, 130, 200, "C2 10 µF", true), wire([400, 200], [400, 220]), gnd(400, 220),
  ].join(""), `${p.mpn} som spenningsinverter`),
});

T.lm386 = (p) => ({
  title: `${p.mpn}: lydforsterker for høyttaler`,
  caption: "Grunnkobling med forsterkning 20. Legg 10 µF mellom pinne 1 og 8 for forsterkning 200. Zobel-leddet (10 Ω + 47 nF) og 250 µF ut gjør den stabil og stopper likestrøm til høyttaleren.",
  svg: svg(560, 280, [
    text(20, 88, "Lyd inn", { weight: 600 }), wire([76, 84], [100, 84], [100, 104]), res(100, 104, 100, 160, "10 kΩ pot", -1), wire([100, 104], [100, 96]), wire([100, 160], [100, 190]), gnd(100, 190),
    wire([112, 132], [176, 132]),
    chip(190, 60, 130, 140, p.mpn, [["IN+", 132, "3"], ["IN−", 164, "2"], ["GND", 188, "4"]], [["VS", 84, "6"], ["VOUT", 140, "5"]]),
    wire([176, 164], [160, 164], [160, 188]), wire([176, 188], [160, 188], [160, 210]), gnd(160, 210),
    vcc(370, 30, "+5–9 V"), wire([370, 30], [370, 84], [334, 84]),
    wire([334, 140], [380, 140]), dot(380, 140), cap(380, 140, 200, "47 nF"), res(380, 200, 380, 240, "10 Ω"), gnd(380, 240),
    wire([380, 140], [420, 140]), text(410, 124, "250 µF", { size: 10, muted: true }),
    `<line x1="420" y1="130" x2="420" y2="150"/><path d="M426 130 Q431 140 426 150"/>`, wire([428, 140], [470, 140]),
    `<rect x="470" y="128" width="10" height="24"/><path d="M480 128 L494 116 L494 164 L480 152"/>`, wire([475, 152], [475, 210]), gnd(475, 210), text(500, 144, "8 Ω", { size: 10, muted: true }),
  ].join(""), `${p.mpn} med høyttaler`),
});

T.zener = (p) => ({
  title: `${p.mpn}: enkel spenningsbegrensning`,
  caption: "Seriemotstanden begrenser strømmen: R = (Vinn − Vz) / I. Fra 12 V til en 5,1 V-zener med 10 mA: (12 − 5,1) / 0,01 ≈ 680 Ω. Brukes også som vern på en inngang (zener fra signal til jord). Katoden (stripen) mot pluss.",
  svg: svg(480, 220, [
    text(20, 84, "Inn", { weight: 600 }), wire([50, 80], [80, 80]), res(80, 80, 200, 80, "680 Ω"), wire([200, 80], [360, 80]), dot(280, 80), text(372, 84, "Ut (Vz)", { weight: 600 }),
    diode(280, 170, 280, 80, { color: A }), wire([280, 170], [280, 186]), gnd(280, 186), text(300, 130, p.mpn, { size: 12, weight: 700, color: A }),
  ].join(""), `${p.mpn} som spenningsbegrenser`),
});

T.bridge = (p) => ({
  title: `${p.mpn}: likeretter`,
  caption: "Vekselstrøm (f.eks. fra en transformator) inn på de to ~-pinnene, likestrøm ut på + og −. Glattekondensatoren må tåle minst 1,5 × toppspenningen. Spenningen ut blir ca. 1,4 × AC-spenningen minus 1,4 V.",
  svg: svg(540, 260, [
    text(20, 134, "~ AC", { weight: 600 }), wire([64, 130], [140, 130]), wire([280, 130], [320, 130]), text(326, 134, "~ AC", { weight: 600 }),
    `<polygon points="210,60 280,130 210,200 140,130" stroke="${A}"/>`, text(210, 134, p.mpn.slice(0, 9), { size: 10, weight: 700, anchor: "middle", color: A }),
    text(220, 74, "+", { size: 13, weight: 700 }), text(220, 196, "−", { size: 13, weight: 700 }),
    wire([210, 60], [210, 40], [460, 40]), dot(420, 40), text(470, 44, "+ DC", { weight: 600 }),
    wire([210, 200], [210, 220], [460, 220]), dot(420, 220), text(470, 224, "− DC", { weight: 600 }),
    cap(420, 40, 220, "1000 µF", true),
  ].join(""), `${p.mpn} med glattekondensator`),
});

// ---------- Moduler i et oppsett ----------

T.nrf24 = (p) => moduleWiring(p, rowsOf([["3V3", "VCC", "pwr", "+ 10 µF"], ["GND", "GND", "gnd"], ["GPIO4", "CE", "sig"], ["GPIO5", "CSN", "spi", "SPI CS"], ["GPIO18", "SCK", "spi", "SPI klokke"], ["GPIO23", "MOSI", "spi"], ["GPIO19", "MISO", "spi"]]),
  `${p.mpn}: trådløs 2,4 GHz`, "Standard SPI-pinner på ESP32 (VSPI). Bruk RF24-biblioteket: RF24 radio(4, 5). To moduler trengs, én i hver ende. 10 µF over VCC/GND rett på modulen.", { modName: "nRF24L01" });

T.lora = (p) => moduleWiring(p, rowsOf([["3V3", "VCC", "pwr"], ["GND", "GND", "gnd"], ["GPIO5", "NSS", "spi", "SPI CS"], ["GPIO18", "SCK", "spi"], ["GPIO23", "MOSI", "spi"], ["GPIO19", "MISO", "spi"], ["GPIO14", "RST", "sig"], ["GPIO26", "DIO0", "sig", "avbrudd"]]),
  `${p.mpn}: LoRa-radio`, "LoRa når flere kilometer med lite strøm. Bruk biblioteket LoRa (Sandeep Mistry) eller RadioLib, og velg riktig frekvens for modulen (433 eller 868 MHz i Norge). Antennen må stå på før strømmen.",
  { out: { name: "Antenne", pins: [["ANT", "λ/4-pisk", "17 cm v/433"]] } });

T.loraUart = (p) => moduleWiring(p, rowsOf([["3V3", "VCC", "pwr"], ["GND", "GND", "gnd"], ["GPIO17", "RXD", "sig", "TX → RXD"], ["GPIO16", "TXD", "sig", "RX ← TXD"], ["GPIO4", "AUX", "sig", "opptatt"], ["GND", "M0", "gnd", "normal modus"], ["GND", "M1", "gnd"]]),
  `${p.mpn}: LoRa over seriell`, "Alt som skrives til seriellporten sendes trådløst til en annen modul med samme kanal og adresse. Ingen radiokode trengs, bare Serial2.", { out: { name: "Antenne", pins: [["ANT", "antenne"]] } });

T.hx711 = (p) => moduleWiring(p, rowsOf([["3V3", "VCC", "pwr"], ["GND", "GND", "gnd"], ["GPIO16", "DT", "sig", "data"], ["GPIO4", "SCK", "sig", "klokke"]]),
  `${p.mpn}: vekt med lastcelle`, "Lastcellen kobles på venstre side av HX711 med fire ledninger. Bruk HX711-biblioteket (bogde): kalibrer med en kjent vekt og lagre faktoren. Fest lastcellen slik at den bøyes i pilens retning.",
  { out: { name: "Lastcelle", pins: [["E+", "rød"], ["E−", "svart"], ["A−", "hvit"], ["A+", "grønn"]] } });

T.i2samp = (p) => moduleWiring(p, rowsOf([["5V", "VIN", "pwr"], ["GND", "GND", "gnd"], ["GPIO26", "BCLK", "sig", "I2S klokke"], ["GPIO25", "LRC", "sig", "venstre/høyre"], ["GPIO22", "DIN", "sig", "lyddata"]]),
  `${p.mpn}: digital lyd til høyttaler`, "ESP32 sender lyd digitalt over I2S, og forsterkeren driver høyttaleren direkte. Bruk ESP32-audioI2S-biblioteket for MP3 og nettradio. GAIN åpen gir 9 dB; SD åpen gir mono (L+R).",
  { modName: "MAX98357A", out: { name: "Høyttaler 4–8 Ω", pins: [["+", "+"], ["−", "−"]] } });

T.servo = (p) => moduleWiring(p, rowsOf([["5V (ekstern)", "V+ (rød)", "pwr", "egen 5 V, 1–2 A"], ["GND", "GND (brun)", "gnd", "felles jord"], ["GPIO13", "PWM (oransje)", "sig", "50 Hz, 0,5–2,5 ms"]]),
  `${p.mpn}: servo fra ESP32`, "Bruk ESP32Servo-biblioteket: servo.attach(13); servo.write(90). Gi servoen egen 5 V-forsyning (USB-porten klarer ikke strømtoppene) og koble jordene sammen. 470 µF over servostrømmen hjelper mot reset.", { modName: "Servo" });

T.stepper = (p) => moduleWiring(p, rowsOf([["3V3", "VDD", "pwr"], ["GND", "GND", "gnd"], ["GPIO26", "STEP", "sig", "én puls = ett steg"], ["GPIO27", "DIR", "sig", "retning"], ["GPIO25", "EN", "sig", "LOW = på"], ["3V3", "SLP + RST", "pwr", "bro"]]),
  `${p.mpn}: stegmotor`, "Motorstrøm (8–35 V) går til VMOT/GND med 100 µF rett ved driveren. Spolene: finn parene med et multimeter (lav motstand mellom to ledninger = én spole). Bruk AccelStepper. Still strømgrensen før motoren kobles til.",
  { out: { name: "Stegmotor", pins: [["2B", "spole B−"], ["2A", "spole B+"], ["1A", "spole A+"], ["1B", "spole A−"], ["VMOT", "8–35 V +", "100 µF"]] } });

T.motordriver = (p) => moduleWiring(p, rowsOf([["GPIO25", "IN1", "sig", "PWM"], ["GPIO26", "IN2", "sig"], ["GPIO27", "IN3", "sig", "PWM"], ["GPIO14", "IN4", "sig"], ["GND", "GND", "gnd", "felles jord"]]),
  `${p.mpn}: to DC-motorer`, "IN1 høy og IN2 lav = forover, motsatt = bakover, begge like = stopp. PWM på én av inngangene styrer farten. Motorene får strøm fra en egen kilde (batteripakke) på VM/+12 V; jordene kobles sammen. L298N mister ca. 2 V, så MX1508/TB6612 er bedre på lav spenning.",
  { out: { name: "Motorer", pins: [["OUT1", "motor A +"], ["OUT2", "motor A −"], ["OUT3", "motor B +"], ["OUT4", "motor B −"], ["VM", "batteri +"]] } });

T.tft = (p) => moduleWiring(p, rowsOf([["3V3", "VCC", "pwr"], ["GND", "GND", "gnd"], ["GPIO18", "SCL", "spi", "SPI klokke"], ["GPIO23", "SDA", "spi", "SPI data"], ["GPIO4", "RES", "sig"], ["GPIO2", "DC", "sig", "data/kommando"], ["GPIO5", "CS", "spi"], ["3V3", "BLK", "pwr", "lys (eller PWM)"]]),
  `${p.mpn}: fargeskjerm`, "Pinnene settes i User_Setup.h i TFT_eSPI-biblioteket. BLK kan gå til en GPIO med PWM for å dimme bakgrunnslyset.");

T.epaper = (p) => moduleWiring(p, rowsOf([["3V3", "VCC", "pwr"], ["GND", "GND", "gnd"], ["GPIO23", "DIN", "spi", "SPI data"], ["GPIO18", "CLK", "spi", "SPI klokke"], ["GPIO5", "CS", "spi"], ["GPIO17", "DC", "sig"], ["GPIO16", "RST", "sig"], ["GPIO4", "BUSY", "sig", "venter på skjermen"]]),
  `${p.mpn}: e-papir`, "Bruk GxEPD2 og velg riktig skjermdriver for størrelsen. Kombiner med deep sleep for batteridrift: skjermen viser bildet videre uten strøm.", { modName: "E-papir" });

T.gsm = (p) => moduleWiring(p, rowsOf([["Li-ion 3,7–4,2 V", "VCC", "pwr", "2 A topper!"], ["GND", "GND", "gnd", "felles jord"], ["GPIO17", "RXD", "sig", "TX → RXD"], ["GPIO16", "TXD", "sig", "RX ← TXD"], ["GPIO4", "RST", "sig"]]),
  `${p.mpn}: SMS og mobildata`, "Styres med AT-kommandoer over Serial2 (TinyGSM-biblioteket). SIM800L støtter bare 2G, som er slått av hos flere norske operatører; A7670/SIM7600 bruker 4G. Sett 1000 µF over VCC.",
  { out: { name: "Antenne og SIM", pins: [["ANT", "GSM-antenne"], ["SIM", "micro-SIM"]] } });

T.rs485 = (p) => moduleWiring(p, rowsOf([["3V3/5V", "VCC", "pwr"], ["GND", "GND", "gnd"], ["GPIO17", "DI", "sig", "send"], ["GPIO16", "RO", "sig", "motta"], ["GPIO4", "DE + RE", "sig", "høy = send"]]),
  `${p.mpn}: RS-485 / Modbus`, "Typisk for Modbus-sensorer og energimålere. DE og RE bindes sammen og styres fra én GPIO. MAX485 er en 5 V-brikke; bruk MAX3485/SP3485 på 3,3 V.",
  { out: { name: "Buss (tvunnet par)", pins: [["A", "A / D+"], ["B", "B / D−"]] } });

T.pir = (p) => moduleWiring(p, rowsOf([["5V", "VCC", "pwr"], ["GPIO27", "OUT", "sig", "høy ved bevegelse"], ["GND", "GND", "gnd"]]),
  `${p.mpn}: bevegelsessensor`, "Les utgangen med digitalRead eller som avbrudd. På HC-SR501 stiller det ene potmeteret følsomheten og det andre hvor lenge utgangen holdes høy. RCWL-0516/LD-radarer ser gjennom plast og tynne vegger.");

T.hall = (p) => moduleWiring(p, rowsOf([["3V3", "VCC", "pwr"], ["GND", "GND", "gnd"], ["GPIO34", "OUT", "sig", "analog eller digital"]]),
  `${p.mpn}: hallsensor (magnet)`, "SS49E: les med analogRead; verdien går opp eller ned fra midten avhengig av polen. US1881/A3144: sett 10 kΩ fra OUT til 3V3 og bruk en vanlig GPIO, f.eks. til turteller eller endebryter.");

T.analog = (p) => moduleWiring(p, rowsOf([["3V3", "VCC", "pwr"], ["GND", "GND", "gnd"], ["GPIO34", "OUT/AO", "sig", "ADC1"]]),
  `${p.mpn}: analog sensor`, "analogRead(34) gir 0–4095 for 0–3,3 V. Gir modulen 5 V ut (ACS712, MQ-gassensorer), må spenningen deles ned med 10 kΩ / 20 kΩ før den går inn på ESP32. MQ-sensorer trenger 5 V til varmeelementet.");

T.relay = (p) => moduleWiring(p, rowsOf([["5V", "DC+ / VCC", "pwr"], ["GND", "DC− / GND", "gnd"], ["GPIO26", "IN", "sig", "LOW = på (ofte)"]]),
  `${p.mpn}: styre en last med relé`, "FARE ved 230 V: bruk lukket boks og godkjente koblinger, eller hold deg til lavspenning (12–24 V). Releet er en bryter: COM og NO kobles sammen når releet trekker. Med 3,3 V-signal: velg en modul med optokobler eller transistor-inngang.",
  { modName: "Relémodul", out: { name: "Last", pins: [["COM", "fra strømkilde +"], ["NO", "til last +"], ["NC", "(ikke i bruk)"]] } });

T.tm16 = (p) => moduleWiring(p, /1637/.test(p.mpn)
  ? rowsOf([["3V3/5V", "VCC", "pwr"], ["GND", "GND", "gnd"], ["GPIO22", "CLK", "sig"], ["GPIO21", "DIO", "sig"]])
  : rowsOf([["5V", "VCC", "pwr"], ["GND", "GND", "gnd"], ["GPIO25", "STB", "sig"], ["GPIO26", "CLK", "sig"], ["GPIO27", "DIO", "sig", "data begge veier"]]),
  `${p.mpn}: sju-segment-display`, "TM1637 har fire sifre og to ledninger; TM1638 har åtte sifre, åtte LED-er og åtte knapper på tre ledninger. Biblioteker: TM1637Display / TM1638plus.");

T.can = (p) => moduleWiring(p, rowsOf([["5V", "VCC", "pwr"], ["GND", "GND", "gnd"], ["GPIO5", "CS", "spi"], ["GPIO18", "SCK", "spi"], ["GPIO23", "SI", "spi", "MOSI"], ["GPIO19", "SO", "spi", "MISO"], ["GPIO4", "INT", "sig"]]),
  `${p.mpn}: CAN-buss`, "Til bil (OBD-II), 3D-skrivere og industriutstyr. TJA1050 på modulen trenger 5 V. ESP32 har også egen CAN-kontroller (TWAI) som bare trenger en transceiver.",
  { out: { name: "CAN-buss", pins: [["CANH", "CAN høy"], ["CANL", "CAN lav"]] } });

T.lcdi2c = (p) => moduleWiring(p, rowsOf([["5V", "VCC", "pwr"], ["GND", "GND", "gnd"], ["GPIO22", "SCL", "i2c"], ["GPIO21", "SDA", "i2c"]]),
  `${p.mpn}: tekstskjerm over I2C`, "Bruk LiquidCrystal_I2C med adresse 0x27 (eller 0x3F). Skjermen trenger 5 V for kontrast; I2C fra ESP32 fungerer som regel likevel. Ser du bare blokker, juster potmeteret bak.");

T.ntc = (p) => ({
  title: `${p.mpn}: temperatur med NTC`,
  caption: "Spenningsdeler: NTC fra 3,3 V til ADC-pinnen og 10 kΩ fra pinnen til jord. Temperaturen regnes ut med B-formelen: 1/T = 1/298,15 + ln(R/10000)/3950 (T i kelvin).",
  svg: svg(460, 230, [
    vcc(140, 30, "3V3"), wire([140, 30], [140, 46]), res(140, 46, 140, 106, "NTC 10 kΩ", -1), dot(140, 120), wire([140, 106], [140, 120]),
    wire([140, 120], [300, 120]), text(310, 124, "GPIO34 (ADC)", { weight: 600 }),
    wire([140, 120], [140, 136]), res(140, 136, 140, 190, "10 kΩ", -1), gnd(140, 190),
  ].join(""), "NTC i spenningsdeler"),
});

T.usbserial = (p) => moduleWiring(p, rowsOf([["GND", "GND", "gnd"], ["RX", "TXD", "sig", "kryss: TX → RX"], ["TX", "RXD", "sig", "kryss: RX ← TX"], ["EN/RST", "RTS/DTR", "sig", "auto-reset (valgfritt)"], ["3V3", "VCC/V3", "pwr"]]),
  `${p.mpn}: USB til seriell`, "TXD på brikken går til RX på mikrokontrolleren og omvendt. Velg 3,3 V-nivå for ESP32 (CH340: koble V3 til VCC ved 3,3 V-drift). DTR/RTS via 100 nF og to transistorer gir automatisk opplasting.", { board: "Mikrokontroller" });

T.max7219 = (p) => moduleWiring(p, rowsOf([["5V", "VCC", "pwr"], ["GND", "GND", "gnd"], ["GPIO23", "DIN", "sig", "data (MOSI)"], ["GPIO5", "CS/LOAD", "sig", "velg"], ["GPIO18", "CLK", "sig", "klokke (SCK)"]]),
  `${p.mpn}: LED-matrise`, "Tre signalledninger (som SPI). Brikken går på 5 V, men 3,3 V-signaler fra ESP32 fungerer som regel. 10 µF + 100 nF ved VCC, og RSET (ca. 10 kΩ) setter LED-strømmen.");

// Moduler: kortet til venstre, modulen til høyre, rette ledninger på samme høyde.
// out: valgfri tredje boks til høyre for det modulen styrer (motor, høyttaler, lastcelle …),
// { name, pins: [[modulpinne, pinne på enheten, etikett]] }.
function moduleWiring(p, rows, title, caption, { board = "ESP32", modName = p.mpn, out = null } = {}) {
  const ROW = 32, top = 60, h = Math.max(rows.length, out ? out.pins.length : 0) * ROW + 40;
  const colors = { pwr: "#d03b3b", gnd: "currentColor", sig: A, i2c: "#0e8f8f", spi: "#7a4fd0", out: "#c27a12" };
  let s = chip(40, top - 30, 150, h, board, [], rows.map(([b, , , i]) => [b, top + i * ROW + 6]), { accent: false });
  s += chip(370, top - 30, 150, h, modName, rows.map(([, m, , i]) => [m, top + i * ROW + 6]), out ? out.pins.map(([m], i) => [m, top + i * ROW + 6]) : []);
  if (out) {
    s += `<rect x="640" y="${top - 30}" width="130" height="${h}" rx="6" stroke-dasharray="5 4"/>` + text(705, top - 12, out.name, { anchor: "middle", size: 12, weight: 700 });
    out.pins.forEach(([, d, label], i) => {
      const y = top + i * ROW + 6;
      s += `<line x1="534" y1="${y}" x2="640" y2="${y}" stroke="${colors[out.color] || colors.out}" stroke-width="2.6"/>` + text(648, y + 4, d, { size: 10 });
      if (label) s += text(587, y - 6, label, { anchor: "middle", size: 9, muted: true });
    });
  }
  rows.forEach(([, , c, i, label]) => {
    const y = top + i * ROW + 6;
    s += `<line x1="204" y1="${y}" x2="356" y2="${y}" stroke="${colors[c] || A}" stroke-width="2.6"/>`;
    if (label) s += text(280, y - 6, label, { anchor: "middle", size: 10, muted: true });
  });
  return { title, caption, svg: svg(out ? 790 : 560, top + h - 10, s, `${modName} koblet til ${board}${out ? ` og ${out.name.toLowerCase()}` : ""}`) };
}
const rowsOf = (list) => list.map((r, i) => [r[0], r[1], r[2], i, r[3]]);

T.i2c = (p) => moduleWiring(p, rowsOf([["3V3", "VCC", "pwr"], ["GND", "GND", "gnd"], ["GPIO22", "SCL", "i2c", "I2C klokke"], ["GPIO21", "SDA", "i2c", "I2C data"]]),
  `${p.mpn} på I2C`, "Fire ledninger: strøm, jord og I2C. GPIO21/22 er standard på ESP32; på andre kort kan du velge pinner med Wire.begin(SDA, SCL). Flere I2C-moduler kan dele de samme to ledningene så lenge adressene er ulike.");
T.hcsr04 = (p) => {
  const r = moduleWiring(p, rowsOf([["5V", "VCC", "pwr"], ["GPIO5", "TRIG", "sig", "puls ut"], ["GPIO18", "ECHO", "sig", "via 1k/2k deler"], ["GND", "GND", "gnd"]]),
    `${p.mpn} avstandssensor`, "TRIG får en 10 µs puls, ECHO svarer med en puls som er like lang som lydens tur-retur. ECHO er 5 V: sett 1 kΩ i serie og 2 kΩ til jord før den går inn på ESP32 (HC-SR04P og RCWL-1601 tåler 3,3 V direkte).");
  return r;
};
T.ds18b20 = (p) => ({
  title: `${p.mpn} temperatursensor (1-Wire)`,
  caption: "Én dataledning med 4,7 kΩ pull-up til 3,3 V. Flere sensorer kan henges på samme ledning; hver har sin egen adresse.",
  svg: svg(480, 230, [
    vcc(140, 26, "3,3 V"), wire([140, 26], [140, 50], [330, 50]), dot(140, 50),
    res(140, 50, 140, 130, "4,7 kΩ", -1), dot(140, 130),
    text(20, 134, "GPIO4", { weight: 600 }), wire([70, 130], [330, 130]),
    chip(344, 30, 110, 140, p.mpn, [["VDD", 50, "3"], ["DQ", 130, "2"], ["GND", 158, "1"]]),
    wire([330, 158], [300, 158], [300, 185]), gnd(300, 185),
  ].join(""), `${p.mpn} med pull-up`),
});
T.dht = (p) => moduleWiring(p, rowsOf([["3V3", "VCC", "pwr"], ["GPIO4", "DATA", "sig", "10 kΩ pull-up"], ["GND", "GND", "gnd"]]),
  `${p.mpn} temperatur og fuktighet`, "Én dataledning. Har sensoren fire bein (ikke modul), trengs 10 kΩ fra DATA til VCC. DHT22 gir bedre nøyaktighet enn DHT11.");
T.buck = (p) => ({
  title: `${p.mpn}: spenningsomformer`,
  caption: "Kobles mellom strømkilden og det som skal ha strøm. Juster potmeteret med et multimeter på utgangen FØR lasten kobles til, og pass på at pluss og minus ikke byttes.",
  svg: svg(560, 200, [
    text(20, 64, "Strømkilde", { weight: 600 }), text(20, 80, "f.eks. 12 V", { size: 11, muted: true }),
    `<line x1="110" y1="60" x2="196" y2="60" stroke="#d03b3b" stroke-width="2.6"/>`, `<line x1="110" y1="130" x2="196" y2="130" stroke-width="2.6"/>`,
    chip(210, 30, 150, 130, p.mpn, [["IN+", 60], ["IN−", 130]], [["OUT+", 60], ["OUT−", 130]]),
    `<line x1="374" y1="60" x2="460" y2="60" stroke="#d03b3b" stroke-width="2.6"/>`, `<line x1="374" y1="130" x2="460" y2="130" stroke-width="2.6"/>`,
    text(470, 64, "Last", { weight: 600 }), text(470, 80, "f.eks. 5 V", { size: 11, muted: true }),
    `<circle cx="285" cy="95" r="8"/>`, `<path d="M281 99 l8 -8"/>`, text(285, 120, "juster", { anchor: "middle", size: 10, muted: true }),
  ].join(""), `${p.mpn} mellom strømkilde og last`),
});
T.tp4056 = (p) => ({
  title: `${p.mpn}: lader for Li-ion`,
  caption: "USB eller 5 V inn, cellen på B+/B−, og det som skal ha strøm på OUT+/OUT−. Rød LED lyser under lading, blå/grønn når cellen er full.",
  svg: svg(560, 220, [
    text(20, 64, "5 V / USB", { weight: 600 }),
    `<line x1="100" y1="60" x2="196" y2="60" stroke="#d03b3b" stroke-width="2.6"/>`, `<line x1="100" y1="150" x2="196" y2="150" stroke-width="2.6"/>`,
    chip(210, 30, 150, 150, p.mpn, [["IN+", 60], ["IN−", 150]], [["B+", 60], ["B−", 90], ["OUT+", 125], ["OUT−", 155]]),
    `<line x1="374" y1="60" x2="440" y2="60" stroke="#d03b3b" stroke-width="2.6"/>`, `<line x1="374" y1="90" x2="440" y2="90" stroke-width="2.6"/>`,
    `<rect x="440" y="50" width="70" height="50" rx="8"/>`, text(475, 80, "18650", { anchor: "middle", size: 12, weight: 600 }),
    `<line x1="374" y1="125" x2="440" y2="125" stroke="#d03b3b" stroke-width="2.6"/>`, `<line x1="374" y1="155" x2="440" y2="155" stroke-width="2.6"/>`,
    text(450, 144, "Til kretsen", { size: 12, weight: 600 }),
  ].join(""), `${p.mpn} med celle og last`),
});
T.ws2812 = (p) => ({
  title: `${p.mpn}: adresserbare LED-er`,
  caption: "Strøm fra en egen 5 V-forsyning (ca. 60 mA per LED på full hvit), felles jord med mikrokontrolleren, og 330 Ω i serie på dataledningen. 1000 µF over strømmen tar opp strømstøt.",
  svg: svg(560, 230, [
    vcc(470, 26, "5 V forsyning"), wire([470, 26], [470, 60], [380, 60]), dot(430, 60), cap(430, 60, 160, "1000 µF", true),
    text(20, 104, "GPIO", { weight: 600 }), wire([60, 100], [90, 100]), res(90, 100, 200, 100, "330 Ω"), wire([200, 100], [366, 100]),
    chip(240, 40, 126, 140, p.mpn, [], [], { accent: true }), text(303, 84, "5V", { size: 10, anchor: "middle" }), text(303, 118, "DIN", { size: 10, anchor: "middle" }), text(303, 152, "GND", { size: 10, anchor: "middle" }),
    wire([366, 60], [380, 60]), wire([366, 160], [470, 160], [470, 180]), dot(430, 160), gnd(470, 180),
    text(20, 200, "Felles GND mellom forsyning og mikrokontroller", { size: 11, muted: true }),
  ].join(""), `${p.mpn} med motstand og kondensator`),
});
T.uln = (p) => ({
  title: `${p.mpn}: driver for releer og steppermotorer`,
  caption: "Hver inngang (IN1–IN7) styrer en utgang (OUT1–OUT7) som drar lasten til jord, opptil 500 mA per kanal. COM til lastens pluss gir innebygd flyback-beskyttelse. Vanlig for 28BYJ-48-steppermotor.",
  svg: svg(520, 230, [
    text(20, 84, "GPIO", { weight: 600 }), wire([60, 80], [170, 80]), text(120, 72, "IN1…", { size: 10, muted: true }),
    chip(184, 50, 140, 130, p.mpn, [["IN1", 80, "1"], ["GND", 160, "8"]], [["OUT1", 80, "16"], ["COM", 120, "9"]]),
    wire([170, 160], [150, 160], [150, 190]), gnd(150, 190),
    vcc(440, 26, "+5–12 V"), wire([440, 26], [440, 40]), load(440, 40, 80, ""), wire([338, 80], [440, 80]),
    wire([338, 120], [470, 120], [470, 34], [440, 34]), dot(440, 34),
  ].join(""), `${p.mpn} med last`),
});
T["spi-rc522"] = (p) => moduleWiring(p, rowsOf([["GPIO5", "SDA", "sig", "chip select"], ["GPIO18", "SCK", "sig", "SPI klokke"], ["GPIO23", "MOSI", "sig", "data ut"], ["GPIO19", "MISO", "sig", "data inn"], ["GPIO22", "RST", "sig", "reset"], ["GND", "GND", "gnd"], ["3V3", "3.3V", "pwr", "ikke 5 V"]]),
  `${p.mpn} RFID-leser (SPI)`, "Samme kobling som Filament og elektronikk universet-leseren. IRQ brukes ikke.");

// Komponenttyper uten delenummer: motstand, kondensator, LED, potmeter.
const GENERIC = [
  [/\bleds?\b(?!.*\b(strip|bulb|lamp|light|module|panel|matrix|ws281))/i, () => ({ mpn: "LED", kind: "led", pins: ["A (+)", "K (−)"], note: "Langt bein er anode (+). Flat kant på kanten er katoden." })],
  [/\b(1N4148)\b/i, null],
];

// ---------- Inngang ----------

// Alt detaljvinduet trenger: delenummer, datablad, pinner og koblingsskjema.
export function componentInfo(part) {
  const found = findPart(part.title, part.mpn) || (() => {
    for (const [re, make] of GENERIC) if (make && re.test(part.title)) return make();
    return null;
  })();
  const mpns = found ? [found.mpn] : candidateMpns(part.title, part.mpn);
  if (!found && !mpns.length) return null;
  const query = found?.mpn === "LED" ? "" : mpns[0];
  const circuit = found && T[found.kind] ? T[found.kind](found) : null;
  return {
    mpn: found?.mpn === "LED" ? "" : mpns[0] || "",
    others: found ? [] : mpns.slice(1),
    datasheets: query ? datasheetLinks(query) : [],
    pkg: found?.pkg || "",
    pins: found?.pins || [],
    note: found?.note || "",
    circuit,
  };
}

// HTML for detaljvinduet.
export function componentHtml(part) {
  const info = componentInfo(part);
  if (!info) return "";
  const pins = info.pins.length
    ? `<div class="pinout"><span class="hint">${info.pkg ? `${esc(info.pkg)}, pinner ${/^(DIP|SO|TSSOP|MSOP)/.test(info.pkg) ? "sett ovenfra, mot klokka fra pinne 1" : "sett forfra"}:` : "Pinner på modulen:"}</span>${info.pins.map((p, i) => `<span class="pin"><b>${i + 1}</b>${esc(p)}</span>`).join("")}</div>`
    : "";
  return `<section class="component-info">
    <h3>Datablad og kobling${info.mpn ? ` · <span class="mpn">${esc(info.mpn)}</span>` : ""}</h3>
    ${info.datasheets.length ? `<p class="ds-links">Datablad: ${info.datasheets.map((d) => `<a href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.label)} ↗</a>`).join(" · ")}${info.others.length ? ` <span class="hint">(fant også ${info.others.map(esc).join(", ")})</span>` : ""}</p>` : ""}
    ${pins}
    ${info.note ? `<p class="hint">${esc(info.note)}</p>` : ""}
    ${info.circuit ? `<figure class="schematic-fig"><figcaption><b>${esc(info.circuit.title)}</b></figcaption><div class="schematic-wrap">${info.circuit.svg}</div><figcaption>${esc(info.circuit.caption)}</figcaption></figure>` : ""}
  </section>`;
}

// ---------- Undergrupper for halvledere ----------
// Brukes som ekstra filter når kategorien «Halvledere» er valgt. Typen kommer fra delenummeret
// (findPart) når vi kjenner det, ellers fra ord i tittelen.
export const SEMI_TYPES = [
  ["bjt", "Transistorer"], ["mosfet", "MOSFET"], ["thyristor", "Tyristorer og triacer"], ["diode", "Dioder og broer"],
  ["reg", "Spenningsregulatorer"], ["opamp", "Op-amp og komparatorer"], ["logic", "Logikk og tellere"], ["timer", "Timere"],
  ["opto", "Optokoblere"], ["driver", "Drivere"], ["mcu", "Mikrokontrollere"], ["memory", "Minne og klokke"],
  ["iface", "USB og grensesnitt"], ["adapter", "Adaptere og sokler"], ["other", "Annet"],
];
const KIND_TYPE = {
  npn: "bjt", pnp: "bjt", nmos: "mosfet", pmos: "mosfet", scr: "thyristor", triac: "thyristor",
  diode: "diode", schottky: "diode", signaldiode: "diode", zener: "diode", bridge: "diode", led: "diode",
  reg78: "reg", reg1117: "reg", lm317: "reg", ldo: "reg", tl431: "reg", icl7660: "reg", buck: "reg", tp4056: "reg",
  opamp: "opamp", comparator: "opamp", lm386: "opamp", logic: "logic", hc595: "logic", schmitt: "logic", cd4017: "logic",
  ne555: "timer", opto: "opto", uln: "driver", max7219: "driver", usbserial: "iface", i2c: "memory",
  motordriver: "driver", stepper: "driver", tm16: "driver", rs485: "iface", can: "iface", hall: "other",
};
const TYPE_WORDS = [
  ["adapter", /adapter|\bto dip\d*|pinboard|zif|test socket|ic socket|\bclamp\b|transfer board/i],
  ["thyristor", /\b(thyristor|scr|triac|silicon controlled)\b/i],
  ["opto", /optocoupler|optoisolator|photocoupler|\bopto\b/i],
  ["mosfet", /mosfet|\b[np]-?ch(annel)?\b|\b(si4\d{3}\w*|si2\d{3}\w*|fd[cnsm]\d{3}\w*|ao[34]\d{3}\w*|irf\w*\d\w*|irl\w*\d\w*|f4905\w*)/i],
  ["bjt", /transistor|darlington|\b(npn|pnp)\b/i],
  ["diode", /diode|rectifier|zener|schottky|\btvs\b|\bsd103\w*/i],
  ["reg", /regulator|\bldo\b|voltage (reference|detector)|charge pump|dc-dc|buck|boost converter|charger ic|power management|\b(tps7\d+\w*|spx\d{4}\w*|cn30\d\d\w*|ip53\d\d\w*|ap30\d\d\w*|tps38\d\d\w*)/i],
  ["opamp", /op ?amps?\b|operational amplifier|comparator|audio amplifier|amplifier ic/i],
  ["timer", /\btimer\b|\btpl5\d{3}/i],
  ["logic", /\b(74(hc|hct|ls|ac)\d+|cd4\d{3}|hef4\d{3})|logic|counter|flip-?flop|shift register|multiplexer|decoder|schmitt|gate\b/i],
  ["mcu", /\b(atmega\d*|attiny\d*|stm32\w*|esp32\w*|esp8266\w*|pic1[0-8]\w*|ch32v\w*|rp2040|microcontroller|mcu)\b/i],
  ["memory", /eeprom|flash|sram|memory|\bw25q\w*|\b24c\d+|real ?time clock|\brtc\b|\b24lc\d+/i],
  ["driver", /driver|\bdrv\d+|\ba4988\b|\btmc\d+|led display|tm16\d\d|\blm391[456]|\bl293\w*|\bl298\w*|\bsn754410\w*|\btc44\d\d\w*|\btlc59\d\d\w*|half-h/i],
  ["iface", /\busb\b|uart|rs-?485|rs-?232|\bcan\b transceiver|ethernet|hub|level shift|\btxs01\d\d|\bgl8\d\d/i],
];
const semiCache = new Map();
export function semiType(part) {
  const key = `${part.mpn || ""}|${part.title}`;
  if (semiCache.has(key)) return semiCache.get(key);
  const f = findPart(part.title, part.mpn);
  const t = (f && KIND_TYPE[f.kind]) || TYPE_WORDS.find(([, re]) => re.test(`${part.mpn || ""} ${part.title}`))?.[0] || "other";
  semiCache.set(key, t);
  return t;
}
