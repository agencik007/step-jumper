# Wskazówki dla agentów

Wszystkie zasady pracy nad projektem (wersjonowanie, lista zmian w grze, `SIM_VERSION`, ekran ZASADY GRY, tłumaczenia,
testy) są w [`CLAUDE.md`](CLAUDE.md) – stosuj je przy każdym PR.

Szczególnie: gdy zmieniasz mechanikę gry (`src/sim/` – fizyka, piętra, przedmioty, punktacja, combo, tempo wieży)
albo dodajesz nową, popraw opis na ekranie ZASADY GRY (`src/game/strings.js`, klucze `rules.*`, we wszystkich pięciu
językach; `src/game/rules.js`). Szczegóły: `CLAUDE.md`, sekcja „Zasady gry”.
