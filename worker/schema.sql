-- Én generell tabell: samling + nøkkel -> JSON. Samlinger: spools, cards, settings, loans,
-- ams, library, wishes, logins, seen. Hver post skrives for seg, så samtidige endringer på
-- ulike poster ikke kolliderer.
CREATE TABLE IF NOT EXISTS records (
  coll    TEXT NOT NULL,
  id      TEXT NOT NULL,
  data    TEXT NOT NULL,
  updated TEXT NOT NULL,
  PRIMARY KEY (coll, id)
);

-- Bambu-butikken (skrives av GitHub Actions via Workeren, /store/ingest).
-- Produkt med varianter [navn, utsolgt, pris i euro] som JSON.
CREATE TABLE IF NOT EXISTS store_products (
  handle  TEXT PRIMARY KEY,
  data    TEXT NOT NULL,
  updated TEXT NOT NULL
);
-- Prishistorikk: én rad per endring per variant (euro).
CREATE TABLE IF NOT EXISTS price_history (
  handle  TEXT NOT NULL,
  variant TEXT NOT NULL,
  at      TEXT NOT NULL,
  price   REAL NOT NULL,
  PRIMARY KEY (handle, variant, at)
);
-- Metadata: kategorier, tidspunkt og eurokurs fra Norges Bank.
CREATE TABLE IF NOT EXISTS store_meta (
  key  TEXT PRIMARY KEY,
  data TEXT NOT NULL
);
