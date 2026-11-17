# Step Jumper — plan wydania: Google Play, backend z rankingami, wycena

## Kontekst

Step Jumper to dziś jedna strona (`index.html`, ~1470 linii: Canvas 2D, Web Audio, sterowanie klawiaturą / padem / dotykiem / przechyłem), PWA wdrażana na Vercel, repozytorium publiczne. Wyniki żyją tylko w `localStorage`. Cel: wydać grę w Google Play jako płatną, dodać rankingi online z własną bazą i wycenić całość.

Ustalone w rozmowie:

| Decyzja | Wybór |
|---|---|
| Cel | **Portfolio** — liczy się jakość, architektura i łatwość odpalenia gry |
| Model | **Płatna z góry, 3,99 zł** (bez reklam i zakupów w aplikacji) |
| Rankingi | **Własny backend**: Cloudflare Workers + D1 |
| Sprzedawca | **Osoba prywatna** (konto osobiste Google Play) |

Moje decyzje wynikające z powyższych (do zakwestionowania przy akceptacji):

- **Wersja web zostaje jako darmowe demo.** Portfolio wymaga, żeby grę dało się odpalić jednym kliknięciem; płatna jest pełna wersja na Androida. Demo: 2 postacie, 2 mapy, ranking tylko do podglądu, przycisk „Pełna wersja w Google Play”.
- **Repozytorium zostaje publiczne** (kod jest częścią portfolio), z plikiem `LICENSE` „wszelkie prawa zastrzeżone”. Bezpieczeństwo rankingu nie może więc polegać na ukrytym kodzie klienta — stąd weryfikacja po stronie serwera.
- **Hosting web przenoszę z Vercel na Cloudflare.** Plan Hobby Vercela jest tylko do użytku niekomercyjnego, a strona będzie promować płatną grę; poza tym backend i tak będzie na Cloudflare.
- **Tylko Android** w tym planie. Capacitor nie zamyka drogi do iOS.

## Wycena

### Cena

**3,99 zł to dobra cena** — najniższy typowy próg, odpowiednik 0,99 EUR / 0,99 USD / 0,89 GBP (ceny regionalne ustawiam ręcznie na te „okrągłe” kwoty zamiast przeliczenia automatycznego). Wyższa cena nie ma uzasadnienia przy grze na krótkie sesje od nieznanego autora; niższa nic nie da, bo barierą jest sama płatność, a nie kwota.

### Ile zostaje z jednej kopii (Polska)

| Pozycja | Kwota |
|---|---|
| Cena dla gracza | 3,99 zł |
| − VAT 23% (odprowadza Google) | 3,24 zł |
| − prowizja Google 15% (10% serwisowa + 5% rozliczeniowa) | **≈ 2,76 zł** |
| − PIT 12% (jeśli inne dochody zjadają kwotę wolną) | ≈ 2,43 zł |

Uwaga: od 30.06.2026 w EOG obowiązuje nowy cennik Google. Prasa branżowa podaje 15% łącznie dla pierwszego 1 mln USD rocznie; oficjalna tabela Google da się też odczytać jako 20% + 5%. **Do potwierdzenia w Play Console przy zakładaniu profilu płatności.** W wariancie 25% zostaje ≈ 2,43 zł przed PIT.

### Realistyczne przychody (pierwszy rok, bez budżetu reklamowego)

| Scenariusz | Kopie | Na rękę przed PIT |
|---|---|---|
| Pesymistyczny | 20–50 | 55–140 zł |
| Realistyczny | 100–300 | 280–830 zł |
| Optymistyczny (wyróżnienie, viral) | 1000+ | 2760 zł+ |

Płatne gry na Androidzie od nieznanych autorów sprzedają zwykle dziesiątki–setki kopii; opublikowane przypadki solo-deweloperów to np. 221 USD łącznie przy cenie 0,99 USD. Przy celu „portfolio” to jest w porządku — ale ranking będzie się zapełniał powoli, dlatego demo web pokazuje go publicznie.

### Koszty

| Pozycja | Koszt |
|---|---|
| Konto deweloperskie Google Play | 25 USD jednorazowo (≈ 95–100 zł) |
| Cloudflare (Workers, D1, hosting demo) | 0 zł w darmowym planie |
| Zapas: Workers Paid, gdyby weryfikacja nie mieściła się w limicie CPU | 5 USD/mies. — tylko jeśli pomiar w etapie 2 tego wymaga |
| Domena (opcjonalnie, dobrze wygląda w portfolio) | 40–60 zł/rok |
| Zakup gry przez testerów, jeśli kody promocyjne nie zadziałają w teście zamkniętym | do 12 × 3,99 zł ≈ 48 zł |

