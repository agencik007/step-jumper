-- Własne postacie (KREATOR w grze): paczka ZIP postaci z najlepszej trójki rankingu, do pobrania przez innych graczy.
-- Paczkę wskazuje skrót SHA-256 jej zawartości – ta sama postać ma zawsze ten sam identyfikator.
ALTER TABLE runs ADD COLUMN skin TEXT;                 -- skrót paczki postaci, którą rozegrano bieg (char_id = 'custom')
ALTER TABLE bests ADD COLUMN skin TEXT;
CREATE TABLE skins (
  hash       TEXT PRIMARY KEY,                         -- SHA-256 (hex) bajtów paczki
  player_id  TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  data       BLOB NOT NULL,                            -- plik ZIP (format: docs/POSTACIE.md)
  created_at INTEGER NOT NULL
);
CREATE INDEX bests_skin ON bests(skin);
