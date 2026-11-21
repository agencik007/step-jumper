// Wibracje: telefon (Android w przeglądarce i w aplikacji; iOS w przeglądarce ich nie obsługuje) i pad.
// Siła w czterech stopniach: wył. / słabe / średnie / mocne. Telefon nie ma regulacji siły, więc słabsze = krótsze;
// pad dostaje i krótszy, i słabszy impuls.
// W etapie 4 (Capacitor) w tym miejscu podepnie się wtyczka Haptics.
import { gpad, padRumble, padRumbles } from './gamepad.js';
import { isTouch } from './input.js';

export const HAPTIC_LEVELS = ['off', 'low', 'mid', 'high'];
const LEN = [0, 0.5, 1, 1.7], MAG = [0, 0.35, 0.65, 1];

export const haptics = {
  level: 2,
  get on() { return this.level > 0; },
  get phone() { return isTouch && typeof navigator.vibrate === 'function'; },
  get available() { return this.phone || (gpad.index >= 0 && padRumbles()); },
  buzz(ms) {
    if (!this.level) return;
    const len = Math.max(10, Math.round(ms * LEN[this.level]));
    if (this.phone) {
      try { navigator.vibrate(len); } catch { /* przeglądarka może odmówić bez gestu użytkownika */ }
    }
    if (gpad.index >= 0) padRumble(Math.max(40, len), MAG[this.level]);
  },
};
