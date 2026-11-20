// Rdzeń rozgrywki: czysta, deterministyczna symulacja. Ten sam kod działa w grze i na serwerze weryfikującym wyniki.
//
// Zasady, których trzeba tu pilnować:
//  - żadnego Math.random, czasu systemowego ani dostępu do DOM,
//  - z funkcji matematycznych tylko działania dokładne wg IEEE 754 (+ − × ÷, abs, sign, min, max, floor, ceil);
//    Math.pow / exp / sin mogą się różnić między wersjami silnika,
//  - stan to zwykłe liczby i wartości logiczne – daje się zapisać do JSON-a jako punkt kontrolny.
import {
  AXIS_MAX, BOOST_COAST, BOOST_EXIT, BOOST_FIRST, BOOST_FIRST_SPREAD, BOOST_FLOORS, BOOST_GAP, BOOST_GAP_SPREAD, BOOST_SPEED, CAM_LERP,
  COMBO_TIME, DEFAULT_TUNE, FIELD, FOLLOW, FOOT, GAP, H, HERO_H, HURRY_EVERY, HW, ITEM_LIFT, ITEM_R, ITEM_SEPARATION, LEFT, MAX_HURRIES, P,
  RIGHT, SLOW_EVERY, SLOW_FACTOR, SLOW_FROM, SLOW_TIME, START_FLOOR, STEP, W,
} from './constants';
import type { Tune } from './constants';
import { floorSpan, mix32 } from './floors';
import { JUMP_TABLE, JUMP_TABLE_SIZE } from './jumpTable';

export interface Hero {
  x: number; y: number; vx: number; vy: number;
  face: number;        // 1 = patrzy w prawo, −1 = w lewo
  onFloor: number;     // numer piętra, na którym stoi, albo −1 w powietrzu
  from: number;        // piętro ostatniego lądowania (do liczenia combo)
  spin: boolean;       // skok z dużym rozpędem
}

export interface SimState {
  seed: number;
  tune: Tune;          // sterowność w locie, z jaką rozgrywany jest ten bieg
  tick: number;
  hero: Hero;
  camY: number;
  maxFloor: number; bonus: number; bestCombo: number;
  combo: { floors: number; jumps: number; timer: number };
  scrolling: boolean; level: number; clock: number; hurries: number;
  genN: number;        // istnieją piętra lowN … genN−1 (okno wokół ekranu)
  lowN: number;
  over: boolean;
  /** Następny booster wyrzutu: wisi nad piętrem n w punkcie x; k – jego numer kolejny w biegu. Zawsze jest jakiś następny. */
  boost: { n: number; x: number; k: number };
  rising: boolean;     // wyrzut w toku: bohater leci w górę ze stałą prędkością
  riseTo: number;      // y, na którym wyrzut się wyłącza (dalej zwykły lot)
  afterBoost: boolean; // pierwsze lądowanie po wyrzucie nie liczy się do combo
  /** Spowolnienie: przedmiot nad piętrem n (−1 = brak), x, numer k; clock – sekundy od ostatniego przedmiotu; t – ile jeszcze trwa efekt. */
  slow: { n: number; x: number; k: number; clock: number; t: number };
}

export type SimEvent =
  | { type: 'jump'; power: number }                    // power 0…1 – jak mocny był rozpęd
  | { type: 'land'; floor: number }
  | { type: 'bounce'; left: boolean }                  // mocne odbicie od ściany
  | { type: 'combo'; floors: number; points: number }  // combo zakończone i zaliczone
  | { type: 'hurry'; level: number }
  | { type: 'boost'; floor: number }                   // złapany booster (floor – piętro, nad którym wisiał)
  | { type: 'boostEnd' }                               // wyrzut się skończył, dalej zwykły lot – trzeba wylądować
  | { type: 'slow' }                                   // złapane spowolnienie
  | { type: 'slowEnd' }
  | { type: 'over' };

