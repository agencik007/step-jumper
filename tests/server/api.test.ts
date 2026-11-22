// API rankingu na lokalnej bazie D1: konta, bilety, wysyłka porcjami, weryfikacja, rankingi, usuwanie danych.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { MAX_SKIN_BYTES } from '../../server/src/app';
import { sha256hex } from '../../server/src/auth';
import { cleanup } from '../../server/src/cleanup';
import { CHUNK_TICKS, splitChunks } from '../../server/src/verify';
import { SIM_VERSION, decodeInputs, encodeInputs, runReplay, score } from '../../src/sim';
import { idleThen, momentumPilot } from '../helpers';
import { START, playRun, startServer } from './harness';

let srv: Awaited<ReturnType<typeof startServer>>;
beforeAll(async () => { srv = await startServer(); }, 60_000);
afterAll(async () => { await srv?.dispose(); });
beforeEach(async () => { await srv.reset(); });

const HOUR = 3_600_000, DAY = 24 * HOUR;
const rows = async (sql: string, ...args: unknown[]) => (await srv.db.prepare(sql).bind(...args).all()).results as any[];

/** Bilet + bieg rozegrany na wydanej wieży. */
async function ticketAndPlay(token: string, pilotSeed = 1, idle = 0) {
  const t = await srv.newRun(token);
  return { ...t, run: playRun(t.seed, idleThen(idle, momentumPilot(pilotSeed))) };
}

describe('konta graczy', () => {
  test('nowe konto dostaje token; serwer trzyma tylko jego skrót', async () => {
    const r = await srv.call('POST', '/v1/players', { json: { platform: 'android' } });
    expect(r.status).toBe(201);
    expect(r.data.token).toMatch(/^[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/);
    const [p] = await rows('SELECT * FROM players');
    expect(p.id).toBe(r.data.playerId);
    expect(p.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(p)).not.toContain(r.data.token.split('.')[1]);
  });

  test('nieznana platforma jest odrzucana', async () => {
    expect((await srv.call('POST', '/v1/players', { json: { platform: 'ios' } })).status).toBe(400);
    expect((await srv.call('POST', '/v1/players', { body: 'nie json', headers: { 'content-type': 'application/json' } })).status).toBe(400);
  });

  test('bez poprawnego tokenu nie ma dostępu', async () => {
    const token = await srv.newPlayer();
    const [id] = token.split('.');
    expect((await srv.call('GET', '/v1/me')).status).toBe(401);
    expect((await srv.call('GET', '/v1/me', { token: `${id}.zly-sekret` })).status).toBe(401);
    expect((await srv.call('GET', '/v1/me', { token: 'smieci' })).status).toBe(401);
    expect((await srv.call('GET', '/v1/me', { token })).status).toBe(200);
  });

  test('limit zakładania kont z jednego adresu IP', async () => {
    // losowy adres z puli testowej: licznik limitu żyje 60 s i nie może zależeć od poprzedniego przebiegu testów
    const headers = { 'cf-connecting-ip': `2001:db8::${(Date.now() % 0xffff).toString(16)}:${Math.floor(Math.random() * 0xffff).toString(16)}` };
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) codes.push((await srv.call('POST', '/v1/players', { json: { platform: 'web' }, headers })).status);
    expect(codes.filter((c) => c === 201).length).toBe(10);
    expect(codes.at(-1)).toBe(429);
  });

  test('nick: ustawienie, walidacja i unikalność bez względu na wielkość liter', async () => {
    const a = await srv.newPlayer(), b = await srv.newPlayer();
    expect((await srv.call('PATCH', '/v1/me', { token: a, json: { nick: 'Żółw' } })).data).toEqual({ nick: 'Żółw' });
    expect((await srv.call('GET', '/v1/me', { token: a })).data.nick).toBe('Żółw');
    expect((await srv.call('PATCH', '/v1/me', { token: b, json: { nick: 'ŻÓŁW' } })).status).toBe(409);
    expect((await srv.call('PATCH', '/v1/me', { token: b, json: { nick: 'kurwa' } })).data).toEqual({ error: 'nick_blocked' });
    expect((await srv.call('PATCH', '/v1/me', { token: b, json: { nick: 'x' } })).data).toEqual({ error: 'nick_length' });
    expect((await srv.call('PATCH', '/v1/me', { token: a, json: { nick: 'Żółw Ninja' } })).status).toBe(200);
    expect((await srv.call('PATCH', '/v1/me', { token: b, json: { nick: 'żółw' } })).status).toBe(200);   // zwolniony
  });
});

