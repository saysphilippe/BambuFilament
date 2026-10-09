// Kategorier for komponentbiblioteket og automatisk klassifisering ut fra tittel (og variant,
// og butikkens egen kategori når den finnes).
//
// AliExpress-titler er fulle av søkeord («… for Arduino ESP32 Raspberry Pi DIY Kit»), så første
// treff gir ofte feil. I stedet får hver kategori poeng for nøkkelordene den har, og ord tidlig i
// tittelen teller mer (det første substantivet sier som regel hva varen er). «For Arduino» og
// lignende fjernes først, så en skjerm for ESP32 ikke blir en mikrokontroller.

// [id, navn, [[mønster, vekt], …]]. Rekkefølgen avgjør bare ved lik poengsum.
export const CATEGORIES = [
  ["display", "Skjermer", [
    [/\b(oled|lcd|tft|ips (display|screen|lcd)|e-?paper|e-?ink|epaper|lcm)\b/, 6], [/\b(display|screen) (module|panel)\b|\b(lcd|oled|tft|led) (display|screen)\b/, 4],
    [/\b(ssd1306|sh1106|ssd1309|st7735|st7789|st7796|ili9341|ili9488|gc9a01|max7219|tm1637|hd44780|lcd1602|lcd2004|1602|2004|12864)\b/, 6],
    [/\b(7|seven)[- ]?segment\b|\bdot matrix\b|\bled matrix\b|\bnixie\b/, 5],
  ]],
  ["mcu", "Mikrokontrollere og utviklingskort", [
    [/\b(esp32(-?[a-z0-9]+)?|esp8266|esp-?01s?|esp-?12[ef]?|esp-?wroom-?\d*|nodemcu|wemos|d1 mini|lolin\w*)\b/, 6], [/\b(arduino (uno|nano|mega|pro|leonardo|micro|due)|uno r[34]|nano v3|mega ?2560|pro micro|pro mini|atmega\d+\w*|attiny\d+\w*|digispark)\b/, 6],
    [/\b(raspberry pi( pico| zero| [345])?|rp2040|rp2350|pico w?|stm32\w*|blue ?pill|black ?pill|nrf52\w*|xiao|teensy|ch32v\w*|lilygo|t-display|m5stack|atom ?s3)\b/, 6],
    [/\b(development board|dev ?board|core board|microcontroller|minimum system|usbasp|usbisp|avr programmer|st-?link|programmer)\b/, 4],
  ]],
  ["sensor", "Sensorer", [
    [/\bsensors?\b/, 5], [/\b(thermistor|thermocouple|ntc ?\d+k?|pt100|pt1000|max6675|max31855|max31865|ds18b20|dht\d+|am2302|aht\d+|sht\d+|shtc3|bme\d+|bmp\d+|hdc\d+|lm75a?|tmp\d+)\b/, 6],
    [/\b(accelerometer|gyro\w*|mpu-?\d+|adxl\d+|imu|magnetometer|hmc5883|qmc5883|hall effect)\b/, 5], [/\b(ultrasonic|hc-?sr0\d|rcwl-?\d+|pir|radar|ld2410|mmwave|lidar|vl53l\dx?|vl6180|gp2y\w+)\b/, 6],
    [/\b(load cell|hx711|strain gauge|current sensor|acs712\w*|ina2\d\d|ldr|photoresistors?|light dependent|bh1750|gas sensor|mq-?\d+|co2 sensor|scd\d+|ens160|soil moisture|water level|rain sensor|flame sensor|gps|gnss|neo-?6m|neo-?m8|atgm336|rfid|rc522|pn532|nfc (reader|tag|card)s?|ntag\d+)\b/, 6],
    [/\b(detector|probe|temperature|humidity|moisture|pressure|motion|hygrometer)\b/, 2],
  ]],
  ["wireless", "Trådløst og smarthjem", [
    [/\b(zigbee|tuya|smart life|z-?wave|matter|home ?assistant|z2m|zha|sonoff)\b/, 6], [/\b(lora(wan)?|sx127\d|sx126\d|e19|e22|nrf24l01\+?|cc1101|433 ?mhz|315 ?mhz|868 ?mhz|915 ?mhz|rf (module|transmitter|receiver|remote)|hc-?0[56]|bluetooth module|ble module|wifi module|rfm9\d\w*|sim800\w*|sim7\d\d\w*|gsm|gprs|4g lte|nb-?iot)\b/, 6],
    [/\b(smart (plug|switch|socket|bulb|home)|wifi switch|wireless switch|remote control|gateway|repeater|range extender)\b/, 4], [/\b(antennas?|ipex|u\.?fl)\b/, 4],
  ]],
  ["module", "Moduler og kort", [
    [/\bmodules?\b|\bboard\b|\bbreakout\b|\bshield\b|\bhat\b/, 2],
    [/\b(relays?|ssr|solid state relay|mosfet (module|board)|motor driver|stepper driver|a4988|drv8825|tmc2\d{3}|l298n|l9110|tb6612|uln2003 driver|pca9685|level shifter|logic level|level converter|dac module|adc module|ads1115|rtc module|real time clock|ds3231|ds1307|(micro ?)?sd card module|usb to (ttl|serial|uart|232)|ttl|ft232\w*|cp2102|pl2303|i2c expander|pcf8574 module|multiplexer|mp3 (decoder|player) (module|board)|dfplayer)\b/, 6],
    [/\b(buck|boost|booster|step[- ]?(up|down)|dc-?dc|lm2596|mp1584|xl4015|xl6009|mt3608|lm2577)\b/, 3],
  ]],
  ["semi", "Halvledere", [
    [/\b(transistors?|mosfets?|igbt|darlington|thyristors?|triac|scr)\b/, 6], [/\b(diodes?|zener|schottky|rectifiers?|bridge rectifier|tvs)\b/, 5],
    [/\b(\dn\d{4}a?|bc[58]\d\d[a-c]?|s80[0-9]{2}|s90[0-9]{2}|ss8050|2sc\d+|2sa\d+|tip1\d\d|tip[34]\d[a-c]?|irf\w+|irl\w+|ao3\d{3}|si23\d\d|si4\d{3}|bs170|2n700\d|mmbt\w+|1n4\d{3}|1n58\d\d|ss[1-5]4)\b/, 6],
    [/\b(ic|ics|chip|chips|integrated circuits?|op-?amp|opamp|comparator|regulator|ldo|ams1117\S*|lm\d{3,4}\w*|ne555|na555|74hc\d+\w*|74ls\d+|sn74\w+|cd4\d{3}\w*|uln2[08]03\w*|max\d{3,5}\w*|pcf\d+\w*|ch340\w*|cp210\d|optocouplers?|pc817\w*|el817|eeprom|at24c\d+|w25q\d+|tl431|tl0[78]\d\w*|lm358|lm393|l78\d\d|78\d\d|79\d\d|mt\d{4}\w*|cn\d{4}\w*|tm16\d\d\w*|tp\d{4}\w*|tps\d{4,6}\w*|tlv\d+\w*|ap\d{4}\w*|xc6206\w*|ht7\d{3}\w*|ms\d{4}\w*)\b/, 4],
    [/\b(sop|ssop|tssop|msop|soic|sot|qfn|qfp|lqfp|dip|to-?92|to-?220|to-?252|to-?263|sod)-?\d*\b|\bsma\b|\bsmb\b/, 2],
  ]],
  ["passive", "Passive komponenter", [
    [/\b(resistors?|resistance|ohms?|ω)\b/, 6], [/\b(capacitors?|electrolytic|ceramic cap\w*|tantalum|supercap\w*|farad|[0-9.]+ ?(uf|nf|pf|µf))\b/, 6],
    [/\b(inductors?|chokes?|ferrite|power inductor|[0-9.]+ ?(uh|mh|µh))\b/, 5], [/\b(crystal|oscillator|resonator)\b/, 5],
    [/\b(fuses?|ptc|polyfuse|varistor|thermal fuse)\b/, 5], [/\b(potentiometers?|trimmer|trimpot|rheostat)\b/, 5],
    [/\b(0201|0402|0603|0805|1206|1210|2512)\b/, 2], [/\bassortment\b|\bassorted\b/, 1],
  ]],
  ["switch", "Brytere og knapper", [
    [/\b(tactile|push ?buttons?|pushbutton|button switch|micro ?switch|limit switch|reed switch|toggle (slide )?switch|rocker switch|slide switch|dip switch|tact switch|key switch|keycaps?|rotary encoder|encoders?|joystick|keypad|membrane switch|foot switch|emergency stop|knob caps?|potentiometer knobs?|button caps?|switch caps?|key ?caps?|cap for (tactile|button|switch))\b/, 6],
    [/\bswitch(es)?\b|\bbuttons?\b|\bknobs?\b/, 3],
  ]],
  ["led", "LED og lys", [
    [/\b(leds?|cob|smd led|ws281\d\w*|sk6812|neopixel|apa102|rgbw?|light strip|led strip|neon|lamp beads?)\b/, 5],
    [/\b(lamps?|lights?|lighting|bulbs?|edison|lantern|flashlight|torch|spotlight|headlamp|night light|fairy lights?|string lights?|light bar|downlight|panel light|grow light)\b/, 5],
    [/\bled filament|filament bulb|filament led|cob filament\b/, 8],
  ]],
  ["power", "Strøm og batterier", [
    [/\b(batter(y|ies)|18650|21700|14500|lipo|li-?ion|lifepo4|nimh|ni-?mh|cr2032|cr\d{4}|battery holder|battery box|battery case|spot weld\w*|nickel strip)\b/, 6],
    [/\b(chargers?|charging (station|dock|pad|board|module)|power supply|power adapter|psu|power bank|ac adapter|transformer|inverter|ups|solar panel|solar cell|wireless charger|magsafe|balancer|balance board|bms)\b/, 6],
    [/\b(buck|boost|booster|step[- ]?(up|down)|dc-?dc|voltage regulator module|tp4056)\b/, 4],
  ]],
  ["cable", "Kabler", [
    [/\b(cables?|cords?|wires?|wiring|awg|silicone wire|extension cord|power cord|jumper wires?|dupont wires?|ribbon cable|flat cable|ffc|fpc cable|coaxial|patch cable|hdmi cable|usb cable|type-?c cable|data cable|charging cable)\b/, 6],
    [/\b(heat ?shrink|shrink tub\w*|cable sleev\w*|braided sleev\w*|spiral wrap|cable ties?|zip ties?|cable clips?|cable organi[sz]er|cable management|cable manager|velcro)\b/, 5],
  ]],
  ["connector", "Kontakter og terminaler", [
    [/\b(connectors?|terminals?|terminal blocks?|pin headers?|pinheader|female headers?|header (pins?|strip)|ic sockets?|jst|xh2\.54|ph2\.0|dupont (connector|housing|head)|crimp\w*|banana (plug|jack|socket)|xt60|xt30|xt90|ec5|dc jack|dc plug|dc power (plug|jack|socket)|barrel jack|audio (jack|socket)|rca|bnc|sma connector|usb (socket|port|connector|jack|plug)|type-?c (socket|port|connector|female|jack)|wago|lever connector|spade|ring terminal|butt connector|splice|pogo pins?|test probe|spring probe|card (socket|slot)|sd card (socket|slot))\b/, 6],
    [/\b(plugs?|sockets?|jacks?|adapters?|otg|male to female)\b/, 2], [/\b2\.54 ?mm\b|\b2\.0 ?mm pitch\b|\bpitch\b/, 2],
  ]],
  ["proto", "Prototyping og bokser", [
    [/\b(breadboards?|bread board|perfboard|stripboard|prototype (pcb|board)|pcb (board|prototype)|universal (pcb|board)|double sided pcb|project box|enclosure|junction box|instrument case|electronic(s)? project box)\b/, 7],
    [/\b(electronic kit|soldering (practice|kit)|diy (electronic|kit)|learning kit|starter kit)\b/, 5],
  ]],
  ["audio", "Lyd", [
    [/\b(speakers?|loudspeakers?|buzzers?|piezo|microphones?|mems mic\w*|inmp441|amplifiers?|amp board|class d|pam8403|tpa3116|max98357\w*|headphones?|headset|earphones?|earbuds|mp3 decoder)\b/, 5], [/\baudio\b/, 2],
  ]],
  ["motor", "Motorer, pumper og vifter", [
    [/\b(motors?|stepper|nema ?\d+|28byj|servos?|sg90|mg90s?|mg996r|brushless|bldc|esc|gear ?motor|pumps?|water pump|air pump|peristaltic|fans?|blower|solenoids?|actuators?)\b/, 6],
    [/\bvibration motor|vibrating motor\b/, 8],
  ]],
  ["mech", "Mekanikk", [
    [/\b(bearings?|linear rail|linear guide|lead screw|ball screw|t8 (screw|nut)|shafts?|rods?|couplings?|couplers?|pulleys?|timing belt|gt2|belts?|gears?|sprockets?|v-?slot|2020 profile|aluminium profile|aluminum profile|extrusion|hinges?|slide rails?|drawer slides?|wheels?|casters?|springs?|gas spring|handles?)\b/, 5],
  ]],
  ["3dprint", "3D-print", [
    [/\b(3d print\w*|3d printer|bambu ?lab|bambulab|prusa|ender|creality|voron|anycubic|elegoo|sovol|klipper|marlin|reprap|kingroon)\b/, 6],
    [/\b(nozzles?|hotend|hot end|extruder|heat ?bed|build plate|pei sheet|bowden|ptfe tube|pc4-?m\d+|bltouch|cr touch|volcano|e3d|heater block|endstop|run-?out sensor)\b/, 4],
    [/\b(pla|petg|abs|asa|tpu|pa-?cf|pla\+?) filament\b|\bfilament (pla|petg|abs|1\.75)\b|\b1\.75 ?mm\b/, 6],
  ]],
  ["fastener", "Festemidler, tape og lim", [
    [/\b(screws?|bolts?|nuts?|washers?|rivets?|standoffs?|spacers?|heat set inserts?|threaded inserts?|inserts?|anchors?|staples|fasteners?|t-?nuts?|wing nuts?|hex socket|countersunk|self[- ]tapping|grub screws?|set screws?|clamps?|clips?|hooks?|pegs?)\b/, 5],
    [/\b(nails?)\b/, 3],
    [/\b(tape|adhesive|glue|epoxy|double[- ]sided|kapton|polyimide|sealant|super glue|cyanoacrylate|thread seal|ptfe tape|putty|magnets?|neodymium)\b/, 4],
  ]],
  ["tool", "Verktøy", [
    [/\b(tools?|toolkit|tool set|pliers?|nippers|screwdrivers?|wrench|spanner|socket set|ratchet|hex keys?|allen keys?|tweezers?|knife|knives|cutters?|scissors|saws?|hacksaw|rasp|chisel|caliper|micrometer|ruler|tape measure|spirit level|angle (finder|detector|gauge)|multimeter|tester|oscilloscope|logic analy[sz]er|clamp meter|magnifier|magnifying)\b/, 5],
    [/\b(soldering|solder|flux|desoldering|hot air|heat gun|glue gun|rework|helping hands?|pcb holder|vise|vice|drill bits?|drills?|router bits?|end mills?|milling cutter|collet|rotary tool|dremel|grinder|sander|sandpaper|polishing|deburr\w*|tap and die|crimping tool|wire stripper|stripping|wire wrap|welder|welding|stapler|staple gun|nail gun|airbrush)\b/, 5],
    [/\bsolder (wire|paste|powder)\b/, 8],
    [/\b(safety (goggles|glasses|gloves)|protective (glasses|goggles|eyewear)|laser (safety )?goggles|cut resistant gloves|anti-?static (bags?|wrist|mat)|esd (bags?|mat|wrist))\b/, 9],
  ]],
  ["craft", "Hobby og håndverk", [
    [/\b(craft\w*|hobby|paint\w*|brush(es)?|acrylic paint|watercolou?r|pigments?|mica powder|resin|uv resin|epoxy resin|molds?|moulds?|silicone mold|glitter|stickers?|decals?|vinyl|htv|heat transfer|transfer paper|sewing|needles?|yarn|knitting|embroider\w*|stamps?|scrapbook\w*|acrylic (sheet|board|plate)|plexiglass|pmma|acetate|foam|leather|labels?|label printer|niimbot|price tags?|gift tags?|kraft paper)\b/, 5],
  ]],
  ["laser", "Laser og treverk", [
    [/\b(laser (engrav\w*|cutt\w*|module|head|tube|lens|mirror|machine|diode|power supply|goggles)|engravers?|engraving machine|co2 laser|k40|xtool|atomstack|sculpfun|ortur|neje|daja|focus(ing)? lens|znse|meniscus lens|reflect(ive|ion) mirrors?|mo mirrors?|si mirrors?|air assist|honeycomb (bed|panel|table|working)|laser bed)\b/, 7],
    [/\b(veneers?|plywood|basswood|balsa|mdf|hardboard|walnut|cherry wood|teak|linden|birch ply\w*|wood (sheets?|veneer|board|boards|blanks|panels?|slices?|chips?)|wooden (sheets?|boards?|blanks|panels?|slices?)|unfinished wood|marquetry|inlay)\b/, 7],
    [/\blaser\b/, 2],
  ]],
  ["house", "Husholdning", [
    [/\b(kitchen|cooking|bathroom|shower|toilet|towels?|bath|cleaning|cleaner|mop|broom|dish(es)?|sponges?|scrub\w*|laundry|hangers?|trash|garbage|vacuum|hepa|sink|faucet|curtains?|bedding|pillows?|blankets?|carpet|rugs?|doormat|furniture|shelf|storage box|organi[sz]er|air fryer|coffee|tea|mug|cup|bottle|lunch box|refrigerator|fridge|knife sharpener|household|home decor\w*|vase|planter|plant pot|plant (support|stakes?|cage|clips?)|watering|corkscrew|wine opener|food cover|saran wrap|cling film|zip ?lock|ziplock|fresh-?keeping|mosquito|insect|pest|window screen|door screen|net screen)\b/, 4],
    [/\bfelt (pads?|furniture|chair)\b|\bfurniture pads?\b|\bfloor protectors?\b|\bchair leg\b|\bmosquito net\b/, 8],
  ]],
  ["computer", "Data og mobil", [
    [/\b(phone|iphone|samsung galaxy|smartphone|tablet|ipad|laptop|notebook|keyboard|mouse|mice|usb hub|docking station|card reader|sd cards?|micro ?sd cards?|tf cards?|memory cards?|flash drive|ssd|nvme|hard drive|hdd|webcam|monitor|screen protector|phone case|phone holder|phone stand|phone pouch|smart ?watch|watch strap|router|network switch|ethernet)\b/, 5],
  ]],
  ["outdoor", "Bil, sykkel og friluft", [
    [/\b(camping|outdoor|hiking|picnic|tent|backpacking|survival|fishing|kayak|bike|bicycle|cycling|mtb|car|vehicle|motorcycle|scooter|garden|lawn|dog|pets?|leash|campfire|bbq|grill|stove)\b/, 5],
    [/\b(titanium cup|camping (lamp|light|table|stove)|tent pegs?|carabiner|paracord)\b/, 8],
  ]],
  ["clothes", "Klær, skjønnhet og tilbehør", [
    [/\b(shirts?|t-?shirts?|hoodie|jackets?|vest|pants|trousers|socks?|shoes?|sneakers|boots|hats?|(baseball|sun|knit|winter|trucker|snapback) caps?|beanie|gloves?|scarf|underwear|raincoat|poncho|(shoulder|waist|hand|tote|messenger|crossbody) bags?|backpack|wallet|purse|belt|jewel\w*|necklace|bracelet|earrings?|sunglasses|glasses|eyewear|makeup|cosmetic\w*|eyeshadow|lipstick|hair|wig|skin ?care|acne|blackhead|pimple|perfume|ear ?wax)\b/, 5],
    [/\b(nail (art|polish|dryer|gel|primer|lamp|drill|tips?|glue)|gel (polish|nail)|manicure|pedicure|uv gel)\b/, 9],
  ]],
  ["other", "Annet", []],
];

