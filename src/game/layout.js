// Układ ekranów – wspólny dla rysowania i obsługi dotyku.
import { textK } from './access.js';

export const slotX = (i) => 168 + i * 76;
export const UIBOX = {
  chars: { y: 124, h: 74 }, maps: { y: 262, h: 40 }, play: { x: 200, y: 346, w: 240, h: 38 },
  ctrl: { x: 150, y: 391, w: 340, h: 27 }, menu: { x: 180, y: 384, w: 280, h: 30 },
  pmenu: { x: 180, y: 306, w: 280, h: 34 },   // pauza: wyjście do menu
  // ekran tytułowy: rogi
  opts: { x: 10, y: 10, w: 92, h: 28 }, rank: { x: 538, y: 10, w: 92, h: 28 },
  news: { x: 10, y: 44, w: 92, h: 28 },                   // NOWOŚCI (lista zmian)
  rules: { x: 10, y: 78, w: 92, h: 28 },                  // ZASADY GRY
  update: { x: 538, y: 44, w: 92, h: 38 },                // PRZEŁADUJ – tylko gdy na serwerze jest nowa wersja
  // ranking
  tab: (i) => ({ x: 104 + i * 110, y: 64, w: 102, h: 28 }),
  list: { x: 110, y: 102, w: 420, h: 276 },
  boardRow: (i) => ({ x: 118, y: 131 + i * 23, w: 404, h: 22 }),   // wiersz rankingu (miejsca 1–3: dotknięcie = powtórka)
  // powtórka: pasek przycisków na dole pola gry
  rPlay: { x: 104, y: 436, w: 44, h: 32 }, rStop: { x: 154, y: 436, w: 44, h: 32 }, rSpeed: { x: 204, y: 436, w: 50, h: 32 },
  rBar: { x: 264, y: 446, w: 200, h: 12 }, rExit: { x: 474, y: 436, w: 62, h: 32 },
  rAgain: { x: 190, y: 290, w: 124, h: 36 }, rBack: { x: 326, y: 290, w: 124, h: 36 },
  // podsumowanie tygodnia: podium (2. – 1. – 3.) i przyciski
  podX: [320, 210, 430], podH: [74, 52, 36], podBase: 300,
  podWatch: (i) => ({ x: [320, 210, 430][i] - 48, y: 346, w: 96, h: 24 }),
  recapBoard: { x: 160, y: 418, w: 150, h: 32 }, recapNext: { x: 330, y: 418, w: 150, h: 32 },
  nick: { x: 130, y: 422, w: 250, h: 32 }, back: { x: 390, y: 422, w: 120, h: 32 },
};
export const PERIODS = ['day', 'week', 'lastweek', 'all'];
/** Strony opcji z samym tekstem (NOWOŚCI, ZASADY GRY): nic do wybrania, tylko przewijanie, jednolite tło bez mapy. */
export const isTextPage = (page) => page === 'news' || page === 'rules';

// ───────────────────────── opcje: przewijana lista ─────────────────────────
// Każda strona opcji to lista wierszy (src/game/options.js); co się nie mieści, przewija się palcem, kółkiem myszy,
// a przy wyborze strzałkami / padem lista sama jedzie za zaznaczeniem. „Wróć” stoi zawsze pod listą.
export const LIST = { x: 110, y: 50, w: 420, h: 330 };
export const LIST_BACK = { x: 240, y: 388, w: 160, h: 28 };
export const ROW_H = { head: 22, info: 24, mode: 42, slider: 48, row: 30, bind: 30 };
export const NOTE_LINE = 17;                          // wysokość linijki punktu na liście zmian (przy średnim tekście)
export const NOTE_FONT = { size: 13, weight: 600 };   // czcionka punktów listy zmian (łamanie linijek i rysowanie)
/** Linijka punktu listy zmian przy obecnym rozmiarze tekstu (wiersz 'note' ma tyle linijek, ile lines). */
export const noteLine = () => Math.round(NOTE_LINE * textK());
const ROW_GAP = 4;
/** Ustawia y (względem początku listy) i h każdego wiersza; zwraca wysokość całej listy. */
export function listLayout(items) {
  let y = 0;
  for (const it of items) {
    if (it.type === 'back') continue;
    it.y = y; it.h = it.type === 'note' ? it.lines.length * noteLine() + 2 : ROW_H[it.type]; y += it.h + ROW_GAP;
  }
  return Math.max(0, y - ROW_GAP);
}
/** Prostokąt wiersza na ekranie przy danym przewinięciu. */
export const rowBox = (it, scroll) => ({ x: LIST.x, y: LIST.y + it.y - scroll, w: LIST.w, h: it.h });
export const SLIDER_STEPS = 8;
/** Pasek suwaka w wierszu (wide: z podpisami „mało / dużo” po bokach). */
export const sliderBar = (r, wide) => (wide ? { x: r.x + 96, y: r.y + 34, w: r.w - 192 } : { x: r.x + 24, y: r.y + 34, w: r.w - 48 });
/** Pozycja dotknięcia na suwaku → wartość 0…8 (null = poza suwakiem). */
export function sliderValueAt(bar, x) {
  if (x < bar.x - 24 || x > bar.x + bar.w + 24) return null;
  return Math.max(0, Math.min(SLIDER_STEPS, Math.round((x - bar.x) / bar.w * SLIDER_STEPS)));
}
/** Pole j z n w wierszu przypisania (klawisz albo przycisk pada). */
export const bindCell = (r, j, n) => ({ x: r.x + r.w - 8 - (n - j) * 76, y: r.y + 3, w: 70, h: r.h - 6 });
/** Strzałki ◀ ▶ wartości w zwykłym wierszu: dotknięcie lewej zmniejsza, reszty wiersza – zwiększa. */
export const ARROW_W = 176;
export const inBox = (x, y, b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