describe('bilety na bieg', () => {
  test('serwer wydaje ziarno wieży i wersję symulacji', async () => {
    const token = await srv.newPlayer();
    const r = await srv.call('POST', '/v1/runs', { token, json: { simVersion: SIM_VERSION } });
    expect(r.status).toBe(201);
    expect(r.data).toMatchObject({ simVersion: SIM_VERSION, chunkTicks: CHUNK_TICKS });
    expect(Number.isInteger(r.data.seed) && r.data.seed >= 0 && r.data.seed < 2 ** 32).toBe(true);
  });

  test('stara wersja gry musi się zaktualizować', async () => {
    const token = await srv.newPlayer();
    const r = await srv.call('POST', '/v1/runs', { token, json: { simVersion: SIM_VERSION - 1 } });
    expect(r.status).toBe(409);
    expect(r.data).toEqual({ error: 'update_required', simVersion: SIM_VERSION });
  });

  test('najwyżej 5 niewykorzystanych biletów – najstarsze przepadają', async () => {
    const token = await srv.newPlayer();
    const ids: string[] = [];
    for (let i = 0; i < 7; i++) { ids.push((await srv.newRun(token)).runId); srv.clock.now += 1000; }
    const left = (await rows("SELECT id FROM runs WHERE status = 'issued' ORDER BY issued_at")).map((r) => r.id);
    expect(left).toEqual(ids.slice(2));
  });

  test('limit biletów na godzinę', async () => {
    const token = await srv.newPlayer();
    const codes: number[] = [];
    for (let i = 0; i < 181; i++) { codes.push((await srv.call('POST', '/v1/runs', { token, json: { simVersion: SIM_VERSION } })).status); srv.clock.now += 1000; }
    expect(codes.slice(0, 180).every((c) => c === 201)).toBe(true);
    expect(codes[180]).toBe(429);
  }, 30_000);   // 181 zapytań po kolei – na wolniejszej maszynie (CI) nie mieści się w domyślnych 5 s

  test('zablokowany gracz nie dostaje biletów', async () => {
    const token = await srv.newPlayer();
    await srv.db.prepare('UPDATE players SET banned = 1').run();
    expect((await srv.call('POST', '/v1/runs', { token, json: { simVersion: SIM_VERSION } })).status).toBe(403);
  });
});

