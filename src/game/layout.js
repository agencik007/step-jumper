// Układ ekranów – wspólny dla rysowania i obsługi dotyku.
export const slotX = (i) => 168 + i * 76;
export const UIBOX = {
  chars: { y: 124, h: 74 }, maps: { y: 262, h: 40 }, play: { x: 200, y: 346, w: 240, h: 38 },
  ctrl: { x: 150, y: 391, w: 340, h: 27 }, menu: { x: 180, y: 384, w: 280, h: 30 },
  pmenu: { x: 180, y: 306, w: 280, h: 34 },   // pauza: wyjście do menu
  // ekran tytułowy: rogi
  opts: { x: 10, y: 10, w: 92, h: 28 }, rank: { x: 538, y: 10, w: 92, h: 28 },
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
  // opcje
  row: (i) => ({ x: 140, y: 66 + i * 34, w: 360, h: 30 }),
};
export const PERIODS = ['day', 'week', 'lastweek', 'all'];
export const SETTINGS = ['lang', 'sound', 'music', 'vibrate', 'hand', 'online', 'delete', 'back'];
export const inBox = (x, y, b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
