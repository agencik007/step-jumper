// Wieża jest czystą funkcją ziarna: piętro n wygląda zawsze tak samo, bez względu na to, kiedy i gdzie się o nie pyta.
// Dzięki temu serwer nie musi przechowywać pięter, a zapis biegu to tylko ziarno i wejścia.
import { FIELD, GAP, LEFT } from './constants';

export interface Floor { n: number; x: number; w: number; y: number }

/** Mieszanie bitów liczby 32-bitowej (finalizer MurmurHash3) – deterministyczna „losowość” wieży. */
export function mix32(h: number): number {
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Położenie i szerokość piętra spakowane w jedną liczbę (x·1024 + w) – bez alokacji, do użycia w pętli fizyki. */
export function floorSpan(seed: number, n: number): number {
  if (n % 50 === 0) return LEFT * 1024 + FIELD;                 // co 50. piętro na całą szerokość
  const a = mix32((seed ^ Math.imul(n, 0x9e3779b1)) >>> 0);
  const w = 32 * (4 + (a % 6));                                 // 128–288 px
  const b = mix32((a ^ 0x68bc21eb) >>> 0);
  return (LEFT + (b % (FIELD - w + 1))) * 1024 + w;
}

export function floorAt(seed: number, n: number): Floor {
  const span = floorSpan(seed, n);
  return { n, x: Math.floor(span / 1024), w: span % 1024, y: -n * GAP };
}
