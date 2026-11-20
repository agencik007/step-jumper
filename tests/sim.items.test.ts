// Przedmioty w locie: booster wyrzutu (≈30 pięter w górę) i spowolnienie wieży (od 400. piętra, co 15 s).
import { describe, expect, test } from 'vitest';
import {
  BOOST_FLOORS, FIELD, LEGACY_TUNE, GAP, ITEM_LIFT, ITEM_SEPARATION, LEFT, RIGHT, SLOW_EVERY, SLOW_FROM, SLOW_TIME, TICK_RATE, createState, floorAt,
  runReplay, speed, stateHash, step,
} from '../src/sim';
import type { SimEvent, SimState } from '../src/sim';
import { inputByte, momentumPilot } from './helpers';

/** Kolejne boostery wieży: wymusza przejście dalej tak, jakby każdy zjechał pod ekran. */
function boosters(seed: number, count: number) {
  const s = createState(seed), out: { n: number; x: number }[] = [];
  for (let i = 0; i < count; i++) {
    out.push({ n: s.boost.n, x: s.boost.x });
    s.lowN = s.boost.n + 1; s.genN = Math.max(s.genN, s.lowN);
    step(s, 0, false);       // krok przesuwa booster na kolejny (bohater na dole i tak przepada – liczy się tylko układ)
  }
  return out;
}

/** Stawia bohatera w locie tuż pod boosterem, lecącego w górę – w następnym kroku go złapie. */
function underBooster(seed: number): SimState {
  const s = createState(seed), h = s.hero, b = s.boost;
  h.onFloor = -1; h.x = b.x; h.vx = 0; h.vy = -200;
  h.y = -b.n * GAP - ITEM_LIFT + 30;
  s.camY = h.y - 300; s.scrolling = true; s.level = 1;
  return s;
}

function stepUntil(s: SimState, type: SimEvent['type'], max: number, each?: (s: SimState) => void): SimEvent[] {
  const ev: SimEvent[] = [];
  for (let i = 0; i < max && !s.over; i++) {
    each?.(s);
    ev.length = 0;
    step(s, 0, false, ev);
    if (ev.some((e) => e.type === type)) return [...ev];
  }
  throw new Error(`brak zdarzenia ${type}`);
}

describe('booster wyrzutu', () => {
  test('pierwszy wisi nad piętrem 30–40, kolejne co 50–90 pięter, z dala od ścian', () => {
    for (const seed of [1, 2, 77, 503, 2026, 0xffffffff]) {
      const list = boosters(seed, 12);
      expect(list[0].n).toBeGreaterThanOrEqual(30);
      expect(list[0].n).toBeLessThanOrEqual(40);
      for (let i = 1; i < list.length; i++) {
        const gap = list[i].n - list[i - 1].n;
        expect(gap).toBeGreaterThanOrEqual(50);
        expect(gap).toBeLessThanOrEqual(90);
      }
      for (const b of list) { expect(b.x).toBeGreaterThan(LEFT + 20); expect(b.x).toBeLessThan(RIGHT - 20); }
    }
  });

  test('układ boosterów zależy tylko od ziarna', () => {
    expect(boosters(2026, 8)).toEqual(boosters(2026, 8));
    expect(boosters(2026, 8)).not.toEqual(boosters(2027, 8));
  });

  test('wyrzuca ok. 30 pięter w górę, potem zwykły lot', () => {
    const s = underBooster(9), n = s.boost.n;
    const ev: SimEvent[] = [];
    step(s, 0, false, ev);
    expect(ev).toContainEqual({ type: 'boost', floor: n });
    expect(s.rising).toBe(true);
    expect(s.boost.n).toBeGreaterThanOrEqual(n + 50);         // od razu czeka następny

    stepUntil(s, 'boostEnd', 4 * TICK_RATE);
    expect(s.rising).toBe(false);
    let apex = s.hero.y;
    while (s.hero.vy < 0) { step(s, 0, false); apex = Math.min(apex, s.hero.y); }
    const target = -(n + BOOST_FLOORS) * GAP - ITEM_LIFT;
    expect(Math.abs(apex - target)).toBeLessThan(12);
    expect(s.hero.y - s.camY).toBeGreaterThan(0);              // kamera nadążyła – bohater jest na ekranie
  });

  test('w czasie wyrzutu kamera trzyma bohatera na ekranie', () => {
    const s = underBooster(4);
    step(s, 0, false);
    while (s.rising) {
      step(s, 0, false);
      const sy = s.hero.y - s.camY;
      expect(sy).toBeGreaterThan(60);
      expect(sy).toBeLessThan(480);
    }
  });

  test('zalicza bieżące combo, a lądowanie po wyrzucie zaczyna combo od zera', () => {
    const s = underBooster(12), n = s.boost.n;
    s.combo = { floors: 10, jumps: 3, timer: 2 };
    s.hero.from = n - 1;
    const ev: SimEvent[] = [];
    step(s, 0, false, ev);
    expect(ev).toContainEqual({ type: 'combo', floors: 10, points: 100 });
    expect(s.bonus).toBe(100);
    expect(s.combo).toEqual({ floors: 0, jumps: 0, timer: 0 });

    // wyląduj na piętrze n+30: bohater „steruje” nad jego środek
    const f = floorAt(s.seed, n + BOOST_FLOORS);
    const landed = stepUntil(s, 'land', 6 * TICK_RATE, (st) => { st.hero.x = f.x + f.w / 2; st.hero.vx = 0; });
    expect(landed).toContainEqual({ type: 'land', floor: n + BOOST_FLOORS });
    expect(s.combo).toEqual({ floors: 0, jumps: 0, timer: 0 });
    expect(s.bonus).toBe(100);
    expect(s.maxFloor).toBe(n + BOOST_FLOORS);
    expect(s.afterBoost).toBe(false);
  });

  test('nie da się go złapać, stojąc na piętrze', () => {
    // wieża, w której piętro pod boosterem sięga pod niego: bohater stoi, a głową dotyka przedmiotu
    let seed = 1;
    for (; seed < 500; seed++) {
      const b = createState(seed).boost, f = floorAt(seed, b.n);
      if (b.x >= f.x + 10 && b.x <= f.x + f.w - 10) break;
    }
    const s = createState(seed), b = s.boost;
    expect(seed).toBeLessThan(500);
    s.hero.x = b.x; s.hero.y = -b.n * GAP; s.hero.onFloor = b.n; s.hero.from = b.n; s.maxFloor = b.n;
    s.camY = s.hero.y - 300; s.lowN = b.n - 2; s.genN = b.n + 8; s.scrolling = true; s.level = 1;
    for (let i = 0; i < 30; i++) step(s, 0, false);
    expect(s.hero.onFloor).toBe(b.n);
    expect(s.rising).toBe(false);
    expect(s.boost.n).toBe(b.n);
  });

  test('bieg z boosterami odtwarza się z zapisu co do bitu', () => {
    const s = createState(503, LEGACY_TUNE), pilot = momentumPilot(3521), ticks: number[] = [];   // ten pilot daleko zachodzi tylko na starej fizyce lotu
    let boosts = 0;
    const ev: SimEvent[] = [];
    while (!s.over && s.tick < TICK_RATE * 60 * 6) {
      const i = pilot.next(s);
      ticks.push(inputByte(i));
      ev.length = 0;
      step(s, i.axis, i.jump, ev);
      boosts += ev.filter((e) => e.type === 'boost').length;
    }
    expect(boosts).toBeGreaterThan(0);
    const again = runReplay(503, Uint8Array.from(ticks), createState(503, LEGACY_TUNE));
    expect(stateHash(again)).toBe(stateHash(s));
    // stan po JSON-ie (punkt kontrolny serwera) też daje ten sam ciąg dalszy
    expect(stateHash(JSON.parse(JSON.stringify(s)))).toBe(stateHash(s));
  });
});

