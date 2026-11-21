// Sterowanie: klawiatura, gamepad i pięć trybów dotykowych do wyboru w OPCJACH → STEROWANIE:
//   buttons  – przyciski ekranowe ◀ ▶ + ▲,
//   halves   – przytrzymana połowa ekranu = bieg w tę stronę, skok przyciskiem ▲ (po jednym w każdym dolnym rogu),
//   swipe    – przytrzymana połowa ekranu = bieg, przesunięcie palca w górę = skok,
//   joystick – pływająca gałka (płynna prędkość) pod jednym kciukiem, skok pod drugim,
//   tilt     – przechył telefonu (płynna prędkość, z regulowaną czułością) + dotknięcie = skok.
// Każdy tryb daje tylko oś −1…1 i skok – symulacja i zapis biegu są dla wszystkich takie same.
import { H, W } from '../sim';
import { sfx } from './audio.js';
import { canvas } from './gfx.js';
import { t } from './i18n.js';
import { toggleFullscreen } from './fullscreen.js';
import { hideInstall, installOpen } from './install.js';
import { clamp, mod } from './util.js';

let game = null;                       // ustawiane przez initInput – ten moduł nie importuje gry, żeby nie robić pętli zależności

const KEYMAP = {
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
  Space: 'jump', ArrowUp: 'jump', KeyW: 'jump',
};
const down = new Set();
const touch = { left: false, right: false, jump: false };   // przyciski ekranowe (.pad)
const zone = { axis: 0, jump: false, jumpUntil: 0 };        // dotyk samego ekranu: połówki, przesunięcia, gałka, przechył
const pad = { left: false, right: false, jump: false, up: false, down: false };
export const input = {
  edge: false,                         // świeże wciśnięcie „akcji” (menu)
  get left()  { return held('left'); },
  get right() { return held('right'); },
  get jump()  { return held('jump'); },
  takeEdge()  { const e = this.edge; this.edge = false; return e; },
};
function held(act) {
  if (touch[act] || pad[act]) return true;
  if (act === 'jump' && (zone.jump || performance.now() < zone.jumpUntil)) return true;
  for (const code of down) if (KEYMAP[code] === act) return true;
  return false;
}

// ───────────────────────── przechył (żyroskop) + dotyk ─────────────────────────
export const isTouch = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
export const tilt = { want: false, active: false, seen: false, listening: false, axis: 0, sens: 4 };

// ───────────────────────── wybór trybu ─────────────────────────
export const CONTROLS = ['buttons', 'halves', 'swipe', 'joystick', 'tilt'];
export const SENS_MAX = 8;                             // czułość przechyłu: 0 (łagodnie) … 8 (czule), domyślnie 4
export const ctrl = { mode: 'buttons' };

/**
 * Czułość przechyłu → stopnie: martwa strefa i wychylenie dające pełny bieg.
 * Środek suwaka to dawne stałe (3° / 13°); każdy krok mnoży wychylenie o ~1,14.
 */
export function tiltRange(sens) {
  const full = 13 * 2 ** ((SENS_MAX / 2 - sens) * 0.19);
  return { dead: full * 0.23, full };
}
const TILT_SMOOTH = 0.45;

/** Zmienia tryb sterowania; przechył najpierw prosi o czujnik (iOS: tylko z kliknięcia). */
export function setControl(mode) {
  if (!CONTROLS.includes(mode)) mode = 'buttons';
  ctrl.mode = mode;
  releaseAll();
  tilt.want = mode === 'tilt';
  if (game) {
    if (tilt.want && !tilt.active) enableTilt();
    else if (!tilt.want && tilt.active) setTilt(false);
  }
  showControl();
}
/** Klasa na <body> – CSS pokazuje przyciski i gałkę właściwe dla trybu. */
function showControl() {
  if (typeof document === 'undefined') return;
  const b = document.body;
  for (const m of CONTROLS) b.classList.toggle(`ctrl-${m}`, m === ctrl.mode);
}
/** Przechył nie ruszył (brak czujnika, odmowa): wracamy do przycisków. */
function tiltFailed() {
  tilt.want = false; setTilt(false);
  ctrl.mode = 'buttons'; showControl();
  game.savePrefs();
}

