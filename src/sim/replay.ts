// Zapis biegu: ziarno wieży + wejście gracza w każdym kroku fizyki. Z tych dwóch rzeczy da się odtworzyć cały bieg.
import { AXIS_MAX } from './constants';
import { createState, step } from './sim';
import type { SimState } from './sim';

const JUMP_BIT = 32;
const AXIS_MASK = 31;

/** Wejście jednego kroku w jednym bajcie: bity 0–4 to oś przesunięta o AXIS_MAX, bit 5 to skok. */
export function packInput(axis: number, jump: boolean): number {
  const a = Math.max(-AXIS_MAX, Math.min(AXIS_MAX, Math.round(axis)));
  return (a + AXIS_MAX) | (jump ? JUMP_BIT : 0);
}
export function unpackAxis(b: number): number { return (b & AXIS_MASK) - AXIS_MAX; }
export function unpackJump(b: number): boolean { return (b & JUMP_BIT) !== 0; }

function isValidInput(b: number): boolean { return b < 64 && (b & AXIS_MASK) <= 2 * AXIS_MAX; }

/** Zbiera wejścia kolejnych kroków w trakcie gry. */
export class InputRecorder {
  private buf: Uint8Array;
  private len = 0;
  constructor(capacity = 8192) { this.buf = new Uint8Array(Math.max(1, capacity)); }

  get length(): number { return this.len; }
  push(b: number): void {
    if (this.len === this.buf.length) {
      const next = new Uint8Array(this.buf.length * 2);
      next.set(this.buf);
      this.buf = next;
    }
    this.buf[this.len++] = b;
  }
  /** Wejścia wszystkich nagranych kroków (widok na bufor – kopiuj, jeśli nagrywanie trwa dalej). */
  ticks(): Uint8Array { return this.buf.subarray(0, this.len); }
  reset(): void { this.len = 0; }
}

/**
 * Pakuje strumień „bajt na krok” do serii: [liczba kroków jako varint][bajt wejścia].
 * Gracz zmienia wejście kilka razy na sekundę, a kroków jest 120 na sekundę, więc zapis kurczy się kilkadziesiąt razy.
 */
export function encodeInputs(ticks: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < ticks.length) {
    const b = ticks[i];
    let run = 1;
    while (i + run < ticks.length && ticks[i + run] === b) run++;
    i += run;
    while (run >= 0x80) { out.push((run & 0x7f) | 0x80); run = Math.floor(run / 128); }
    out.push(run, b);
  }
  return Uint8Array.from(out);
}

/**
 * Odwrotność encodeInputs. Rzuca wyjątek dla danych uszkodzonych albo dłuższych niż maxTicks –
 * serwer dostaje te dane z sieci i nie może im ufać.
 */
export function decodeInputs(data: Uint8Array, maxTicks = 120 * 60 * 60 * 4): Uint8Array {
  const runs: number[] = [];
  let total = 0, i = 0;
  while (i < data.length) {
    let run = 0, mul = 1, more = true;
    while (more) {
      if (i >= data.length || mul > 0x10000000) throw new Error('Uszkodzony zapis biegu: urwana długość serii');
      const v = data[i++];
      run += (v & 0x7f) * mul;
      mul *= 128;
      more = (v & 0x80) !== 0;
    }
    if (run === 0) throw new Error('Uszkodzony zapis biegu: seria o zerowej długości');
    if (i >= data.length) throw new Error('Uszkodzony zapis biegu: brak wejścia po długości serii');
    const b = data[i++];
    if (!isValidInput(b)) throw new Error('Uszkodzony zapis biegu: wejście spoza zakresu');
    total += run;
    if (total > maxTicks) throw new Error('Zapis biegu jest za długi');
    runs.push(run, b);
  }
  const ticks = new Uint8Array(total);
  let at = 0;
  for (let r = 0; r < runs.length; r += 2) { ticks.fill(runs[r + 1], at, at + runs[r]); at += runs[r]; }
  return ticks;
}

/**
 * Odtwarza wejścia na wieży o danym ziarnie. Podany stan pozwala kontynuować od punktu kontrolnego
 * (serwer weryfikuje długie biegi porcjami). Wejścia po końcu gry są ignorowane.
 * Bieg grany z innym strojeniem lotu niż domyślne trzeba odtwarzać od stanu createState(seed, tune).
 */
export function runReplay(seed: number, ticks: Uint8Array, state: SimState = createState(seed)): SimState {
  if (state.seed !== seed >>> 0) throw new Error('Punkt kontrolny pochodzi z innej wieży');
  for (let i = 0; i < ticks.length && !state.over; i++) {
    const b = ticks[i];
    step(state, unpackAxis(b), unpackJump(b));
  }
  return state;
}

/** Skrót stanu symulacji – do porównywania przebiegów między urządzeniem, testami i serwerem. */
export function stateHash(s: SimState): string {
  const h = s.hero, c = s.combo;
  const nums = [
    s.seed, s.tick, h.x, h.y, h.vx, h.vy, h.face, h.onFloor, h.from, h.spin ? 1 : 0,
    s.camY, s.maxFloor, s.bonus, s.bestCombo, c.floors, c.jumps, c.timer,
    s.scrolling ? 1 : 0, s.level, s.clock, s.hurries, s.genN, s.lowN, s.over ? 1 : 0,
    s.boost.n, s.boost.x, s.boost.k, s.rising ? 1 : 0, s.riseTo, s.afterBoost ? 1 : 0,
    s.slow.n, s.slow.x, s.slow.k, s.slow.clock, s.slow.t,
  ];
  const bytes = new Uint8Array(new Float64Array(nums.map((n) => n + 0)).buffer);   // „+ 0” ujednolica −0 i 0
  let a = 0x811c9dc5, b = 0x01000193;
  for (let i = 0; i < bytes.length; i++) {
    a = Math.imul(a ^ bytes[i], 0x01000193);
    b = Math.imul(b ^ bytes[i], 0x5bd1e995) + i;
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}
