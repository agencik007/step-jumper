// Koniec czasu wyścigu (timeUp): bieg ucięty zegarem zalicza trwające combo, tak jak złapany booster.
import { describe, expect, test } from 'vitest';
import { InputRecorder, createState, packInput, runReplay, score, stateHash, step, timeUp } from '../src/sim';
import type { SimEvent, SimState } from '../src/sim';
import { momentumPilot, randomPilot } from './helpers';

/** Gra pilotem, aż warunek będzie spełniony (albo bieg się skończy); zwraca stan i zapis wejść. */
function playUntil(seed: number, stop: (s: SimState) => boolean, limit = 120 * 60 * 3) {
  const s = createState(seed), rec = new InputRecorder(), pilot = momentumPilot(seed);
  while (!s.over && s.tick < limit && !stop(s)) {
    const i = pilot.next(s);
    rec.push(packInput(i.axis, i.jump));
    step(s, i.axis, i.jump);
  }
  return { s, ticks: rec.ticks() };
}

describe('timeUp – koniec czasu wyścigu', () => {
  test('trwające combo z co najmniej 2 skoków zostaje zaliczone: wynik rośnie o piętra²', () => {
    let found = 0;
    for (let seed = 1; seed < 40 && found < 3; seed++) {
      const { s } = playUntil(seed, (st) => st.combo.jumps >= 3 && st.combo.floors >= 8);
      if (s.over || s.combo.jumps < 3) continue;
      found++;
      const floors = s.combo.floors, before = score(s), events: SimEvent[] = [];
      timeUp(s, events);
      expect(s.over).toBe(true);
      expect(score(s)).toBe(before + floors * floors);
      expect(s.bestCombo).toBeGreaterThanOrEqual(floors);
      expect(events).toEqual([{ type: 'combo', floors, points: floors * floors }, { type: 'timeup', combo: floors }]);
    }
    expect(found).toBeGreaterThan(0);
  });

  test('combo z jednego skoku przepada (jak zawsze)', () => {
    const { s } = playUntil(7, (st) => st.combo.jumps === 1);
    expect(s.combo.jumps).toBe(1);
    const before = score(s), events: SimEvent[] = [];
    timeUp(s, events);
    expect(score(s)).toBe(before);
    expect(events).toEqual([{ type: 'timeup', combo: 0 }]);
  });

  test('po upadku nic nie zmienia', () => {
    const s = createState(3), pilot = randomPilot(3);
    while (!s.over && s.tick < 120 * 60 * 10) { const i = pilot.next(s); step(s, i.axis, i.jump); }
    expect(s.over).toBe(true);
    const h = stateHash(s), events: SimEvent[] = [];
    timeUp(s, events);
    expect(stateHash(s)).toBe(h);
    expect(events).toEqual([]);
  });

  test('odtworzenie zapisu + timeUp daje ten sam wynik co bieg na żywo', () => {
    const { s, ticks } = playUntil(11, (st) => st.tick >= 120 * 40);
    timeUp(s);
    const again = runReplay(11, ticks);
    timeUp(again);
    expect(stateHash(again)).toBe(stateHash(s));
    expect(score(again)).toBe(score(s));
  });
});