/** Oś z dotyku: przechył albo gałka dają wartość płynną, połówki ekranu ±1. */
export function touchAxis() { return tilt.active ? tilt.axis : zone.axis; }

// Boczne wychylenie ekranu w stopniach. Liczone z wektora grawitacji, a nie wprost z kąta gamma,
// dzięki czemu działa tak samo w pionie, w poziomie i z telefonem trzymanym „na płasko”.
export function tiltDegrees(beta, gamma, angle) {
  const b = beta * Math.PI / 180, g = gamma * Math.PI / 180;
  const ux = -Math.cos(b) * Math.sin(g), uy = Math.sin(b);          // „góra” świata w układzie urządzenia
  const a = mod(Math.round(angle / 90) * 90, 360);                   // obrót ekranu
  const s = a === 0 ? -ux : a === 90 ? uy : a === 180 ? ux : -uy;
  return Math.asin(clamp(s, -1, 1)) * 180 / Math.PI;
}
function onOrient(e) {
  if (e.beta == null || e.gamma == null) return;
  tilt.seen = true;
  const deg = tiltDegrees(e.beta, e.gamma, screen.orientation?.angle ?? window.orientation ?? 0);
  const { dead, full } = tiltRange(tilt.sens);
  const mag = clamp((Math.abs(deg) - dead) / (full - dead), 0, 1);
  tilt.axis += (Math.sign(deg) * mag - tilt.axis) * (1 - TILT_SMOOTH);
}
function setTilt(on) {
  tilt.active = on; tilt.axis = 0;
  if (!on) releaseAll();
  document.body.classList.toggle('tilt', on);
}
async function enableTilt() {
  try {
    const D = window.DeviceOrientationEvent;
    if (!D) throw new Error('no-sensor');
    if (typeof D.requestPermission === 'function' && (await D.requestPermission()) !== 'granted') throw new Error('denied');
    if (ctrl.mode !== 'tilt') return;                  // w trakcie pytania o zgodę gracz wybrał inny tryb
    if (!tilt.listening) { addEventListener('deviceorientation', onOrient); tilt.listening = true; }
    tilt.seen = false;
    setTilt(true);
    setTimeout(() => {                                 // czujnik milczy (komputer, brak HTTPS) → wracamy do przycisków
      if (tilt.active && !tilt.seen) { tiltFailed(); game.say(t('msg.noSensor'), t('msg.noSensorSub'), 'warn', 2.6); }
    }, 1500);
  } catch (err) {
    if (ctrl.mode !== 'tilt') return;
    tiltFailed();
    const denied = err.message === 'denied';
    game.say(t(denied ? 'msg.denied' : 'msg.noSensor'), t(denied ? 'msg.deniedSub' : 'msg.buttonsStay'), 'warn', 2.6);
  }
}
/** Klawisz T na ekranie tytułowym: przechył ↔ przyciski. */
export function toggleTilt() {
  sfx.pick();
  setControl(ctrl.mode === 'tilt' ? 'buttons' : 'tilt');
  game.savePrefs();
}

// ───────────────────────── dotyk samego ekranu ─────────────────────────
// Każdy palec to wpis w `ptrs` (Map trzyma kolejność dotknięć – o kierunku biegu decyduje ostatni palec).
//   run   – połówki / przesunięcia: side −1 | 1 (i w trybie swipe stan gestu „w górę”),
//   stick – gałka: środek (cx, cy) i oś,
//   jump  – dotknięcie, które samo w sobie jest skokiem (przechył, strona skoku przy gałce).
const ptrs = new Map();
const SWIPE = 28, REARM = 18, SWIPE_HOLD = 150;   // px: przesunięcie w górę = skok, cofnięcie palca = gotowość do kolejnego; ms trzymania skoku po krótkim machnięciu
const STICK_R = 52, STICK_DEAD = 0.14;            // px: zasięg gałki; martwa strefa (część zasięgu)
let stickEl = null;