describe('wysyłka i weryfikacja biegu', () => {
  test('uczciwy bieg trafia do wszystkich rankingów', async () => {
    const token = await srv.newPlayer();
    const { runId, run } = await ticketAndPlay(token);
    const r = await srv.submit(token, runId, run);
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({ status: 'verified', score: run.score, floor: run.state.maxFloor, ticks: run.ticks.length });
    expect(r.data.ranks).toEqual({ all: 1, week: 1, day: 1 });
    expect(r.data.improved).toEqual({ all: true, week: true, day: true });
    const [row] = await rows('SELECT status, score, checkpoint FROM runs WHERE id = ?', runId);
    expect(row).toMatchObject({ status: 'verified', score: run.score });
  });

  test('długi bieg weryfikowany w kilku porcjach', async () => {
    const token = await srv.newPlayer();
    const { runId, run } = await ticketAndPlay(token, 2, 2 * CHUNK_TICKS + 500);
    expect(run.ticks.length).toBeGreaterThan(2 * CHUNK_TICKS);
    const r = await srv.submit(token, runId, run);
    expect(r.data).toMatchObject({ status: 'verified', score: run.score, ticks: run.ticks.length });
  });

  test('zawyżony wynik jest odrzucany', async () => {
    const token = await srv.newPlayer();
    const { runId, run } = await ticketAndPlay(token);
    const r = await srv.submit(token, runId, run, { claimScore: run.score + 1000 });
    expect(r.status).toBe(422);
    expect(r.data).toEqual({ error: 'rejected', reason: 'score_mismatch' });
    expect((await rows('SELECT status, reject_reason FROM runs'))[0]).toEqual({ status: 'rejected', reject_reason: 'score_mismatch' });
    expect(await rows('SELECT * FROM bests')).toEqual([]);
  });

  test('bieg zagrany na innej wieży niż wydana jest odrzucany', async () => {
    const token = await srv.newPlayer();
    const { runId, seed } = await srv.newRun(token);
    const run = playRun(seed ^ 1, momentumPilot(1));
    const r = await srv.submit(token, runId, run);
    expect(r.status).toBe(422);
  });

  test('bieg „szybszy niż czas rzeczywisty” jest odrzucany', async () => {
    const token = await srv.newPlayer();
    const { runId, run } = await ticketAndPlay(token);
    const r = await srv.submit(token, runId, run, { advanceMs: Math.floor(run.ticks.length * 1000 / 120 / 2) });
    expect(r.data).toEqual({ error: 'rejected', reason: 'too_fast' });
  });

  test('uszkodzona porcja odrzuca bieg', async () => {
    const token = await srv.newPlayer();
    const { runId } = await srv.newRun(token);
    const r = await srv.call('PUT', `/v1/runs/${runId}/chunks/0`, { token, body: new Uint8Array([1, 250]) });
    expect(r.status).toBe(422);
    expect(r.data).toEqual({ error: 'rejected', reason: 'corrupt' });
    expect((await srv.call('PUT', `/v1/runs/${runId}/chunks/1`, { token, body: new Uint8Array([1, 8]) })).data.error).toBe('run_closed');
  });

  test('zatwierdzenie przed końcem gry jest odrzucane', async () => {
    const token = await srv.newPlayer();
    const { runId, run } = await ticketAndPlay(token, 2, 2 * CHUNK_TICKS);
    srv.clock.now += HOUR;
    await srv.call('PUT', `/v1/runs/${runId}/chunks/0`, { token, body: encodeInputs(run.ticks.subarray(0, CHUNK_TICKS)) });
    const r = await srv.call('POST', `/v1/runs/${runId}/finish`, { token, json: { score: run.score, char: 'fox', style: 'classic', control: 'keys', appVersion: 't' } });
    expect(r.data).toEqual({ error: 'rejected', reason: 'not_over' });
  });

  test('porcje muszą iść po kolei; powtórzona porcja nie psuje biegu', async () => {
    const token = await srv.newPlayer();
    const { runId, run } = await ticketAndPlay(token, 3, CHUNK_TICKS + 100);
    srv.clock.now += HOUR;
    const [c0, c1, ...rest] = splitChunks(run.ticks).map(encodeInputs);
    expect((await srv.call('PUT', `/v1/runs/${runId}/chunks/1`, { token, body: c1 })).data).toEqual({ error: 'seq', nextSeq: 0 });
    expect((await srv.call('PUT', `/v1/runs/${runId}/chunks/0`, { token, body: c0 })).data).toMatchObject({ nextSeq: 1, over: false });
    expect((await srv.call('PUT', `/v1/runs/${runId}/chunks/0`, { token, body: c0 })).data).toEqual({ nextSeq: 1, duplicate: true });
    const tail = [c1, ...rest];
    let last: any = null;
    for (let i = 0; i < tail.length; i++) last = (await srv.call('PUT', `/v1/runs/${runId}/chunks/${i + 1}`, { token, body: tail[i] })).data;
    expect(last).toMatchObject({ nextSeq: tail.length + 1, over: true });
    const r = await srv.call('POST', `/v1/runs/${runId}/finish`, { token, json: { score: run.score, char: 'fox', style: 'classic', control: 'keys', appVersion: 't' } });
    expect(r.data.status).toBe('verified');
    expect((await srv.call('POST', `/v1/runs/${runId}/finish`, { token, json: { score: run.score, char: 'fox' } })).data.error).toBe('run_closed');
  });

  test('cudzego biegu nie da się wysłać ani zatwierdzić', async () => {
    const a = await srv.newPlayer(), b = await srv.newPlayer();
    const { runId, run } = await ticketAndPlay(a);
    expect((await srv.submit(b, runId, run)).status).toBe(404);
  });

  test('zbyt duża porcja jest odrzucana bez dekodowania', async () => {
    const token = await srv.newPlayer();
    const { runId } = await srv.newRun(token);
    expect((await srv.call('PUT', `/v1/runs/${runId}/chunks/0`, { token, body: new Uint8Array(20_000) })).status).toBe(413);
    // bez nagłówka Content-Length (strumień): limit liczony w trakcie czytania
    const stream = new ReadableStream({ start(ctl) { for (let i = 0; i < 50; i++) ctl.enqueue(new Uint8Array(1000)); ctl.close(); } });
    expect((await srv.call('PUT', `/v1/runs/${runId}/chunks/0`, { token, body: stream, headers: {} })).status).toBe(413);
    expect((await srv.db.prepare('SELECT status FROM runs WHERE id = ?').bind(runId).first())).toEqual({ status: 'issued' });
  });
});