Razem w pierwszym roku: **ok. 100–200 zł**. Zwrot kosztów stałych przy ≈ 40–70 sprzedanych kopiach.

### Wartość pracy

Pozostała praca z tego planu to ok. **80–110 godzin**. Jako zlecenie zewnętrzne całość (istniejąca gra + ten plan) to rząd **12–24 tys. zł**. Wniosek uczciwie: finansowo to projekt hobbystyczny, jego wartość to działający produkt w sklepie plus pokazowa architektura (deterministyczna symulacja weryfikowana na serwerze).

## Technologie

| Warstwa | Wybór | Dlaczego |
|---|---|---|
| Gra | Obecny kod: vanilla JS + Canvas 2D, podzielony na moduły ES | Działa, nie ma powodu przepisywać na silnik |
| Build | Vite; nowy kod (symulacja, klient API, backend) w TypeScript | Jeden rdzeń symulacji importowany przez grę i serwer |
| Android | **Capacitor 8** (minSdk 24, target SDK 36) | Pakuje grę do AAB, działa offline, spełnia wymóg Google „API 36”; TWA odpada, bo płatna aplikacja nie może być publiczną stroną w ramce |
| Wtyczki | `preferences`, `haptics`, `app` (przycisk Wstecz → pauza), `keep-awake`, `splash-screen` | Zamienniki `localStorage` i `wakeLock`, wibracje |
| Backend | Cloudflare Workers + router Hono, TypeScript | Ten sam silnik JS (V8) co WebView Androida — warunek identycznych wyników symulacji |
| Baza | Cloudflare D1 (SQLite), migracje SQL w repo | Darmowy limit: 5 mln odczytów i 100 tys. zapisów wierszy dziennie, nie usypia |
| Testy | Vitest + `@cloudflare/vitest-pool-workers` | Testy symulacji i API na lokalnym D1 |
| CI | GitHub Actions: testy, typecheck, deploy Workera i demo | Publiczne repo = darmowe minuty |

Docelowy układ repo: `src/sim/` (rdzeń), `src/game/` (render, audio, wejście, ekrany), `src/platform/` (web / Capacitor), `server/` (Worker + `migrations/`), `android/`, `store/` (teksty i grafiki sklepu), `docs/`.

## Rankingi i baza danych

### Zasada: serwer sam przelicza wynik

Gra ma stały krok fizyki (`STEP = 1/120`, `index.html:80`), więc przebieg da się odtworzyć z ziarna i zapisu wejść. Klient nie wysyła „mam 12 340 punktów”, tylko zapis sterowania; serwer odpala tę samą symulację i wynik wylicza sam. Podrobienie wyniku wymaga realnego przejścia wieży.

Zmiany w kodzie, które to umożliwiają:

| Miejsce | Dziś | Po zmianie |
|---|---|---|
| `Game.step` (`index.html:849`) | fizyka wymieszana z dźwiękiem i cząsteczkami | czyste `step(state, input)` w `src/sim/`, zwraca zdarzenia (`land`, `jump`, `combo`, `hurry`, `over`) dla warstwy prezentacji |
| `makeFloor` (`index.html:782`) | `Math.random()` | `floorAt(seed, n)` — czysta funkcja na liczbach całkowitych; serwer nie musi przechowywać pięter |
| `Math.pow(k, 1.4)` (`index.html:891`) | zależne od wersji silnika | tablica wartości z interpolacją, zapisana w kodzie |
| `Math.exp(-7*dt)` (`index.html:942`) | liczone co krok | stała |
| `jumpLock` (`index.html:851`) | stan gry | przeniesione do warstwy wejścia |
| oś przechyłu (`index.html:855`) | dowolny float z czujnika | kwantyzacja do 17 poziomów (−8…8) przed symulacją |

Zapis wejść: na krok tylko `{oś, skok}`, kodowane jako lista zmian (kilka KB na kilkuminutowy bieg). Stała `SIM_VERSION` wiąże zapis z wersją fizyki.

### Protokół

