// iPhone / iPad: instrukcja „Do ekranu początkowego”. Safari na iOS nie daje zwykłej stronie pełnego ekranu,
// ale gra dodana do ekranu początkowego startuje bez pasków (manifest: display „fullscreen”).
// Okienko pokazuje się samo raz, przy pierwszym uruchomieniu w Safari, a potem po dotknięciu przycisku pełnego ekranu.
import { sfx } from './audio.js';
import { loadJSON, saveJSON } from './util.js';

const SEEN = 'stepjumper.iosHelp.v1';
const box = document.getElementById('ios');

/** iPhone, iPod albo iPad (iPadOS przedstawia się jako Mac z ekranem dotykowym). */
export const isIOS = /iP(hone|od|ad)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
/** Gra już działa bez pasków przeglądarki (zainstalowana aplikacja albo pełny ekran z F11). */
export const standalone = () => matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches || navigator.standalone === true;

export const installOpen = () => !!box && !box.hidden;

export function showInstall() {
  if (!box) return;
  box.hidden = false;
  saveJSON(SEEN, { seen: true });
  document.getElementById('iosOk')?.focus({ preventScroll: true });
  box.querySelector('.card')?.scrollTo?.(0, 0);
}
export function hideInstall() {
  if (!box || box.hidden) return;
  box.hidden = true;
  sfx.pick();
}

/** Podpina okienko; przy pierwszym uruchomieniu w Safari na iOS pokazuje je po chwili. */
export function initInstall(game) {
  if (!box) return;
  // dotknięcia w okienku nie trafiają do gry (w trybie przechyłu każde dotknięcie to skok)
  box.addEventListener('pointerdown', (e) => e.stopPropagation());
  box.addEventListener('click', (e) => { e.stopPropagation(); if (e.target === box) hideInstall(); });
  document.getElementById('iosOk')?.addEventListener('click', hideInstall);
  if (isIOS && !standalone() && !loadJSON(SEEN, { seen: false }).seen) {
    setTimeout(() => { if (game.state === 'title') showInstall(); }, 1200);
  }
}
