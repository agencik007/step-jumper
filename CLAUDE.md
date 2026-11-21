# Step Jumper – wskazówki dla agentów

Gra przeglądarkowa (Vite, Canvas 2D) z rankingiem online (Cloudflare Worker + D1). Opis projektu, układ katalogów
i uruchamianie: [`README.md`](README.md). Kod, komentarze, commity i opisy PR piszemy po polsku.

## Każdy PR – lista kontrolna

1. **Podbij wersję** w `package.json` (pole `version`) i w `package-lock.json` (dwa pola `version` na początku pliku).
2. **Dopisz wpis na górze `src/game/changelog.js`** z nową wersją, dzisiejszą datą i punktami we **wszystkich pięciu
   językach** (pl, en, de, fr, es).
3. Gdy zmiana dotyka `src/sim/` (fizyka, piętra, przedmioty, punktacja) – podbij `SIM_VERSION` w `src/sim/constants.ts`
   i odśwież złote biegi (szczegóły w README, sekcja „Determinizm”).
4. Nowe napisy w grze: klucz w `src/game/strings.js` we wszystkich pięciu językach.
5. `npm run typecheck` i `npm test` muszą przechodzić. `tests/changelog.test.ts` sprawdza, że najnowszy wpis listy zmian
   ma wersję z `package.json` i że każdy język ma te same punkty.

## Wersje i lista zmian

Wersja ma postać `0.MINOR.PATCH` (semver). Jedno źródło: `package.json`. Vite wstawia ją do gry jako `__APP_VERSION__`
(numer w lewym dolnym rogu ekranu tytułowego, `APP_VERSION` wysyłane do serwera rankingu, `version.json`).

Każdy scalony PR to jedna nowa wersja:

| Zmiana w PR | Co podbić | Przykład |
|---|---|---|
| nowa funkcja, nowa zawartość, zmiana rozgrywki (także `SIM_VERSION`) | MINOR, PATCH = 0 | 0.13.0 → 0.14.0 |
| poprawka błędu, drobna korekta, usunięcie efektu | PATCH | 0.13.0 → 0.13.1 |
| zmiany wyłącznie deweloperskie (testy, CI, dokumentacja, refaktor bez zmian dla gracza) | nic – bez nowej wersji i bez wpisu | |
| wydanie w Google Play | 1.0.0 | |

Zmiana tylko po stronie serwera rankingu, którą gracz odczuje (np. lepszy komunikat w grze), to PATCH z wpisem.

**Równoległe PR-y:** gdy `main` ma już wersję, którą nadał twój PR (inny PR scalono wcześniej), przed scaleniem
weź kolejny wolny numer: zmień wersję w `package.json` / `package-lock.json` i wpis w `changelog.js`. Rozwiąż konflikt
w `changelog.js` tak, żeby oba wpisy zostały, najnowszy na górze.

### Jak pisać punkty listy zmian

Lista zmian jest dla graczy (ekran NOWOŚCI), nie dla deweloperów.

- 1–4 punkty na wersję, najważniejsze pierwsze, każdy w jednym-dwóch zdaniach.
- Tylko to, co gracz zobaczy albo poczuje. Nie pisz o serwerze, bazie, testach, CI, refaktorze ani o nazwach plików.
- Nazwy ekranów i przycisków dokładnie takie, jak w grze w danym języku (`src/game/strings.js`, np. OPCJE → STEROWANIE,
  po hiszpańsku OPCIONES → CONTROL).
- Każdy język ma tyle samo punktów, w tej samej kolejności. Zwracaj się do gracza tak jak gra w danym języku
  (po francusku „vous”, po niemiecku „du”, po hiszpańsku „tú”).

## Wykrywanie nowej wersji

`vite.config.js` zapisuje przy budowaniu `dist/version.json` (`{ version, build }`, `build` = commit z Vercela). Gra
(`src/game/update.js`) pobiera go przy starcie, po powrocie do karty i co 5 minut; gdy `build` różni się od jej
własnego, na ekranie tytułowym pojawia się przycisk PRZEŁADUJ (klawisz U, RB na padzie). `public/sw.js` przepuszcza
`version.json` prosto do sieci, bez kopii – każde sprawdzenie ma inny adres (`?t=…`), więc kopie zapychałyby pamięć
podręczną.

## Przydatne polecenia

```bash
npm run dev          # serwer deweloperski
npm test             # wszystkie testy (symulacja, serwer, lista zmian, tłumaczenia)
npm run e2e          # testy E2E sterowania dotykiem w Chromium (Playwright, tests/e2e/*.e2e.ts)
npm run typecheck
npm run build        # dist/ z version.json
```
