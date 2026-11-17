import { describe, expect, test } from 'vitest';
import { FIELD, GAP, LEFT, RIGHT, floorAt } from '../src/sim';

describe('floorAt – piętra wieży', () => {
  test('co 50. piętro zajmuje całą szerokość między ścianami', () => {
    for (const n of [0, 50, 100, 950]) {
      expect(floorAt(1234, n)).toEqual({ n, x: LEFT, w: FIELD, y: -n * GAP });
    }
  });

  test('zwykłe piętro ma 128–288 px szerokości w krokach po 32 i mieści się między ścianami', () => {
    const widths = new Set<number>();
    for (let n = 1; n < 2000; n++) {
      if (n % 50 === 0) continue;
      const f = floorAt(987654321, n);
      widths.add(f.w);
      expect(f.w % 32).toBe(0);
      expect(f.w).toBeGreaterThanOrEqual(128);
      expect(f.w).toBeLessThanOrEqual(288);
      expect(Number.isInteger(f.x)).toBe(true);
      expect(f.x).toBeGreaterThanOrEqual(LEFT);
      expect(f.x + f.w).toBeLessThanOrEqual(RIGHT);
      expect(f.y).toBe(-n * GAP);
    }
    expect([...widths].sort((a, b) => a - b)).toEqual([128, 160, 192, 224, 256, 288]);
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
