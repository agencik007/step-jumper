// Sterowanie: klawiatura, gamepad i sześć trybów dotykowych do wyboru w OPCJACH → STEROWANIE:
//   buttons  – przyciski ekranowe ◀ ▶ + ▲,
//   halves   – przytrzymana połowa ekranu = bieg w tę stronę, skok przyciskiem ▲ (po jednym w każdym dolnym rogu),
//   swipe    – przytrzymana połowa ekranu = bieg, przesunięcie palca w górę = skok,
//   joystick – pływająca gałka (płynna prędkość) pod jednym kciukiem, skok pod drugim,
//   tilt     – przechył telefonu (płynna prędkość, z regulowaną czułością) + dotknięcie = skok,
//   one      – jeden przycisk: bohater sam biega i zawraca przy ścianach, cały ekran (każdy klawisz skoku) = skok.
// Każdy tryb daje tylko oś −1…1 i skok – symulacja i zapis biegu są dla wszystkich takie same.
//
// Klawisze i przyciski pada dla biegu, skoku i pauzy można przypisać na nowo (OPCJE → STEROWANIE → Klawiatura / Pad).
// Menu mają stałe przyciski: strzałki, Enter, Spacja i Esc; na padzie krzyżak lub gałka, A (dolny) – wybierz,
// B (prawy) – wróć, Y (górny) – ranking / menu, X (lewy) – opcje, Start – start / pauza.
import { H, W } from '../sim';
import { sfx } from './audio.js';
import { BTN, KIND_NAMES, padKind, readPad } from './gamepad.js';
import { canvas, focusGame } from './gfx.js';
import { t } from './i18n.js';
import { toggleFullscreen } from './fullscreen.js';
import { hideInstall, installOpen } from './install.js';
import { cancelNick, nickOpen } from './nickform.js';
import { closePadEditor, initPadEditor, padEditing, padScale, restStick, stickHome } from './padlayout.js';
import { clamp, mod } from './util.js';

let game = null;                       // ustawiane przez initInput – ten moduł nie importuje gry, żeby nie robić pętli zależności

export const isTouch = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;

// ───────────────────────── przypisania klawiszy i przycisków pada ─────────────────────────
export const BIND_ACTS = ['left', 'right', 'jump', 'pause'];
export const KEY_SLOTS = 3, PAD_SLOTS = 2;
const KEY_DEFAULT = { left: ['ArrowLeft', 'KeyA', null], right: ['ArrowRight', 'KeyD', null], jump: ['Space', 'ArrowUp', 'KeyW'], pause: ['KeyP', null, null] };
const PAD_DEFAULT = { left: [BTN.LEFT, null], right: [BTN.RIGHT, null], jump: [BTN.A, BTN.B], pause: [BTN.START, null] };
const copy = (o) => JSON.parse(JSON.stringify(o));
/** key: kody klawiszy (KeyboardEvent.code), pad: numery przycisków; names – napisy klawiszy z układu klawiatury gracza. */
export const binds = { key: copy(KEY_DEFAULT), pad: copy(PAD_DEFAULT), names: {} };

