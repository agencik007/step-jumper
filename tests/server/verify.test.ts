import { describe, expect, test } from 'vitest';
import { CHUNK_TICKS, Rejected, splitChunks, verifyChunk } from '../../server/src/verify';
import { InputRecorder, createState, encodeInputs, score, stateHash, step } from '../../src/sim';
import type { SimState } from '../../src/sim';
import { idleThen, inputByte, momentumPilot } from '../helpers';
import type { Pilot } from '../helpers';

/** Rozgrywa bieg do końca gry i zwraca stan oraz wejścia kroków. */
function play(seed: number, pilot: Pilot) {
  const s = createState(seed), rec = new InputRecorder();
  while (!s.over) { const i = pilot.next(s); rec.push(inputByte(i)); step(s, i.axis, i.jump); }
  return { live: s, ticks: rec.ticks().slice() };
}

/** Weryfikuje cały bieg porcja po porcji, przepuszczając punkt kontrolny przez JSON (tak jak przez bazę). */
function verifyAll(seed: number, chunks: Uint8Array[]): SimState {
  let checkpoint: SimState | null = null;
  for (const c of chunks) checkpoint = JSON.parse(JSON.stringify(verifyChunk(seed, checkpoint, c)));
  return checkpoint!;
}

function reason(fn: () => unknown): string {
  try { fn(); } catch (e) { if (e instanceof Rejected) return e.reason; throw e; }
  return 'brak odrzucenia';
}

// długi bieg: więcej niż dwie pełne porcje (stoi 14 000 kroków, potem gra)
const IDLE = 14_000;
const LONG = play(503, idleThen(IDLE, momentumPilot(3521)));

describe('weryfikacja biegu porcjami', () => {
  test('bieg testowy jest dłuższy niż dwie porcje', () => {
    expect(LONG.ticks.length).toBeGreaterThan(2 * CHUNK_TICKS);
  });

  test('porcje dzielą zapis na pełne kawałki po CHUNK_TICKS i krótszą końcówkę', () => {
    const chunks = splitChunks(LONG.ticks);
    expect(chunks.length).toBe(Math.ceil(LONG.ticks.length / CHUNK_TICKS));
    expect(chunks.slice(0, -1).every((c) => c.length === CHUNK_TICKS)).toBe(true);
  });

  test('zweryfikowany bieg kończy się dokładnie w stanie z gry', () => {
    const end = verifyAll(503, splitChunks(LONG.ticks).map(encodeInputs));
    expect(end.over).toBe(true);
    expect(stateHash(end)).toBe(stateHash(LONG.live));
    expect(score(end)).toBe(score(LONG.live));
  });

  test('krótki bieg mieści się w jednej porcji', () => {
    const short = play(77, momentumPilot(12));
    expect(short.ticks.length).toBeLessThan(CHUNK_TICKS);
    expect(stateHash(verifyAll(77, [encodeInputs(short.ticks)]))).toBe(stateHash(short.live));
  });

  test('porcja dłuższa niż CHUNK_TICKS jest odrzucana', () => {
    expect(reason(() => verifyChunk(503, null, encodeInputs(LONG.ticks)))).toBe('chunk_too_long');
  });

  test('krótsza porcja jest dozwolona tylko wtedy, gdy kończy grę', () => {
    expect(reason(() => verifyChunk(503, null, encodeInputs(LONG.ticks.subarray(0, 100))))).toBe('short_chunk');
  });

  test('wejścia po końcu gry są odrzucane', () => {
    const short = play(77, momentumPilot(12));
    const extra = new Uint8Array(short.ticks.length + 5);
    extra.set(short.ticks);
    expect(reason(() => verifyChunk(77, null, encodeInputs(extra)))).toBe('inputs_after_end');
  });

  test('porcja po zakończonej grze jest odrzucana', () => {
    const short = play(77, momentumPilot(12));
    const end = verifyChunk(77, null, encodeInputs(short.ticks));
    expect(reason(() => verifyChunk(77, end, encodeInputs(new Uint8Array([8]))))).toBe('inputs_after_end');
  });

  test('uszkodzone dane i pusta porcja są odrzucane', () => {
    expect(reason(() => verifyChunk(1, null, new Uint8Array([5])))).toBe('corrupt');
    expect(reason(() => verifyChunk(1, null, new Uint8Array([1, 200])))).toBe('corrupt');
    expect(reason(() => verifyChunk(1, null, new Uint8Array(0)))).toBe('empty_chunk');
  });

  test('punkt kontrolny z innej wieży jest odrzucany', () => {
    const first = verifyChunk(503, null, encodeInputs(LONG.ticks.subarray(0, CHUNK_TICKS)));
    expect(reason(() => verifyChunk(504, first, encodeInputs(LONG.ticks.subarray(CHUNK_TICKS, 2 * CHUNK_TICKS))))).toBe('bad_checkpoint');
  });

  test('podmienione wejścia dają inny wynik niż w grze', () => {
    const forged = LONG.ticks.slice();
    for (let i = IDLE + 200; i < IDLE + 440; i++) forged[i] = inputByte({ axis: 0, jump: false });
    const chunks = splitChunks(forged).map(encodeInputs);
    let end: SimState | null = null;
    try { end = verifyAll(503, chunks); } catch (e) { if (!(e instanceof Rejected)) throw e; }
    if (end) expect(stateHash(end)).not.toBe(stateHash(LONG.live));
  });
});
