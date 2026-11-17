import { describe, expect, test } from 'vitest';
import { CAM_LERP, STEP, jumpCurve } from '../src/sim';

describe('jumpCurve – krzywa „im szybciej biegniesz, tym wyżej skaczesz”', () => {
  test('na końcach przedziału daje dokładnie 0 i 1', () => {
    expect(jumpCurve(0)).toBe(0);
    expect(jumpCurve(1)).toBe(1);
  });

  test('odbiega od k^1.4 o mniej niż 0,00005 (poniżej 0,04 px/s prędkości skoku)', () => {
    let worst = 0;
    for (let i = 0; i <= 20000; i++) {
      const k = i / 20000;
      worst = Math.max(worst, Math.abs(jumpCurve(k) - Math.pow(k, 1.4)));
    }
    expect(worst).toBeLessThan(5e-5);
  });

  test('rośnie razem z prędkością', () => {
    let prev = -1;
    for (let i = 0; i <= 5000; i++) {
      const v = jumpCurve(i / 5000);
      expect(v).toBeGreaterThan(prev);
      prev = v;
    }
  });

  test('wartości spoza przedziału są przycinane', () => {
    expect(jumpCurve(-0.5)).toBe(0);
    expect(jumpCurve(1.5)).toBe(1);
  });
});

describe('CAM_LERP – stała pogoni kamery', () => {
  test('odpowiada wzorowi 1 − e^(−7·dt) z pierwszej wersji gry', () => {
    expect(CAM_LERP).toBe(1 - Math.exp(-7 * STEP));
  });
});
