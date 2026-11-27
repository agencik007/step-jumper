-- Pokoje znajomych: grupa graczy z własnym rankingiem. Dołącza się nazwą i hasłem; gracz jest najwyżej w jednym pokoju.
-- Ranking pokoju nie ma osobnych wyników – to ranking z tabeli bests ograniczony do członków pokoju.
CREATE TABLE rooms (
  id          TEXT PRIMARY KEY,                        -- UUID
  name        TEXT NOT NULL,                           -- nazwa tak, jak ją wpisał twórca
  name_key    TEXT NOT NULL UNIQUE,                    -- nazwa po normalizacji (małe litery) – pilnuje unikalności
  pass_salt   TEXT NOT NULL,                           -- sól (hex) skrótu hasła
  pass_hash   TEXT NOT NULL,                           -- PBKDF2-SHA256 hasła (hex); samego hasła serwer nie zna
  fail_window INTEGER NOT NULL DEFAULT 0,              -- limit błędnych haseł: numer bieżącego okna czasu
  fail_count  INTEGER NOT NULL DEFAULT 0,              --   i liczba błędnych prób w tym oknie
  created_at  INTEGER NOT NULL
);
ALTER TABLE players ADD COLUMN room_id TEXT REFERENCES rooms(id) ON DELETE SET NULL;
CREATE INDEX players_room ON players(room_id);
