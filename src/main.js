// Start gry: tworzy grę, podpina sterowanie i kręci pętlą klatek.
import { Game } from './game/game.js';
import { initInput, pollGamepad, tilt, tiltDegrees } from './game/input.js';

const game = new Game();
initInput(game);

if (import.meta.env.DEV) {             // podgląd stanu z konsoli – tylko w trybie deweloperskim
  window.__game = game;
  window.__tilt = { state: tilt, degrees: tiltDegrees };
}

let last = performance.now();
function loop(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  pollGamepad();
  game.frame(dt);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// PWA: service worker daje instalację „jako aplikacja” i działanie offline (tylko po HTTPS / z localhost).
// W trybie deweloperskim wyłączony, żeby pamięć podręczna nie podawała starych modułów.
if (import.meta.env.PROD && 'serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
