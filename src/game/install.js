// Instalacja gry jako aplikacji (PWA).
//
// iPhone / iPad: instrukcja „Do ekranu początkowego”. Safari na iOS nie daje zwykłej stronie pełnego ekranu,
// ale gra dodana do ekranu początkowego startuje bez pasków (manifest: display „fullscreen”).
// Okienko pokazuje się samo raz, przy pierwszym uruchomieniu w Safari, a potem po dotknięciu przycisku pełnego ekranu.
//
// Android: okienko „Zainstaluj grę”. Chrome (i Edge, Samsung Internet) zgłasza zdarzenie beforeinstallprompt –
// wtedy przycisk ZAINSTALUJ otwiera systemowe okno instalacji. Przeglądarka bez tego zdarzenia (np. Firefox)
// dostaje krótką instrukcję z menu przeglądarki. Odłożone („Nie teraz”) wraca po kilku dniach.
import { sfx } from './audio.js';
import { nickOpen } from './nickform.js';
import { loadJSON, saveJSON } from './util.js';

const SEEN = 'stepjumper.iosHelp.v1';
const ANDROID = 'stepjumper.androidInstall.v1';
const SNOOZE_MS = 3 * 86_400_000;      // „Nie teraz” – zapytamy znowu za 3 dni
const box = document.getElementById('ios');
const abox = document.getElementById('android');

/** iPhone, iPod albo iPad (iPadOS przedstawia się jako Mac z ekranem dotykowym). */
export const isIOS = /iP(hone|od|ad)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isAndroid = /Android/i.test(navigator.userAgent);
/** Gra już działa bez pasków przeglądarki (zainstalowana aplikacja albo pełny ekran z F11). */
export const standalone = () => matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches || navigator.standalone === true;

/** Któreś z okienek instalacji jest na wierzchu (klawisze i dotyk należą wtedy do niego). */
export const installOpen = () => (!!box && !box.hidden) || (!!abox && !abox.hidden);

export function showInstall() {
  if (!box) return;
  box.hidden = false;
  saveJSON(SEEN, { seen: true });
  document.getElementById('iosOk')?.focus({ preventScroll: true });
  box.querySelector('.card')?.scrollTo?.(0, 0);
}
/** Zamyka okienko, które jest otwarte. Zamknięcie okienka Androida bez instalacji odkłada pytanie na kilka dni. */
export function hideInstall() {
  if (box && !box.hidden) { box.hidden = true; sfx.pick(); }
  if (abox && !abox.hidden) { abox.hidden = true; snooze(); sfx.pick(); }
}

// ───────────────────────── Android ─────────────────────────

let deferred = null;                   // zdarzenie beforeinstallprompt – pozwala otworzyć systemowe okno instalacji
let gameRef = null;

const androidPrefs = () => loadJSON(ANDROID, { installed: false, snoozedAt: 0 });
function snooze() { saveJSON(ANDROID, { ...androidPrefs(), snoozedAt: Date.now() }); }

/** Czy wolno teraz zaproponować instalację: Android, gra w przeglądarce, ekran tytułowy, nic innego nie jest otwarte. */
function androidWanted() {
  if (!abox || !isAndroid || standalone()) return false;
  const p = androidPrefs();
  if (p.installed || Date.now() - p.snoozedAt < SNOOZE_MS) return false;
  return gameRef?.state === 'title' && !nickOpen() && !installOpen();
}

function showAndroid() {
  if (!androidWanted()) return;
  abox.classList.toggle('manual', !deferred);       // bez zdarzenia przeglądarki: instrukcja z menu zamiast przycisku
  abox.hidden = false;
  document.getElementById(deferred ? 'andInstall' : 'andOk')?.focus({ preventScroll: true });
}

async function installNow() {
  const e = deferred;
  if (!e) { hideInstall(); return; }
  deferred = null;
  abox.hidden = true;
  sfx.pick();
  try {
    await e.prompt();
    const choice = await e.userChoice;
    if (choice?.outcome === 'accepted') saveJSON(ANDROID, { ...androidPrefs(), installed: true });
    else snooze();
  } catch { snooze(); }
}

/** Podpina okienka; przy pierwszym uruchomieniu w Safari na iOS albo w przeglądarce na Androidzie pokazuje je po chwili. */
export function initInstall(game) {
  gameRef = game;
  for (const b of [box, abox]) {
    if (!b) continue;
    // dotknięcia w okienku nie trafiają do gry (w trybie przechyłu każde dotknięcie to skok)
    b.addEventListener('pointerdown', (e) => e.stopPropagation());
    b.addEventListener('click', (e) => { e.stopPropagation(); if (e.target === b) hideInstall(); });
  }
  document.getElementById('iosOk')?.addEventListener('click', hideInstall);
  document.getElementById('andLater')?.addEventListener('click', hideInstall);
  document.getElementById('andOk')?.addEventListener('click', hideInstall);
  document.getElementById('andInstall')?.addEventListener('click', installNow);

  if (isIOS && !standalone() && !loadJSON(SEEN, { seen: false }).seen) {
    setTimeout(() => { if (game.state === 'title') showInstall(); }, 1200);
  }

  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();                                // zamiast paska przeglądarki – nasze okienko, w dogodnej chwili
    deferred = e;
    abox?.classList.remove('manual');                  // okienko już otwarte z instrukcją → teraz z przyciskiem
  });
  addEventListener('appinstalled', () => {
    deferred = null;
    saveJSON(ANDROID, { ...androidPrefs(), installed: true });
    if (abox) abox.hidden = true;
  });
  // Raz na uruchomienie, na ekranie tytułowym. Chrome zgłasza beforeinstallprompt zwykle w ciągu kilku sekund;
  // przeglądarka, która go nie zgłasza (np. Firefox), po 6 s dostaje instrukcję z menu.
  if (isAndroid && !standalone()) {
    const start = performance.now();
    const iv = setInterval(() => {
      const p = androidPrefs();
      if (p.installed || Date.now() - p.snoozedAt < SNOOZE_MS || standalone()) { clearInterval(iv); return; }
      if (!deferred && performance.now() - start < 6000) return;
      if (androidWanted()) { showAndroid(); clearInterval(iv); }
    }, 1500);
  }
}
