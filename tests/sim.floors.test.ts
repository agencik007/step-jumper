import { describe, expect, test } from 'vitest';
import { FIELD, GAP, LEFT, NARROW_EVERY, NARROW_MAX, RIGHT, floorAt, narrowLevel } from '../src/sim';

describe('floorAt – piętra wieży', () => {
  test('co 50. piętro zajmuje całą szerokość między ścianami', () => {
    for (const n of [0, 50, 100, 950]) {
      expect(floorAt(1234, n)).toEqual({ n, x: LEFT, w: FIELD, y: -n * GAP });
    }
  });

  test('piętra 1–99 mają 128–288 px szerokości w krokach po 32 (jak przed zwężaniem)', () => {
    const widths = new Set<number>();
    for (const seed of [1, 2, 3, 987654321]) {
      for (let n = 1; n < NARROW_EVERY; n++) {
        if (n % 50 !== 0) widths.add(floorAt(seed, n).w);
      }
    }
    expect([...widths].sort((a, b) => a - b)).toEqual([128, 160, 192, 224, 256, 288]);
  });

  test('co 100 pięter klocek piętra traci 2 px, aż do 800. piętra (64–144 px)', () => {
    expect([0, 99, 100, 199, 200, 750, 799, 800, 5000].map(narrowLevel)).toEqual([0, 0, 1, 1, 2, 7, 7, 8, 8]);
    for (let lv = 0; lv <= NARROW_MAX + 2; lv++) {
      const block = 32 - 2 * Math.min(lv, NARROW_MAX);
      const widths = new Set<number>();
      for (const seed of [11, 22, 33, 44]) {
        for (let n = lv * NARROW_EVERY + 1; n < (lv + 1) * NARROW_EVERY; n++) {
          if (n % 50 !== 0) widths.add(floorAt(seed, n).w);
        }
      }
      expect([...widths].sort((a, b) => a - b)).toEqual([4, 5, 6, 7, 8, 9].map((k) => k * block));
    }
  });

  test('zwykłe piętro ma 64–288 px, mieści się między ścianami i ma całkowite położenie', () => {
    for (let n = 1; n < 2000; n++) {
      if (n % 50 === 0) continue;
      const f = floorAt(987654321, n);
      expect(f.w).toBeGreaterThanOrEqual(64);
      expect(f.w).toBeLessThanOrEqual(288);
      expect(Number.isInteger(f.x)).toBe(true);
      expect(f.x).toBeGreaterThanOrEqual(LEFT);
      expect(f.x + f.w).toBeLessThanOrEqual(RIGHT);
      expect(f.y).toBe(-n * GAP);
    }
  });

  test('to samo ziarno daje zawsze tę samą wieżę', () => {
    for (let n = 1; n < 300; n++) expect(floorAt(42, n)).toEqual(floorAt(42, n));
  });

  test('różne ziarna dają różne wieże', () => {
    let same = 0;
    for (let n = 1; n < 300; n++) {
      const a = floorAt(1, n), b = floorAt(2, n);
      if (a.x === b.x && a.w === b.w) same++;
    }
    expect(same).toBeLessThan(30);
  });

  test('piętra są rozrzucone po całej szerokości pola', () => {
    let minX = Infinity, maxRight = -Infinity;
    for (let n = 1; n < 3000; n++) {
      if (n % 50 === 0) continue;
      const f = floorAt(7, n);
      minX = Math.min(minX, f.x); maxRight = Math.max(maxRight, f.x + f.w);
    }
    expect(minX).toBeLessThanOrEqual(LEFT + 4);
    expect(maxRight).toBeGreaterThanOrEqual(RIGHT - 4);
  });
});
