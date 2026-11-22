import { describe, expect, test } from 'vitest';
import { RULES, RULE_VARS, jumpFloors } from '../src/game/rules.js';
import { STRINGS } from '../src/game/strings.js';
import { BLOCK, DEFAULT_TUNE, GAP, NARROW_BY, NARROW_MAX, P, STEP, jumpCurve } from '../src/sim';

// ZASADY GRY opisują mechanikę słowami. Liczby idą ze stałych ({zmienne}), a te twierdzenia, które w tekście są
// napisane wprost, pilnujemy tutaj – po zmianie fizyki test pokaże, który punkt zasad trzeba poprawić.

/** Szczyt skoku w px liczony krokami fizyki tak jak w sim.ts (bez sterowania). */
function peak(k: number): number {
  let vy = -(P.jumpBase + P.jumpBoost * jumpCurve(k)), y = 0, top = 0;
  while (vy < 0) { vy = Math.min(vy + P.gravity * STEP, P.maxFall); y += vy * STEP; top = Math.min(top, y); }
  return -top;
}

describe('ZASADY GRY', () => {
  for (const [code, dict] of Object.entries(STRINGS) as [string, Record<string, string>][]) {
    test(`${code}: każda sekcja ma nagłówek i wszystkie punkty, żadnych zbędnych kluczy`, () => {
      const want = RULES.flatMap(([k, n]) => [`rules.${k}`, ...Array.from({ length: n }, (_, i) => `rules.${k}.${i + 1}`)]);
      expect(Object.keys(dict).filter((k) => k.startsWith('rules.')).sort()).toEqual(want.sort());
    });

    test(`${code}: każda {zmienna} w zasadach ma wartość`, () => {
      for (const [k, v] of Object.entries(dict)) {
        if (!k.startsWith('rules.')) continue;
        for (const m of v.matchAll(/\{(\w+)\}/g)) expect(RULE_VARS, `${k}: {${m[1]}}`).toHaveProperty(m[1]);
      }
    });
  }

  test('wysokość skoku w piętrach zgadza się z krokami fizyki', () => {
    for (const k of [0, P.spinAt, 0.5, 1]) expect(jumpFloors(k), `k = ${k}`).toBe(Math.floor(peak(k) / GAP));
    expect([RULE_VARS.jumpMin, RULE_VARS.jumpMax]).toEqual([1, 5]);
  });

  test('twierdzenia zapisane w tekście wprost', () => {
    expect(jumpFloors(P.spinAt)).toBeGreaterThanOrEqual(2);                  // obrót w locie = co najmniej 2 piętra
    expect(P.maxVx / P.accel).toBeLessThan(1);                               // pełna prędkość w niecałą sekundę
    expect(P.turn).toBeGreaterThan(1.5); expect(P.turn).toBeLessThan(2);     // zawracanie „prawie dwa razy” mocniej
    expect(DEFAULT_TUNE.airAccel).toBeGreaterThan(P.accel);                  // w locie sterujesz mocniej niż na ziemi
    expect(DEFAULT_TUNE.airBrake).toBeLessThan(P.fricGround);                // a hamujesz słabiej
    expect((BLOCK - NARROW_BY * NARROW_MAX) * 2).toBe(BLOCK);                // od narrowEnd piętra – połowa szerokości
  });
});