describe('rankingi', () => {
  async function playerWithScore(nick: string | null, pilotSeed: number) {
    const token = await srv.newPlayer();
    if (nick) await srv.call('PATCH', '/v1/me', { token, json: { nick } });
    const { runId, run } = await ticketAndPlay(token, pilotSeed);
    const r = await srv.submit(token, runId, run);
    expect(r.data.status).toBe('verified');
    return { token, score: run.score };
  }

  test('top: kolejność wyników, nick albo nazwa zastępcza, nagłówek cache', async () => {
    const ps = [await playerWithScore('Ala', 1), await playerWithScore('Bob', 2), await playerWithScore(null, 3)];
    const r = await srv.call('GET', '/v1/leaderboards/all');
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('public, max-age=30');
    const scores = r.data.entries.map((e: any) => e.score);
    expect(scores).toEqual([...ps.map((p) => p.score)].sort((x, y) => y - x));
    expect(r.data.entries.map((e: any) => e.rank)).toEqual([1, 2, 3]);
    expect(r.data.entries.find((e: any) => e.score === ps[2].score)).toMatchObject({ nick: null, tag: expect.stringMatching(/^[0-9A-F]{4}$/) });
    expect(JSON.stringify(r.data)).not.toContain(ps[0].token.split('.')[0]);   // identyfikatory graczy nie wyciekają
  });

  test('przy remisie wyżej jest ten, kto osiągnął wynik wcześniej', async () => {
    const a = await srv.newPlayer(), b = await srv.newPlayer();
    await srv.call('PATCH', '/v1/me', { token: a, json: { nick: 'Pierwszy' } });
    await srv.call('PATCH', '/v1/me', { token: b, json: { nick: 'Drugi' } });
    const ins = srv.db.prepare("INSERT INTO bests (period, player_id, score, floor, combo, char_id, run_id, achieved_at) VALUES ('all', ?, 500, 50, 0, 'fox', 'r', ?)");
    await srv.db.batch([ins.bind(b.split('.')[0], START + 2000), ins.bind(a.split('.')[0], START + 1000)]);
    expect((await srv.call('GET', '/v1/leaderboards/all')).data.entries.map((e: any) => [e.rank, e.nick])).toEqual([[1, 'Pierwszy'], [2, 'Drugi']]);
    expect((await srv.call('GET', '/v1/leaderboards/all/me', { token: b })).data.rank).toBe(2);
  });

  test('rekord to najlepszy bieg; słabszy nie nadpisuje, lepszy tak', async () => {
    const token = await srv.newPlayer();
    const runs = [];
    for (const p of [1, 2, 3]) runs.push(await ticketAndPlay(token, p));
    runs.sort((x, y) => y.run.score - x.run.score);
    const [best, ...rest] = runs;
    expect((await srv.submit(token, best.runId, best.run)).data.improved).toEqual({ all: true, week: true, day: true });
    for (const r of rest) expect((await srv.submit(token, r.runId, r.run)).data.improved).toEqual({ all: false, week: false, day: false });
    expect((await rows("SELECT score, run_id FROM bests WHERE period = 'all'"))[0]).toEqual({ score: best.run.score, run_id: best.runId });
    // następnego dnia nawet słabszy bieg jest rekordem dnia, ale nie wszech czasów
    srv.clock.now += 24 * HOUR;
    const next = await ticketAndPlay(token, 3);
    const r = await srv.submit(token, next.runId, next.run);
    expect(r.data.improved.day).toBe(true);
    expect(r.data.improved.all).toBe(next.run.score > best.run.score);
  });

  test('ranking tygodniowy i dzienny zaczyna się od nowa', async () => {
    await playerWithScore('Ala', 1);
    srv.clock.now = START + 8 * DAY;
    expect((await srv.call('GET', '/v1/leaderboards/all')).data.entries.length).toBe(1);
    expect((await srv.call('GET', '/v1/leaderboards/week')).data.entries).toEqual([]);
    expect((await srv.call('GET', '/v1/leaderboards/day')).data.entries).toEqual([]);
  });

  test('moje miejsce z sąsiadami', async () => {
    const ps = [];
    for (let i = 1; i <= 14; i++) ps.push(await playerWithScore(`Gracz${i}`, i));
    const sorted = [...ps].sort((a, b) => b.score - a.score);
    const me = sorted[9];
    const r = await srv.call('GET', '/v1/leaderboards/all/me', { token: me.token });
    expect(r.data.rank).toBeGreaterThanOrEqual(9);
    expect(r.data.rank).toBeLessThanOrEqual(10);
    const mine = r.data.entries.filter((e: any) => e.me);
    expect(mine.length).toBe(1);
    expect(mine[0].score).toBe(me.score);
    expect(r.data.entries.length).toBeLessThanOrEqual(11);
    expect(r.data.entries[0].rank).toBe(Math.max(1, r.data.rank - 5));
  });

  test('gracz bez wyniku nie ma miejsca', async () => {
    const token = await srv.newPlayer();
    expect((await srv.call('GET', '/v1/leaderboards/week/me', { token })).data).toEqual({ period: expect.any(String), rank: null, entries: [] });
  });

  test('zablokowany gracz znika z rankingu', async () => {
    const ala = await playerWithScore('Ala', 1);
    await playerWithScore('Oszust', 2);
    await srv.db.prepare("UPDATE bests SET score = 999999 WHERE player_id = (SELECT id FROM players WHERE nick = 'Oszust')").run();
    await srv.db.prepare('UPDATE players SET banned = 1 WHERE nick = ?').bind('Oszust').run();
    const r = await srv.call('GET', '/v1/leaderboards/all');
    expect(r.data.entries.map((e: any) => e.nick)).toEqual(['Ala']);
    expect((await srv.call('GET', '/v1/leaderboards/all/me', { token: ala.token })).data.rank).toBe(1);
  });

  test('nieznany okres to 404', async () => {
    expect((await srv.call('GET', '/v1/leaderboards/month')).status).toBe(404);
  });
});

