-- Wyścigi w pokojach znajomych: kilka minut na tej samej wieży (to samo ziarno dla wszystkich), wygrywa więcej punktów.
-- Biegi z wyścigu to zwykłe wiersze runs z mode = 'match' – weryfikacja ta sama, ale nie trafiają do rankingu (bests).
CREATE TABLE matches (
  id          TEXT PRIMARY KEY,                        -- UUID
  room_id     TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL DEFAULT 'race',            -- 'race' – wyścig na czas
  scoring     TEXT NOT NULL,                           -- 'best' – najlepszy bieg, 'sum' – suma biegów
  seed        INTEGER NOT NULL,                        -- wieża wyścigu
  sim_version INTEGER NOT NULL,
  minutes     INTEGER NOT NULL,
  created_by  TEXT NOT NULL,                           -- gracz, który założył wyścig
  starts_at   INTEGER NOT NULL,                        -- koniec odliczania (ms od epoki)
  ends_at     INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX matches_room ON matches(room_id, ends_at);

ALTER TABLE runs ADD COLUMN match_id TEXT;             -- wyścig, z którego jest bieg (mode = 'match')
ALTER TABLE runs ADD COLUMN max_ticks INTEGER;         -- najwięcej kroków: tyle, ile zostało do końca wyścigu przy wydaniu biletu
CREATE INDEX runs_match ON runs(match_id) WHERE match_id IS NOT NULL;

-- Ostateczna tabela wyścigu, zapisywana raz, gdy minie czas na wysłanie ostatnich biegów.
CREATE TABLE match_results (
  match_id  TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL,
  place     INTEGER NOT NULL,
  score     INTEGER NOT NULL,
  runs      INTEGER NOT NULL,
  floor     INTEGER NOT NULL,
  combo     INTEGER NOT NULL,
  PRIMARY KEY (match_id, player_id)
) WITHOUT ROWID;
