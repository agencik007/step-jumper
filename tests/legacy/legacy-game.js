// Wzorzec do testów zgodności: fizyka przeniesiona 1:1 z jednoplikowej wersji gry (index.html, commit 6a7dbda).
// Jedyne zmiany względem oryginału:
//  - piętra i krzywa skoku są wstrzykiwane (oryginał: Math.random i Math.pow),
//  - usunięte efekty bez wpływu na rozgrywkę (dźwięk, cząsteczki, komunikaty, przysiad, obrót, faza biegu).
// Tego pliku się nie „poprawia” – ma zostać taki, jak grało się w pierwszej wersji.

const W = 640, H = 480;
const WALL = 96, LEFT = WALL, RIGHT = W - WALL;
const GAP = 80;
const HW = 13;
const FOOT = 9;
const HERO_H = 58;
const FOLLOW = 170;
const START_FLOOR = 5;
const HURRY_EVERY = 30;
const MAX_HURRIES = 5;
const COMBO_TIME = 3;

const P = {
  accel: 760, turn: 1.8, maxVx: 580,
  fricGround: 900, fricAir: 200,
  gravity: 1900, maxFall: 1150,
  jumpBase: 620, jumpBoost: 700, jumpPow: 1.4,
  spinAt: 0.42,
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class LegacyGame {
  constructor({ makeFloor, jumpCurve }) {
    this.makeFloor = makeFloor;
    this.jumpCurve = jumpCurve;
    this.input = { left: false, right: false, jump: false };
    this.tilt = { active: false, axis: 0 };
    this.reset();
    this.state = 'play';
  }

  reset() {
    this.floors = new Map(); this.genN = 0; this.lowN = 0;
    this.camY = -(H - 40);
    this.hero = { x: W / 2, y: 0, vx: 0, vy: 0, face: 1, onFloor: 0, from: 0, spin: false };
    this.maxFloor = 0; this.bonus = 0; this.bestCombo = 0;
    this.combo = { floors: 0, jumps: 0, timer: 0 };
    this.scrolling = false; this.level = 0; this.clock = 0; this.hurries = 0;
    this.jumpLock = false;
    this.ensureFloors();
  }

  get score() { return this.maxFloor * 10 + this.bonus; }
  get speed() { return this.scrolling ? 30 + 28 * (this.level - 1) : 0; }

  ensureFloors() {
    const topN = Math.ceil((-this.camY + GAP) / GAP);
    while (this.genN <= topN) { this.floors.set(this.genN, this.makeFloor(this.genN)); this.genN++; }
    while (this.lowN < this.genN && -this.lowN * GAP - this.camY > H + 40) this.floors.delete(this.lowN++);
  }

  endCombo() {
    const c = this.combo;
    if (c.jumps >= 2) {
      const pts = c.floors * c.floors;
      this.bonus += pts;
      this.bestCombo = Math.max(this.bestCombo, c.floors);
    }
    c.floors = 0; c.jumps = 0; c.timer = 0;
  }

  land(n) {
    const h = this.hero;
    const diff = n - h.from;
    h.y = -n * GAP; h.vy = 0; h.onFloor = n; h.from = n;
    h.spin = false;

    if (diff >= 2) {
      this.combo.floors += diff; this.combo.jumps++; this.combo.timer = COMBO_TIME;
    } else if (diff === 1 || diff < 0) {
      this.endCombo();
    }
    if (n > this.maxFloor) this.maxFloor = n;
    if (!this.scrolling && n >= START_FLOOR) { this.scrolling = true; this.level = 1; this.clock = 0; }
  }

  gameOver() {
    this.state = 'over';
    this.combo.floors = 0; this.combo.jumps = 0; this.combo.timer = 0;
  }

  step(dt) {
    const input = this.input, tilt = this.tilt;
    const h = this.hero;
    if (this.jumpLock && !input.jump) this.jumpLock = false;
    const wantJump = input.jump && !this.jumpLock;
    let axis = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    if (!axis && tilt.active && Math.abs(tilt.axis) > 0.02) axis = tilt.axis;
    const dir = Math.sign(axis);
    const grounded = h.onFloor >= 0;

    if (dir) {
      const turning = h.vx * dir < 0;
      h.vx += axis * P.accel * (turning ? P.turn : 1) * dt;
      h.face = dir;
    } else {
      const f = (grounded ? P.fricGround : P.fricAir) * dt;
      h.vx = Math.abs(h.vx) <= f ? 0 : h.vx - Math.sign(h.vx) * f;
    }
    h.vx = clamp(h.vx, -P.maxVx, P.maxVx);
    h.x += h.vx * dt;

    if (h.x - HW < LEFT || h.x + HW > RIGHT) {
      const left = h.x - HW < LEFT;
      h.x = left ? LEFT + HW : RIGHT - HW;
      if ((left && h.vx < 0) || (!left && h.vx > 0)) {
        if (Math.abs(h.vx) > 140) {
          if (!dir) h.face = left ? 1 : -1;
        }
        h.vx = -h.vx;
      }
    }

    if (h.onFloor >= 0) {
      const p = this.floors.get(h.onFloor);
      if (!p || h.x + FOOT < p.x || h.x - FOOT > p.x + p.w) {
        h.onFloor = -1;
      } else if (wantJump) {
        const k = Math.abs(h.vx) / P.maxVx;
        h.vy = -(P.jumpBase + P.jumpBoost * this.jumpCurve(k));
        h.onFloor = -1;
        h.spin = k >= P.spinAt;
      }
    }

    if (h.onFloor < 0) {
      const prevY = h.y;
      h.vy = Math.min(h.vy + P.gravity * dt, P.maxFall);
      h.y += h.vy * dt;
      if (h.vy > 0) {
        const nHi = Math.floor(-prevY / GAP + 1e-9), nLo = Math.ceil(-h.y / GAP - 1e-9);
        for (let n = nHi; n >= nLo; n--) {
          const p = this.floors.get(n);
          if (p && h.x + FOOT >= p.x && h.x - FOOT <= p.x + p.w) { this.land(n); break; }
        }
      }
    }

    if (this.combo.timer > 0) {
      this.combo.timer -= dt;
      if (this.combo.timer <= 0) this.endCombo();
    }

    if (this.scrolling) {
      this.camY -= this.speed * dt;
      if (this.hurries < MAX_HURRIES) {
        this.clock += dt;
        if (this.clock >= HURRY_EVERY) {
          this.clock -= HURRY_EVERY; this.hurries++; this.level++;
          if (this.hurries >= MAX_HURRIES) this.clock = 0;
        }
      }
    }
    const target = h.y - FOLLOW;
    if (target < this.camY) this.camY += (target - this.camY) * (1 - Math.exp(-7 * dt));
    this.ensureFloors();

    if (h.y - HERO_H - this.camY > H) this.gameOver();
  }
}
