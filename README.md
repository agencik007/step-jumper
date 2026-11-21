# Step Jumper

Zręcznościówka: wspinaczka po wieży, w której wysokość skoku zależy od rozpędu.

- Canvas 2D, Web Audio, Pointer Events, Gamepad API – bez silnika i bez plików graficznych czy dźwiękowych.
- 5 postaci, 5 map (stylów graficznych).
- Sterowanie: klawiatura i gamepad działają zawsze, a na telefonie do wyboru jest 6 trybów (OPCJE → STEROWANIE
  albo dotknięcie „STEROWANIE: …” na ekranie tytułowym; `src/game/input.js`):
  - **przyciski ekranowe** ◀ ▶ + ▲ (układ prawo- / leworęczny w opcjach),
  - **połówki ekranu + przycisk skoku** – przytrzymana połowa ekranu = bieg w tę stronę, ▲ w obu dolnych rogach,
  - **połówki ekranu + machnięcie w górę** – jak wyżej, a skok to przesunięcie palca w górę (przytrzymanie = skok przy każdym lądowaniu),
  - **gałka (joystick)** – pływająca gałka pod jednym kciukiem daje płynną prędkość, dotknięcie drugiej połowy ekranu = skok,
  - **przechył telefonu + dotyk** (wymaga HTTPS) z suwakiem czułości (9 stopni) i kalibracją pozycji zerowej (np. do gry na leżąco),
  - **jeden przycisk** – bohater biegnie sam i zawraca przy ścianach, cały ekran (każdy klawisz / przycisk skoku) = skok;
    strzałka albo gałka przejmuje bieg i ustawia kierunek.

  Każdy tryb podaje symulacji tylko oś −1…1 i skok, więc zapis biegu, powtórki i weryfikacja rankingu są dla wszystkich takie same.
- Strona OPCJE → STEROWANIE to przewijana lista (palec, kółko myszy, strzałki / PageUp / PageDown, pad; `src/game/options.js`):
  - **skok**: przytrzymanie (trzymany = skok przy każdym lądowaniu), przełącznik (wciśnięcie włącza i wyłącza ciągłe skakanie,
    na ekranie plakietka „▲ AUTO”) albo automat (bohater skacze sam, gracz tylko kieruje),
  - **przyciski ekranowe**: rozmiar (60–140%), widoczność (20–100%) i **własny układ** – edytor, w którym każdy przycisk i gałkę
    przeciąga się w dowolne miejsce (`src/game/padlayout.js`; pozycje jako ułamek okna, przy zmianie ręki układ odbija się w poziomie),
  - martwa strefa gałki ekranowej i gałki pada,
  - **przypisanie klawiszy** (3 na akcję) i **przycisków pada** (2 na akcję) dla biegu, skoku i pauzy; menu zawsze działa
    strzałkami, Enter, Spacją i Esc,
  - przywrócenie domyślnego sterowania.
- **Gamepad** (`src/game/gamepad.js`): pełna obsługa bez myszy i klawiatury – w menu krzyżak / gałka, A (dolny) wybierz, B (prawy) wróć,
  Y – ranking / menu, X – opcje, Start – start i pauza, LB / RB – zakładki i tempo powtórki. Gra rozpoznaje pady Xbox, PlayStation
  i Nintendo i rysuje ich przyciski (A B X Y, ✕ ○ □ △, B A Y X); pady bez układu „standard” mają krzyżak z osi / „hata”
  i numery przycisków do przypisania. Gałka pada daje płynną prędkość. Formularz nicku na padzie: B = graj bez nicku
  (gra zapyta przy następnym uruchomieniu).
- **Dostępność** (OPCJE → DOSTĘPNOŚĆ, `src/game/access.js`; wszystko czysto wizualne, ranking bez zmian):
  - rozmiar tekstu mały / średni (domyślny) / duży – mnożnik w `text()` (`gfx.js`) dla napisów poniżej 24 px, okienka HTML przez `zoom`,
  - wysoki kontrast: prawie nieprzezroczyste tło menu, grube obrysy pięter, wyraźne przyciski ekranowe,
  - efekty map wł. / wył. (filtry kolorów, ziarno, rysy, linie, piksele),
  - ograniczenie ruchu: jak w systemie (`prefers-reduced-motion`), zawsze albo nigdy – bez wstrząsów, migania, podskakujących
    napisów i gwiazdek za bohaterem; przyciemnienie taśmy w „Starym kinie” najwyżej raz na sekundę,
  - asysta wzroku: poświata wokół bohatera i znacznik piętra, na które spada (rzut w pionie z układu pięter),
  - miejsca 1–3 w rankingu mają numer obok korony, a wybrany wiersz opcji – znacznik ▸ (nie tylko kolor).
