// Wyścig w pokoju znajomych: zakładanie, bilety na wspólnej wieży, bieg ucięty zegarem (combo zaliczone),
// tabela wyścigu (najlepszy bieg / suma, budżet czasu), wynik ostateczny i brak wpisów w zwykłym rankingu.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { liveKey } from '../../server/src/live';
import { BUDGET_SLACK_TICKS, MATCH_CUT_EARLY_MS, MATCH_GRACE_MS, MATCH_LEAD_MS, budgetTicks, maxTicks, standings } from '../../server/src/match';
import type { MatchRun } from '../../server/src/match';
import { splitChunks } from '../../server/src/verify';
import { InputRecorder, SIM_VERSION, TICK_RATE, createState, encodeInputs, score, step, timeUp } from '../../src/sim';
import type { SimState } from '../../src/sim';
import { idleThen, inputByte, momentumPilot } from '../helpers';
import { START, playRun, startServer } from './harness';

let srv: Awaited<ReturnType<typeof startServer>>;
beforeAll(async () => { srv = await startServer(); }, 60_000);
afterAll(async () => { await srv?.dispose(); });
beforeEach(async () => { await srv.reset(); });

const rows = async (sql: string, ...args: unknown[]) => (await srv.db.prepare(sql).bind(...args).all()).results as any[];

async function player(nick: string) {
  const token = await srv.newPlayer();
  await srv.call('PATCH', '/v1/me', { token, json: { nick } });
  return token;
}
/** Pokój z graczami o podanych nickach; zwraca ich tokeny w tej kolejności. */
async function room(...nicks: string[]) {
  const tokens = [];
  for (const n of nicks) tokens.push(await player(n));
  await srv.call('POST', '/v1/rooms', { token: tokens[0], json: { name: 'Ekipa', password: 'tajne123' } });
  for (const t of tokens.slice(1)) await srv.call('POST', '/v1/rooms/join', { token: t, json: { name: 'Ekipa', password: 'tajne123' } });
  return tokens;
}
const newMatch = (token: string, minutes = 2, scoring = 'best') => srv.call('POST', '/v1/rooms/me/matches', { token, json: { minutes, scoring } });
const ticket = (token: string, match: string) => srv.call('POST', '/v1/runs', { token, json: { simVersion: SIM_VERSION, mode: 'match', match } });
const results = (token: string, id: string) => srv.call('GET', `/v1/rooms/me/matches/${id}`, { token });

/** Bieg na wieży wyścigu: do upadku albo ucięty po cutAt krokach (wtedy z timeUp, jak w grze). */
function race(seed: number, pilotSeed: number, cutAt?: number): { ticks: Uint8Array; score: number; state: SimState; cut: boolean } {
  if (cutAt === undefined) { const r = playRun(seed, idleThen(0, momentumPilot(pilotSeed))); return { ...r, cut: false }; }
  const s = createState(seed), rec = new InputRecorder(), pilot = momentumPilot(pilotSeed);
  while (!s.over && s.tick < cutAt) { const i = pilot.next(s); rec.push(inputByte(i)); step(s, i.axis, i.jump); }
  const cut = !s.over;
  timeUp(s);
  return { ticks: rec.ticks().slice(), score: score(s), state: s, cut };
}

/** Wysyła bieg z wyścigu (ostatnia porcja z ?end=time, gdy bieg ucięty) i go zatwierdza. Zegar ustawia wywołujący. */
async function send(token: string, runId: string, run: { ticks: Uint8Array; score: number; cut: boolean }, claim?: number) {
  const chunks = splitChunks(run.ticks);
  for (let i = 0; i < chunks.length; i++) {
    const end = run.cut && i === chunks.length - 1 ? '?end=time' : '';
    const r = await srv.call('PUT', `/v1/runs/${runId}/chunks/${i}${end}`, { token, body: encodeInputs(chunks[i]), headers: { 'content-type': 'application/octet-stream' } });
    if (r.status !== 200) return r;
  }
  return srv.call('POST', `/v1/runs/${runId}/finish`, { token, json: { score: claim ?? run.score, char: 'fox', style: 'classic', control: 'keys', appVersion: 'test' } });
}

