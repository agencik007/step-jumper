-- Rankingi Step Jumpera: gracze, biegi (bilety + weryfikacja) i najlepsze wyniki w okresach.

-- Anonimowe konto urządzenia. Token zna tylko urządzenie, serwer trzyma jego skrót SHA-256.
CREATE TABLE players (
  id           TEXT PRIMARY KEY,                       -- UUID
  token_hash   TEXT NOT NULL,
  nick         TEXT,                                   -- NULL, dopóki gracz nie wybierze nicku
  nick_key     TEXT UNIQUE,                            -- nick po normalizacji (małe litery, także polskie) – pilnuje unikalności
  platform     TEXT NOT NULL CHECK (platform IN ('android', 'web')),
  country      TEXT,                                   -- kod kraju z Cloudflare; adres IP nie jest zapisywany
  banned       INTEGER NOT NULL DEFAULT 0,
  ticket_hour  INTEGER NOT NULL DEFAULT 0,             -- limit biletów: numer bieżącej godziny (ms / 3 600 000)
  ticket_count INTEGER NOT NULL DEFAULT 0,             --   i liczba biletów wydanych w tej godzinie
  created_at   INTEGER NOT NULL,                       -- ms od epoki
  last_seen_at INTEGER NOT NULL
);

-- Bieg: najpierw bilet (ziarno wieży wydane przez serwer), potem zapis wejść wysyłany porcjami i weryfikowany.
CREATE TABLE runs (
  id            TEXT PRIMARY KEY,
  player_id     TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  mode          TEXT NOT NULL DEFAULT 'classic',
  seed          INTEGER NOT NULL,
  sim_version   INTEGER NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('issued', 'uploading', 'verified', 'rejected')),
  issued_at     INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  finished_at   INTEGER,
  next_seq      INTEGER NOT NULL DEFAULT 0,            -- numer porcji, na którą serwer czeka
  checkpoint    TEXT,                                  -- JSON stanu symulacji po ostatniej porcji
  ticks         INTEGER NOT NULL DEFAULT 0,            -- kroki zweryfikowane do tej pory
  score         INTEGER,
  floor         INTEGER,
  combo         INTEGER,
  char_id       TEXT,
  style_id      TEXT,
  control       TEXT,
  app_version   TEXT,
  reject_reason TEXT
);
CREATE INDEX runs_player ON runs(player_id, issued_at DESC);
CREATE INDEX runs_status ON runs(status, updated_at);

-- Najlepszy wynik gracza w danym okresie: 'all', tydzień ISO 'W:2026-47', dzień UTC 'D:2026-11-18'.
CREATE TABLE bests (
  period      TEXT NOT NULL,
  player_id   TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  score       INTEGER NOT NULL,
  floor       INTEGER NOT NULL,
  combo       INTEGER NOT NULL,
  char_id     TEXT NOT NULL,
  run_id      TEXT NOT NULL,
  achieved_at INTEGER NOT NULL,
  PRIMARY KEY (period, player_id)
) WITHOUT ROWID;
CREATE INDEX bests_rank ON bests(period, score DESC, achieved_at ASC);