- **Dźwięk** (OPCJE → DŹWIĘK): wyciszenie całości (też klawisz M), osobne suwaki głośności efektów i muzyki (0–100%, krok 10%,
  wzmocnienie w kwadracie – `src/game/audio.js`) oraz **ostrzeżenie przy dole ekranu** – wizualny odpowiednik tykania w muzyce:
  dół planszy pulsuje na czerwono (~1 raz na sekundę), z paskiem i strzałkami, przy tym samym progu co tykanie (`drawDangerWarn`
  w `render.js`). Pozostałe dźwięki mają już swój obraz (komunikaty, kurz, zegar, HUD).
- **Czytniki ekranu i klawiatura** (`src/game/speech.js`): płótno ma `role="application"`, opis klawiszy (`aria-describedby`)
  i dostaje fokus przy starcie. Gra opisuje ekran słowami w ukrytych regionach `aria-live`: po wejściu na ekran czyta całość,
  potem tylko to, co się zmieniło (wybrana postać i mapa, wiersz opcji z wartością, zakładka i lista rankingu, wynik i miejsce
  po biegu, powtórka, podsumowanie tygodnia, najnowszy wpis NOWOŚCI), a komunikaty z `game.say` idą tą samą drogą.
  Klawisz **I** w biegu i w pauzie czyta wynik, piętro, combo i tempo. Tab dochodzi do przycisków pauzy i pełnego ekranu
  (Enter / spacja je naciskają), przyciski dotykowe są poza kolejnością Tab, a po zamknięciu okienek fokus wraca na płótno.
- **Technicznie** (wersja 0.17.0):
  - ekran nie gaśnie w biegu i powtórce w każdym trybie (Screen Wake Lock, `src/game/wake.js`), poza grą blokada jest zwalniana,
  - **oszczędzanie baterii** (OPCJE, `src/game/power.js`): WYŁ. / AUTO / WŁ. – obraz najwyżej 30 kl./s i płótno do 1,5× DPR;
    AUTO włącza się przy baterii ≤ 20% bez ładowania (Battery API, Chrome na Androidzie). Fizyka liczy dalej stałe kroki,
  - liczby z separatorem tysięcy wg języka i godzina zamknięcia rankingu dnia / tygodnia w czasie gracza (`src/game/format.js`,
    zamknięcie liczone jak `server/src/periods.ts` – pilnuje tego `tests/format.test.ts`),
  - gałka i machnięcie czytają też surowe ruchy palca (`pointerrawupdate`), obok zwykłych `pointermove`,
  - OPCJE → Przywróć domyślne ustawienia (bez języka, postaci, mapy i rankingu),
  - **testy E2E** (Playwright, `tests/e2e/`, `npm run e2e`): sześć trybów dotyku na emulowanym telefonie, układ leworęczny
    i własny układ przycisków. Uruchamiają własny serwer deweloperski na porcie 5174 i nie łączą się z rankingiem online.
- Ekran NOWOŚCI rysuje sam tekst na jednolitym tle, bez mapy i efektów pod spodem.
- Wibracje w 4 stopniach (wył. / słabe / średnie / mocne) – telefon i pad (`vibrationActuator`).
- Pełny ekran: przycisk w prawym górnym rogu albo klawisz **F** (Fullscreen API; na telefonie dodatkowo obrót do poziomu). iPhone nie daje pełnego ekranu zwykłej stronie – tam przycisk otwiera instrukcję „Do ekranu początkowego” (w każdym języku gry; przy pierwszym uruchomieniu w Safari pokazuje się sama), a zainstalowana gra startuje bez pasków (`src/game/install.js`).
- Pauza: klawisz **P** albo przycisk ⏸ w prawym górnym rogu (widoczny w trakcie biegu); z pauzy przycisk MENU wraca do wyboru postaci i mapy.
- **Piętra coraz węższe**: piętro to 4–9 klocków; co 100 pięter klocek traci 2 px (piętra 0–99: 128–288 px, od 800.: 64–144 px), a gra mówi o tym komunikatem „WĘŻSZE PIĘTRA!”. Co 50. piętro zostaje na całą szerokość. Stałe: `BLOCK`, `NARROW_EVERY`, `NARROW_BY`, `NARROW_MAX` w `src/sim/constants.ts`.
- Przedmioty w locie (część symulacji, więc serwer rankingu też je liczy):
  - **booster wyrzutu** – wisi między piętrami co 50–90 pięter (pierwszy nad piętrem 30–40). Złapany w locie zalicza bieżące combo i wyrzuca bohatera ok. 30 pięter w górę; wylądować trzeba samemu, a to lądowanie zaczyna combo od zera,
  - **spowolnienie** – od 400. piętra co 15 s pojawia się nad ekranem klepsydra; złapana zwalnia wieżę o połowę na 5 s. Nigdy nie pojawia się w pobliżu czekającego boostera ani w trakcie wyrzutu, więc oba przedmioty nie są naraz na ekranie.
  Stałe: `src/sim/constants.ts` (sekcja „przedmioty”).