/** Akcja przypisana klawiszowi (albo null). */
export function keyAct(code) {
  for (const a of BIND_ACTS) if (binds.key[a].includes(code)) return a;
  return null;
}
const SYMBOLS = {
  ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Enter: 'ENTER', Tab: 'TAB', Backspace: '⌫',
  ShiftLeft: 'SHIFT', ShiftRight: 'SHIFT ▸', ControlLeft: 'CTRL', ControlRight: 'CTRL ▸', AltLeft: 'ALT', AltRight: 'ALT GR',
  MetaLeft: 'META', MetaRight: 'META ▸', CapsLock: 'CAPS', Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'",
  BracketLeft: '[', BracketRight: ']', Backslash: '\\', Minus: '-', Equal: '=', Backquote: '`',
};
/** Napis klawisza do opcji i podpowiedzi. */
export function keyLabel(code) {
  if (!code) return '—';
  if (code === 'Space') return t('key.space');
  if (binds.names[code]) return binds.names[code];
  if (SYMBOLS[code]) return SYMBOLS[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad/.test(code)) return `NUM ${code.slice(6)}`;
  return code.toUpperCase();
}
/** Nowe przypisanie; ten sam klawisz (przycisk) znika z innych miejsc, żeby jeden klawisz nie robił dwóch rzeczy. */
export function setBind(kind, act, slot, value, name) {
  const m = binds[kind];
  if (value != null) for (const a of BIND_ACTS) m[a] = m[a].map((v) => (v === value ? null : v));
  m[act][slot] = value;
  if (kind === 'key' && value) {
    if (name && name.length === 1 && name !== ' ') binds.names[value] = name.toUpperCase();
    else delete binds.names[value];
  }
}
export function resetBinds(kind) {
  binds[kind] = copy(kind === 'key' ? KEY_DEFAULT : PAD_DEFAULT);
  if (kind === 'key') binds.names = {};
}
/** Zapisane przypisania (z prefs gry); niepoprawne wpisy wracają do domyślnych. */
export function loadBinds(keys, padKeys, names) {
  const ok = (src, def, n, valid) => {
    const out = copy(def);
    if (!src || typeof src !== 'object') return out;
    for (const a of BIND_ACTS) {
      if (!Array.isArray(src[a])) continue;
      out[a] = Array.from({ length: n }, (_, i) => (valid(src[a][i]) ? src[a][i] : null));
    }
    return out;
  };
  binds.key = ok(keys, KEY_DEFAULT, KEY_SLOTS, (v) => typeof v === 'string' && v.length < 32 && v !== 'Escape');
  binds.pad = ok(padKeys, PAD_DEFAULT, PAD_SLOTS, (v) => Number.isInteger(v) && v >= 0 && v < 32);
  binds.names = {};
  if (names && typeof names === 'object') for (const [k, v] of Object.entries(names)) if (typeof v === 'string' && v.length <= 2) binds.names[k] = v;
}

// ───────────────────────── ustawienia sterowania ─────────────────────────
export const JUMP_MODES = ['hold', 'toggle', 'auto'];
export const DEAD_STEPS = 8;
/** jump: przytrzymanie / przełącznik / automat; stickDead, padDead: martwa strefa gałki ekranowej i gałki pada (0…8). */
export const opts = { jump: 'hold', stickDead: 3, padDead: 3 };
export const OPTS_DEFAULT = { ...opts };
export const stickDeadValue = (s = opts.stickDead) => 0.02 + s * 0.04;   // 2% … 34% zasięgu gałki
export const padDeadValue = (s = opts.padDead) => 0.05 + s * 0.05;       // 5% … 45% wychylenia gałki pada

/** Ostatnio używane wejście – od niego zależą podpowiedzi na ekranie: 'touch' | 'keys' | 'pad'. */
export const inputSrc = { last: isTouch ? 'touch' : 'keys' };
export const hintMode = () => (inputSrc.last === 'pad' ? 'pad' : isTouch ? 'touch' : 'keys');

// ───────────────────────── stan wejścia ─────────────────────────
const down = new Set();
const touch = { left: false, right: false, jump: false };   // przyciski ekranowe (.pad)
const zone = { axis: 0, jump: false, jumpUntil: 0 };        // dotyk samego ekranu: połówki, przesunięcia, gałka, przechył
const pad = { left: false, right: false, jump: false, axis: 0 };
export const input = {
  edge: false,                         // świeże wciśnięcie „akcji” (menu)
  get left()  { return held('left'); },
  get right() { return held('right'); },
  get jump()  { return held('jump'); },
  get padAxis() { return pad.axis; },  // gałka pada – wartość płynna
  takeEdge()  { const e = this.edge; this.edge = false; return e; },
};
function held(act) {
  if (touch[act] || pad[act]) return true;
  if (act === 'jump' && (zone.jump || performance.now() < zone.jumpUntil)) return true;
  for (const code of down) if (binds.key[act]?.includes(code)) return true;
  return false;
}