export const CAT_NAME = Object.fromEntries(CATEGORIES.map(([id, name]) => [id, name]));

// Fjerner «for Arduino …», «compatible with …» og lignende før klassifisering.
const NOISE = [
  /\bfor\s+(the\s+)?(arduino|raspberry\s?pi|esp32|esp8266|stm32|uno|nano|mega|pico|microbit|micro:bit|jetson|orange pi|banana pi|smart home|home assistant|avr|arm|pic|dsp)\b[^,;]*/g,
  /\b(compatible|works) with\b[^,;]*/g,
  /\b(diy|new|original|hot sale|free shipping|in stock|high quality|wholesale)\b/g,
];

function clean(text) {
  let t = ` ${String(text || "").toLowerCase().replace(/[_|/,()[\]{}+]+/g, " ")} `;
  for (const re of NOISE) t = t.replace(re, " ");
  return t.replace(/\s+/g, " ");
}

// Poeng per kategori. Treff tidlig i tittelen teller dobbelt, treff langt ute halvt.
export function scoreTitle(title, extra = "") {
  const t = clean(title);
  const x = clean(extra);
  const scores = {};
  for (const [id, , rules] of CATEGORIES) {
    let s = 0;
    for (const [re, w] of rules) {
      const r = new RegExp(re.source, "g");
      let m, first = true;
      while ((m = r.exec(t))) {
        s += w * (m.index < 32 ? 2 : m.index > 70 ? 0.5 : 1) * (first ? 1 : 0.25);
        first = false;
        if (m[0] === "") r.lastIndex++;
      }
      if (x && re.test(x)) s += w * 0.75;
    }
    if (s) scores[id] = s;
  }
  // Spesialregler der et ord betyr noe annet i sammenhengen.
  const no3d = !/\b3d\b/.test(t);
  if (scores["3dprint"] && no3d && /\b(led|cob|bulb|edison|lamp)\b/.test(t) && /filament/.test(t)) scores["3dprint"] = 0; // LED-filamentpære
  if (scores["3dprint"] && no3d && /\bprinter (cable|cord)|usb[- ]?b\b|scanner\b/.test(t)) scores["3dprint"] = 0; // skriverkabel
  if (scores.display && /\b(window|door|mosquito|net|insect)\b/.test(t) && !/\b(lcd|oled|tft)\b/.test(t)) scores.display = 0; // myggnetting
  if (scores.power && /\b(cables?|cords?)\b/.test(t) && /\bcharg/.test(t) && !/\bcharger (module|board)\b/.test(t)) scores.cable = (scores.cable || 0) + 6; // ladekabel
  if (/\b(knobs?|knob caps?|caps?)\b/.test(t) && /\bpotentiometer/.test(t)) { scores.passive = 0; scores.switch = (scores.switch || 0) + 8; } // knotter til potmeter
  if (/\b(servos?|motors?|stepper)\b/.test(t) && scores.mech) scores.mech /= 3; // «metal gear servo» er en motor
  if (/\bmotor (shield|driver|controller|drive board)\b/.test(t)) { scores.module = (scores.module || 0) + 8; scores.motor = (scores.motor || 0) / 3; }
  if (/\bpogo pins?|test probe|spring probe\b/.test(t)) scores.mech = 0;
  if (/\bjumper caps?\b|\bshunt\b/.test(t)) { scores.clothes = 0; scores.connector = (scores.connector || 0) + 10; }
  if (/\b(standoffs?|spacers?|pillars?)\b/.test(t)) scores.proto = (scores.proto || 0) / 3; // avstandsstykker er festemidler
  if (/\bbelts?\b/.test(t) && !/\b(timing|gt2|drive|conveyor) belts?\b/.test(t)) scores.mech = (scores.mech || 0) / 3;
  if (/\b(rangefinder|range finder|distance meter|tape measure|laser level|laser pointer)\b/.test(t)) { scores.laser = 0; scores.tool = (scores.tool || 0) + 10; }
  if (/\b(touch|sensor|switch)\b/.test(t) && !/\b(laser|veneer|plywood|basswood)\b/.test(t)) scores.laser = 0; // «touch switch for wood board»
  if (/\bcnc\b/.test(t) && !/\blaser\b/.test(t)) scores.laser = (scores.laser || 0) / 3; // CNC-fres, ikke laser
  if (/\blaser\b/.test(t) && /\b(acrylic|pmma|plexiglass|acetate)\b/.test(t)) scores.laser = (scores.laser || 0) + 8; // akryl til laserkutting
  return scores;
}

export function classify(title, extra = "") {
  const scores = scoreTitle(title, extra);
  let best = "other", top = 0;
  for (const [id] of CATEGORIES) if ((scores[id] || 0) > top) { top = scores[id]; best = id; }
  return best;
}
