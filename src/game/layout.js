// Układ ekranu wyboru – wspólny dla rysowania i obsługi dotyku.
export const slotX = (i) => 168 + i * 76;
export const UIBOX = {
  chars: { y: 124, h: 74 }, maps: { y: 262, h: 40 }, play: { x: 200, y: 346, w: 240, h: 38 },
  ctrl: { x: 150, y: 391, w: 340, h: 27 }, menu: { x: 180, y: 384, w: 280, h: 30 },
};
export const inBox = (x, y, b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