describe('spowolnienie', () => {
  /** Bohater stoi na piętrze 0, wieża stoi w miejscu, ale gra uważa, że doszedł już do 400. piętra. */
  function high(seed: number): SimState {
    const s = createState(seed);
    s.maxFloor = SLOW_FROM;
    s.boost.n = 10_000;                                         // booster daleko – nie blokuje spowolnienia
    return s;
  }

  test('nie pojawia się poniżej 400. piętra', () => {
    const s = createState(5);
    for (let i = 0; i < 40 * TICK_RATE; i++) step(s, 0, false);
    expect(s.slow.n).toBe(-1);
    expect(s.slow.k).toBe(-1);
  });

  test('od 400. piętra pojawia się po 15 s tuż nad ekranem', () => {
    const s = high(5);
    const ticks = SLOW_EVERY * TICK_RATE;
    for (let i = 0; i < ticks - 2; i++) step(s, 0, false);
    expect(s.slow.n).toBe(-1);
    for (let i = 0; i < 4; i++) step(s, 0, false);
    expect(s.slow.n).toBe(s.genN);
    expect(s.slow.x).toBeGreaterThan(LEFT);
    expect(s.slow.x).toBeLessThan(LEFT + FIELD);
  });

  test('złapane zwalnia wieżę o połowę na 5 s', () => {
    const s = high(6);
    s.scrolling = true; s.level = 4;
    const full = speed(s);
    s.slow.n = 3; s.slow.x = 300; s.slow.k = 0;
    const h = s.hero;
    h.onFloor = -1; h.x = 300; h.vx = 0; h.vy = -100; h.y = -3 * GAP - ITEM_LIFT + 30;
    const ev: SimEvent[] = [];
    step(s, 0, false, ev);
    expect(ev).toContainEqual({ type: 'slow' });
    expect(s.slow.n).toBe(-1);
    expect(speed(s)).toBe(full / 2);
    const end = stepUntil(s, 'slowEnd', SLOW_TIME * TICK_RATE + 5, (st) => { st.camY = -440; });   // kamera stoi, żeby bohater nie przepadł
    expect(end).toContainEqual({ type: 'slowEnd' });
    expect(s.tick).toBeGreaterThanOrEqual(SLOW_TIME * TICK_RATE);
    expect(speed(s)).toBe(full);
  });

  test('nie pojawia się w pobliżu czekającego boostera', () => {
    const s = high(7);
    for (let i = 0; i < SLOW_EVERY * TICK_RATE + 10; i++) {
      s.boost.n = s.genN + ITEM_SEPARATION - 1;                 // booster wisi niedaleko nad ekranem
      step(s, 0, false);
    }
    expect(s.slow.n).toBe(-1);
    s.boost.n = s.genN + ITEM_SEPARATION + 5;                   // booster odjechał – spowolnienie od razu
    step(s, 0, false);
    expect(s.slow.n).toBe(s.genN);
  });

  test('nie pojawia się w czasie wyrzutu', () => {
    const s = high(8);
    for (let i = 0; i < SLOW_EVERY * TICK_RATE + 10; i++) {
      s.rising = true; s.hero.onFloor = -1; s.riseTo = -1e9;
      s.hero.y = 0; s.hero.vy = 0;                              // „wyrzut” w miejscu, żeby bohater nie odleciał
      step(s, 0, false);
    }
    expect(s.slow.n).toBe(-1);
  });
});
