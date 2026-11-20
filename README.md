# Step Jumper

Zręcznościówka: wspinaczka po wieży, w której wysokość skoku zależy od rozpędu.

- Canvas 2D, Web Audio, Pointer Events, Gamepad API – bez silnika i bez plików graficznych czy dźwiękowych.
- 5 postaci, 5 map (stylów graficznych).
- Sterowanie: klawiatura, gamepad, przyciski ekranowe albo **przechył telefonu + dotyk** (wymaga HTTPS).
- Pełny ekran: przycisk w prawym górnym rogu albo klawisz **F** (Fullscreen API; na telefonie dodatkowo obrót do poziomu). iPhone nie daje pełnego ekranu zwykłej stronie – tam przycisk otwiera instrukcję „Do ekranu początkowego” (w każdym języku gry; przy pierwszym uruchomieniu w Safari pokazuje się sama), a zainstalowana gra startuje bez pasków (`src/game/install.js`).
- Pauza: klawisz **P** albo przycisk ⏸ w prawym górnym rogu (widoczny w trakcie biegu); z pauzy przycisk MENU wraca do wyboru postaci i mapy.
- Muzyka (`src/game/music.js`): syntezowany sekwencer w a-moll. Tempo rośnie z tempem wieży (108 → ~194 BPM), z każdym poziomem dochodzą warstwy (hi-hat, werbel, arpeggio, szesnastki basu), a gdy bohater zjeżdża ku dołowi ekranu, dochodzi tykanie. Osobny przełącznik w OPCJACH.

Plan wydania (Google Play, rankingi online, wycena): [`docs/PLAN.md`](docs/PLAN.md).

## Uruchomienie

```
npm install
npm run dev        # serwer deweloperski (Vite)
npm test           # testy symulacji
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
- W grze: RANKING (R) i OPCJE (O) w rogach ekranu tytułowego; w opcjach dźwięk, wibracje, wyłączenie rankingu
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

## Deploy

Vercel buduje projekt przez Vite (`vercel.json`), każdy push do `main` wdraża produkcję.

## PWA

`public/manifest.webmanifest`, `public/sw.js` i `public/icons/` pozwalają zainstalować grę jako aplikację (Android: menu Chrome → „Zainstaluj aplikację”).
Po instalacji startuje na pełnym ekranie, w poziomie, i działa offline. Service worker bierze stronę najpierw z sieci,
więc nowy deploy widać od razu.
