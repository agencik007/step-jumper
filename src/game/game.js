// Gra: maszyna stanów (tytuł / gra / pauza / koniec) i wszystko, co widać i słychać wokół symulacji.
// Reguły rozgrywki są w src/sim – tutaj tylko podajemy im wejście i reagujemy na zdarzenia.
import {
  AXIS_MAX, H, InputRecorder, LEFT, RIGHT, SIM_VERSION, STEP, createState, encodeInputs, packInput, runReplay, score, stateHash, step,
  unpackAxis, unpackJump,
} from '../sim';
import { sfx } from './audio.js';
import { CHARS } from './characters.js';
import { NEON, PENCILS, STYLES, applyStyle, cycle, style, themeOf } from './gfx.js';
import { input, isTouch, tilt, toggleTilt } from './input.js';
import { UIBOX, inBox, slotX } from './layout.js';
import { render } from './render.js';
import { clamp, loadJSON, mod, rand, saveJSON } from './util.js';

const STORE = 'stepjumper.best.v1', PREFS = 'stepjumper.prefs.v1';

const TIERS = [
  [200, 'NIEMOŻLIWE!'], [140, 'KOSMOS!'], [100, 'FANTASTYCZNIE!'], [70, 'EKSTREMALNIE!'],
  [50, 'NIESAMOWICIE!'], [35, 'WOW!'], [25, 'SUPER!'], [15, 'ŚWIETNIE!'], [7, 'ŁADNIE!'], [4, 'NIEŹLE!'],
];

const newSeed = () => crypto.getRandomValues(new Uint32Array(1))[0];

export class Game {
  constructor() {
    this.best = loadJSON(STORE, { score: 0, floor: 0, combo: 0 });
    const prefs = loadJSON(PREFS, { char: 0, style: 0, tilt: false });
    this.charIdx = clamp(prefs.char | 0, 0, CHARS.length - 1);
    this.styleIdx = clamp(prefs.style | 0, 0, STYLES.length - 1);
    tilt.want = !!prefs.tilt;
    applyStyle(this.styleIdx);
    this.t = 0;
    this.snow = Array.from({ length: 34 }, () => ({ x: rand(LEFT, RIGHT), y: rand(0, H), r: rand(0.8, 2.2), s: rand(12, 34), ph: rand(0, 7) }));
    this.events = [];
    this.rec = new InputRecorder();
    this.lastRun = null;                 // zapis ostatniego zakończonego biegu (ziarno + wejścia) – materiał dla rankingu
    this.reset();
    this.state = 'title';
  }

  pick(what, d, abs = false) {
    if (what === 'char') this.charIdx = abs ? d : mod(this.charIdx + d, CHARS.length);
    else { this.styleIdx = abs ? d : mod(this.styleIdx + d, STYLES.length); applyStyle(this.styleIdx); }
    this.savePrefs();
    sfx.pick();
  }
  savePrefs() { saveJSON(PREFS, { char: this.charIdx, style: this.styleIdx, tilt: tilt.want }); }

  reset() {
    this.sim = createState(newSeed());
    this.rec.reset();
    this.fx = { angle: 0, squash: 0, runPhase: 0 };   // stan czysto wizualny bohatera
    this.shake = 0; this.parts = []; this.msgs = [];
    this.acc = 0; this.trailT = 0; this.jumpLock = true; this.newBest = false; this.overT = 0;
  }

  get score() { return score(this.sim); }

  start() {
    this.reset(); this.state = 'play';
    if (tilt.active) navigator.wakeLock?.request('screen').catch(() => {});   // ekran nie gaśnie w trakcie gry
  }
  toTitle() { this.reset(); this.state = 'title'; }
  pause() { if (this.state === 'play') this.state = 'pause'; }
  togglePause() {
    if (this.state === 'play') this.state = 'pause';
    else if (this.state === 'pause') { this.state = 'play'; this.jumpLock = true; }
  }

  pointer(x, y) {
    if (this.state === 'title') {
      for (let i = 0; i < 5; i++) {
        if (Math.abs(x - slotX(i)) <= 34) {
          if (y >= UIBOX.chars.y && y <= UIBOX.chars.y + UIBOX.chars.h) return this.pick('char', i, true);
          if (y >= UIBOX.maps.y - 4 && y <= UIBOX.maps.y + UIBOX.maps.h + 4) return this.pick('style', i, true);
        }
      }
      if (inBox(x, y, UIBOX.play)) this.start();
      else if ((isTouch || tilt.active) && inBox(x, y, UIBOX.ctrl)) toggleTilt();
    } else if (this.state === 'pause') {
      this.togglePause();
    } else if (this.state === 'over' && this.overT > 0.6) {
      if (inBox(x, y, UIBOX.menu)) this.toTitle(); else this.start();
    }
  }

  say(title, sub = '', color = 'gold', dur = 1.6) { this.msgs.push({ title, sub, color, dur, t: 0 }); if (this.msgs.length > 3) this.msgs.shift(); }

  // ── cząsteczki ──
  puff(x, y, n, { color = '#fff', sx = 120, sy = 80, up = 60, life = 0.4, size = 3, g = 300, star = false } = {}) {
    for (let i = 0; i < n; i++) {
      this.parts.push({ x, y, vx: rand(-sx, sx), vy: rand(-sy, sy) - up, life: life * rand(0.6, 1.2), max: life, size: size * rand(0.6, 1.3), color, g, star, rot: rand(0, 7) });
    }
  }
  dustColor(n) {
    return style.world === 'neon' ? cycle(NEON, n) : style.world === 'sketch' ? 'rgba(31,42,68,.55)' : themeOf(n).top;
  }

