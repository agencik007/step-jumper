// Sterowanie: klawiatura, przyciski ekranowe, gamepad oraz przechył telefonu + dotyk.
import { H, W } from '../sim';
import { sfx } from './audio.js';
import { canvas } from './gfx.js';
import { t } from './i18n.js';
import { toggleFullscreen } from './fullscreen.js';
import { clamp, mod } from './util.js';

let game = null;                       // ustawiane przez initInput – ten moduł nie importuje gry, żeby nie robić pętli zależności

const KEYMAP = {
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
  Space: 'jump', ArrowUp: 'jump', KeyW: 'jump',
};
const down = new Set();
const touch = { left: false, right: false, jump: false };
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
  for (const code of down) if (KEYMAP[code] === act) return true;
  return false;
}

// ───────────────────────── przechył (żyroskop) + dotyk ─────────────────────────
const TILT = { dead: 3, full: 13, smooth: 0.45 };   // stopnie: martwa strefa i wychylenie dające pełny bieg
export const isTouch = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
export const tilt = { want: false, active: false, seen: false, listening: false, axis: 0 };

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
  const mag = clamp((Math.abs(deg) - TILT.dead) / (TILT.full - TILT.dead), 0, 1);
  tilt.axis += (Math.sign(deg) * mag - tilt.axis) * (1 - TILT.smooth);
}
function setTilt(on) {
  tilt.active = on; tilt.axis = 0;
  if (!on) { taps.clear(); touch.jump = false; }
  document.body.classList.toggle('tilt', on);
}
async function enableTilt() {
  try {
    const D = window.DeviceOrientationEvent;
    if (!D) throw new Error('no-sensor');
    if (typeof D.requestPermission === 'function' && (await D.requestPermission()) !== 'granted') throw new Error('denied');
    if (!tilt.listening) { addEventListener('deviceorientation', onOrient); tilt.listening = true; }
    tilt.seen = false;
    setTilt(true);
    setTimeout(() => {                                 // czujnik milczy (komputer, brak HTTPS) → wracamy do przycisków
      if (tilt.active && !tilt.seen) { tilt.want = false; setTilt(false); game.savePrefs(); game.say(t('msg.noSensor'), t('msg.noSensorSub'), 'warn', 2.6); }
    }, 1500);
  } catch (err) {
    tilt.want = false; setTilt(false); game.savePrefs();
    const denied = err.message === 'denied';
    game.say(t(denied ? 'msg.denied' : 'msg.noSensor'), t(denied ? 'msg.deniedSub' : 'msg.buttonsStay'), 'warn', 2.6);
  }
}
export function toggleTilt() {
  sfx.pick();
  tilt.want = !tilt.active;
  if (tilt.want) enableTilt(); else setTilt(false);
  game.savePrefs();
}

// w trybie przechyłu każde dotknięcie ekranu to skok (przytrzymanie = skacz przy każdym lądowaniu)
const taps = new Set();

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
    } else if (game.state === 'settings') {
      if (up) { game.settingsMove(-1); return; }
      if (dn) { game.settingsMove(1); return; }
      if (act === 'left' || act === 'right') { game.settingsSide(act === 'left' ? -1 : 1); return; }
    }
    if (act && game.state !== 'board' && game.state !== 'settings') down.add(e.code);
    if (e.code === 'Space' || e.code === 'Enter') input.edge = true;
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
  addEventListener('blur', () => { down.clear(); game.pause(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) game.pause(); });

  // menu obsługuje „click” (a nie pointerdown), bo iOS pozwala poprosić o dostęp do czujników tylko z kliknięcia
  canvas.addEventListener('click', (e) => {
    sfx.unlock();
    const r = canvas.getBoundingClientRect();
    game.pointer((e.clientX - r.left) / r.width * W, (e.clientY - r.top) / r.height * H);
  });

  addEventListener('pointerdown', (e) => {
    sfx.unlock();
    if (!tilt.active) return;
    taps.add(e.pointerId); touch.jump = true;
  });
  for (const ev of ['pointerup', 'pointercancel']) {
    addEventListener(ev, (e) => { if (taps.delete(e.pointerId) && taps.size === 0) touch.jump = false; });
  }
  for (const btn of document.querySelectorAll('.pad button')) {
    const act = btn.dataset.act;
    const set = (v) => { touch[act] = v; btn.classList.toggle('on', v); };
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault(); sfx.unlock();
      try { btn.setPointerCapture(e.pointerId); } catch {}
      set(true);
      if (act === 'jump') input.edge = true;
      else if (game.state === 'title') game.pick('char', act === 'left' ? -1 : 1);
      else if (game.state === 'board') game.boardTab(act === 'left' ? -1 : 1);
    });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) btn.addEventListener(ev, () => set(false));
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // zapamiętany tryb przechyłu: Android włącza się od razu, iOS dopiero po pierwszym kliknięciu (wymóg zgody)
  if (tilt.want) {
    if (typeof window.DeviceOrientationEvent?.requestPermission === 'function') addEventListener('click', () => { if (tilt.want && !tilt.active) enableTilt(); }, { once: true, capture: true });
    else enableTilt();
  }
}
