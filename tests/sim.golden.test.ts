// „Złote biegi”: zapisane na sztywno wyniki kilku przebiegów.
//
// Jeśli ten test przestał przechodzić, to znaczy, że zmieniła się rozgrywka (fizyka, układ pięter albo punktacja).
// Zapisy biegów nagrane starą wersją przestaną się wtedy zgadzać na serwerze, więc:
//   1. upewnij się, że zmiana jest zamierzona,
//   2. podbij SIM_VERSION w src/sim/constants.ts,
//   3. dopiero wtedy zaktualizuj wartości poniżej (npx vitest run -u).
import { expect, test } from 'vitest';
import { DEFAULT_TUNE, LEGACY_TUNE, SIM_VERSION, createState, floorAt, score, stateHash, step } from '../src/sim';
import { momentumPilot, tiltPilot } from './helpers';
import type { Pilot } from './helpers';

// Złote biegi są grane fizyką lotu z pierwszej wersji gry – dopóki sterowność w locie jest strojona suwakami,
// pilnują, że reszta rozgrywki się nie zmieniła.
function play(seed: number, pilot: Pilot, tune = LEGACY_TUNE) {
  const s = createState(seed, tune);
  while (!s.over && s.tick < 120 * 60 * 6) {
    const i = pilot.next(s);
    step(s, i.axis, i.jump);
  }
  return { ticks: s.tick, floor: s.maxFloor, bestCombo: s.bestCombo, score: score(s), over: s.over, hash: stateHash(s) };
}

test('wersja symulacji, dla której zapisano złote biegi', () => {
  expect(SIM_VERSION).toBe(2);
});

test('układ pierwszych pięter wieży o ziarnie 2026', () => {
  expect([1, 2, 3, 4, 5, 6].map((n) => { const f = floorAt(2026, n); return `${f.x}+${f.w}`; })).toMatchInlineSnapshot(`
    [
      "274+256",
      "108+192",
      "344+192",
      "186+128",
      "255+256",
      "289+128",
    ]
  `);
});

test('bieg na klawiszach, ziarno 503', () => {
  expect(play(503, momentumPilot(3521))).toMatchInlineSnapshot(`
    {
      "bestCombo": 68,
      "floor": 177,
      "hash": "eadc565eb2b9c8b4",
      "over": true,
      "score": 10999,
      "ticks": 5440,
    }
  `);
});

test('bieg na klawiszach, ziarno 77', () => {
  expect(play(77, momentumPilot(12))).toMatchInlineSnapshot(`
    {
      "bestCombo": 0,
      "floor": 7,
      "hash": "9f9ccc28688119c6",
      "over": true,
      "score": 70,
      "ticks": 546,
    }
  `);
});

test('bieg na przechyle, ziarno 9001', () => {
  expect(play(9001, tiltPilot(44))).toMatchInlineSnapshot(`
    {
      "bestCombo": 0,
      "floor": 11,
      "hash": "d276687a0bbe0312",
      "over": true,
      "score": 110,
      "ticks": 1001,
    }
  `);
});

// Te same biegi na strojeniu gry (DEFAULT_TUNE) – pilnują fizyki lotu, z którą faktycznie się gra.
test('bieg na klawiszach, ziarno 503, strojenie gry', () => {
  expect(play(503, momentumPilot(3521), DEFAULT_TUNE)).toMatchInlineSnapshot(`
    {
      "bestCombo": 0,
      "floor": 18,
      "hash": "bf7e7e0b1d8666cb",
      "over": true,
      "score": 180,
      "ticks": 716,
    }
  `);
});

test('bieg na klawiszach, ziarno 77, strojenie gry', () => {
  expect(play(77, momentumPilot(12), DEFAULT_TUNE)).toMatchInlineSnapshot(`
    {
      "bestCombo": 0,
      "floor": 4,
      "hash": "d6c54e5575f0ffe1",
      "over": true,
      "score": 40,
      "ticks": 366,
    }
  `);
});

test('bieg na przechyle, ziarno 9001, strojenie gry', () => {
  expect(play(9001, tiltPilot(44), DEFAULT_TUNE)).toMatchInlineSnapshot(`
    {
      "bestCombo": 9,
      "floor": 12,
      "hash": "eab8547726d8f627",
      "over": true,
      "score": 201,
      "ticks": 900,
    }
  `);
});
