// Dostępność (OPCJE → DOSTĘPNOŚĆ): rozmiar tekstu, wysoki kontrast, efekty map, ograniczenie ruchu i asysta wzroku.
// Wszystko to czysto wizualne – symulacja, zapis biegu i ranking się nie zmieniają.
import { setReduceMotion } from './util.js';

export const TEXT_SIZES = ['small', 'medium', 'large'];
const TEXT_K = [0.88, 1, 1.25];
export const MOTION_MODES = ['auto', 'on', 'off'];     // auto – jak w systemie (prefers-reduced-motion)
/**
 * text: indeks w TEXT_SIZES; contrast, fx (filtry i efekty map), assist: tak / nie; motion: z MOTION_MODES;
 * warn: pulsujący pasek u dołu ekranu, gdy bohater zjeżdża ku przegranej (to, co słychać w tykaniu muzyki).
 */
export const ACCESS_DEFAULT = { text: 1, contrast: false, fx: true, motion: 'auto', assist: false, warn: true };
export const access = { ...ACCESS_DEFAULT };

const sysMotion = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
export const systemReducesMotion = () => !!sysMotion?.matches;

export const textK = () => TEXT_K[access.text] ?? 1;
/** Rozmiar czcionki po uwzględnieniu ustawienia. Tytuły (24 px i więcej) zostają, reszta rośnie najwyżej do 24 px. */
export const fontSize = (size) => (size >= 24 ? size : Math.min(24, size * textK()));

/** Przenosi ustawienia na stronę: ograniczenie ruchu, skala okienek HTML, klasa kontrastu. */
export function applyAccess() {
  setReduceMotion(access.motion === 'on' || (access.motion === 'auto' && systemReducesMotion()));
  if (typeof document === 'undefined') return;
  document.documentElement.style.setProperty('--text-k', String(textK()));
  document.body.classList.toggle('hi-contrast', access.contrast);
}
sysMotion?.addEventListener?.('change', applyAccess);

/** Zapisane ustawienia (z prefs gry); niepoprawne wartości wracają do domyślnych. */
export function loadAccess(p) {
  Object.assign(access, ACCESS_DEFAULT);
  if (p && typeof p === 'object') {
    if (Number.isInteger(p.text) && p.text >= 0 && p.text < TEXT_SIZES.length) access.text = p.text;
    if (MOTION_MODES.includes(p.motion)) access.motion = p.motion;
    for (const k of ['contrast', 'fx', 'assist', 'warn']) if (typeof p[k] === 'boolean') access[k] = p[k];
  }
  applyAccess();
}
