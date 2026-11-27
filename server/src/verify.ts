// Weryfikacja zapisu biegu: serwer sam odtwarza symulację z wejść gracza, porcja po porcji.
//
// Porcje są konieczne, bo darmowy plan Workers daje 10 ms procesora na jedno zapytanie, a długi bieg
// to ponad 100 tys. kroków. Stan symulacji po każdej porcji trafia do bazy jako punkt kontrolny (JSON).
import { createState, decodeInputs, step, timeUp, unpackAxis, unpackJump } from '../../src/sim';
import type { SimState } from '../../src/sim';

/**
 * Kroki w jednej porcji (≈ 17 s gry). Wszystkie porcje poza ostatnią mają dokładnie tyle kroków.
 * Pomiar na Cloudflare (18.11.2026): 6000 kroków kosztowało 4–15 ms CPU, czyli często ponad limit 10 ms –
 * serwery Cloudflare liczą symulację wyraźnie wolniej niż komputer deweloperski. 2000 kroków daje zapas.
 */
export const CHUNK_TICKS = 2000;
/** Najdłuższy bieg, jaki serwer przyjmie: 4 godziny gry. */
export const MAX_CHUNKS = (120 * 60 * 60 * 4) / CHUNK_TICKS;

/** Zapis biegu jest nie do przyjęcia; reason trafia do bazy i do odpowiedzi API. */
export class Rejected extends Error {
  constructor(readonly reason: string) { super(reason); }
}

/** Dzieli wejścia kroków na porcje, które klient wysyła po kolei (każdą kodując encodeInputs). */
export function splitChunks(ticks: Uint8Array): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let i = 0; i < ticks.length; i += CHUNK_TICKS) out.push(ticks.subarray(i, i + CHUNK_TICKS));
  return out;
}

/**
 * Odtwarza jedną porcję od punktu kontrolnego (null = początek biegu) i zwraca nowy punkt kontrolny.
 * Przekazany punkt kontrolny nie jest modyfikowany.
 * cut – ostatnia porcja biegu z wyścigu uciętego zegarem: może być krótsza, a po niej bieg kończy timeUp
 * (trwające combo zaliczone).
 */
export function verifyChunk(seed: number, checkpoint: SimState | null, data: Uint8Array, o: { cut?: boolean } = {}): SimState {
  let ticks: Uint8Array;
  try {
    ticks = decodeInputs(data, CHUNK_TICKS);
  } catch (e) {
    throw new Rejected(e instanceof Error && e.message.includes('za długi') ? 'chunk_too_long' : 'corrupt');
  }
  if (ticks.length === 0) throw new Rejected('empty_chunk');

  const s: SimState = checkpoint ? structuredClone(checkpoint) : createState(seed);
  if (s.seed !== seed >>> 0) throw new Rejected('bad_checkpoint');

  for (let i = 0; i < ticks.length; i++) {
    if (s.over) throw new Rejected('inputs_after_end');
    step(s, unpackAxis(ticks[i]), unpackJump(ticks[i]));
  }
  if (o.cut) {
    timeUp(s);                                         // upadek w ostatnim kroku – zostaje zwykłym końcem biegu
    return s;
  }
  if (ticks.length < CHUNK_TICKS && !s.over) throw new Rejected('short_chunk');
  return s;
}
