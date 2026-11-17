# Step Jumper

Zręcznościówka: wspinaczka po wieży, w której wysokość skoku zależy od rozpędu.

- Canvas 2D, Web Audio, Pointer Events, Gamepad API – bez silnika i bez plików graficznych czy dźwiękowych.
- 5 postaci, 5 map (stylów graficznych).
- Sterowanie: klawiatura, gamepad, przyciski ekranowe albo **przechył telefonu + dotyk** (wymaga HTTPS).

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
| `public/` | Manifest PWA, service worker, ikony. |
| `tests/` | Testy symulacji. `tests/legacy/` to fizyka z pierwszej, jednoplikowej wersji gry – wzorzec, z którym porównywany jest nowy rdzeń. |
| `scripts/` | Generator tablicy krzywej skoku. |

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