/** Krzywa skoku ≈ k^1.4 dla k w 0…1, liczona z tablicy (patrz jumpTable.ts). */
export function jumpCurve(k: number): number {
  if (!(k > 0)) return 0;
  if (k >= 1) return 1;
  const t = k * JUMP_TABLE_SIZE;
  const i = Math.floor(t);
  const a = JUMP_TABLE[i];
  return a + (JUMP_TABLE[i + 1] - a) * (t - i);
}

export function createState(seed: number, tune: Tune = DEFAULT_TUNE): SimState {
  const s: SimState = {
    seed: seed >>> 0,
    tune: { airAccel: tune.airAccel, airBrake: tune.airBrake },
    tick: 0,
    hero: { x: W / 2, y: 0, vx: 0, vy: 0, face: 1, onFloor: 0, from: 0, spin: false },
    camY: -(H - 40),
    maxFloor: 0, bonus: 0, bestCombo: 0,
    combo: { floors: 0, jumps: 0, timer: 0 },
    scrolling: false, level: 0, clock: 0, hurries: 0,
    genN: 0, lowN: 0,
    over: false,
    boost: { n: 0, x: 0, k: -1 },
    rising: false, riseTo: 0, afterBoost: false,
    slow: { n: -1, x: 0, k: -1, clock: 0, t: 0 },
  };
  nextBoost(s);
  updateFloorWindow(s);
  return s;
}

/** Położenie x przedmiotu: losowe z ziarna, ale z dala od ścian. */
function itemX(a: number): number {
  const margin = ITEM_R + 14;
  return LEFT + margin + (mix32((a ^ 0x5bd1e995) >>> 0) % (FIELD - 2 * margin + 1));
}

/** Wyznacza kolejny booster: pierwszy nad piętrem 30–40, każdy następny 50–90 pięter wyżej od poprzedniego. */
function nextBoost(s: SimState): void {
  const b = s.boost;
  b.k++;
  const a = mix32((s.seed ^ Math.imul(b.k + 1, 0x7feb352d) ^ 0x2c1b3c6d) >>> 0);
  b.n = b.k === 0 ? BOOST_FIRST + (a % BOOST_FIRST_SPREAD) : b.n + BOOST_GAP + (a % BOOST_GAP_SPREAD);
  b.x = itemX(a);
}

/** Czy bohater dotyka przedmiotu wiszącego nad piętrem n w punkcie x. */
function touches(h: Hero, n: number, x: number): boolean {
  const y = -n * GAP - ITEM_LIFT;
  return Math.abs(h.x - x) <= HW + ITEM_R && y >= h.y - HERO_H - ITEM_R && y <= h.y + ITEM_R;
}

export function score(s: SimState): number { return s.maxFloor * 10 + s.bonus; }

/** Prędkość przesuwania wieży w px/s. */
export function speed(s: SimState): number {
  const v = s.scrolling ? 30 + 28 * (s.level - 1) : 0;
  return s.slow.t > 0 ? v * SLOW_FACTOR : v;
}

// Piętra pojawiają się tuż nad górną krawędzią ekranu i znikają 40 px pod dolną – tak jak w pierwszej wersji gry.
function updateFloorWindow(s: SimState): void {
  const topN = Math.ceil((-s.camY + GAP) / GAP);
  if (s.genN <= topN) s.genN = topN + 1;
  while (s.lowN < s.genN && -s.lowN * GAP - s.camY > H + 40) s.lowN++;
}

/** Czy pod stopami bohatera w punkcie x jest piętro n. */
function standsOn(s: SimState, n: number, x: number): boolean {
  if (n < s.lowN || n >= s.genN) return false;
  const span = floorSpan(s.seed, n);
  const fx = Math.floor(span / 1024);
  return x + FOOT >= fx && x - FOOT <= fx + (span % 1024);
}

function endCombo(s: SimState, events?: SimEvent[]): void {
  const c = s.combo;
  if (c.jumps >= 2) {
    const points = c.floors * c.floors;
    s.bonus += points;
    if (c.floors > s.bestCombo) s.bestCombo = c.floors;
    events?.push({ type: 'combo', floors: c.floors, points });
  }
  c.floors = 0; c.jumps = 0; c.timer = 0;
}