// ───────────────────────── przechył (żyroskop) + dotyk ─────────────────────────
/** raw – ostatnie odczytane wychylenie (°), zero – wychylenie uznane za „prosto” (kalibracja). */
export const tilt = { want: false, active: false, seen: false, listening: false, axis: 0, sens: 4, raw: 0, zero: 0 };
export const TILT_ZERO_MAX = 45;

// ───────────────────────── wybór trybu ─────────────────────────
export const CONTROLS = ['buttons', 'halves', 'swipe', 'joystick', 'tilt', 'one'];
/** Tryby z przyciskami ekranowymi (tylko je da się układać i zmieniać im rozmiar). */
export const PAD_MODES = ['buttons', 'halves', 'joystick'];
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
  tilt.raw = tiltDegrees(e.beta, e.gamma, screen.orientation?.angle ?? window.orientation ?? 0);
  const deg = tilt.raw - tilt.zero;
  const { dead, full } = tiltRange(tilt.sens);
  const mag = clamp((Math.abs(deg) - dead) / (full - dead), 0, 1);
  tilt.axis += (Math.sign(deg) * mag - tilt.axis) * (1 - TILT_SMOOTH);
}
/** Kalibracja: obecne ułożenie telefonu staje się pozycją „prosto”. */
export function calibrateTilt() { tilt.zero = clamp(Math.round(tilt.raw), -TILT_ZERO_MAX, TILT_ZERO_MAX); }
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
//   jump  – dotknięcie, które samo w sobie jest skokiem (przechył, jeden przycisk, strona skoku przy gałce).
const ptrs = new Map();
const SWIPE = 28, REARM = 18, SWIPE_HOLD = 150;   // px: przesunięcie w górę = skok, cofnięcie palca = gotowość do kolejnego; ms trzymania skoku po krótkim machnięciu
const STICK_R = 52;                               // px: zasięg gałki przy rozmiarze 100%
const TAP_HOLD = 60;                              // ms: najkrótszy skok – szybkie stuknięcie (krótsze niż klatka) też musi trafić do symulacji
const holdJump = () => { zone.jumpUntil = Math.max(zone.jumpUntil, performance.now() + TAP_HOLD); };
let stickEl = null;

const sideOf = (x) => (x < innerWidth / 2 ? -1 : 1);
const stickR = () => STICK_R * padScale();
/** Strona gałki: własny układ albo praworęczny – lewa połowa (skok pod prawym kciukiem), leworęczny – odwrotnie. */
const stickSide = () => stickHome() ?? (game?.lefty ? 1 : -1);

