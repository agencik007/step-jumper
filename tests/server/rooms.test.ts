// Pokoje znajomych: zakładanie, dołączanie nazwą i hasłem, limit błędnych haseł, ranking pokoju, sprzątanie.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { ROOM_FAIL_MAX, ROOM_FAIL_WINDOW, ROOM_MAX_MEMBERS } from '../../server/src/app';
import { cleanup } from '../../server/src/cleanup';
import { liveKey } from '../../server/src/live';
import { periodKeys } from '../../server/src/periods';
import { idleThen, momentumPilot } from '../helpers';
import { playRun, startServer } from './harness';

let srv: Awaited<ReturnType<typeof startServer>>;
beforeAll(async () => { srv = await startServer(); }, 60_000);
afterAll(async () => { await srv?.dispose(); });
beforeEach(async () => { await srv.reset(); });

const rows = async (sql: string, ...args: unknown[]) => (await srv.db.prepare(sql).bind(...args).all()).results as any[];
const create = (token: string, name: string, password = 'tajne123') => srv.call('POST', '/v1/rooms', { token, json: { name, password } });
const join = (token: string, name: string, password = 'tajne123') => srv.call('POST', '/v1/rooms/join', { token, json: { name, password } });
const board = (token: string, period = 'week') => srv.call('GET', `/v1/rooms/me/leaderboards/${period}`, { token });

async function player(nick: string) {
  const token = await srv.newPlayer();
  await srv.call('PATCH', '/v1/me', { token, json: { nick } });
  return token;
}
/** Bieg z wynikiem zależnym od pilota (różne ziarna pilota = różne wyniki). */
async function playAndSubmit(token: string, pilotSeed: number) {
  const t = await srv.newRun(token);
  const run = playRun(t.seed, idleThen(0, momentumPilot(pilotSeed)));
  const r = await srv.submit(token, t.runId, run);
  expect(r.status).toBe(200);
  return run.score;
}

describe('zakładanie pokoju', () => {
  test('twórca jest od razu w pokoju; serwer nie zna hasła', async () => {
    const a = await player('Ala');
    const r = await create(a, 'Ekipa z Bloku');
    expect(r.status).toBe(201);
    expect(r.data).toEqual({ room: { name: 'Ekipa z Bloku', members: 1 } });
    expect((await srv.call('GET', '/v1/me', { token: a })).data.room).toEqual({ name: 'Ekipa z Bloku' });
    const [room] = await rows('SELECT * FROM rooms');
    expect(room.pass_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(room)).not.toContain('tajne123');
  });

  test('nazwa jest unikalna bez względu na wielkość liter', async () => {
    const a = await player('Ala'), b = await player('Bartek');
    expect((await create(a, 'Żółwie')).status).toBe(201);
    expect((await create(b, 'ŻÓŁWIE')).data).toEqual({ error: 'room_taken' });
  });

  test('bez nicku nie da się założyć pokoju ani do niego dołączyć', async () => {
    const a = await player('Ala'), anon = await srv.newPlayer();
    expect((await create(anon, 'Ekipa')).data).toEqual({ error: 'nick_required' });
    await create(a, 'Ekipa');
    expect((await join(anon, 'Ekipa')).data).toEqual({ error: 'nick_required' });
    await srv.call('PATCH', '/v1/me', { token: anon, json: { nick: 'Anonim' } });
    expect((await join(anon, 'Ekipa')).status).toBe(200);
  });

  test('walidacja nazwy i hasła', async () => {
    const a = await player('Ala');
    expect((await create(a, 'ab')).data).toEqual({ error: 'room_length' });
    expect((await create(a, 'x'.repeat(21))).data).toEqual({ error: 'room_length' });
    expect((await create(a, '<script>')).data).toEqual({ error: 'room_chars' });
    expect((await create(a, 'Kurwiki')).data).toEqual({ error: 'room_blocked' });
    expect((await create(a, 'Ekipa', 'abc')).data).toEqual({ error: 'room_pass' });
    expect((await create(a, 'Ekipa', 'a'.repeat(33))).data).toEqual({ error: 'room_pass' });
    expect((await create(a, 'Ekipa', 'ab\ncd')).data).toEqual({ error: 'room_pass' });
    expect(await rows('SELECT * FROM rooms')).toEqual([]);
  });

  test('nowy pokój to wyjście ze starego; pusty stary pokój znika i zwalnia nazwę', async () => {
    const a = await player('Ala'), b = await player('Bartek');
    await create(a, 'Pierwszy');
    await create(a, 'Drugi');
    expect((await rows('SELECT name FROM rooms')).map((r) => r.name)).toEqual(['Drugi']);
    expect((await create(b, 'pierwszy')).status).toBe(201);
  });
});