- Nick: przed pierwszą grą w rankingu gra prosi o nick (bez sieci pozwala grać i pyta przy następnym uruchomieniu).
- Muzyka (`src/game/music.js`): syntezowany sekwencer w a-moll. Tempo rośnie z tempem wieży (108 → ~194 BPM), z każdym poziomem dochodzą warstwy (hi-hat, werbel, arpeggio, szesnastki basu), a gdy bohater zjeżdża ku dołowi ekranu, dochodzi tykanie. Osobny przełącznik w OPCJACH.

Plan wydania (Google Play, rankingi online, wycena): [`docs/PLAN.md`](docs/PLAN.md).

## Uruchomienie

```
npm install
npm run dev        # serwer deweloperski (Vite)
npm test           # testy symulacji
npm run e2e        # testy E2E w przeglądarce (Playwright; raz: npx playwright install chromium)
npm run typecheck
npm run build      # wersja produkcyjna w dist/
```

Tryb przechyłu działa tylko po HTTPS albo z `localhost`.

## Układ projektu

| Katalog | Zawartość |
|---|---|
| `src/sim/` | Rdzeń rozgrywki: deterministyczna symulacja, wieża, zapis i odtwarzanie biegu. Bez DOM – ten sam kod trafi na serwer weryfikujący wyniki. |
| `src/game/` | Wszystko, co widać i słychać: rysowanie, mapy, postacie, dźwięk, sterowanie, ekrany. |
| `server/` | Serwer rankingu: Cloudflare Worker + baza D1, weryfikuje zapisy biegów. Opis API: [`server/README.md`](server/README.md). |
| `public/` | Manifest PWA, service worker, ikony. |
| `tests/` | Testy symulacji i serwera (`tests/server/`, na lokalnej bazie D1). `tests/legacy/` to fizyka z pierwszej, jednoplikowej wersji gry – wzorzec, z którym porównywany jest nowy rdzeń. |
| `scripts/` | Generator tablicy krzywej skoku. |

## Ranking online

Gra bierze z zapasu bilet (ziarno wieży od serwera), a po przegranej wysyła zapis sterowania; serwer sam odtwarza
bieg i wpisuje wynik do rankingu dziennego, tygodniowego i ogólnego (`src/net/online.ts`, serwer: `server/`).
Bez sieci gra działa normalnie: bieg bez biletu jest poza rankingiem, a wynik bez połączenia czeka w kolejce.

- `npm run dev` łączy się z lokalnym serwerem (`npm run server:dev`), żeby testy nie trafiały do prawdziwego rankingu;
  `VITE_API_URL=…` wskazuje inny serwer.
- Build produkcyjny łączy się z serwerem na Cloudflare.
- Ranking otwiera się na zakładce TYDZIEŃ; jest też ZESZŁY TYDZIEŃ (zamknięte wyniki).
- **Nagrody dla najlepszej trójki tygodnia** (`src/game/game.js` → „efekty nagrody”): miejsca 1–3 zamkniętego tygodnia
  noszą przez cały następny tydzień koronę (złotą, srebrną, brązową) nad głową, sypią pyłem z iskrami w kolorze korony,
  gdy ocierają się o ściany.
  Nagrody są czysto wizualne – symulacja i weryfikacja biegów się nie zmieniają. W trybie DEV `?crown=1|2|3` w adresie
  zakłada koronę bez rankingu.