describe('zakładanie wyścigu', () => {
  test('wyścig startuje po odliczaniu; znajomi dostają zaproszenie; drugi naraz – 409 z bieżącym', async () => {
    const [a, b] = await room('Ala', 'Bartek');
    const r = await newMatch(a, 3, 'sum');
    expect(r.status).toBe(201);
    expect(r.data).toMatchObject({
      now: START,
      match: { scoring: 'sum', minutes: 3, startsAt: START + MATCH_LEAD_MS, endsAt: START + MATCH_LEAD_MS + 3 * 60_000, by: { nick: 'Ala' } },
    });
    expect(r.data.match.seed).toBeUndefined();          // wieża dopiero z biletem
    expect(srv.roomEvents).toEqual([{ room: expect.any(String), msg: { t: 'ev', e: 'match', k: await liveKey((await rows('SELECT id FROM players WHERE nick = ?', 'Ala'))[0].id), match: r.data.match, now: START } }]);

    const again = await newMatch(b);
    expect(again.status).toBe(409);
    expect(again.data).toMatchObject({ error: 'match_running', match: { id: r.data.match.id } });
    expect((await srv.call('GET', '/v1/rooms/me/match', { token: b })).data).toEqual({ match: r.data.match, now: START });
  });

  test('walidacja i pokój', async () => {
    const [a] = await room('Ala');
    expect((await newMatch(a, 4)).data).toEqual({ error: 'bad_request' });
    expect((await newMatch(a, 2, 'avg')).data).toEqual({ error: 'bad_request' });
    const lonely = await player('Samotnik');
    expect((await newMatch(lonely)).data).toEqual({ error: 'no_room' });
    expect((await srv.call('GET', '/v1/rooms/me/match', { token: lonely })).data).toEqual({ match: null, now: START });
  });

  test('po końcu wyścigu można założyć następny (rewanż); stary jest jeszcze chwilę bieżący', async () => {
    const [a] = await room('Ala');
    const m = (await newMatch(a)).data.match;
    srv.clock.now = m.endsAt + 1;
    expect((await srv.call('GET', '/v1/rooms/me/match', { token: a })).data.match.id).toBe(m.id);
    expect((await newMatch(a)).status).toBe(201);
  });
});

