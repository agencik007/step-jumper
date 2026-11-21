# Serwer rankingu

Cloudflare Worker (Hono) + baza D1. Gra nie wysyła wyniku, tylko zapis sterowania; serwer odtwarza bieg tą samą
symulacją (`src/sim/`) i sam wylicza wynik.

## Uruchomienie

```
npm run server:migrate     # tworzy tabele w lokalnej bazie (server/.wrangler/)
npm run server:dev         # API na http://localhost:8787, bez konta Cloudflare
npm test                   # testy, w tym API na lokalnej bazie D1 w pamięci

SMOKE_URL=http://localhost:8787 npx vitest run tests/server/smoke   # pełna ścieżka na działającym serwerze
```

Wdrożenie (jednorazowo):

1. `npx wrangler login`
2. `npx wrangler d1 create step-jumper` i wpisanie zwróconego `database_id` do `wrangler.jsonc`
3. `npm run server:deploy` – migracje na zdalnej bazie + wdrożenie Workera
4. dopisanie adresu demo web do `ALLOWED_ORIGINS` w `wrangler.jsonc`

Po wdrożeniu `SMOKE_URL=https://… npx vitest run tests/server/smoke` sprawdza całą ścieżkę i sprząta po sobie.

Potem serwer wdraża się sam: `.github/workflows/deploy-server.yml` po każdym scaleniu do `main`, które zmienia
`server/`, `src/sim/` albo zależności (testy → migracje → wdrożenie → test `smoke`). Wymaga sekretów repozytorium
`CLOUDFLARE_API_TOKEN` (uprawnienia „Workers Scripts: Edit” i „D1: Edit”) i `CLOUDFLARE_ACCOUNT_ID`.
Ręcznie: zakładka Actions → „Wdrożenie serwera rankingu” → Run workflow.

Gra (Vercel) i serwer wdrażają się niezależnie, więc przez chwilę mogą mieć różne `SIM_VERSION`. Gra nowsza od
serwera pokazuje wtedy „serwer rankingu jest aktualizowany” i co minutę sprawdza, czy serwer już ją dogonił.

## API

Uwierzytelnianie: `Authorization: Bearer <playerId>.<sekret>` (token z `POST /v1/players`). Błędy mają postać `{ "error": "kod" }`.

| Metoda i ścieżka | Opis | Odpowiedź |
|---|---|---|
| `POST /v1/players` `{platform: "android"\|"web"}` | anonimowe konto urządzenia; limit 10/min na IP | `201 {playerId, token}` |
| `GET /v1/me` | moje konto | `{playerId, nick, createdAt}` |
| `PATCH /v1/me` `{nick}` | nick 3–16 znaków, unikalny bez względu na wielkość liter | `{nick}` · `400 nick_length/nick_chars/nick_blocked` · `409 nick_taken` |
| `DELETE /v1/me` | usuwa konto, biegi i wyniki | `204` |
| `POST /v1/runs` `{simVersion}` | bilet: ziarno wieży; maks. 180/h, nadmiar ponad 5 niewykorzystanych przepada | `201 {runId, seed, simVersion, chunkTicks}` · `409 update_required` · `403 banned` · `429 too_many_runs` |
| `PUT /v1/runs/:id/chunks/:seq` (binarnie, `encodeInputs`) | porcja zapisu: dokładnie `chunkTicks` kroków, krótsza tylko ostatnia (kończąca grę) | `{nextSeq, ticks, over}` · powtórka: `{nextSeq, duplicate: true}` · `409 seq` · `413` · `422 rejected` |
| `POST /v1/runs/:id/finish` `{score, char, style?, control?, appVersion?}` | zatwierdzenie | `{status: "verified", score, floor, combo, ticks, improved, ranks}` · `422 rejected` |
| `GET /v1/leaderboards/:okres?limit=50` | `all` / `week` / `day` / `lastweek` (zamknięty poprzedni tydzień), cache 30 s | `{period, entries: [{rank, nick, tag, score, floor, combo, char, country, replay?}]}` (bez nicku gra pokazuje „Gracz {tag}”; `replay` – identyfikator powtórki, tylko miejsca 1–3) |
| `GET /v1/leaderboards/:okres/me` | moje miejsce ± 5 sąsiadów | `{period, rank, entries: [... , me]}` |
| `GET /v1/replays/:id` | powtórka biegu z rankingu, cache 1 dzień | `{runId, seed, simVersion, ticks, score, floor, combo, char, style, nick, tag, finishedAt, chunks: [base64 encodeInputs]}` · `404` |

Powody odrzucenia biegu (`reason`): `corrupt`, `empty_chunk`, `chunk_too_long`, `short_chunk`, `inputs_after_end`,
`not_over`, `score_mismatch`, `too_fast` (bieg krótszy w czasie rzeczywistym niż liczba kroków / 120), `sim_version`, `too_long`.

Tydzień i dzień liczone są w UTC (tydzień ISO, od poniedziałku). Remis rozstrzyga wcześniejszy wynik.

Najlepsza trójka zamkniętego tygodnia (`lastweek`) dostaje w grze korony na cały następny tydzień – gra sprawdza swoje
miejsce przez `GET /v1/leaderboards/lastweek/me`.

Powtórki: przyjęte porcje zapisu trafiają do tabeli `run_chunks`. Zostają tylko dla biegów, które są czyimś najlepszym
wynikiem w którymś okresie (`bests`); zatwierdzenie biegu od razu usuwa porcje biegów gracza, które rekordem nie są.

## Koszt procesora

Darmowy plan Workers daje 10 ms CPU na zapytanie, a weryfikacja porcji to najdroższa część API. Na Cloudflare
porcja 6000 kroków kosztowała 4–15 ms CPU (lokalnie w Node ok. 1 ms – serwery liczą wolniej), dlatego porcja ma
2000 kroków. Pomiar: `npx wrangler tail step-jumper-api --format json` (pole `cpuTime`) podczas testu `smoke`.
`tests/server/cpu.test.ts` pilnuje tylko, żeby koszt lokalny nie urósł.

## Dane

Schemat: `migrations/`. Serwer nie zapisuje adresu IP (służy tylko jako klucz limitu) ani tokenu (tylko jego skrót
SHA-256). Cron raz na dobę (`src/cleanup.ts`) usuwa bilety starsze niż 7 dni, przerwane wysyłki starsze niż dzień,
biegi starsze niż 90 dni (poza biegami, które są czyimś rekordem – potrzebne do powtórek), rankingi tygodniowe i dzienne
starsze niż poprzedni okres oraz powtórki, które nie są już niczyim rekordem.
