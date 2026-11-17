import { describe, expect, test } from 'vitest';
import {
  AXIS_MAX, InputRecorder, createState, decodeInputs, encodeInputs, packInput, runReplay, score, stateHash, step, unpackAxis, unpackJump,
} from '../src/sim';
import { inputByte, momentumPilot, tiltPilot } from './helpers';
import type { Pilot } from './helpers';

/** Rozgrywa bieg „na żywo”, nagrywając wejścia tak, jak robi to gra. */
function playLive(seed: number, pilot: Pilot, maxTicks = 120 * 60 * 4) {
  const sim = createState(seed);
  const rec = new InputRecorder();
  while (!sim.over && sim.tick < maxTicks) {
    const i = pilot.next(sim);
    rec.push(inputByte(i));
    step(sim, i.axis, i.jump);
  }
  return { sim, rec };
}

describe('kodowanie wejścia jednego kroku', () => {
  test('każda kombinacja osi i skoku wraca po rozpakowaniu', () => {
    for (let axis = -AXIS_MAX; axis <= AXIS_MAX; axis++) {
      for (const jump of [false, true]) {
        const b = packInput(axis, jump);
        expect(b).toBeGreaterThanOrEqual(0);
        expect(b).toBeLessThan(64);
        expect(unpackAxis(b)).toBe(axis);
        expect(unpackJump(b)).toBe(jump);
      }
    }
  });

  test('oś spoza zakresu jest przycinana, a ułamki zaokrąglane', () => {
    expect(unpackAxis(packInput(99, false))).toBe(AXIS_MAX);
    expect(unpackAxis(packInput(-99, false))).toBe(-AXIS_MAX);
    expect(unpackAxis(packInput(2.6, false))).toBe(3);
  });
});

describe('zapis biegu', () => {
  test('zakodowany i odkodowany strumień wejść jest identyczny', () => {
    const { rec } = playLive(11, tiltPilot(5));
    const ticks = rec.ticks();
    expect(decodeInputs(encodeInputs(ticks))).toEqual(ticks);
  });

  test('pusty zapis koduje się do pustego', () => {
    expect(encodeInputs(new Uint8Array(0)).length).toBe(0);
    expect(decodeInputs(new Uint8Array(0)).length).toBe(0);
  });

  test('długie przytrzymanie klawisza zajmuje kilka bajtów, a nie bajt na krok', () => {
    const ticks = new Uint8Array(50000).fill(packInput(AXIS_MAX, true));
    const enc = encodeInputs(ticks);
    expect(enc.length).toBeLessThanOrEqual(4);
    expect(decodeInputs(enc)).toEqual(ticks);
  });

  test('zapis kilkuminutowego biegu na klawiszach mieści się w kilku kilobajtach', () => {
    const { sim, rec } = playLive(503, momentumPilot(503 * 7));
    expect(sim.tick).toBeGreaterThan(120 * 20);
    expect(encodeInputs(rec.ticks()).length).toBeLessThan(8 * 1024);
  });

  test('uszkodzony zapis jest odrzucany zamiast odtwarzany po cichu', () => {
    expect(() => decodeInputs(new Uint8Array([0x85]))).toThrow();          // urwana liczba
    expect(() => decodeInputs(new Uint8Array([5]))).toThrow();             // brak bajtu wejścia
    expect(() => decodeInputs(new Uint8Array([5, 0xff]))).toThrow();       // wejście spoza zakresu
    expect(() => decodeInputs(new Uint8Array([0, 8]))).toThrow();          // zerowa długość serii
  });

  test('nagrywarka rośnie bez gubienia danych', () => {
    const rec = new InputRecorder(4);
    for (let i = 0; i < 1000; i++) rec.push(packInput((i % 17) - 8, i % 3 === 0));
    const t = rec.ticks();
    expect(t.length).toBe(1000);
    for (let i = 0; i < 1000; i++) expect(t[i]).toBe(packInput((i % 17) - 8, i % 3 === 0));
  });
});

describe('odtwarzanie biegu', () => {
  test('odtworzenie zapisu daje ten sam stan końcowy, co bieg na żywo', () => {
    for (const seed of [21, 22, 23, 24, 25]) {
      const { sim, rec } = playLive(seed, momentumPilot(seed));
      const replayed = runReplay(seed, decodeInputs(encodeInputs(rec.ticks())));
      expect(replayed.over).toBe(sim.over);
      expect(score(replayed)).toBe(score(sim));
      expect(stateHash(replayed)).toBe(stateHash(sim));
    }
  });

  test('ten sam zapis odtworzony na innej wieży daje inny przebieg', () => {
    const { sim, rec } = playLive(31, momentumPilot(31));
    expect(stateHash(runReplay(32, rec.ticks()))).not.toBe(stateHash(sim));
  });

  test('zmiana jednego kroku w zapisie zmienia stan końcowy', () => {
    const { sim, rec } = playLive(41, momentumPilot(41));
    const ticks = rec.ticks().slice();
    const at = Math.floor(ticks.length / 3);
    ticks[at] = packInput(-unpackAxis(ticks[at]) || AXIS_MAX, !unpackJump(ticks[at]));
    for (let i = at; i < at + 40 && i < ticks.length; i++) ticks[i] = ticks[at];
    expect(stateHash(runReplay(41, ticks))).not.toBe(stateHash(sim));
  });

  test('odtwarzanie porcjami od zapisanego stanu daje to samo, co odtworzenie w całości', () => {
    const { sim, rec } = playLive(51, momentumPilot(51));
    const ticks = rec.ticks();
    let state = createState(51);
    for (let from = 0; from < ticks.length; from += 1000) {
      state = JSON.parse(JSON.stringify(state));              // punkt kontrolny przechodzi przez JSON, jak w bazie
      runReplay(51, ticks.subarray(from, from + 1000), state);
    }
    expect(stateHash(state)).toBe(stateHash(sim));
  });

  test('wejścia po końcu gry są ignorowane, a licznik kroków staje', () => {
    const { sim, rec } = playLive(61, momentumPilot(61));
    expect(sim.over).toBe(true);
    const longer = new Uint8Array(rec.length + 500);
    longer.set(rec.ticks());
    const replayed = runReplay(61, longer);
    expect(replayed.tick).toBe(sim.tick);
    expect(stateHash(replayed)).toBe(stateHash(sim));
  });
});