describe('dołączanie', () => {
  test('dobra nazwa i hasło – gracz w pokoju; nazwa bez względu na wielkość liter', async () => {
    const a = await player('Ala'), b = await player('Bartek');
    await create(a, 'Ekipa');
    expect((await join(b, 'EKIPA')).data).toEqual({ room: { name: 'Ekipa', members: 2 } });
    const me = await srv.call('GET', '/v1/rooms/me', { token: b });
    expect(me.data.room.name).toBe('Ekipa');
    expect(me.data.room.members).toEqual([{ nick: 'Ala', tag: expect.any(String) }, { nick: 'Bartek', tag: expect.any(String), me: true }]);
  });

  test('zła nazwa albo złe hasło', async () => {
    const a = await player('Ala'), b = await player('Bartek');
    await create(a, 'Ekipa');
    expect((await join(b, 'Nie ma takiego')).data).toEqual({ error: 'room_not_found' });
    expect((await join(b, 'Ekipa', 'zle-haslo')).data).toEqual({ error: 'room_password' });
    expect((await join(b, 'Ekipa', 'TAJNE123')).status).toBe(403);   // hasło rozróżnia wielkość liter
    expect((await srv.call('GET', '/v1/rooms/me', { token: b })).data).toEqual({ room: null });
  });

  test('limit błędnych haseł blokuje pokój do końca okna – także dla dobrego hasła', async () => {
    const a = await player('Ala'), b = await player('Bartek');
    await create(a, 'Ekipa');
    srv.clock.now = Math.ceil(srv.clock.now / ROOM_FAIL_WINDOW) * ROOM_FAIL_WINDOW;   // początek okna
    for (let i = 0; i < ROOM_FAIL_MAX; i++) expect((await join(b, 'Ekipa', `zle${i}xx`)).status).toBe(403);
    expect((await join(b, 'Ekipa')).data).toEqual({ error: 'room_locked' });
    srv.clock.now += ROOM_FAIL_WINDOW;
    expect((await join(b, 'Ekipa')).status).toBe(200);
  });

  test('pełny pokój nie przyjmuje nowych graczy', async () => {
    const a = await player('Ala');
    await create(a, 'Ekipa');
    const [{ id }] = await rows('SELECT id FROM rooms');
    // pozostałe miejsca zajmujemy wprost w bazie – zakładanie 50 kont przez API trwałoby za długo
    const t = srv.clock.now;
    await srv.db.batch(Array.from({ length: ROOM_MAX_MEMBERS - 1 }, (_, i) =>
      srv.db.prepare("INSERT INTO players (id, token_hash, platform, created_at, last_seen_at, room_id) VALUES (?, 'x', 'web', ?, ?, ?)").bind(`p${i}`, t, t, id)));
    const b = await player('Bartek');
    expect((await join(b, 'Ekipa')).data).toEqual({ error: 'room_full' });
  });

  test('ponowne dołączenie do własnego pokoju nic nie psuje', async () => {
    const a = await player('Ala');
    await create(a, 'Ekipa');
    expect((await join(a, 'Ekipa', 'cokolwiek')).data).toEqual({ room: { name: 'Ekipa', members: 1 } });
  });

  test('wyjście z pokoju; ostatni gracz zabiera pokój ze sobą', async () => {
    const a = await player('Ala'), b = await player('Bartek');
    await create(a, 'Ekipa');
    await join(b, 'Ekipa');
    expect((await srv.call('DELETE', '/v1/rooms/me', { token: a })).status).toBe(204);
    expect((await rows('SELECT COUNT(*) AS n FROM rooms'))[0].n).toBe(1);
    expect((await srv.call('DELETE', '/v1/rooms/me', { token: b })).status).toBe(204);
    expect((await rows('SELECT COUNT(*) AS n FROM rooms'))[0].n).toBe(0);
    expect((await srv.call('DELETE', '/v1/rooms/me', { token: b })).status).toBe(204);   // poza pokojem – nic się nie dzieje
  });

  test('usunięcie konta wyprowadza gracza z pokoju', async () => {
    const a = await player('Ala'), b = await player('Bartek');
    await create(a, 'Ekipa');
    await join(b, 'Ekipa');
    await srv.call('DELETE', '/v1/me', { token: b });
    expect((await srv.call('GET', '/v1/rooms/me', { token: a })).data.room.members).toHaveLength(1);
    await srv.call('DELETE', '/v1/me', { token: a });
    expect(await rows('SELECT * FROM rooms')).toEqual([]);
  });

  test('zablokowany gracz nie zakłada pokoi i nie dołącza', async () => {
    const a = await player('Ala'), b = await player('Bartek');
    await create(a, 'Ekipa');
    await srv.db.prepare('UPDATE players SET banned = 1 WHERE nick = ?').bind('Bartek').run();
    expect((await create(b, 'Inny')).status).toBe(403);
    expect((await join(b, 'Ekipa')).status).toBe(403);
  });
});