const sideOf = (x) => (x < innerWidth / 2 ? -1 : 1);
/** Strona gałki: praworęczny – lewa połowa (skok pod prawym kciukiem), leworęczny – odwrotnie. */
const stickSide = () => (game?.lefty ? 1 : -1);

function onScreenDown(e) {
  if (game.state !== 'play') return;                     // w menu dotyk obsługuje „click” na płótnie
  if (e.target instanceof Element && e.target.closest('button, input, form, .sheet, .pad, #corner')) return;
  const m = ctrl.mode, x = e.clientX, y = e.clientY;
  let p = null;
  if (tilt.active) p = { kind: 'jump' };
  else if (m === 'halves' || m === 'swipe') p = { kind: 'run', side: sideOf(x), base: y, peak: y, jumping: false };
  else if (m === 'joystick') {
    const hasStick = [...ptrs.values()].some((q) => q.kind === 'stick');
    if (sideOf(x) === stickSide() && !hasStick) {
      p = { kind: 'stick', cx: clamp(x, STICK_R + 8, innerWidth - STICK_R - 8), cy: y, axis: 0, dx: 0, dy: 0 };
    } else if (sideOf(x) !== stickSide()) p = { kind: 'jump' };
  }
  if (!p) return;
  ptrs.set(e.pointerId, p);
  if (p.kind === 'stick') moveStick(p, x, y);
  recompute();
}
function onScreenMove(e) {
  const p = ptrs.get(e.pointerId);
  if (!p) return;
  const x = e.clientX, y = e.clientY;
  if (p.kind === 'run') {
    p.side = sideOf(x);
    if (ctrl.mode === 'swipe') {
      if (!p.jumping) {
        p.base = Math.max(p.base, y);
        if (p.base - y >= SWIPE) { p.jumping = true; p.peak = y; zone.jumpUntil = performance.now() + SWIPE_HOLD; }
      } else {
        p.peak = Math.min(p.peak, y);
        if (y - p.peak >= REARM) { p.jumping = false; p.base = y; }   // palec wraca w dół – można machnąć znowu
      }
    }
  } else if (p.kind === 'stick') moveStick(p, x, y);
  recompute();
}
function onScreenUp(e) {
  if (!ptrs.delete(e.pointerId)) return;
  recompute();
}
/** Gałka „pływa”: gdy palec wyjdzie poza zasięg, środek jedzie za nim – zawrócenie działa od razu. */
function moveStick(p, x, y) {
  let dx = x - p.cx;
  if (Math.abs(dx) > STICK_R) { p.cx = x - Math.sign(dx) * STICK_R; dx = Math.sign(dx) * STICK_R; }
  const k = Math.abs(dx) / STICK_R;
  p.axis = k < STICK_DEAD ? 0 : Math.sign(dx) * (k - STICK_DEAD) / (1 - STICK_DEAD);
  const dy = clamp(y - p.cy, -STICK_R, STICK_R), len = Math.hypot(dx, dy), f = len > STICK_R ? STICK_R / len : 1;
  p.dx = dx * f; p.dy = dy * f;
}
function recompute() {
  let run = null, stick = null, jump = false;
  for (const p of ptrs.values()) {
    if (p.kind === 'jump' || p.jumping) jump = true;
    if (p.kind === 'run') run = p;
    if (p.kind === 'stick') stick = p;
  }
  zone.axis = run ? run.side : stick ? stick.axis : 0;
  zone.jump = jump;
  drawStick(stick);
}
/** Gałka na ekranie: w spoczynku blady zarys w dolnym rogu, pod palcem – pod palcem. */
function drawStick(p) {
  if (!stickEl) return;
  stickEl.classList.toggle('on', !!p);
  if (p) {
    stickEl.style.left = `${p.cx}px`; stickEl.style.top = `${p.cy}px`;
    stickEl.style.setProperty('--kx', `${p.dx}px`); stickEl.style.setProperty('--ky', `${p.dy}px`);
  } else {
    stickEl.style.left = stickEl.style.top = '';
    stickEl.style.setProperty('--kx', '0px'); stickEl.style.setProperty('--ky', '0px');
  }
}
/** Puszcza wszystkie palce (zmiana trybu, utrata fokusu). */
function releaseAll() {
  ptrs.clear(); zone.axis = 0; zone.jump = false; zone.jumpUntil = 0;
  drawStick(null);
}