function land(s: SimState, n: number, events?: SimEvent[]): void {
  const h = s.hero;
  const diff = n - h.from;
  h.y = -n * GAP; h.vy = 0; h.onFloor = n; h.from = n;
  h.spin = false;
  events?.push({ type: 'land', floor: n });

  if (s.afterBoost) {                    // lądowanie po wyrzucie: combo zaczyna się od zera (to poprzednie booster już zaliczył)
    s.afterBoost = false;
  } else if (diff >= 2) {                // skok o 2+ piętra: buduje combo i odnawia licznik
    s.combo.floors += diff; s.combo.jumps++; s.combo.timer = COMBO_TIME;
  } else if (diff === 1 || diff < 0) {   // jedno piętro albo upadek niżej: koniec combo
    endCombo(s, events);
  }
  if (n > s.maxFloor) s.maxFloor = n;
  if (!s.scrolling && n >= START_FLOOR) { s.scrolling = true; s.level = 1; s.clock = 0; }
}

/**
 * Jeden krok fizyki (1/120 s).
 * @param axis  oś sterowania: liczba całkowita −AXIS_MAX…AXIS_MAX
 * @param jump  czy skok jest wciśnięty (trzymany skok = skok od razu po lądowaniu)
 * @param events  opcjonalna lista, do której trafiają zdarzenia tego kroku (dźwięki, cząsteczki, komunikaty)
 */