describe('bilety i biegi wyścigu', () => {
  test('wszyscy grają na tej samej wieży; limit kroków liczony od startu do końca', async () => {
    const [a, b] = await room('Ala', 'Bartek');
    const m = (await newMatch(a)).data.match;
    const ta = await ticket(a, m.id);
    expect(ta.status).toBe(201);
    expect(ta.data).toMatchObject({ match: m.id, startsAt: m.startsAt, endsAt: m.endsAt, maxTicks: 2 * 60 * TICK_RATE });
    srv.clock.now = m.startsAt + 30_000;
    const tb = await ticket(b, m.id);
    expect(tb.data.seed).toBe(ta.data.seed);
    expect(tb.data.maxTicks).toBe(90 * TICK_RATE);
    expect(maxTicks({ starts_at: 0, ends_at: 1000, minutes: 1 }, 999)).toBe(1);
  });

  test('bilet tylko dla pokoju wyścigu i tylko do jego końca', async () => {
    const [a] = await room('Ala');
    const m = (await newMatch(a)).data.match;
    const stranger = await player('Obcy');
    expect((await ticket(stranger, m.id)).data).toEqual({ error: 'match_not_found' });
    expect((await ticket(a, 'nie-ma')).data).toEqual({ error: 'match_not_found' });
    srv.clock.now = m.endsAt;
    expect((await ticket(a, m.id)).data).toEqual({ error: 'match_over' });
  });

  test('bieg zakończony upadkiem trafia do tabeli wyścigu, a nie do rankingu', async () => {
    const [a, b] = await room('Ala', 'Bartek');
    const m = (await newMatch(a)).data.match;
    srv.clock.now = m.startsAt;
    const t = await ticket(b, m.id);
    const run = race(t.data.seed, 1);
    srv.clock.now += Math.ceil(run.ticks.length * 1000 / TICK_RATE) + 1000;
    srv.roomEvents.length = 0;
    const r = await send(b, t.data.runId, run);
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({ status: 'verified', score: run.score, match: { id: m.id, score: run.score, runs: 1, place: 1 } });
    expect(r.data.improved).toBeUndefined();
    expect(await rows('SELECT * FROM bests')).toEqual([]);
    expect(await rows('SELECT * FROM run_chunks')).toEqual([]);
    expect(srv.roomEvents.map((e) => e.msg)).toEqual([expect.objectContaining({ e: 'mscore', nick: 'Bartek', match: m.id, score: run.score, runs: 1, last: run.score })]);
  });

  test('bieg ucięty zegarem: trwające combo zaliczone; ucięcie dopiero pod koniec wyścigu', async () => {
    const [a] = await room('Ala');
    const m = (await newMatch(a)).data.match;
    srv.clock.now = m.startsAt;
    const t = await ticket(a, m.id);
    // szukamy chwili z trwającym combo, żeby sprawdzić, że wynik je zawiera
    // (wieża jest losowa – próbujemy kolejnych pilotów, aż któryś zbuduje combo)
    let cutAt = 0, comboFloors = 0, ps = 0;
    for (let k = 1; k <= 40 && !cutAt; k++) {
      const s = createState(t.data.seed), pilot = momentumPilot(k);
      while (!s.over && s.tick < t.data.maxTicks) {
        const i = pilot.next(s); step(s, i.axis, i.jump);
        if (s.combo.jumps >= 2 && s.combo.floors >= 6) { cutAt = s.tick; comboFloors = s.combo.floors; ps = k; break; }
      }
    }
    expect(cutAt).toBeGreaterThan(0);
    const run = race(t.data.seed, ps, cutAt);
    expect(run.cut).toBe(true);
    expect(run.state.bestCombo).toBeGreaterThanOrEqual(comboFloors);

    // za wcześnie: gracz nie może „uciąć” biegu sam, żeby zgarnąć combo bez ryzyka
    srv.clock.now = m.endsAt - MATCH_CUT_EARLY_MS - 1000;
    const early = await send(a, t.data.runId, run);
    expect(early.data).toEqual({ error: 'rejected', reason: 'cut_early' });

    const t2 = await ticket(a, m.id);
    srv.clock.now = m.endsAt;
    const run2 = race(t2.data.seed, ps, cutAt);
    const r = await send(a, t2.data.runId, run2);
    expect(r.status).toBe(200);
    expect(r.data.score).toBe(run2.score);
    expect(r.data.combo).toBeGreaterThanOrEqual(comboFloors);
  });

  test('ucięcie tylko w wyścigu; bieg dłuższy niż czas wyścigu odrzucony', async () => {
    const [a] = await room('Ala');
    const classic = await srv.newRun(a);
    const r = await srv.call('PUT', `/v1/runs/${classic.runId}/chunks/0?end=time`, { token: a, body: encodeInputs(new Uint8Array(10)), headers: { 'content-type': 'application/octet-stream' } });
    expect(r.data).toEqual({ error: 'bad_request' });

    const m = (await newMatch(a)).data.match;
    srv.clock.now = m.endsAt - 1000;                   // bilet wydany sekundę przed końcem: najwyżej 120 kroków
    const t = await ticket(a, m.id);
    expect(t.data.maxTicks).toBe(TICK_RATE);
    const run = race(t.data.seed, 2, 2 * TICK_RATE);
    srv.clock.now = m.endsAt + 5000;
    expect((await send(a, t.data.runId, run)).data).toEqual({ error: 'rejected', reason: 'too_long' });
  });

  test('po czasie na wysyłkę bieg przepada; zły wynik odrzucony', async () => {
    const [a] = await room('Ala');
    const m = (await newMatch(a)).data.match;
    srv.clock.now = m.startsAt;
    const t1 = await ticket(a, m.id), t2 = await ticket(a, m.id);
    const run = race(t1.data.seed, 3, 20 * TICK_RATE);
    srv.clock.now = m.endsAt;
    expect((await send(a, t1.data.runId, run, run.score + 1)).data).toEqual({ error: 'rejected', reason: 'score_mismatch' });
    srv.clock.now = m.endsAt + MATCH_GRACE_MS + 1;
    expect((await send(a, t2.data.runId, run)).data).toEqual({ error: 'rejected', reason: 'match_closed' });
  });
});

