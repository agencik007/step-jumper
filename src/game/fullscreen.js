// Pełny ekran: przycisk w rogu ekranu i klawisz F.
// Fullscreen API ze wszystkimi prefiksami (Chrome / Firefox / Edge / Safari na Macu i iPadzie / stare WebKity).
// iPhone nie pozwala na pełny ekran zwykłej strony – tam przycisk otwiera instrukcję „Do ekranu początkowego” (install.js),
// bo zainstalowana gra startuje bez pasków przeglądarki (manifest: display „fullscreen”).
//
// ESC w pełnym ekranie: przeglądarka sama zabiera ten klawisz i wychodzi z pełnego ekranu, zamiast oddać go grze
// (powrót do menu). W Chrome / Edge / Operze prosimy o klawisz przez Keyboard Lock API – wtedy ESC wraca w menu,
// a z pełnego ekranu wychodzi się, przytrzymując ESC (przeglądarka sama to podpowiada), klawiszem F albo przyciskiem.
// Firefox i Safari tego API nie mają: tam wyjście z pełnego ekranu, którego nie zleciła gra, traktujemy jak ESC.
import { sfx } from './audio.js';
import { focusGame } from './gfx.js';
import { t } from './i18n.js';
import { isTouch } from './input.js';
import { isIOS, showInstall, standalone } from './install.js';

const root = document.documentElement;
const btn = document.getElementById('fs');

const request = root.requestFullscreen || root.webkitRequestFullscreen || root.webkitRequestFullScreen || root.mozRequestFullScreen || root.msRequestFullscreen;
const exit = document.exitFullscreen || document.webkitExitFullscreen || document.webkitCancelFullScreen || document.mozCancelFullScreen || document.msExitFullscreen;

export const fsSupported = !!request && (document.fullscreenEnabled ?? document.webkitFullscreenEnabled ?? document.mozFullScreenEnabled ?? document.msFullscreenEnabled ?? true) !== false;


export const isFullscreen = () => !!(document.fullscreenElement || document.webkitFullscreenElement || document.webkitCurrentFullScreenElement || document.mozFullScreenElement || document.msFullscreenElement);

let game = null;
let escLocked = false;          // Keyboard Lock trzyma ESC – klawisz dociera do gry
let selfExit = false;           // wyjście zleciła gra (klawisz F / przycisk), a nie ESC przeglądarki
let onEscExit = null;           // co zrobić, gdy przeglądarka zjadła ESC (ustawia input.js)

/** Ustawia reakcję na ESC zjedzony przez przeglądarkę przy wyjściu z pełnego ekranu. */
export function setEscExitHandler(fn) { onEscExit = fn; }

async function lockEsc() {
  try {
    await navigator.keyboard?.lock?.(['Escape']);
    escLocked = !!navigator.keyboard?.lock && isFullscreen();
  } catch { escLocked = false; }
}

async function enter() {
  try {
    const r = request.call(root, { navigationUI: 'hide' });
    if (r && typeof r.then === 'function') await r;
  } catch {
    game?.say(t('msg.fsFail'), '', 'warn', 1.6);
    return;
  }
  lockEsc();
  // gra jest pozioma (4:3) – na telefonie i tablecie obracamy ekran, jeśli przeglądarka na to pozwala
  if (isTouch) screen.orientation?.lock?.('landscape').catch(() => {});
}

function leave() {
  selfExit = true;
  try { screen.orientation?.unlock?.(); } catch { /* nie każda przeglądarka to ma */ }
  try { const r = exit.call(document); if (r && typeof r.catch === 'function') r.catch(() => {}); } catch { /* już wyszliśmy */ }
}

/** Przełącza pełny ekran. Musi być wywołane z gestu użytkownika (kliknięcie, klawisz). */
export function toggleFullscreen() {
  sfx.unlock(); sfx.pick();
  if (!fsSupported) {
    if (isIOS && !standalone()) { game?.pause(); showInstall(); }
    return;
  }
  if (isFullscreen()) leave(); else enter();
}

let wasFs = isFullscreen();

function onChange() {
  const on = isFullscreen();
  if (wasFs && !on) {
    // ESC zjedzony przez przeglądarkę (bez Keyboard Lock) – gra i tak robi to, co zrobiłby ESC;
    // przy Keyboard Lock wyjście to przytrzymany ESC, którego pierwsze naciśnięcie gra już dostała
    if (!selfExit && !escLocked && document.visibilityState === 'visible' && document.hasFocus()) onEscExit?.();
    try { navigator.keyboard?.unlock?.(); } catch { /* nie każda przeglądarka to ma */ }
    escLocked = false;
  }
  if (!on) selfExit = false;
  wasFs = on;
  update();
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
  for (const ev of ['fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange', 'MSFullscreenChange']) document.addEventListener(ev, onChange);
  matchMedia('(display-mode: standalone)').addEventListener?.('change', update);
  if (btn) {
    // po kliknięciu fokus wraca na grę, żeby SPACJA dalej skakała zamiast przełączać pełny ekran;
    // pointerdown nie leci dalej, żeby w trybie przechyłu dotknięcie przycisku nie było skokiem
    btn.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); });
    btn.addEventListener('click', (e) => { e.stopPropagation(); toggleFullscreen(); focusGame(); });
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  update();
}
