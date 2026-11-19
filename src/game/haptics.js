// Wibracje (Android w przeglądarce i w aplikacji). iOS w przeglądarce ich nie obsługuje.
// W etapie 4 (Capacitor) w tym miejscu podepnie się wtyczka Haptics.
import { isTouch } from './input.js';

export const haptics = {
  on: true,
  get available() { return isTouch && typeof navigator.vibrate === 'function'; },
  buzz(ms) {
    if (!this.on || !this.available) return;
    try { navigator.vibrate(ms); } catch { /* przeglądarka może odmówić bez gestu użytkownika */ }
  },
};
