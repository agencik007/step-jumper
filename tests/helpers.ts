// Pomocnicy testów: powtarzalny generator liczb i „gracze” produkujący strumień wejść.
import { AXIS_MAX, packInput } from '../src/sim';
import type { SimState } from '../src/sim';

export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Pilot {
  /** Zwraca wejście na kolejny krok: oś −AXIS_MAX…AXIS_MAX i skok. */
  next(s: SimState): { axis: number; jump: boolean };
}

/** Losowe przytrzymania klawiszy – ginie wcześnie, ale trafia w nietypowe sytuacje. */
export function randomPilot(seed: number): Pilot {
  const r = prng(seed);
  let axis = 0, jump = false, left = 0;
  return {
    next() {
      if (left-- <= 0) {
        left = 5 + Math.floor(r() * 150);
        axis = [-AXIS_MAX, 0, AXIS_MAX][Math.floor(r() * 3)];
        jump = r() < 0.6;
      }
      return { axis, jump };
    },
  };
}

/** Losowy przechył: oś przyjmuje wszystkie poziomy pośrednie. */
export function tiltPilot(seed: number): Pilot {
  const r = prng(seed);
  let axis = 0, jump = false, left = 0;
  return {
    next() {
      if (left-- <= 0) {
        left = 3 + Math.floor(r() * 60);
        axis = Math.floor(r() * (2 * AXIS_MAX + 1)) - AXIS_MAX;
        jump = r() < 0.7;
      }
      return { axis, jump };
    },
  };
}

/** Gracz, który trzyma rozpęd: biegnie w stronę, w którą już leci, i prawie zawsze trzyma skok. */
export function momentumPilot(seed: number): Pilot {
  const r = prng(seed);
  let dir = 1, release = 0;
  return {
    next(s) {
      if (Math.abs(s.hero.vx) > 60) dir = Math.sign(s.hero.vx);
      else if (r() < 0.02) dir = -dir;
      if (release > 0) release--;
      else if (r() < 0.004) release = 10 + Math.floor(r() * 40);
      return { axis: dir * AXIS_MAX, jump: release === 0 };
    },
  };
}

export function inputByte(i: { axis: number; jump: boolean }): number {
  return packInput(i.axis, i.jump);
}

/** Gracz, który najpierw stoi bez ruchu (wieża nie rusza, dopóki nikt nie wskoczy wyżej), a potem gra jak inny pilot – daje dowolnie długi bieg. */
export function idleThen(idleTicks: number, then: Pilot): Pilot {
  let left = idleTicks;
  return { next(s) { return left-- > 0 ? { axis: 0, jump: false } : then.next(s); } };
}
