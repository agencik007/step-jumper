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
| `GET /v1/me` | moje konto | `{playerId, nick, createdAt, room: {name} \| null}` |
| `PATCH /v1/me` `{nick}` | nick 3–16 znaków, unikalny bez względu na wielkość liter | `{nick}` · `400 nick_length/nick_chars/nick_blocked` · `409 nick_taken` |
| `DELETE /v1/me` | usuwa konto, biegi i wyniki | `204` |
| `POST /v1/runs` `{simVersion}` | bilet: ziarno wieży; maks. 180/h, nadmiar ponad 5 niewykorzystanych przepada | `201 {runId, seed, simVersion, chunkTicks}` · `409 update_required` · `403 banned` · `429 too_many_runs` |
| `PUT /v1/runs/:id/chunks/:seq` (binarnie, `encodeInputs`) | porcja zapisu: dokładnie `chunkTicks` kroków, krótsza tylko ostatnia (kończąca grę) | `{nextSeq, ticks, over}` · powtórka: `{nextSeq, duplicate: true}` · `409 seq` · `413` · `422 rejected` |
| `POST /v1/runs/:id/finish` `{score, char, skin?, style?, control?, appVersion?}` | zatwierdzenie; `skin` – skrót SHA-256 paczki własnej postaci (tylko z `char: "custom"`) | `{status: "verified", score, floor, combo, ticks, improved, ranks, needSkin?}` (`needSkin` – bieg wszedł do trójki, a serwer nie ma tej paczki) · `422 rejected` |
| `GET /v1/leaderboards/:okres?limit=50` | `all` / `week` / `day` / `lastweek` (zamknięty poprzedni tydzień), cache 30 s | `{period, entries: [{rank, nick, tag, score, floor, combo, char, country, replay?, skin?}]}` (bez nicku gra pokazuje „Gracz {tag}”; `replay` – identyfikator powtórki, `skin` – skrót paczki własnej postaci, oba tylko miejsca 1–3) |
| `GET /v1/leaderboards/:okres/me` | moje miejsce ± 5 sąsiadów | `{period, rank, entries: [... , me]}` |
| `GET /v1/replays/:id` | powtórka biegu z rankingu, cache 1 dzień | `{runId, seed, simVersion, ticks, score, floor, combo, char, style, nick, tag, finishedAt, skin?, chunks: [base64 encodeInputs]}` · `404` |
| `PUT /v1/skins/:hash` (binarnie, ZIP do 1,5 MB) | paczka własnej postaci; tylko gdy skrót SHA-256 zgadza się z zawartością, a wynik gracza w rankingu jest rozegrany tą postacią | `201 {hash}` · `400 bad_skin/hash_mismatch` · `403 not_needed` · `413` |
| `GET /v1/skins/:hash` | pobranie paczki postaci (ZIP), cache na zawsze (zawartość pod skrótem się nie zmienia) | `200 application/zip` · `404` |
| `POST /v1/rooms` `{name, password}` | nowy pokój znajomych; nazwa 3–20 znaków (zasady jak nick), unikalna bez względu na wielkość liter, hasło 4–32 znaki; twórca od razu w środku (i poza poprzednim pokojem) | `201 {room: {name, members}}` · `400 room_length/room_chars/room_blocked/room_pass` · `409 room_taken` · `403 banned` |
| `POST /v1/rooms/join` `{name, password}` | dołączenie; gracz jest najwyżej w jednym pokoju, więc wychodzi z poprzedniego | `{room: {name, members}}` · `404 room_not_found` · `403 room_password` · `409 room_full` (50 graczy) · `429 room_locked` |
| `DELETE /v1/rooms/me` | wyjście z pokoju; pusty pokój znika i zwalnia nazwę | `204` |
| `GET /v1/rooms/me` | mój pokój i jego gracze | `{room: null}` · `{room: {name, members: [{nick, tag, me?}]}}` |
| `GET /v1/rooms/me/leaderboards/:okres` | ranking pokoju: te same najlepsze wyniki co w rankingu ogólnym, tylko graczy z pokoju (wszyscy) | `{period, room: {name}, rank, entries: [... , me?]}` · `404 no_room` |

Powody odrzucenia biegu (`reason`): `corrupt`, `empty_chunk`, `chunk_too_long`, `short_chunk`, `inputs_after_end`,
`not_over`, `score_mismatch`, `too_fast` (bieg krótszy w czasie rzeczywistym niż liczba kroków / 120), `sim_version`, `too_long`.

Tydzień i dzień liczone są w UTC (tydzień ISO, od poniedziałku). Remis rozstrzyga wcześniejszy wynik.

Najlepsza trójka zamkniętego tygodnia (`lastweek`) dostaje w grze korony na cały następny tydzień – gra sprawdza swoje
miejsce przez `GET /v1/leaderboards/lastweek/me`.

Własne postacie (KREATOR w grze, `docs/POSTACIE.md`): bieg postacią z kreatora ma `char: "custom"` i skrót paczki (`skin`).
Gdy wejdzie do najlepszej trójki któregoś okresu, serwer prosi o paczkę (`needSkin`), a gra wysyła ją `PUT /v1/skins/:hash`.
Serwer nie rozpakowuje paczki – sprawdza tylko nagłówek ZIP, rozmiar i skrót; obrazki sprawdza i koduje od nowa gra przy wczytaniu.
Paczki trzyma tabela `skins`; sprzątanie usuwa te, których nie używa już żaden wynik w `bests`.

Pokoje znajomych: tabela `rooms`, a członkostwo to kolumna `players.room_id` (jeden pokój naraz). Ranking pokoju nie ma
własnych wyników – to zapytanie o `bests` ograniczone do graczy pokoju, więc weryfikacja biegów i powtórki działają bez zmian.
Hasło: PBKDF2-SHA256 z solą (`auth.ts`). Przed zgadywaniem chroni limit: po 20 błędnych hasłach pokój nie przyjmuje
nikogo do końca 10-minutowego okna (`fail_window`, `fail_count`).

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
starsze niż poprzedni okres, powtórki, które nie są już niczyim rekordem, paczki postaci, których nie używa żaden wynik, oraz pokoje znajomych bez graczy.