export function pollGamepad() {
  const gp = navigator.getGamepads ? [...navigator.getGamepads()].find(Boolean) : null;
  const was = { ...pad };
  pad.left = pad.right = pad.jump = pad.up = pad.down = false;
  if (!gp) return;
  const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
  pad.left = ax < -0.35 || !!gp.buttons[14]?.pressed;
  pad.right = ax > 0.35 || !!gp.buttons[15]?.pressed;
  pad.up = ay < -0.5 || !!gp.buttons[12]?.pressed;
  pad.down = ay > 0.5 || !!gp.buttons[13]?.pressed;
  pad.jump = !!gp.buttons[0]?.pressed || !!gp.buttons[1]?.pressed;
  if (pad.jump && !was.jump) { sfx.unlock(); input.edge = true; }
  if (game.state === 'title') {
    if (pad.left && !was.left) game.pick('char', -1);
    if (pad.right && !was.right) game.pick('char', 1);
    if (pad.up && !was.up) game.pick('style', -1);
    if (pad.down && !was.down) game.pick('style', 1);
  } else if (game.state === 'board') {
    if (pad.left && !was.left) game.boardTab(-1);
    if (pad.right && !was.right) game.boardTab(1);
  } else if (game.state === 'replay') {
    if (pad.left && !was.left) game.replaySpeed(-1);
    if (pad.right && !was.right) game.replaySpeed(1);
    if (pad.down && !was.down) game.replayStop();
    if (pad.up && !was.up) game.exitReplay();
  } else if (game.state === 'settings') {
    if (pad.up && !was.up) game.settingsMove(-1);
    if (pad.down && !was.down) game.settingsMove(1);
    if (pad.left && !was.left) game.settingsSide(-1);
    if (pad.right && !was.right) game.settingsSide(1);
  }
}