describe('powtórki', () => {
  test('najlepsza trójka ma powtórkę, która odtwarza dokładnie ten sam bieg', async () => {
    const players = [];
    for (let i = 1; i <= 4; i++) {
      const token = await srv.newPlayer();
      await srv.call('PATCH', '/v1/me', { token, json: { nick: `Gracz${i}` } });
      const { runId, run } = await ticketAndPlay(token, i, i === 4 ? 300 : 0);
      expect((await srv.submit(token, runId, run)).data.status).toBe('verified');
      players.push({ token, runId, run });
    }
    const board = (await srv.call('GET', '/v1/leaderboards/week')).data.entries;
    expect(board.length).toBe(4);
    expect(board.slice(0, 3).every((e: any) => typeof e.replay === 'string')).toBe(true);
    expect(board[3].replay).toBeUndefined();
    // „/me” też podaje powtórki trójki (sąsiedzi gracza z czołówki)
    expect((await srv.call('GET', '/v1/leaderboards/week/me', { token: players[0].token })).data.entries.filter((e: any) => e.replay).length).toBe(3);

    const top = board[0];
    const p = players.find((x) => x.runId === top.replay)!;
    const r = await srv.call('GET', `/v1/replays/${top.replay}`);
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('public, max-age=86400');
    expect(r.data).toMatchObject({ runId: p.runId, simVersion: SIM_VERSION, score: p.run.score, nick: top.nick, char: 'fox', style: 'classic' });
    const parts = r.data.chunks.map((b: string) => decodeInputs(Uint8Array.from(atob(b), (ch) => ch.charCodeAt(0))));
    const ticks = new Uint8Array(parts.reduce((n: number, x: Uint8Array) => n + x.length, 0));
    let at = 0;
    for (const x of parts) { ticks.set(x, at); at += x.length; }
    expect(ticks).toEqual(p.run.ticks);
    const end = runReplay(r.data.seed, ticks);
    expect(end.over).toBe(true);
    expect(score(end)).toBe(p.run.score);
  });

  test('bieg, który nie poprawił żadnego rekordu, nie zostawia powtórki', async () => {
    const token = await srv.newPlayer();
    const runs = [await ticketAndPlay(token, 1), await ticketAndPlay(token, 2)];
    runs.sort((x, y) => y.run.score - x.run.score);
    await srv.submit(token, runs[0].runId, runs[0].run);
    await srv.submit(token, runs[1].runId, runs[1].run);
    expect((await rows('SELECT DISTINCT run_id FROM run_chunks')).map((r) => r.run_id)).toEqual([runs[0].runId]);
    expect((await srv.call('GET', `/v1/replays/${runs[1].runId}`)).status).toBe(404);
  });

  test('odrzucony bieg nie zostawia powtórki; nieznany bieg to 404', async () => {
    const token = await srv.newPlayer();
    const { runId, run } = await ticketAndPlay(token);
    expect((await srv.submit(token, runId, run, { claimScore: run.score + 10 })).status).toBe(422);
    expect(await rows('SELECT * FROM run_chunks')).toEqual([]);
    expect((await srv.call('GET', `/v1/replays/${runId}`)).status).toBe(404);
    expect((await srv.call('GET', '/v1/replays/nie-ma-takiego')).status).toBe(404);
  });

  test('ranking zeszłego tygodnia: zamknięte wyniki i moje miejsce', async () => {
    const token = await srv.newPlayer();
    await srv.call('PATCH', '/v1/me', { token, json: { nick: 'Mistrz' } });
    const { runId, run } = await ticketAndPlay(token);
    await srv.submit(token, runId, run);
    expect((await srv.call('GET', '/v1/leaderboards/lastweek')).data.entries).toEqual([]);
    srv.clock.now = START + 7 * DAY;                     // następny tydzień
    const last = await srv.call('GET', '/v1/leaderboards/lastweek');
    expect(last.data.period).toBe('W:2026-47');
    expect(last.data.entries).toMatchObject([{ rank: 1, nick: 'Mistrz', score: run.score, replay: runId }]);
    expect((await srv.call('GET', '/v1/leaderboards/lastweek/me', { token })).data.rank).toBe(1);
    expect((await srv.call('GET', '/v1/leaderboards/week')).data.entries).toEqual([]);
    expect((await srv.call('GET', `/v1/replays/${runId}`)).status).toBe(200);
  });
});