  gameOver() {
    this.state = 'over'; this.overT = 0; this.msgs = [];
    sfx.over();
    const b = this.best, s = this.sim;
    this.newBest = this.score > b.score && this.score > 0;
    b.score = Math.max(b.score, this.score);
    b.floor = Math.max(b.floor, s.maxFloor);
    b.combo = Math.max(b.combo, s.bestCombo);
    saveJSON(STORE, b);

    const ticks = this.rec.ticks();
    this.lastRun = { simVersion: SIM_VERSION, seed: s.seed, ticks: ticks.length, score: this.score, inputs: encodeInputs(ticks) };
    if (import.meta.env.DEV) {                           // kontrola determinizmu: zapis odtworzony od zera musi dać ten sam stan
      const again = runReplay(s.seed, ticks);
      if (stateHash(again) !== stateHash(s)) console.error('Symulacja nie jest deterministyczna: odtworzenie zapisu dało inny stan', { live: s, again });
    }
  }

  // ── reakcja na zdarzenia symulacji: dźwięk, cząsteczki, komunikaty ──
  onEvent(e) {
    const h = this.sim.hero, fx = this.fx;
    switch (e.type) {
      case 'jump':
        fx.squash = -0.6; fx.angle = 0;
        sfx.jump(e.power);
        break;
      case 'land':
        fx.squash = 0.9; fx.angle = 0;
        this.puff(h.x, h.y, 6, { color: this.dustColor(e.floor), sx: 110, sy: 20, up: 50, life: 0.35 });
        sfx.land();
        break;
      case 'bounce':
        sfx.bounce();
        this.puff(e.left ? LEFT : RIGHT, h.y - 24, 7, { color: this.dustColor(Math.max(0, h.from)), sx: 60, sy: 140, up: 0, life: 0.35, size: 2.5 });
        break;
      case 'combo': {
        const ti = TIERS.findIndex(([min]) => e.floors >= min);
        const label = ti >= 0 ? TIERS[ti][1] : 'COMBO!';
        this.say(label, `combo ${e.floors} pięter  ·  +${e.points}`, 'gold', 1.8);
        sfx.combo(TIERS.length - 1 - ti);
        break;
      }
      case 'hurry':
        this.say('SZYBCIEJ!', '', 'warn', 1.5);
        this.shake = 0.6; sfx.hurry();
        break;
      case 'over':
        this.gameOver();
        break;
    }
  }

  // ── jeden krok fizyki + efekty, które idą z nim w parze ──
  tick() {
    const s = this.sim, h = s.hero, fx = this.fx, dt = STEP;

    // wejście: po starcie i po pauzie skok działa dopiero po puszczeniu przycisku
    if (this.jumpLock && !input.jump) this.jumpLock = false;
    const wantJump = input.jump && !this.jumpLock;
    // klawisze/przyciski dają pełne ±1; przechył daje wartość płynną, czyli słabsze lub mocniejsze przyspieszenie
    let axis = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    if (!axis && tilt.active) axis = tilt.axis;
    // symulacja dostaje dokładnie to, co trafia do zapisu biegu
    const packed = packInput(axis * AXIS_MAX, wantJump);
    this.rec.push(packed);

    const wasGrounded = h.onFloor >= 0;
    this.events.length = 0;
    step(s, unpackAxis(packed), unpackJump(packed), this.events);
    for (const e of this.events) this.onEvent(e);

    if (wasGrounded) fx.runPhase += Math.abs(h.vx) * dt * 0.085;
    if (h.onFloor < 0 && h.spin) {
      fx.angle += dt * 15;
      this.trailT -= dt;
      if (this.trailT <= 0) {
        this.trailT = 0.03;
        const cols = style.world === 'sketch' ? PENCILS : ['#ffe066', '#7ef0e0', '#ff9ecb', '#ffffff'];
        this.puff(h.x, h.y - 24, 1, { color: cols[Math.floor(Math.random() * cols.length)], sx: 40, sy: 40, up: 0, life: 0.5, size: 5, g: 120, star: true });
      }
    }
    fx.squash += (0 - fx.squash) * Math.min(1, 12 * dt);

    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; p.rot += dt * 6;
      if (p.life <= 0) this.parts.splice(i, 1);
    }
  }

  frame(dt) {
    this.t += dt;
    const edge = input.takeEdge();
    const camBefore = this.sim.camY;
    if (this.state === 'title') { if (edge) this.start(); }
    else if (this.state === 'pause') { if (edge) this.togglePause(); }
    else if (this.state === 'over') { this.overT += dt; if (edge && this.overT > 0.6) this.start(); }
    else {
      this.acc += dt;
      while (this.acc >= STEP && this.state === 'play') { this.tick(); this.acc -= STEP; }
    }
    // efekty niezależne od fizyki
    if (this.state !== 'pause') {
      for (const m of this.msgs) m.t += dt;
      this.msgs = this.msgs.filter((m) => m.t < m.dur);
      this.shake = Math.max(0, this.shake - dt);
      const rise = clamp(camBefore - this.sim.camY, 0, 200);
      for (const s of this.snow) {
        s.y += s.s * dt + rise * 0.35; s.x += Math.sin(this.t * 1.3 + s.ph) * 8 * dt;
        if (s.y > H + 4) { s.y = -4; s.x = rand(LEFT, RIGHT); }
      }
    }
    render(this);
  }
}

