// Układ ekranów – wspólny dla rysowania i obsługi dotyku.
export const slotX = (i) => 168 + i * 76;
export const UIBOX = {
  chars: { y: 124, h: 74 }, maps: { y: 262, h: 40 }, play: { x: 200, y: 346, w: 240, h: 38 },
  ctrl: { x: 150, y: 391, w: 340, h: 27 }, menu: { x: 180, y: 384, w: 280, h: 30 },
  pmenu: { x: 180, y: 306, w: 280, h: 34 },   // pauza: wyjście do menu
  // ekran tytułowy: rogi
  opts: { x: 10, y: 10, w: 92, h: 28 }, rank: { x: 538, y: 10, w: 92, h: 28 },
  // ranking
  tab: (i) => ({ x: 130 + i * 130, y: 64, w: 120, h: 28 }),
  list: { x: 110, y: 102, w: 420, h: 276 },
  nick: { x: 130, y: 422, w: 250, h: 32 }, back: { x: 390, y: 422, w: 120, h: 32 },
  // opcje
  row: (i) => ({ x: 140, y: 72 + i * 38, w: 360, h: 32 }),
};
export const PERIODS = ['day', 'week', 'all'];
export const SETTINGS = ['lang', 'sound', 'music', 'vibrate', 'online', 'delete', 'back'];
export const inBox = (x, y, b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