describe('tabela wyścigu', () => {
  async function playMatch(scoring: 'best' | 'sum') {
    const [a, b] = await room('Ala', 'Bartek');
    const m = (await newMatch(a, 2, scoring)).data.match;
    srv.clock.now = m.startsAt;
    const scores: Record<string, number[]> = { a: [], b: [] };
    // bilety w trakcie wyścigu, wysyłka biegów uciętych na końcu (każdy bieg trwa 15 s gry)
    const plays = [];
    for (const [who, token, seeds] of [['a', a, [1, 2]], ['b', b, [3]]] as const) {
      for (const ps of seeds) { plays.push({ who, token, ps, t: await ticket(token, m.id) }); srv.clock.now += 16_000; }
    }
    srv.clock.now = m.endsAt;
    for (const { who, token, ps, t } of plays) {
      const run = race(t.data.seed, ps, 15 * TICK_RATE);
      const r = await send(token, t.data.runId, run);
      expect(r.status).toBe(200);
      scores[who].push(run.score);
    }
    return { a, b, m, scores };
  }

  test('najlepszy bieg; ostateczna po czasie na wysyłkę i zapisana', async () => {
    const { a, b, m, scores } = await playMatch('best');
    const live = await results(b, m.id);
    expect(live.data.final).toBe(false);
    const bestA = Math.max(...scores.a), bestB = scores.b[0];
    const order = bestA > bestB ? ['Ala', 'Bartek'] : ['Bartek', 'Ala'];
    expect(live.data.entries.map((e: any) => e.nick)).toEqual(order);
    expect(live.data.entries.find((e: any) => e.nick === 'Ala')).toMatchObject({ score: bestA, runs: 2 });
    expect(live.data.entries.find((e: any) => e.nick === 'Bartek')).toMatchObject({ score: bestB, runs: 1, me: true });

    srv.clock.now = m.endsAt + MATCH_GRACE_MS + 1;
    const fin = await results(a, m.id);
    expect(fin.data.final).toBe(true);
    expect(fin.data.entries.map((e: any) => [e.place, e.nick, e.score])).toEqual(live.data.entries.map((e: any) => [e.place, e.nick, e.score]));
    expect((await rows('SELECT player_id FROM match_results')).length).toBe(2);
    // zapisana tabela się nie zmienia
    await srv.db.prepare("UPDATE runs SET score = 0 WHERE mode = 'match'").run();
    expect((await results(a, m.id)).data.entries.map((e: any) => e.score)).toEqual(fin.data.entries.map((e: any) => e.score));
  });

  test('suma biegów', async () => {
    const { a, m, scores } = await playMatch('sum');
    const e = (await results(a, m.id)).data.entries.find((x: any) => x.nick === 'Ala');
    expect(e).toMatchObject({ score: scores.a[0] + scores.a[1], runs: 2, me: true });
  });

  test('tabela tylko dla pokoju wyścigu', async () => {
    const { m } = await playMatch('best');
    expect((await results(await player('Obcy'), m.id)).data).toEqual({ error: 'match_not_found' });
  });
});

describe('standings – budżet czasu i remisy', () => {
  const run = (player_id: string, score: number, ticks: number, issued_at: number, finished_at = issued_at + 1): MatchRun =>
    ({ player_id, score, ticks, floor: score / 10, combo: 0, issued_at, finished_at });
  const m = { starts_at: 0, ends_at: 60_000, minutes: 1 };

  test('biegi ponad budżet czasu odpadają (dwa urządzenia naraz nie podwoją sumy)', () => {
    const half = 30 * TICK_RATE;
    const t = standings([run('a', 100, half, 1), run('a', 200, half, 2), run('a', 300, half, 3)], 'sum', budgetTicks(m));
    expect(t).toEqual([expect.objectContaining({ player_id: 'a', score: 300, runs: 2 })]);
    expect(budgetTicks(m)).toBe(60 * TICK_RATE + BUDGET_SLACK_TICKS);
  });

  test('remis wygrywa ten, kto osiągnął wynik wcześniej', () => {
    const t = standings([run('b', 500, 10, 1, 50), run('a', 500, 10, 1, 40), run('c', 600, 10, 1, 90)], 'best', 1000);
    expect(t.map((s) => [s.place, s.player_id])).toEqual([[1, 'c'], [2, 'a'], [3, 'b']]);
  });
});
