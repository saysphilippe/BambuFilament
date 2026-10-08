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
