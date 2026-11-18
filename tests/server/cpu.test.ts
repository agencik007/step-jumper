// Budżet procesora: darmowy plan Workers daje 10 ms CPU na zapytanie, a weryfikacja pełnej porcji jest jego największą częścią.
// Mierzone w Node (ten sam silnik V8 co Workers), na aktywnej grze, nie na staniu w miejscu.
import { expect, test } from 'vitest';
import { CHUNK_TICKS, verifyChunk } from '../../server/src/verify';
import { encodeInputs } from '../../src/sim';
import { momentumPilot } from '../helpers';
import { playRun } from './harness';

test('weryfikacja pełnej porcji mieści się w połowie limitu CPU', () => {
  const run = playRun(137, momentumPilot(3658));               // długi, aktywny bieg (ponad 11 000 kroków)
  expect(run.ticks.length).toBeGreaterThan(CHUNK_TICKS);
  const chunk = encodeInputs(run.ticks.subarray(0, CHUNK_TICKS));
  const t0 = performance.now();
  verifyChunk(137, null, chunk);                                // pierwszy raz: kod jeszcze nierozgrzany, jak w świeżym izolacie
  const cold = performance.now() - t0;
  const warm: number[] = [];
  for (let i = 0; i < 30; i++) { const t = performance.now(); verifyChunk(137, null, chunk); warm.push(performance.now() - t); }
  warm.sort((a, b) => a - b);
  const median = warm[warm.length >> 1];
  console.log(`[cpu] porcja ${CHUNK_TICKS} kroków: pierwsza ${cold.toFixed(2)} ms, mediana ${median.toFixed(2)} ms`);
  expect(median).toBeLessThan(5);
});
