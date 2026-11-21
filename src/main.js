// Start gry: tworzy grę, podpina sterowanie i kręci pętlą klatek.
import { online } from './net';
import { initFullscreen } from './game/fullscreen.js';
import { Game } from './game/game.js';
import { focusGame } from './game/gfx.js';
import { initInput, pollGamepad, tilt, tiltDegrees } from './game/input.js';
import { initInstall } from './game/install.js';
import { initSpeech } from './game/speech.js';
import { initUpdateCheck } from './game/update.js';

const game = new Game();
initSpeech();
initInput(game);
focusGame();                           // klawiatura i czytnik ekranu od razu „w grze”
initFullscreen(game);
initInstall(game);
initUpdateCheck();                     // nowa wersja na serwerze → przycisk PRZEŁADUJ na ekranie tytułowym

// ranking online: wczytaj konto, uzupełnij zapas biletów i dośli biegi, które czekały na sieć
online.init().then(() => { online.refill(); online.flush(); game.loadLastWeek(); });
addEventListener('online', () => { online.refill(); online.flush(); });
// serwer jeszcze na starszej wersji symulacji (trwa wdrożenie): co minutę sprawdzamy, czy już go zaktualizowano
setInterval(() => { if (online.serverBehind) online.refill(); }, 60_000);
if (import.meta.env.DEV) {             // suwaki fizyki lotu – tylko deweloperski podgląd, w buildzie produkcyjnym ich nie ma
  import('./game/tuning.js').then((m) => m.initTuning(game));
}

if (import.meta.env.DEV) {             // podgląd stanu z konsoli – tylko w trybie deweloperskim
  window.__game = game;
  window.__tilt = { state: tilt, degrees: tiltDegrees };
}

let last = performance.now();
function loop(now) {
  const dt = Math.max(0, Math.min(0.1, (now - last) / 1000));   // pierwsza klatka potrafi mieć znacznik czasu sprzed `last`
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