1. `POST /v1/players` → `{playerId, token}` przy pierwszym uruchomieniu online. Konto anonimowe, bez e-maila i hasła. Serwer trzyma tylko hash tokenu. Token w `Preferences` z włączonym Android Auto Backup, więc przeżywa reinstalację.
2. `POST /v1/runs` → `{runId, seed, simVersion}`. Klient trzyma zapas 3 biletów, żeby start gry nie czekał na sieć i żeby dało się grać offline.
3. Po przegranej: `PUT /v1/runs/:id/chunks/:seq` — porcje po maks. 6000 kroków. Serwer przelicza porcję od zapisanego punktu kontrolnego. **Porcjowanie jest konieczne**: darmowy plan Workers daje 10 ms CPU na żądanie, a długi bieg to ponad 100 tys. kroków.
4. `POST /v1/runs/:id/finish` → serwer potwierdza, że symulacja doszła do końca gry, zapisuje wynik i zwraca miejsce w rankingach.
5. `GET /v1/leaderboards/:okres` (top 50) i `GET /v1/leaderboards/:okres/me` (moje miejsce ± 5 sąsiadów); okres: `all`, `week`, `day`. Odpowiedzi w cache na 30 s.
6. `PATCH /v1/me` (nick), `DELETE /v1/me` (usunięcie danych — wymóg Google Play).

Dodatkowe zabezpieczenia: bieg nie może być krótszy w czasie rzeczywistym niż liczba kroków / 120; limit żądań na gracza; flaga `banned`; nicki 3–16 znaków, unikalne bez rozróżniania wielkości liter, z filtrem wulgaryzmów. Nieudany upload czeka w kolejce na urządzeniu do następnego uruchomienia.

Czego to **nie** zatrzyma: bota grającego idealnie w czasie rzeczywistym. Na to jest etap 7 (Play Integrity) i ręczna flaga `banned`.

### Schemat D1

```sql
CREATE TABLE players (
  id           TEXT PRIMARY KEY,               -- UUID
  token_hash   TEXT NOT NULL,                  -- SHA-256 tokenu urządzenia
  nick         TEXT COLLATE NOCASE UNIQUE,     -- NULL do czasu wyboru
  platform     TEXT NOT NULL,                  -- 'android' | 'web'
  country      TEXT,                           -- kod kraju z Cloudflare (flaga); IP nie jest zapisywane
  banned       INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);

CREATE TABLE runs (
  id           TEXT PRIMARY KEY,
  player_id    TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  mode         TEXT NOT NULL DEFAULT 'classic', -- 'classic' | 'daily'
  seed         INTEGER NOT NULL,
  sim_version  INTEGER NOT NULL,
  status       TEXT NOT NULL,                   -- issued | uploading | verified | rejected | expired
  issued_at    INTEGER NOT NULL,
  finished_at  INTEGER,
  next_seq     INTEGER NOT NULL DEFAULT 0,
  checkpoint   TEXT,                            -- JSON stanu symulacji po ostatniej porcji
  ticks INTEGER, score INTEGER, floor INTEGER, combo INTEGER,
  char_id TEXT, style_id TEXT, control TEXT, app_version TEXT,
  reject_reason TEXT
);
CREATE INDEX runs_player ON runs(player_id, issued_at DESC);

CREATE TABLE bests (                            -- najlepszy wynik gracza w danym okresie
  period      TEXT NOT NULL,                    -- 'all' | 'W:2026-46' | 'D:2026-11-12'
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
```

Miejsce gracza: `SELECT COUNT(*)+1 FROM bests WHERE period=? AND (score>? OR (score=? AND achieved_at<?))`. Zadanie cron raz na dobę usuwa wygasłe bilety, stare okresy tygodniowe/dzienne i biegi starsze niż 90 dni.

Postacie są czysto kosmetyczne, więc osobne rankingi „per postać” nie mają sensu — ikona postaci pojawia się przy wpisie. Kolumna `mode` jest przygotowana pod „Wieżę dnia” (to samo ziarno dla wszystkich danego dnia).

## Etapy

| # | Etap | Zakres | Szac. |
|---|---|---|---|
| 0 | Porządek | Plan do `docs/PLAN.md`, `LICENSE`, Vite, podział `index.html` na moduły bez zmiany zachowania | 6–8 h |
| 1 | Rdzeń symulacji | `src/sim/` wg tabeli wyżej, zapis i odtwarzanie wejść, testy „złotych” biegów | 12–16 h |
| 2 | Backend | Worker, migracje D1, protokół, weryfikacja porcjami, limit żądań, cron, **pomiar CPU na porcję** | 16–24 h |
| 3 | Rankingi w grze | Ekran rankingu, miejsce po przegranej, wybór nicku, kolejka offline, ustawienia (dźwięk, wibracje, „usuń moje dane”) | 10–14 h |
| 4 | Android | Capacitor, wtyczki, pełny ekran, tryb `full`/`demo`, test na telefonie | 12–16 h |
| 5 | Własna tożsamość i szlif | Patrz niżej | 12–18 h |
| 6 | Google Play | Konto, karta gry, formularze, test zamknięty 14 dni, produkcja | 8–10 h + 14 dni kalendarzowych |
| 7 | Po premierze (opcjonalnie) | Play Integrity przy wysyłce wyników, „Wieża dnia”, odtwarzanie najlepszych biegów w demo web | — |