describe('ranking pokoju', () => {
  test('tylko gracze z pokoju, z własnymi miejscami; moje miejsce zaznaczone', async () => {
    const a = await player('Ala'), b = await player('Bartek'), c = await player('Celina');
    await create(a, 'Ekipa');
    await join(b, 'Ekipa');
    const scores = { a: await playAndSubmit(a, 1), b: await playAndSubmit(b, 2), c: await playAndSubmit(c, 3) };
    const r = await board(b);
    expect(r.status).toBe(200);
    expect(r.data.room).toEqual({ name: 'Ekipa' });
    expect(r.data.entries.map((e: any) => e.nick).sort()).toEqual(['Ala', 'Bartek']);
    expect(r.data.entries.map((e: any) => e.rank)).toEqual([1, 2]);
    const mine = r.data.entries.find((e: any) => e.me);
    expect(mine).toMatchObject({ nick: 'Bartek', score: scores.b, rank: r.data.rank });
    expect(r.data.entries.filter((e: any) => e.me)).toHaveLength(1);
    // najlepsze wyniki pokoju mają powtórki tak jak w rankingu ogólnym
    expect(r.data.entries.every((e: any) => typeof e.replay === 'string')).toBe(true);
  });

  test('gracz bez wyniku nie ma miejsca; poza pokojem – 404', async () => {
    const a = await player('Ala'), b = await player('Bartek');
    await create(a, 'Ekipa');
    expect((await board(a)).data).toMatchObject({ rank: null, entries: [] });
    expect((await board(b)).data).toEqual({ error: 'no_room' });
    expect((await board(a, 'nie-ma')).status).toBe(404);
  });

  test('zablokowani gracze znikają z rankingu pokoju', async () => {
    const a = await player('Ala'), b = await player('Bartek');
    await create(a, 'Ekipa');
    await join(b, 'Ekipa');
    await playAndSubmit(a, 1); await playAndSubmit(b, 2);
    await srv.db.prepare('UPDATE players SET banned = 1 WHERE nick = ?').bind('Bartek').run();
    expect((await board(a)).data.entries.map((e: any) => e.nick)).toEqual(['Ala']);
  });
});

describe('wynik dla znajomych na żywo (zdarzenie „score”)', () => {
  /** Najlepszy wynik gracza wpisany wprost do bazy (tydzień i ogółem). */
  async function best(nick: string, week: number, all: number) {
    const [{ id }] = await rows('SELECT id FROM players WHERE nick = ?', nick);
    const keys = periodKeys(srv.clock.now);
    for (const [period, score] of [[keys.week, week], ['all', all]] as const) {
      await srv.db.prepare("INSERT INTO bests (period, player_id, score, floor, combo, char_id, run_id, achieved_at) VALUES (?, ?, ?, 1, 0, 'fox', 'x', 0)")
        .bind(period, id, score).run();
    }
    return liveKey(id);
  }

  test('rekord dnia idzie do pokoju; wyprzedzeni w tygodniu są wymienieni', async () => {
    const a = await player('Ala'), b = await player('Bartek'), c = await player('Celina');
    await create(a, 'Ekipa'); await join(b, 'Ekipa'); await join(c, 'Ekipa');
    const kb = await best('Bartek', 1, 1), kc = await best('Celina', 1e9, 1e9);
    const score = await playAndSubmit(a, 1);
    expect(srv.roomEvents).toHaveLength(1);
    const { room, msg } = srv.roomEvents[0];
    expect(room).toBe((await rows('SELECT id FROM rooms'))[0].id);
    expect(msg).toEqual({
      t: 'ev', e: 'score', k: await liveKey(a.split('.')[0]), nick: 'Ala', tag: expect.any(String), score, floor: expect.any(Number),
      best: true, roomBest: false, over: [kb],
    });
    expect(msg.over).not.toContain(kc);
  });

  test('rekord pokoju: lepszy od najlepszych wyników wszystkich w pokoju', async () => {
    const a = await player('Ala'), b = await player('Bartek');
    await create(a, 'Ekipa'); await join(b, 'Ekipa');
    await best('Bartek', 1, 1);
    await playAndSubmit(a, 1);
    expect(srv.roomEvents[0].msg).toMatchObject({ best: true, roomBest: true });
  });

  test('sam w pokoju – bez „rekordu pokoju”; bieg gorszy od dzisiejszego – bez zdarzenia; poza pokojem – nic', async () => {
    const a = await player('Ala'), solo = await player('Sam');
    await create(a, 'Ekipa');
    const first = await playAndSubmit(a, 1);
    expect(srv.roomEvents[0].msg).toMatchObject({ best: true, roomBest: false, over: [] });
    // drugi bieg: zdarzenie tylko, jeśli pobił dzisiejszy wynik
    const second = await playAndSubmit(a, 1);
    expect(srv.roomEvents).toHaveLength(second > first ? 2 : 1);
    await playAndSubmit(solo, 2);
    expect(srv.roomEvents.every((e) => e.msg.nick === 'Ala')).toBe(true);
  });
});

test('sprzątanie usuwa pokoje bez graczy', async () => {
  const a = await player('Ala');
  await create(a, 'Ekipa');
  await srv.db.prepare("INSERT INTO rooms (id, name, name_key, pass_salt, pass_hash, created_at) VALUES ('r0', 'Pusty', 'pusty', '00', '00', 0)").run();
  await cleanup(srv.db, srv.clock.now);
  expect((await rows('SELECT name FROM rooms')).map((r) => r.name)).toEqual(['Ekipa']);
});