/** Podpina wszystkie zdarzenia wejścia do podanej gry. Wywoływane raz, przy starcie. */
export function initInput(theGame) {
  game = theGame;

  addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return;   // pisanie nicku – klawisze należą do pola tekstowego
    if (installOpen()) {                                 // instrukcja iOS na wierzchu: klawisze tylko ją zamykają
      if (['Escape', 'Enter', 'Space'].includes(e.code)) { e.preventDefault(); hideInstall(); }
      return;
    }
    sfx.unlock();
    const act = KEYMAP[e.code];
    if (act || e.code === 'ArrowDown' || e.code === 'KeyS') e.preventDefault();
    if (e.repeat) return;
    const up = e.code === 'ArrowUp' || e.code === 'KeyW', dn = e.code === 'ArrowDown' || e.code === 'KeyS';
    if (game.state === 'title') {
      if (act === 'left') game.pick('char', -1);
      else if (act === 'right') game.pick('char', 1);
      else if (up) game.pick('style', -1);
      else if (dn) game.pick('style', 1);
      else if (e.code === 'KeyR') game.openBoard();
      else if (e.code === 'KeyO') game.openSettings();
    } else if (game.state === 'board') {
      if (act === 'left') game.boardTab(-1);
      else if (act === 'right') game.boardTab(1);
      else if (e.code === 'KeyN') { e.preventDefault(); game.editNick(); return; }   // bez „n” w otwieranym polu
      else if (/^(Digit|Numpad)[123]$/.test(e.code)) { game.boardReplay(Number(e.code.slice(-1))); return; }
    } else if (game.state === 'recap') {
      if (/^(Digit|Numpad)[123]$/.test(e.code)) { game.recapReplay(Number(e.code.slice(-1))); return; }
      if (e.code === 'KeyR') { game.recapBoard(); return; }
      if (e.code === 'Escape') { game.closeRecap(); return; }
    } else if (game.state === 'replay') {
      if (act === 'left' || act === 'right') { game.replaySpeed(act === 'left' ? -1 : 1); return; }
      if (e.code === 'KeyS') { game.replayStop(); return; }
      if (e.code === 'Escape') { game.exitReplay(); return; }
    } else if (game.state === 'settings') {
      if (up) { game.settingsMove(-1); return; }
      if (dn) { game.settingsMove(1); return; }
      if (act === 'left' || act === 'right') { game.settingsSide(act === 'left' ? -1 : 1); return; }
    }
    if (act && game.state !== 'board' && game.state !== 'settings' && game.state !== 'replay') down.add(e.code);
    if (e.code === 'Space' || e.code === 'Enter') input.edge = true;
    else if (e.code === 'Escape' && game.state === 'settings') game.settingsBack();
    else if (e.code === 'KeyP') game.togglePause();
    else if (e.code === 'KeyT' && game.state === 'title') toggleTilt();
    else if (e.code === 'KeyF') toggleFullscreen();
    else if (e.code === 'Escape') { if (['over', 'pause', 'board', 'settings'].includes(game.state)) game.toTitle(); else game.pause(); }
    else if (e.code === 'KeyM') {
      sfx.muted = !sfx.muted;
      game.savePrefs();
      game.say(t(sfx.muted ? 'msg.soundOff' : 'msg.soundOn'), '', 'hint', 1);
    }
  });
  addEventListener('keyup', (e) => { down.delete(e.code); });
  addEventListener('blur', () => { down.clear(); releaseAll(); game.pause(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) game.pause(); });

  // menu obsługuje „click” (a nie pointerdown), bo iOS pozwala poprosić o dostęp do czujników tylko z kliknięcia
  canvas.addEventListener('click', (e) => {
    sfx.unlock();
    const r = canvas.getBoundingClientRect();
    game.pointer((e.clientX - r.left) / r.width * W, (e.clientY - r.top) / r.height * H);
  });

  addEventListener('pointerdown', (e) => { sfx.unlock(); onScreenDown(e); });
  addEventListener('pointermove', onScreenMove);
  for (const ev of ['pointerup', 'pointercancel']) addEventListener(ev, onScreenUp);
  stickEl = document.getElementById('stick');

  // przyciski ekranowe; w trybie połówek są dwa ▲, więc stan akcji to „którykolwiek wciśnięty”
  const pressed = { left: new Set(), right: new Set(), jump: new Set() };
  for (const btn of document.querySelectorAll('.pad button')) {
    const act = btn.dataset.act;
    const set = (v) => {
      if (v) pressed[act].add(btn); else pressed[act].delete(btn);
      touch[act] = pressed[act].size > 0; btn.classList.toggle('on', v);
    };
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault(); sfx.unlock();
      try { btn.setPointerCapture(e.pointerId); } catch {}
      set(true);
      if (act === 'jump') input.edge = true;
      else if (game.state === 'title') game.pick('char', act === 'left' ? -1 : 1);
      else if (game.state === 'board') game.boardTab(act === 'left' ? -1 : 1);
      else if (game.state === 'replay') game.replaySpeed(act === 'left' ? -1 : 1);
    });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) btn.addEventListener(ev, () => set(false));
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // przycisk pauzy (widoczny tylko w trakcie biegu i pauzy – CSS na body[data-state])
  const pauseBtn = document.getElementById('pause');
  if (pauseBtn) {
    pauseBtn.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); });   // w trybie przechyłu to nie jest skok
    pauseBtn.addEventListener('click', (e) => { e.stopPropagation(); sfx.unlock(); sfx.pick(); game.togglePause(); pauseBtn.blur(); });
    pauseBtn.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  showControl();
  // zapamiętany tryb przechyłu: Android włącza się od razu, iOS dopiero po pierwszym kliknięciu (wymóg zgody)
  if (tilt.want) {
    if (typeof window.DeviceOrientationEvent?.requestPermission === 'function') addEventListener('click', () => { if (tilt.want && !tilt.active) enableTilt(); }, { once: true, capture: true });
    else enableTilt();
  }
}