**Ścieżka krytyczna to kalendarz, nie kod**: weryfikacja konta i 14 dni testu zamkniętego. Rejestrację konta i szukanie 12 testerów warto zacząć równolegle z etapem 2.

### Etap 4 — rzeczy do poprawienia wykryte w kodzie

- **Fonty**: `Trebuchet MS`, `Comic Sans MS`, `Georgia`, `Courier New` (`index.html:276–286`) nie istnieją na Androidzie — mapy „Zeszyt”, „Stare kino” i „Retro LCD” wyglądałyby inaczej. Dołączam fonty na licencji OFL.
- **Service worker** (`index.html:1471`) zarejestrowałby się też w aplikacji (Capacitor serwuje z `https://localhost`) — wyłączam go poza web.
- **`navigator.wakeLock`** (`index.html:753`) nie działa w WebView → wtyczka `keep-awake`, aktywna przez całą rozgrywkę.
- **`window.__game`** (`index.html:1451`) — usuwam z buildów produkcyjnych.
- **Filtry CSS na canvasie** (mapy „Stare kino”, „Retro LCD”) — sprawdzić wydajność na słabszym telefonie.
- Proporcje 4:3 na ekranie 20:9 zostają: boczne pasy to naturalne miejsce na przyciski dotykowe.

### Etap 5 — własna tożsamość (ważne przed sprzedażą)

Zestaw zasad jest dziś bardzo bliski **Icy Tower**: skok zależny od rozpędu, progi combo 4/7/15/25/35/50/70/100/140/200 (`index.html:98`), zegar „SZYBCIEJ!” co 30 s, zmiana wyglądu co 100 pięter, tabliczki co 10, zegar i miernik combo po lewej. Same mechaniki nie są chronione, a postacie, grafika i nazwa są własne — ale przy płatnej grze to ryzyko zgłoszenia i odrzucenia jako kopii, a w portfolio lepiej wyglądają własne pomysły. Plan:

- własne progi i nazwy combo, przeprojektowany HUD,
- 1–2 własne mechaniki (np. specjalne platformy: krucha, sprężyna, ruchoma) i „Wieża dnia”,
- w opisie sklepu żadnych odwołań do Icy Tower,
- sprawdzenie, czy nazwa „Step Jumper” nie koliduje z istniejącą grą w Google Play.

Do tego: angielska wersja językowa (teksty są dziś wpisane na sztywno po polsku), wibracje, obsługa przycisku Wstecz.

### Etap 6 — Google Play krok po kroku

1. **Konto osobiste** (25 USD): weryfikacja tożsamości dokumentem i urządzeniem z Androidem.
2. **Status sprzedawcy (DSA)**: płatna gra w UE = „trader”. Według dostępnych źródeł imię, nazwisko, **adres**, telefon i e-mail są pokazywane na karcie gry. **Sprawdź to w konsoli, zanim zapłacisz** — to jedyny punkt, który może zmienić decyzję o sprzedaży jako osoba prywatna.
3. **Profil płatności**: konto bankowe, dane podatkowe, potwierdzenie stawki prowizji.
4. **Aplikacja**: identyfikator pakietu (nieodwracalny), typ „płatna” — płatną można później zmienić na darmową, odwrotnie nie.
5. **Karta gry** (PL + EN): tytuł ≤ 30 znaków, krótki opis ≤ 80, pełny ≤ 4000, ikona 512 px, grafika 1024×500, min. 2 zrzuty ekranu w poziomie; kategoria Zręcznościowe.
6. **Formularze**: ocena treści IARC (spodziewane PEGI 3), grupa docelowa 13+, Bezpieczeństwo danych (identyfikator gracza, nick, wyniki; szyfrowane w transmisji; możliwe usunięcie), brak reklam, adres polityki prywatności i strony usuwania danych (hostowane razem z demo).
7. **Test wewnętrzny** — instalacja za darmo, na własnych urządzeniach.
8. **Test zamknięty**: 12 testerów zapisanych **nieprzerwanie przez 14 dni**. W teście zamkniętym płatną grę testerzy muszą kupić; sprawdzić kody promocyjne, a w razie czego zwrócić im 3,99 zł.
9. **Wniosek o dostęp produkcyjny** (pytania o przebieg testu i wprowadzone zmiany), potem wdrożenie stopniowe.