export function step(s: SimState, axis: number, jump: boolean, events?: SimEvent[]): void {
  if (s.over) return;
  s.tick++;
  const dt = STEP;
  const h = s.hero;
  const ax = axis / AXIS_MAX;
  const dir = Math.sign(ax);
  const grounded = h.onFloor >= 0;

  // bieg z rozpędem; w locie siłę sterowania i hamowanie po puszczeniu wyznacza strojenie biegu
  if (dir) {
    const turning = h.vx * dir < 0;
    h.vx += ax * (grounded ? P.accel : s.tune.airAccel) * (turning ? P.turn : 1) * dt;
    h.face = dir;
  } else {
    const f = (grounded ? P.fricGround : s.tune.airBrake) * dt;
    h.vx = Math.abs(h.vx) <= f ? 0 : h.vx - Math.sign(h.vx) * f;
  }
  h.vx = Math.max(-P.maxVx, Math.min(P.maxVx, h.vx));
  h.x += h.vx * dt;

  // odbicie od ściany – prędkość zostaje, zmienia się kierunek
  if (h.x - HW < LEFT || h.x + HW > RIGHT) {
    const left = h.x - HW < LEFT;
    h.x = left ? LEFT + HW : RIGHT - HW;
    if ((left && h.vx < 0) || (!left && h.vx > 0)) {
      if (Math.abs(h.vx) > 140) {
        events?.push({ type: 'bounce', left });
        if (!dir) h.face = left ? 1 : -1;
      }
      h.vx = -h.vx;
    }
  }

  if (h.onFloor >= 0) {
    if (!standsOn(s, h.onFloor, h.x)) {
      h.onFloor = -1;                                   // zejście z krawędzi
    } else if (jump) {
      const k = Math.abs(h.vx) / P.maxVx;
      h.vy = -(P.jumpBase + P.jumpBoost * jumpCurve(k));
      h.onFloor = -1;
      h.spin = k >= P.spinAt;
      events?.push({ type: 'jump', power: k });
    }
  }

  if (h.onFloor < 0 && s.rising) {                     // wyrzut: stała prędkość w górę, bez grawitacji
    h.vy = -BOOST_SPEED;
    h.y += h.vy * dt;
    if (h.y <= s.riseTo) {
      s.rising = false; h.vy = -BOOST_EXIT;
      events?.push({ type: 'boostEnd' });
    }
  } else if (h.onFloor < 0) {
    const prevY = h.y;
    h.vy = Math.min(h.vy + P.gravity * dt, P.maxFall);
    h.y += h.vy * dt;
    if (h.vy > 0) {                                     // platformy są jednostronne – lądujemy tylko z góry
      const nHi = Math.floor(-prevY / GAP + 1e-9), nLo = Math.ceil(-h.y / GAP - 1e-9);
      for (let n = nHi; n >= nLo; n--) {
        if (standsOn(s, n, h.x)) { land(s, n, events); break; }
      }
    }
  }

  // przedmioty łapie się tylko w locie
  if (h.onFloor < 0 && !s.rising) {
    const b = s.boost, sl = s.slow;
    if (touches(h, b.n, b.x)) {
      endCombo(s, events);                              // bieżące combo zostaje zaliczone, wyrzut już się do niego nie liczy
      s.rising = true; s.afterBoost = true; h.spin = false;
      // szczyt lotu ≈ BOOST_FLOORS pięter nad boosterem: wznoszenie kończy się BOOST_COAST px niżej, resztę robi rozpęd
      s.riseTo = -(b.n + BOOST_FLOORS) * GAP - ITEM_LIFT + BOOST_COAST;
      events?.push({ type: 'boost', floor: b.n });
      nextBoost(s);
    } else if (sl.n >= 0 && touches(h, sl.n, sl.x)) {
      sl.n = -1; sl.t = SLOW_TIME;
      events?.push({ type: 'slow' });
    }
  }

  // licznik combo
  if (s.combo.timer > 0) {
    s.combo.timer -= dt;
    if (s.combo.timer <= 0) endCombo(s, events);
  }

  // spowolnienie: czas trwania efektu i pojawianie się przedmiotów (od SLOW_FROM piętra)
  const sl = s.slow;
  if (sl.t > 0) {
    sl.t -= dt;
    if (sl.t <= 0) { sl.t = 0; events?.push({ type: 'slowEnd' }); }
  }
  if (s.maxFloor >= SLOW_FROM) {
    sl.clock += dt;
    // nowe spowolnienie tylko, gdy poprzednie zniknęło, nie trwa wyrzut i w pobliżu nie czeka booster – nigdy nie są razem na ekranie
    if (sl.clock >= SLOW_EVERY && sl.n < 0 && !s.rising && Math.abs(s.boost.n - s.genN) >= ITEM_SEPARATION) {
      sl.k++; sl.clock = 0;
      sl.n = s.genN;                                    // tuż nad górną krawędzią ekranu – wjedzie razem z wieżą
      sl.x = itemX(mix32((s.seed ^ Math.imul(sl.k + 1, 0x1b873593) ^ 0x7a3c5e11) >>> 0));
    }
  }

  // kamera: stałe przewijanie + pogoń za bohaterem
  if (s.scrolling) {
    s.camY -= speed(s) * dt;
    if (s.hurries < MAX_HURRIES) {
      s.clock += dt;
      if (s.clock >= HURRY_EVERY) {
        s.clock -= HURRY_EVERY; s.hurries++; s.level++;
        if (s.hurries >= MAX_HURRIES) s.clock = 0;
        events?.push({ type: 'hurry', level: s.level });
      }
    }
  }
  const target = h.y - FOLLOW;
  if (target < s.camY) s.camY = s.rising ? target : s.camY + (target - s.camY) * CAM_LERP;   // w czasie wyrzutu kamera nie może zostać w tyle
  updateFloorWindow(s);
  // przedmioty, które zjechały pod ekran, przepadają
  if (s.boost.n < s.lowN) nextBoost(s);
  if (sl.n >= 0 && sl.n < s.lowN) sl.n = -1;

  // spadł poniżej ekranu
  if (h.y - HERO_H - s.camY > H) {
    s.over = true;
    s.combo.floors = 0; s.combo.jumps = 0; s.combo.timer = 0;   // przerwane combo przepada
    events?.push({ type: 'over' });
  }
}
