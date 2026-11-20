// Test zgodności: nowy rdzeń symulacji musi krok po kroku dawać ten sam stan, co fizyka z pierwszej wersji gry.
// Pierwsza wersja nie miała przedmiotów (booster wyrzutu, spowolnienie), więc porównanie kończy się w kroku, w którym bohater złapał przedmiot.
import { describe, expect, test } from 'vitest';
import { AXIS_MAX, LEGACY_TUNE, STEP, createState, floorAt, jumpCurve, score, speed, step } from '../src/sim';
import type { SimEvent, SimState } from '../src/sim';
import { LegacyGame } from './legacy/legacy-game.js';
import { momentumPilot, randomPilot, tiltPilot } from './helpers';
import type { Pilot } from './helpers';

const MAX_TICKS = 120 * 60 * 6;   // 6 minut gry

function snapshotLegacy(g: LegacyGame) {
  return {
    hero: { ...g.hero },
    camY: g.camY, maxFloor: g.maxFloor, bonus: g.bonus, bestCombo: g.bestCombo,
    combo: { ...g.combo },
    scrolling: g.scrolling, level: g.level, clock: g.clock, hurries: g.hurries,
    genN: g.genN, lowN: g.lowN,
    over: g.state === 'over', score: g.score, speed: g.speed,
  };
}
function snapshotSim(s: SimState) {
  return {
    hero: { ...s.hero },
    camY: s.camY, maxFloor: s.maxFloor, bonus: s.bonus, bestCombo: s.bestCombo,
    combo: { ...s.combo },
    scrolling: s.scrolling, level: s.level, clock: s.clock, hurries: s.hurries,
    genN: s.genN, lowN: s.lowN,
    over: s.over, score: score(s), speed: speed(s),
  };
}

/** Prowadzi obie symulacje tym samym wejściem aż do końca gry; zwraca statystyki przebiegu. */
function runBoth(seed: number, pilot: Pilot, analog: boolean) {
  const legacy = new LegacyGame({ makeFloor: (n: number) => floorAt(seed, n), jumpCurve });
  const sim = createState(seed, LEGACY_TUNE);   // stara fizyka lotu = strojenie LEGACY_TUNE
  const events: SimEvent[] = [];
  const seen: Record<string, number> = {};

  expect(snapshotSim(sim)).toEqual(snapshotLegacy(legacy));

  let tick = 0;
  while (!sim.over && tick < MAX_TICKS) {
    const { axis, jump } = pilot.next(sim);
    if (analog) {
      legacy.input.left = legacy.input.right = false;
      legacy.tilt.active = true; legacy.tilt.axis = axis / AXIS_MAX;
    } else {
      legacy.input.left = axis < 0; legacy.input.right = axis > 0;
    }
    legacy.input.jump = jump;

    legacy.step(STEP);
    events.length = 0;
    step(sim, axis, jump, events);
    for (const e of events) seen[e.type] = (seen[e.type] ?? 0) + 1;
    tick++;
    if (events.some((e) => e.type === 'boost' || e.type === 'slow')) return { ticks: tick, seen, sim, item: true };

    const a = snapshotSim(sim), b = snapshotLegacy(legacy);
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      expect(a, `rozjazd w kroku ${tick} (ziarno ${seed})`).toEqual(b);
    }
  }
  expect(sim.tick).toBe(tick);
  return { ticks: tick, seen, sim, item: false };
}

describe('zgodność z fizyką pierwszej wersji gry', () => {
  test('stan początkowy: bohater stoi na środku piętra 0, wieża jeszcze się nie przesuwa', () => {
    const s = createState(5);
    expect(s.hero).toEqual({ x: 320, y: 0, vx: 0, vy: 0, face: 1, onFloor: 0, from: 0, spin: false });
    expect(s.camY).toBe(-440);
    expect(s.scrolling).toBe(false);
    expect(s.over).toBe(false);
    expect(score(s)).toBe(0);
    expect(speed(s)).toBe(0);
  });

  test('losowe wciskanie klawiszy – identyczny przebieg dla 40 wież', () => {
    for (let seed = 1; seed <= 40; seed++) runBoth(seed, randomPilot(seed * 31), false);
  });

  test('przechył z poziomami pośrednimi – identyczny przebieg dla 25 wież', () => {
    for (let seed = 100; seed < 125; seed++) runBoth(seed, tiltPilot(seed * 17), true);
  });

  test('gracz trzymający rozpęd – identyczny przebieg, w tym combo, odbicia i przyspieszenia wieży', () => {
    const total: Record<string, number> = {};
    let bestFloor = 0, anyBonus = false;
    for (let seed = 500; seed < 530; seed++) {
      const { seen, sim } = runBoth(seed, momentumPilot(seed * 7), false);
      for (const [k, v] of Object.entries(seen)) total[k] = (total[k] ?? 0) + v;
      bestFloor = Math.max(bestFloor, sim.maxFloor);
      anyBonus ||= sim.bonus > 0;
    }
    // test ma sens tylko wtedy, gdy przebiegi faktycznie przechodzą przez wszystkie reguły gry
    for (const type of ['jump', 'land', 'bounce', 'combo', 'hurry', 'over']) {
      expect(total[type] ?? 0, `zdarzenie „${type}” ani razu nie wystąpiło`).toBeGreaterThan(0);
    }
    expect(bestFloor).toBeGreaterThan(60);
    expect(anyBonus).toBe(true);
  });

  test('po końcu gry kolejne kroki niczego nie zmieniają', () => {
    const { sim, item } = runBoth(3, randomPilot(99), false);
    expect(item).toBe(false);
    expect(sim.over).toBe(true);
    const before = JSON.stringify(sim);
    step(sim, AXIS_MAX, true);
    expect(JSON.stringify(sim)).toBe(before);
  });
});