Program Play Games Level Up (niższa prowizja, wymaga Play Games Services) — pomijam, przy tej skali się nie opłaca.

### Podatki (skrót, do potwierdzenia z księgową)

Działalność nierejestrowana: limit **10 813,50 zł przychodu na kwartał** w 2026 r., warunek: brak firmy w ostatnich 60 miesiącach. Przychód w rocznym PIT-36, uproszczona ewidencja sprzedaży. Do sprawdzenia: czy rozliczenia z Google (podmiot z Irlandii) wymagają rejestracji VAT-UE.

## Co musisz zrobić sam

- założyć konto Google Play i przejść weryfikację; podjąć decyzję w sprawie publicznego adresu,
- zalogować Cloudflare (`wrangler login`) — resztę konfiguruję z repo,
- znaleźć 12 testerów z kontami Google,
- zrobić zrzuty ekranu na prawdziwym telefonie (pomogę z grafiką 1024×500 i tekstami).

## Weryfikacja

- **Symulacja**: testy Vitest odtwarzają zapisane biegi i porównują wynik oraz hash stanu; ten sam test przechodzi w Node, w `workerd` i raz ręcznie w WebView telefonu.
- **Brak regresji rozgrywki**: po etapie 0–1 gra w przeglądarce zachowuje się jak dziś (porównanie z obecną wersją na `step-jumper.vercel.app`).
- **Backend**: `wrangler dev` z lokalnym D1; testy API: poprawny bieg trafia do rankingu, zmieniony zapis wejść → `rejected`, zawyżony wynik → `rejected`, bieg „szybszy niż czas” → `rejected`, usunięcie konta czyści `bests` i `runs`.
- **Limit CPU**: pomiar czasu porcji 6000 kroków na wdrożonym Workerze; cel < 5 ms.
- **Android**: `npx cap run android` na telefonie, podgląd przez `chrome://inspect`; scenariusze: bieg online, bieg offline i dosłanie wyniku później, reinstalacja (token wraca z kopii zapasowej), wszystkie 5 map i 4 tryby sterowania.
- **Sklep**: raport przedpremierowy Google Play bez błędów krytycznych, test wewnętrzny, potem zamknięty.

Po akceptacji zaczynam od etapu 0 i 1 — wszystko inne zależy od wydzielonego rdzenia symulacji.

## Źródła

- [Opłaty serwisowe Google Play (oficjalne)](https://support.google.com/googleplay/android-developer/answer/112622?hl=en) · [Android Authority o nowym cenniku](https://www.androidauthority.com/google-play-billing-changes-3681025/) · [MacRumors](https://macrumors.com/2026/06/24/google-play-store-fee-change/)
- [Wymóg testów dla nowych kont osobistych (oficjalne)](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en)
- [Wymagany docelowy poziom API (oficjalne)](https://developer.android.com/google/play/requirements/target-sdk)
- [Cennik i limity Cloudflare D1](https://developers.cloudflare.com/d1/platform/pricing/) · [egzekwowanie limitów od 1.09.2026](https://developers.cloudflare.com/changelog/post/2026-09-01-d1-free-tier-limit-enforcement/) · [limity Workers](https://developers.cloudflare.com/workers/platform/limits/index.md)
- [Capacitor 8](https://ionic.io/blog/announcing-capacitor-8) · [przewodnik aktualizacji](https://capacitorjs.com/docs/updating/8-0)
- [Wytyczne Play Games Level Up](https://developer.android.com/games/guidelines?hl=en)
- [Działalność nierejestrowana 2026 — pit.pl](https://www.pit.pl/aktualnosci/ponad-10-tys-zlotych-bez-zakladania-firmy-dzialalnosc-nierejestrowana-na-nowych-zasadach-w-2026-roku-1011738) · [money.pl](https://direct.money.pl/artykuly/porady/dzialalnosc-nierejestrowana-2026-limit-10-813,50-zl,-po-przekroczeniu-7-dni-na-ceidg)
- [Status sprzedawcy w Google Play (nieoficjalne)](https://www.fdaytalk.com/google-play-trader-status/)
- [Liczby sprzedaży gry za 0,99 USD — Asterogue](https://chr15m.itch.io/asterogue/devlog/201756/sales-numbers-for-asterogue)