describe('własne postacie (paczki z najlepszej trójki)', () => {
  /** Paczka postaci i jej skrót. Serwer sprawdza w paczce tylko nagłówek ZIP („PK\\3\\4”) – obrazki czyta dopiero gra. */
  async function pack(seed = 1) {
    const data = new Uint8Array([0x50, 0x4b, 3, 4, 20, 0, seed, 1, 2, 3]);
    return { data, hash: await sha256hex(data) };
  }
  const put = (token: string, hash: string, body: Uint8Array) =>
    srv.call('PUT', `/v1/skins/${hash}`, { token, body: body as BodyInit, headers: { 'content-type': 'application/zip' } });

  test('bieg z postacią w trójce: serwer prosi o paczkę, ranking i powtórka ją podają, każdy może ją pobrać', async () => {
    const token = await srv.newPlayer(), other = await srv.newPlayer();
    const p = await pack();
    const { runId, run } = await ticketAndPlay(token);
    const fin = await srv.submit(token, runId, run, { skin: p.hash });
    expect(fin.data).toMatchObject({ status: 'verified', needSkin: true });
    expect((await srv.call('GET', '/v1/leaderboards/week')).data.entries[0].skin).toBeUndefined();   // jeszcze bez paczki

    expect((await put(token, p.hash, new Uint8Array([1, 2, 3, 4]))).data.error).toBe('bad_skin');
    expect((await put(token, p.hash, (await pack(2)).data)).data.error).toBe('hash_mismatch');
    expect((await put(other, p.hash, p.data)).status).toBe(403);                  // cudzej postaci nie wyśle
    expect((await srv.call('PUT', `/v1/skins/${p.hash}`, { body: p.data as BodyInit })).status).toBe(401);
    expect((await put(token, p.hash, p.data)).status).toBe(201);
    expect((await put(token, p.hash, p.data)).status).toBe(201);                  // powtórzenie nieszkodliwe

    const [e] = (await srv.call('GET', '/v1/leaderboards/week')).data.entries;
    expect(e).toMatchObject({ char: 'custom', skin: p.hash });
    expect((await srv.call('GET', `/v1/replays/${e.replay}`)).data.skin).toBe(p.hash);
    const res = await srv.app.request(`/v1/skins/${p.hash}`, {}, srv.env);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');
    expect(res.headers.get('cache-control')).toContain('immutable');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(p.data);
    expect((await srv.call('GET', `/v1/skins/${'0'.repeat(64)}`)).status).toBe(404);
    expect((await srv.call('GET', '/v1/skins/zly')).status).toBe(404);

    // kolejny rekord tą samą postacią: paczka już jest
    const next = await ticketAndPlay(token, 2);
    const again = await srv.submit(token, next.runId, next.run, { skin: p.hash });
    expect(again.data.needSkin).toBeUndefined();
  });

  test('bez prośby o paczkę: wbudowana postać, bieg poza trójką, zły skrót', async () => {
    const p = await pack();
    // trzech graczy z wynikami nie do pobicia (wpisani wprost do bazy) – bieg z postacią będzie czwarty
    for (let i = 1; i <= 3; i++) {
      const id = (await srv.newPlayer()).split('.')[0];
      for (const period of ['all', 'W:2026-47', 'D:2026-11-18']) {
        await srv.db.prepare('INSERT INTO bests (period, player_id, score, floor, combo, char_id, run_id, achieved_at) VALUES (?, ?, ?, 0, 0, ?, ?, ?)')
          .bind(period, id, 1_000_000 * i, 'fox', `r${i}`, START).run();
      }
    }
    const token = await srv.newPlayer();
    const { runId, run } = await ticketAndPlay(token);
    const fin = await srv.submit(token, runId, run, { skin: p.hash });
    expect(fin.data.status).toBe('verified');
    expect(fin.data.ranks.week).toBe(4);
    expect(fin.data.needSkin).toBeUndefined();
    expect((await rows('SELECT skin FROM bests WHERE player_id = ?', token.split('.')[0]))[0].skin).toBe(p.hash);

    const t2 = await srv.newPlayer();
    const r2 = await ticketAndPlay(t2, 9);
    srv.clock.now += Math.ceil(r2.run.ticks.length * 1000 / 120) + 5000;
    await srv.upload(t2, r2.runId, r2.run.ticks);
    const fox = await srv.call('POST', `/v1/runs/${r2.runId}/finish`, { token: t2, json: { score: r2.run.score, char: 'fox', skin: p.hash } });
    expect(fox.data.needSkin).toBeUndefined();          // skrót liczy się tylko z postacią „custom”
    expect((await rows('SELECT skin FROM runs WHERE id = ?', r2.runId))[0].skin).toBeNull();
  });

  test('za duża paczka, sprzątanie nieużywanych paczek i usunięcie konta', async () => {
    const token = await srv.newPlayer();
    const big = new Uint8Array(MAX_SKIN_BYTES + 1); big.set([0x50, 0x4b, 3, 4]);
    expect((await put(token, await sha256hex(big), big)).status).toBe(413);

    const p = await pack();
    const { runId, run } = await ticketAndPlay(token);
    await srv.submit(token, runId, run, { skin: p.hash });
    expect((await put(token, p.hash, p.data)).status).toBe(201);
    await cleanup(srv.db, srv.clock.now);
    expect(await rows('SELECT hash FROM skins')).toHaveLength(1);       // wynik w rankingu jej używa
    await srv.db.prepare('UPDATE bests SET skin = NULL').run();         // np. nowy rekord wbudowaną postacią
    await cleanup(srv.db, srv.clock.now);
    expect(await rows('SELECT hash FROM skins')).toEqual([]);

    await srv.db.prepare('UPDATE bests SET skin = ?').bind(p.hash).run();
    expect((await put(token, p.hash, p.data)).status).toBe(201);
    expect((await srv.call('DELETE', '/v1/me', { token })).status).toBe(204);
    expect(await rows('SELECT hash FROM skins')).toEqual([]);
  });
});

