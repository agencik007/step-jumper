// Sterowność w locie: strojenie (SimState.tune) zmienia tylko to, co dzieje się w powietrzu.
import { describe, expect, test } from 'vitest';
import { AXIS_MAX, DEFAULT_TUNE, LEGACY_TUNE, P, STEP, createState, runReplay, stateHash, step } from '../src/sim';
import type { SimState, Tune } from '../src/sim';
import { inputByte, momentumPilot } from './helpers';

const STRONG: Tune = { airAccel: 1520, airBrake: 1200 };

/** Skok z miejsca na piętrze 0 i `ticks` kroków lotu z podaną osią. Piętro 0 ma pełną szerokość, więc start jest zawsze taki sam. */
function hop(tune: Tune, axis: number, ticks: number): SimState {
  const s = createState(7, tune);
  step(s, 0, true);
  expect(s.hero.onFloor).toBe(-1);
  for (let i = 0; i < ticks; i++) step(s, axis, false);
  return s;
}

/** Rozbieg po piętrze 0, skok i `ticks` kroków lotu z podaną osią; zwraca też prędkość w chwili wybicia. */
function runAndHop(tune: Tune, runTicks: number, axis: number, ticks: number) {
  const s = createState(7, tune);
  for (let i = 0; i < runTicks; i++) step(s, AXIS_MAX, false);
  const v0 = s.hero.vx;
  step(s, AXIS_MAX, true);
  expect(s.hero.onFloor).toBe(-1);
  for (let i = 0; i < ticks; i++) step(s, axis, false);
  return { s, v0 };
}

describe('strojenie lotu', () => {
  test('domyślne strojenie jest mocniejsze od fizyki pierwszej wersji gry', () => {
    expect(LEGACY_TUNE).toEqual({ airAccel: P.accel, airBrake: 200 });
    expect(DEFAULT_TUNE.airAccel).toBeGreaterThan(LEGACY_TUNE.airAccel);
    expect(DEFAULT_TUNE.airBrake).toBeGreaterThan(LEGACY_TUNE.airBrake);
    expect(createState(1).tune).toEqual(DEFAULT_TUNE);
  });

  test('stan dostaje własną kopię strojenia', () => {
    const tune = { ...STRONG };
    const s = createState(1, tune);
    tune.airAccel = 1;
    expect(s.tune).toEqual(STRONG);
    expect(s.tune).not.toBe(DEFAULT_TUNE);
  });

  test('na ziemi strojenie niczego nie zmienia', () => {
    const a = createState(7, LEGACY_TUNE), b = createState(7, STRONG);
    const axes = [AXIS_MAX, AXIS_MAX, 0, -AXIS_MAX, 3, 0];
    for (let i = 0; i < 900; i++) {
      const axis = axes[Math.floor(i / 150)];
      step(a, axis, false); step(b, axis, false);
      expect(b.hero.onFloor).toBe(0);
    }
    expect(b.hero).toEqual(a.hero);
    expect(stateHash(b)).toBe(stateHash(a));
  });

  test('trzymany kierunek rozpędza w locie z siłą airAccel', () => {
    const ticks = 30;
    for (const tune of [LEGACY_TUNE, DEFAULT_TUNE, STRONG]) {
      const s = hop(tune, AXIS_MAX, ticks);
      expect(s.hero.onFloor).toBe(-1);
      expect(s.hero.vx).toBeCloseTo(tune.airAccel * ticks * STEP, 6);
    }
    expect(hop(STRONG, AXIS_MAX, ticks).hero.x).toBeGreaterThan(hop(LEGACY_TUNE, AXIS_MAX, ticks).hero.x);
  });

  test('przechył w połowie daje w locie połowę siły', () => {
    const full = hop(DEFAULT_TUNE, AXIS_MAX, 30), half = hop(DEFAULT_TUNE, AXIS_MAX / 2, 30);
    expect(half.hero.vx).toBeCloseTo(full.hero.vx / 2, 6);
  });

  test('kontra w locie hamuje z siłą airAccel × turn', () => {
    for (const tune of [LEGACY_TUNE, STRONG]) {
      const { s, v0 } = runAndHop(tune, 60, -AXIS_MAX, 10);
      // krok wybicia jest jeszcze krokiem „na ziemi”, więc dolicza zwykłe przyspieszenie
      const atTakeoff = v0 + P.accel * STEP;
      expect(s.hero.vx).toBeCloseTo(atTakeoff - tune.airAccel * P.turn * 10 * STEP, 6);
    }
  });

  test('puszczone sterowanie wytraca w locie prędkość z siłą airBrake', () => {
    for (const tune of [LEGACY_TUNE, DEFAULT_TUNE, STRONG]) {
      const { s, v0 } = runAndHop(tune, 60, 0, 20);
      expect(s.hero.onFloor).toBe(-1);
      expect(s.hero.vx).toBeCloseTo(v0 + P.accel * STEP - tune.airBrake * 20 * STEP, 6);
    }
  });

  test('hamowanie w locie zatrzymuje bohatera, ale nie cofa go', () => {
    const { s } = runAndHop({ airAccel: 760, airBrake: 2000 }, 20, 0, 40);
    expect(s.hero.onFloor).toBe(-1);
    expect(s.hero.vx).toBe(0);
  });

  test('zerowe hamowanie zachowuje prędkość w locie', () => {
    const { s, v0 } = runAndHop({ airAccel: 760, airBrake: 0 }, 60, 0, 30);
    expect(s.hero.vx).toBe(v0 + P.accel * STEP);
  });

  test('strojenie nie podnosi prędkości maksymalnej ani wysokości skoku', () => {
    const { s } = runAndHop({ airAccel: 2280, airBrake: 200 }, 60, AXIS_MAX, 12);   // krótki lot – bez dolotu do ściany
    expect(s.hero.onFloor).toBe(-1);
    expect(s.hero.vx).toBe(P.maxVx);
    const a = hop(LEGACY_TUNE, 0, 20), b = hop(STRONG, 0, 20);
    expect(b.hero.y).toBe(a.hero.y);
    expect(b.hero.vy).toBe(a.hero.vy);
  });
});

