-- Powtórki: zapis sterowania biegu (porcje encodeInputs, tak jak przyszły od gracza).
-- Zostają tylko porcje biegów, które są czyimś najlepszym wynikiem w którymś okresie (tabela bests) –
-- resztę usuwa zatwierdzenie biegu i dobowe sprzątanie.
CREATE TABLE run_chunks (
  run_id TEXT NOT NULL,
  seq    INTEGER NOT NULL,
  data   BLOB NOT NULL,
  PRIMARY KEY (run_id, seq)
) WITHOUT ROWID;
CREATE INDEX bests_run ON bests(run_id);