describe('usuwanie danych i sprzątanie', () => {
  test('DELETE /v1/me usuwa konto, biegi i wyniki', async () => {
    const token = await srv.newPlayer();
    const { runId, run } = await ticketAndPlay(token);
    await srv.submit(token, runId, run);
    await srv.newRun(token);
    expect((await srv.call('DELETE', '/v1/me', { token })).status).toBe(204);
    for (const t of ['players', 'runs', 'bests', 'run_chunks', 'skins']) expect(await rows(`SELECT * FROM ${t}`)).toEqual([]);
    expect((await srv.call('GET', '/v1/me', { token })).status).toBe(401);
  });

  test('sprzątanie usuwa przeterminowane bilety, porzucone wysyłki i stare okresy', async () => {
    const token = await srv.newPlayer();
    const fresh = await ticketAndPlay(token, 1);
    await srv.submit(token, fresh.runId, fresh.run);
    const old = await srv.newRun(token);
    srv.clock.now += 8 * DAY;
    const recent = await srv.newRun(token);
    await cleanup(srv.db, srv.clock.now);
    const ids = (await rows('SELECT id FROM runs')).map((r) => r.id);
    expect(ids).toContain(fresh.runId);          // zweryfikowany zostaje (90 dni)
    expect(ids).toContain(recent.runId);
    expect(ids).not.toContain(old.runId);        // bilet sprzed 8 dni
    const periods = (await rows('SELECT period FROM bests ORDER BY period')).map((r) => r.period);
    expect(periods).toEqual(['W:2026-47', 'all']);   // dzień sprzed 8 dni usunięty; poprzedni tydzień jeszcze widoczny
    srv.clock.now += 91 * DAY;
    await cleanup(srv.db, srv.clock.now);
    expect((await rows('SELECT period FROM bests')).map((r) => r.period)).toEqual(['all']);   // rekord wszech czasów zostaje
    // …razem ze swoim biegiem i powtórką
    expect((await rows('SELECT id FROM runs')).map((r) => r.id)).toEqual([fresh.runId]);
    expect((await rows('SELECT DISTINCT run_id FROM run_chunks')).map((r) => r.run_id)).toEqual([fresh.runId]);
  });

  test('sprzątanie usuwa stare biegi i powtórki, które nie są niczyim rekordem', async () => {
    const token = await srv.newPlayer();
    const a = await ticketAndPlay(token, 1);
    await srv.submit(token, a.runId, a.run);
    await srv.db.prepare('DELETE FROM bests').run();     // np. rekord wyparty i okresy wygasłe
    srv.clock.now += 91 * DAY;
    await cleanup(srv.db, srv.clock.now);
    expect(await rows('SELECT id FROM runs')).toEqual([]);
    expect(await rows('SELECT run_id FROM run_chunks')).toEqual([]);
  });
});

describe('CORS', () => {
  test('przeglądarka z dozwolonej strony dostaje zgodę, z obcej nie', async () => {
    const ok = await srv.call('OPTIONS', '/v1/leaderboards/all', { headers: { origin: 'http://localhost:5173', 'access-control-request-method': 'GET' } });
    expect(ok.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    const bad = await srv.call('OPTIONS', '/v1/leaderboards/all', { headers: { origin: 'https://zla-strona.example', 'access-control-request-method': 'GET' } });
    expect(bad.headers.get('access-control-allow-origin')).toBeNull();
  });
});
