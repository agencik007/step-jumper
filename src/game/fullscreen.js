// Pełny ekran: przycisk w rogu ekranu i klawisz F.
// Fullscreen API ze wszystkimi prefiksami (Chrome / Firefox / Edge / Safari na Macu i iPadzie / stare WebKity).
// iPhone nie pozwala na pełny ekran zwykłej strony – tam przycisk podpowiada „Do ekranu początkowego”,
// bo zainstalowana gra startuje bez pasków przeglądarki (manifest: display „fullscreen”).
import { sfx } from './audio.js';
import { t } from './i18n.js';
import { isTouch } from './input.js';

const root = document.documentElement;
const btn = document.getElementById('fs');

const request = root.requestFullscreen || root.webkitRequestFullscreen || root.webkitRequestFullScreen || root.mozRequestFullScreen || root.msRequestFullscreen;
const exit = document.exitFullscreen || document.webkitExitFullscreen || document.webkitCancelFullScreen || document.mozCancelFullScreen || document.msExitFullscreen;

export const fsSupported = !!request && (document.fullscreenEnabled ?? document.webkitFullscreenEnabled ?? document.mozFullScreenEnabled ?? document.msFullscreenEnabled ?? true) !== false;

/** Gra już działa bez pasków przeglądarki (zainstalowana aplikacja albo pełny ekran z F11). */
const standalone = () => matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = /iP(hone|od|ad)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export const isFullscreen = () => !!(document.fullscreenElement || document.webkitFullscreenElement || document.webkitCurrentFullScreenElement || document.mozFullScreenElement || document.msFullscreenElement);

let game = null;

async function enter() {
  try {
    const r = request.call(root, { navigationUI: 'hide' });
    if (r && typeof r.then === 'function') await r;
  } catch {
    game?.say(t('msg.fsFail'), '', 'warn', 1.6);
    return;
  }
  // gra jest pozioma (4:3) – na telefonie i tablecie obracamy ekran, jeśli przeglądarka na to pozwala
  if (isTouch) screen.orientation?.lock?.('landscape').catch(() => {});
}

function leave() {
  try { screen.orientation?.unlock?.(); } catch { /* nie każda przeglądarka to ma */ }
  try { const r = exit.call(document); if (r && typeof r.catch === 'function') r.catch(() => {}); } catch { /* już wyszliśmy */ }
}

/** Przełącza pełny ekran. Musi być wywołane z gestu użytkownika (kliknięcie, klawisz). */
export function toggleFullscreen() {
  sfx.unlock(); sfx.pick();
  if (!fsSupported) {
    if (isIOS && !standalone()) game?.say(t('msg.fsHome'), t('msg.fsHomeSub'), 'hint', 3.2);
    return;
  }
  if (isFullscreen()) leave(); else enter();
}

function update() {
  if (!btn) return;
  const on = isFullscreen();
  // bez API i bez obejścia (albo gra już jest bez pasków) przycisk nic by nie dał – chowamy go
  btn.hidden = !fsSupported && (!isIOS || standalone());
  btn.classList.toggle('on', on);
  btn.dataset.i18nAria = on ? 'aria.fsExit' : 'aria.fs';
  btn.setAttribute('aria-label', t(btn.dataset.i18nAria));
  btn.title = t(btn.dataset.i18nAria);
}

/** Podpina przycisk i zdarzenia zmiany trybu. Wywoływane raz, przy starcie. */
export function initFullscreen(theGame) {
  game = theGame;
  for (const ev of ['fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange', 'MSFullscreenChange']) document.addEventListener(ev, update);
  matchMedia('(display-mode: standalone)').addEventListener?.('change', update);
  if (btn) {
    // przycisk nie łapie fokusu, żeby SPACJA dalej skakała zamiast przełączać pełny ekran;
    // pointerdown nie leci dalej, żeby w trybie przechyłu dotknięcie przycisku nie było skokiem
    btn.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); });
    btn.addEventListener('click', (e) => { e.stopPropagation(); toggleFullscreen(); btn.blur(); });
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  update();
}