describe('strojenie a zapis biegu', () => {
  function playLive(seed: number, tune: Tune) {
    const sim = createState(seed, tune);
    const pilot = momentumPilot(seed);
    const ticks: number[] = [];
    while (!sim.over && sim.tick < 120 * 60 * 4) {
      const i = pilot.next(sim);
      ticks.push(inputByte(i));
      step(sim, i.axis, i.jump);
    }
    return { sim, ticks: Uint8Array.from(ticks) };
  }

  test('zapis odtworzony z tym samym strojeniem daje ten sam stan', () => {
    for (const seed of [21, 22, 23]) {
      const { sim, ticks } = playLive(seed, STRONG);
      expect(stateHash(runReplay(seed, ticks, createState(seed, STRONG)))).toBe(stateHash(sim));
    }
  });

  test('ten sam zapis odtworzony z innym strojeniem daje inny przebieg', () => {
    const { sim, ticks } = playLive(21, STRONG);
    expect(stateHash(runReplay(21, ticks, createState(21, LEGACY_TUNE)))).not.toBe(stateHash(sim));
  });

  test('strojenie przechodzi przez punkt kontrolny w JSON-ie', () => {
    const { sim, ticks } = playLive(22, STRONG);
    let state = createState(22, STRONG);
    for (let from = 0; from < ticks.length; from += 500) {
      state = JSON.parse(JSON.stringify(state));
      runReplay(22, ticks.subarray(from, from + 500), state);
    }
    expect(state.tune).toEqual(STRONG);
    expect(stateHash(state)).toBe(stateHash(sim));
  });
});