- **Powtórki**: wiersze 1–3 w rankingu (dotknięcie albo klawisze 1–3) odtwarzają bieg tego gracza na jego wieży, postaci
  i mapie – start / pauza (Spacja, P), stop (S), tempo 1× / 2× / 4× (← →), wyjście (Esc), na końcu ekran „KONIEC POWTÓRKI”.
- **Podsumowanie tygodnia**: po zamknięciu tygodnia, przy pierwszym uruchomieniu gra raz pokazuje podium najlepszej trójki
  (z powtórkami) i miejsce gracza.
- W grze: RANKING (R), OPCJE (O) i NOWOŚCI (N) w rogach ekranu tytułowego; w opcjach dźwięk, wibracje, sterowanie, układ przycisków (prawo- lub leworęczny – leworęczny przenosi skok na lewą stronę, a ◀ ▶ na prawą), wyłączenie rankingu
  i usunięcie swoich danych z serwera.

## Języki

Polski, angielski, niemiecki, francuski i hiszpański. Przy pierwszym uruchomieniu gra wybiera język przeglądarki
(nieobsługiwany → angielski); zmiana w OPCJACH. Teksty są w `src/game/strings.js` – test `tests/i18n.test.ts` pilnuje,
żeby każdy język miał wszystkie klucze i te same `{zmienne}`. Nowy tekst: dopisz klucz we wszystkich pięciu językach
i użyj `t('klucz')` z `src/game/i18n.js`.

## Determinizm

Bieg da się odtworzyć z ziarna wieży i zapisu wejść (`src/sim/replay.ts`), co jest podstawą rankingu odpornego na podrabianie wyników. Dlatego w `src/sim/`:

- nie ma `Math.random`, czasu systemowego ani DOM,
- używane są tylko działania dokładne wg IEEE 754; `k^1.4` pochodzi z tablicy (`jumpTable.ts`), a nie z `Math.pow`,
- każda zmiana fizyki, układu pięter albo punktacji wymaga podbicia `SIM_VERSION` – pilnuje tego test `tests/sim.golden.test.ts`.

W trybie deweloperskim gra po każdym biegu odtwarza jego zapis i zgłasza w konsoli błąd, jeśli stan końcowy się różni.

## Strojenie

- fizyka: obiekt `P` i stałe w `src/sim/constants.ts` (pamiętaj o `SIM_VERSION`),
- czułość przechyłu: stała `TILT` w `src/game/input.js` (`dead`, `full`, `smooth`).

## Wersje, NOWOŚCI i aktualizacja

- Wersja gry (`0.MINOR.PATCH`) jest w `package.json`; każdy scalony PR z widoczną dla gracza zmianą ją podbija.
  Zasady: [`CLAUDE.md`](CLAUDE.md).
- **NOWOŚCI** (przycisk na ekranie tytułowym, klawisz N, LB na padzie): najważniejsze zmiany każdej wersji w języku gry.
  Treść: `src/game/changelog.js`; `tests/changelog.test.ts` pilnuje, żeby najnowszy wpis miał wersję z `package.json`
  i był we wszystkich językach. Numer wersji jest w lewym dolnym rogu ekranu tytułowego.
- **PRZEŁADUJ**: build zapisuje `version.json` z identyfikatorem builda (`vite.config.js`). Gra sprawdza go przy starcie,
  po powrocie do karty i co 5 minut (`src/game/update.js`); gdy na serwerze jest nowszy build, na ekranie tytułowym
  pojawia się przycisk PRZEŁADUJ (klawisz U, RB na padzie). W trakcie biegu gra nic nie pokazuje.

## Deploy

Vercel buduje projekt przez Vite (`vercel.json`), każdy push do `main` wdraża produkcję.

## PWA

`public/manifest.webmanifest`, `public/sw.js` i `public/icons/` pozwalają zainstalować grę jako aplikację. Na Androidzie gra sama proponuje instalację okienkiem na ekranie tytułowym (`src/game/install.js`): w Chrome przycisk ZAINSTALUJ otwiera systemowe okno (`beforeinstallprompt`), w przeglądarce bez tego zdarzenia pokazuje instrukcję z menu. „Nie teraz” odkłada pytanie na 3 dni.
Po instalacji startuje na pełnym ekranie, w poziomie, i działa offline. Service worker bierze stronę najpierw z sieci,
więc nowy deploy widać po przeładowaniu – a gra, która była już otwarta, sama proponuje PRZEŁADUJ.