function onScreenDown(e) {
  if (game.state !== 'play') return;                     // w menu dotyk obsługuje „click” na płótnie
  if (e.target instanceof Element && e.target.closest('button, input, form, .sheet, .pad, #corner, #padEdit')) return;
  const m = ctrl.mode, x = e.clientX, y = e.clientY;
  let p = null;
  if (tilt.active || m === 'one') p = { kind: 'jump' };
  else if (m === 'halves' || m === 'swipe') p = { kind: 'run', side: sideOf(x), base: y, peak: y, jumping: false };
  else if (m === 'joystick') {
    const hasStick = [...ptrs.values()].some((q) => q.kind === 'stick'), R = stickR();
    if (sideOf(x) === stickSide() && !hasStick) {
      p = { kind: 'stick', cx: clamp(x, R + 8, innerWidth - R - 8), cy: y, axis: 0, dx: 0, dy: 0 };
    } else if (sideOf(x) !== stickSide()) p = { kind: 'jump' };
  }
  if (!p) return;
  if (p.kind === 'jump') holdJump();
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
  const R = stickR(), dead = stickDeadValue();
  let dx = x - p.cx;
  if (Math.abs(dx) > R) { p.cx = x - Math.sign(dx) * R; dx = Math.sign(dx) * R; }
  const k = Math.abs(dx) / R;
  p.axis = k < dead ? 0 : Math.sign(dx) * (k - dead) / (1 - dead);
  const dy = clamp(y - p.cy, -R, R), len = Math.hypot(dx, dy), f = len > R ? R / len : 1;
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
/** Gałka na ekranie: w spoczynku blady zarys w swoim miejscu, pod palcem – pod palcem. */
function drawStick(p) {
  if (!stickEl) return;
  stickEl.classList.toggle('on', !!p);
  if (p) {
    stickEl.style.left = `${p.cx}px`; stickEl.style.top = `${p.cy}px`;
    stickEl.style.setProperty('--kx', `${p.dx}px`); stickEl.style.setProperty('--ky', `${p.dy}px`);
  } else {
    restStick();
    stickEl.style.setProperty('--kx', '0px'); stickEl.style.setProperty('--ky', '0px');
  }
}
/** Puszcza wszystkie palce (zmiana trybu, utrata fokusu). */
function releaseAll() {
  ptrs.clear(); zone.axis = 0; zone.jump = false; zone.jumpUntil = 0;
  drawStick(null);
}

// ───────────────────────── gamepad ─────────────────────────
let prevB = [], navHeld = null, navNext = 0;
const NAV_DELAY = 380, NAV_REPEAT = 110;   // ms: przytrzymany kierunek w menu powtarza się jak klawisz

export function pollGamepad() {
  const p = readPad();
  pad.left = pad.right = pad.jump = false; pad.axis = 0;
  if (!p) { prevB = []; navHeld = null; return; }
  const B = p.buttons;
  const fresh = B.some((v, i) => v && !prevB[i]);
  if (fresh || Math.abs(p.ax) > 0.5 || Math.abs(p.ay) > 0.5) inputSrc.last = 'pad';
  if (fresh) sfx.unlock();
  try { handlePad(p, B); } finally { prevB = B.slice(); }
}

function handlePad(p, B) {
  const edge = (i) => i != null && !!B[i] && !prevB[i];
  const st = game.settings;
  // przypisywanie przycisku: czekamy, aż gracz puści wszystko (także przycisk, którym wybrał pole), potem bierzemy pierwszy wciśnięty
  if (game.state === 'settings' && st.capture?.kind === 'pad') {
    if (!st.capture.armed) { if (!B.some(Boolean)) st.capture.armed = true; return; }
    const i = B.findIndex((v, j) => v && !prevB[j]);
    if (i >= 0) game.bindPad(i);
    return;
  }
  if (padEditing()) { if (edge(BTN.A) || edge(BTN.B) || edge(BTN.START)) closePadEditor(); return; }
  if (installOpen()) { if (edge(BTN.A) || edge(BTN.B)) hideInstall(); return; }
  if (nickOpen()) { if (edge(BTN.B)) cancelNick(); return; }

  // bieg i skok: przypisane przyciski + lewa gałka (płynnie, z martwą strefą)
  const dz = padDeadValue(), m = Math.abs(p.ax);
  const bound = (act) => binds.pad[act].some((i) => i != null && B[i]);
  pad.axis = m < dz ? 0 : Math.sign(p.ax) * Math.min(1, (m - dz) / Math.max(0.05, 0.9 - dz));
  pad.left = bound('left'); pad.right = bound('right'); pad.jump = bound('jump');
  const s = game.state;
  if (s === 'play') {
    if (binds.pad.pause.some(edge)) game.togglePause();
    return;
  }

  // menu: krzyżak albo gałka, z powtarzaniem przy przytrzymaniu
  const thr = Math.max(0.5, dz);
  const dir = B[BTN.UP] || p.ay < -thr ? 'up' : B[BTN.DOWN] || p.ay > thr ? 'down'
    : B[BTN.LEFT] || p.ax < -thr ? 'left' : B[BTN.RIGHT] || p.ax > thr ? 'right' : null;
  const now = performance.now();
  let nav = null;
  if (dir !== navHeld) { navHeld = dir; nav = dir; navNext = now + NAV_DELAY; }
  else if (dir && now >= navNext) { nav = dir; navNext = now + NAV_REPEAT; }
  const A = edge(BTN.A), Bk = edge(BTN.B), X = edge(BTN.X), Y = edge(BTN.Y);
  const START = edge(BTN.START), SEL = edge(BTN.SELECT), LB = edge(BTN.LB), RB = edge(BTN.RB);

  switch (s) {
    case 'title':
      if (nav === 'left' || nav === 'right') game.pick('char', nav === 'left' ? -1 : 1);
      else if (nav === 'up' || nav === 'down') game.pick('style', nav === 'up' ? -1 : 1);
      if (A || START) game.start();
      else if (Y) game.openBoard();
      else if (X || SEL) game.openSettings();
      else if (LB) game.openNews();
      else if (RB) game.reloadGame();
      break;
    case 'pause':
      if (A || Bk || START || binds.pad.pause.some(edge)) game.togglePause();
      else if (Y || SEL) { sfx.pick(); game.toTitle(); }
      break;
    case 'over':
      if (game.overT <= 0.6) break;
      if (A || Bk || START) game.start();
      else if (Y || SEL) game.toTitle();
      break;
    case 'board':
      if (nav === 'left' || LB) game.boardTab(-1);
      else if (nav === 'right' || RB) game.boardTab(1);
      else if (nav === 'up' || nav === 'down') game.boardMove(nav === 'up' ? -1 : 1);
      if (A) game.boardConfirm();
      else if (Bk) { sfx.pick(); game.toTitle(); }
      break;
    case 'recap':
      if (nav === 'left' || nav === 'right') game.recapMove(nav === 'left' ? -1 : 1);
      if (A) game.recapWatch();
      else if (Y) game.recapBoard();
      else if (Bk || START) game.closeRecap();
      break;
    case 'replay':
      if (game.replay?.ended) { if (A || START) game.replayToggle(); else if (Bk) game.exitReplay(); break; }
      if (A || START) game.replayToggle();
      else if (X) game.replayStop();
      else if (Bk) game.exitReplay();
      else if (nav === 'left' || LB) game.replaySpeed(-1);
      else if (nav === 'right' || RB) game.replaySpeed(1);
      break;
    case 'settings':
      if (nav === 'up' || nav === 'down') game.settingsMove(nav === 'up' ? -1 : 1);
      else if (nav === 'left' || nav === 'right') game.settingsSide(nav === 'left' ? -1 : 1);
      if (A) game.activate(game.settings.sel);
      else if (Bk) game.settingsBack();
      else if (X) game.clearBind();
      else if (LB || RB) game.settingsMove(LB ? -5 : 5, true);
      break;
  }
}

// ───────────────────────── klawiatura ─────────────────────────
function onKey(e) {
  if (e.target instanceof HTMLInputElement && e.target.type !== 'range') return;   // pisanie nicku – klawisze należą do pola tekstowego
  // przycisk z fokusem (Tab): Enter i spacja go naciskają, a nie startują gry pod spodem
  if (e.target instanceof HTMLButtonElement && ['Enter', 'NumpadEnter', 'Space'].includes(e.code)) return;
  inputSrc.last = 'keys';
  if (padEditing()) {                                  // edytor układu: suwaki działają strzałkami, Esc / Enter kończy
    if (e.code === 'Escape' || (e.code === 'Enter' && !(e.target instanceof HTMLButtonElement))) { e.preventDefault(); closePadEditor(); }
    return;
  }
  if (installOpen()) {                                 // instrukcja iOS na wierzchu: klawisze tylko ją zamykają
    if (['Escape', 'Enter', 'Space'].includes(e.code)) { e.preventDefault(); hideInstall(); }
    return;
  }
  const st = game.settings;
  if (game.state === 'settings' && st.capture) {       // przypisywanie klawisza
    e.preventDefault();
    if (e.repeat) return;
    if (e.code === 'Escape') game.cancelCapture();
    else if (st.capture.kind === 'key') {
      if (e.code === 'Backspace' || e.code === 'Delete') game.clearBind();
      else game.bindKey(e.code, e.key);
    }
    return;
  }
  sfx.unlock();
  const code = e.code, act = keyAct(code), free = !act;   // klawisz bez akcji może być skrótem (R, O, N, U, T, F, M)
  const left = code === 'ArrowLeft' || act === 'left', right = code === 'ArrowRight' || act === 'right';
  const up = code === 'ArrowUp' || (code === 'KeyW' && (free || act === 'jump'));
  const dn = code === 'ArrowDown' || (code === 'KeyS' && free);
  if (act || left || right || up || dn || code === 'Space') e.preventDefault();
  const s = game.state;
  if (e.repeat && !(s === 'settings' && (up || dn || left || right))) return;   // w długiej liście opcji strzałki się powtarzają

  if (s === 'title') {
    if (left || right) { game.pick('char', left ? -1 : 1); return; }
    if (up || dn) { game.pick('style', up ? -1 : 1); return; }
    if (free && code === 'KeyR') { game.openBoard(); return; }
    if (free && code === 'KeyO') { game.openSettings(); return; }
    if (free && code === 'KeyN') { game.openNews(); return; }
    if (free && code === 'KeyU') { game.reloadGame(); return; }
  } else if (s === 'board') {
    if (left || right) { game.boardTab(left ? -1 : 1); return; }
    if (up || dn) { game.boardMove(up ? -1 : 1); return; }
    if (free && code === 'KeyN') { game.editNick(); return; }
    if (/^(Digit|Numpad)[123]$/.test(code)) { game.boardReplay(Number(code.slice(-1))); return; }
  } else if (s === 'recap') {
    if (/^(Digit|Numpad)[123]$/.test(code)) { game.recapReplay(Number(code.slice(-1))); return; }
    if (left || right) { game.recapMove(left ? -1 : 1); return; }
    if (free && code === 'KeyR') { game.recapBoard(); return; }
    if (code === 'Escape') { game.closeRecap(); return; }
  } else if (s === 'replay') {
    if (left || right) { game.replaySpeed(left ? -1 : 1); return; }
    if (free && code === 'KeyS') { game.replayStop(); return; }
    if (code === 'Escape') { game.exitReplay(); return; }
  } else if (s === 'settings') {
    if (up || dn) { game.settingsMove(up ? -1 : 1); return; }
    if (left || right) { game.settingsSide(left ? -1 : 1); return; }
    if (code === 'PageUp' || code === 'PageDown') { game.settingsMove(code === 'PageUp' ? -5 : 5, true); return; }
    if (code === 'Backspace' || code === 'Delete') { game.clearBind(); return; }
  }
  if (act && s !== 'board' && s !== 'settings' && s !== 'replay') down.add(code);
  if (act === 'jump' && s === 'play') holdJump();
  if (code === 'Space' || code === 'Enter' || act === 'jump') input.edge = true;
  else if (code === 'Escape' && s === 'settings') game.settingsBack();
  else if (act === 'pause') game.togglePause();
  else if (free && code === 'KeyT' && s === 'title') toggleTilt();
  else if (free && code === 'KeyF') toggleFullscreen();
  else if (free && code === 'KeyI' && (s === 'play' || s === 'pause')) game.speakStatus();   // czytnik ekranu: stan biegu
  else if (code === 'Escape') { if (['over', 'pause', 'board', 'settings'].includes(s)) game.toTitle(); else game.pause(); }
  else if (free && code === 'KeyM') {
    sfx.muted = !sfx.muted;
    game.savePrefs();
    game.say(t(sfx.muted ? 'msg.soundOff' : 'msg.soundOn'), '', 'hint', 1);
  }
}

/** Podpina wszystkie zdarzenia wejścia do podanej gry. Wywoływane raz, przy starcie. */
export function initInput(theGame) {
  game = theGame;

  addEventListener('keydown', onKey);
  addEventListener('keyup', (e) => { down.delete(e.code); });
  addEventListener('blur', () => { down.clear(); releaseAll(); game.pause(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) game.pause(); });

  // menu obsługuje „click” (a nie pointerdown), bo iOS pozwala poprosić o dostęp do czujników tylko z kliknięcia
  let drag = null, swallow = false;                    // przewijanie listy opcji palcem: przeciągnięcie to nie kliknięcie
  canvas.addEventListener('click', (e) => {
    if (swallow) { swallow = false; return; }
    if (padEditing()) return;
    sfx.unlock();
    const r = canvas.getBoundingClientRect();
    game.pointer((e.clientX - r.left) / r.width * W, (e.clientY - r.top) / r.height * H);
  });
  canvas.addEventListener('pointerdown', (e) => {
    swallow = false;
    if (game.state === 'settings' && !padEditing()) drag = { id: e.pointerId, y: e.clientY, from: game.settings.scroll, moved: false };
  });
  addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = (e.clientY - drag.y) / canvas.getBoundingClientRect().height * H;
    if (!drag.moved && Math.abs(dy) > 7) drag.moved = true;
    if (drag.moved) game.settingsScroll(drag.from - dy, true);
  });
  for (const ev of ['pointerup', 'pointercancel']) addEventListener(ev, (e) => { if (drag && e.pointerId === drag.id) { swallow = drag.moved; drag = null; } });
  canvas.addEventListener('wheel', (e) => {
    if (game.state !== 'settings') return;
    e.preventDefault();
    game.settingsScroll(game.settings.scrollTo + e.deltaY * (e.deltaMode === 1 ? 16 : 0.6));
  }, { passive: false });

  addEventListener('pointerdown', (e) => {
    sfx.unlock();
    inputSrc.last = e.pointerType === 'mouse' ? 'keys' : 'touch';
    onScreenDown(e);
  });
  // gałka i machnięcie: surowe ruchy palca bez czekania na klatkę (pointerrawupdate – Chrome po HTTPS), a obok zwykłe
  // pointermove, bo nie każda przeglądarka wysyła surowe zdarzenia dla dotyku. Ta sama pozycja dwa razy niczego nie psuje.
  if ('onpointerrawupdate' in window) addEventListener('pointerrawupdate', onScreenMove);
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
      if (padEditing()) return;                        // edytor układu przeciąga przycisk
      e.preventDefault(); sfx.unlock();
      try { btn.setPointerCapture(e.pointerId); } catch {}
      set(true);
      if (act === 'jump') { input.edge = true; if (game.state === 'play') holdJump(); }
      else if (game.state === 'title') game.pick('char', act === 'left' ? -1 : 1);
      else if (game.state === 'board') game.boardTab(act === 'left' ? -1 : 1);
      else if (game.state === 'replay') game.replaySpeed(act === 'left' ? -1 : 1);
    });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) btn.addEventListener(ev, () => set(false));
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  initPadEditor(() => game.savePrefs());

  // przycisk pauzy (widoczny tylko w trakcie biegu i pauzy – CSS na body[data-state])
  const pauseBtn = document.getElementById('pause');
  if (pauseBtn) {
    pauseBtn.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); });   // w trybie przechyłu to nie jest skok
    pauseBtn.addEventListener('click', (e) => { e.stopPropagation(); sfx.unlock(); sfx.pick(); game.togglePause(); focusGame(); });
    pauseBtn.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // pad: komunikat po podłączeniu (z rozpoznanym rodzajem), pauza po odłączeniu w trakcie biegu
  addEventListener('gamepadconnected', (e) => {
    inputSrc.last = 'pad';
    const name = KIND_NAMES[padKind(e.gamepad?.id ?? '')] ?? t('pad.generic');
    game.say(t('msg.padOn', { name }), t('msg.padOnSub'), 'mint', 2.2);
  });
  addEventListener('gamepaddisconnected', () => {
    if (game.state === 'play') game.pause();
    game.say(t('msg.padOff'), '', 'warn', 1.6);
  });

  showControl();
  // zapamiętany tryb przechyłu: Android włącza się od razu, iOS dopiero po pierwszym kliknięciu (wymóg zgody)
  if (tilt.want) {
    if (typeof window.DeviceOrientationEvent?.requestPermission === 'function') addEventListener('click', () => { if (tilt.want && !tilt.active) enableTilt(); }, { once: true, capture: true });
    else enableTilt();
  }
}
