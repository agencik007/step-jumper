// Obecność w pokoju znajomych (server/src/hub.ts) na udawanych gniazdach: lista, stany, wyjścia, martwe połączenia.
import { describe, expect, test } from 'vitest';
import { Hub, MAX_SOCKETS, STALE_MS, STATUS_MIN_MS } from '../../server/src/hub';
import type { HubSocket } from '../../server/src/hub';

class FakeSocket implements HubSocket {
  got: any[] = [];
  closed: number | null = null;
  private a: unknown = null;
  send(m: string) { if (this.closed == null) this.got.push(JSON.parse(m)); }
  close(code = 1000) { this.closed = code; }
  serializeAttachment(v: unknown) { this.a = structuredClone(v); }
  deserializeAttachment() { return structuredClone(this.a); }
  /** Ostatnia wiadomość danego typu. */
  last(t: string) { return this.got.filter((m) => m.t === t).at(-1); }
}

function room() {
  const sockets: FakeSocket[] = [];
  const clock = { now: 1_000_000 };
  const hub = new Hub(() => sockets.filter((s) => s.closed == null), () => clock.now);
  const connect = (pid: string, nick: string | null = pid) => {
    const ws = new FakeSocket();
    sockets.push(ws);
    hub.join(ws, { pid, k: `k-${pid}`, nick, tag: pid.slice(0, 4).toUpperCase() });
    return ws;
  };
  const send = (ws: FakeSocket, m: object) => { clock.now += STATUS_MIN_MS; hub.message(ws, JSON.stringify(m)); };
  /** Gniazdo zamknięte przez gracza: tak, jak robi to Durable Object (webSocketClose). */
  const drop = (ws: FakeSocket) => { hub.close(ws); ws.closed = 1000; };
  return { hub, clock, connect, send, drop };
}

describe('lista obecnych', () => {
  test('nowy gracz dostaje listę, a reszta – nowinę o nim', () => {
    const r = room();
    const ala = r.connect('ala');
    expect(ala.last('list')).toEqual({ t: 'list', me: 'k-ala', players: [{ k: 'k-ala', nick: 'ala', tag: 'ALA', s: 'menu' }] });
    const bob = r.connect('bob');
    expect(bob.last('list').players.map((p: any) => p.k)).toEqual(['k-ala', 'k-bob']);
    expect(ala.last('up')).toEqual({ t: 'up', p: { k: 'k-bob', nick: 'bob', tag: 'BOB', s: 'menu' } });
    expect(bob.got.filter((m) => m.t === 'up')).toEqual([]);   // o sobie samym nowiny nie dostaje
  });

  test('stan biegu: piętro i wynik idą do wszystkich; menu je czyści', () => {
    const r = room();
    const ala = r.connect('ala'), bob = r.connect('bob');
    r.send(ala, { t: 'status', s: 'play', floor: 230, score: 4100 });
    expect(bob.last('up').p).toEqual({ k: 'k-ala', nick: 'ala', tag: 'ALA', s: 'play', floor: 230, score: 4100 });
    expect(ala.last('up').p.s).toBe('play');
    r.send(ala, { t: 'status', s: 'menu', floor: 5 });
    expect(bob.last('up').p).toEqual({ k: 'k-ala', nick: 'ala', tag: 'ALA', s: 'menu' });
  });

  test('złe liczby i nieznane stany są pomijane', () => {
    const r = room();
    const ala = r.connect('ala'), bob = r.connect('bob');
    r.send(ala, { t: 'status', s: 'play', floor: -3, score: 1.5 });
    expect(bob.last('up').p).toMatchObject({ s: 'play', floor: 0, score: 0 });
    const n = bob.got.length;
    r.send(ala, { t: 'status', s: 'hack' });
    r.hub.message(ala, 'nie json');
    r.hub.message(ala, 'x'.repeat(2000));
    expect(bob.got.length).toBe(n);
  });

  test('za częste zmiany stanu z jednego gniazda są pomijane', () => {
    const r = room();
    const ala = r.connect('ala'), bob = r.connect('bob');
    r.send(ala, { t: 'status', s: 'play', floor: 1, score: 1 });
    r.hub.message(ala, JSON.stringify({ t: 'status', s: 'play', floor: 2, score: 2 }));   // ta sama chwila
    expect(bob.last('up').p.floor).toBe(1);
  });

  test('wyjście: „bye” dopiero, gdy gracz nie ma już żadnego urządzenia', () => {
    const r = room();
    const ala1 = r.connect('ala'), ala2 = r.connect('ala'), bob = r.connect('bob');
    expect(bob.last('list').players.filter((p: any) => p.k === 'k-ala')).toHaveLength(1);
    r.send(ala2, { t: 'status', s: 'play', floor: 10, score: 100 });
    r.drop(ala2);
    expect(bob.last('up').p).toMatchObject({ k: 'k-ala', s: 'menu' });   // zostało pierwsze urządzenie
    r.drop(ala1);
    expect(bob.last('bye')).toEqual({ t: 'bye', k: 'k-ala' });
    expect(r.hub.players().map((p) => p.k)).toEqual(['k-bob']);
  });

  test('wyrzucenie gracza (wyszedł z pokoju) zamyka wszystkie jego gniazda', () => {
    const r = room();
    const ala1 = r.connect('ala'), ala2 = r.connect('ala'), bob = r.connect('bob');
    r.hub.kick('ala');
    expect([ala1.closed, ala2.closed]).toEqual([4001, 4001]);
    expect(bob.last('bye')).toEqual({ t: 'bye', k: 'k-ala' });
    expect(r.hub.players().map((p) => p.k)).toEqual(['k-bob']);
  });

  test('milczące gniazdo (np. telefon zgasł bez pożegnania) znika przy następnej wiadomości kogokolwiek', () => {
    const r = room();
    const ala = r.connect('ala'), bob = r.connect('bob');
    r.clock.now += STALE_MS - 5_000;
    r.send(bob, { t: 'ping' });
    expect(ala.closed).toBeNull();
    r.clock.now += 10_000;
    r.send(bob, { t: 'ping' });
    expect(ala.closed).toBe(4000);
    expect(bob.last('bye')).toEqual({ t: 'bye', k: 'k-ala' });
  });

  test('pokój ma limit gniazd', () => {
    const r = room();
    for (let i = 0; i < MAX_SOCKETS - 1; i++) r.connect(`p${i}`);
    expect(r.hub.hasRoom).toBe(true);
    r.connect('ostatni');
    expect(r.hub.hasRoom).toBe(false);
  });
});

describe('zdarzenia z biegu', () => {
  test('piętro i combo od gry idą do pozostałych, z nickiem; nadawca ich nie dostaje', () => {
    const r = room();
    const ala = r.connect('ala'), bob = r.connect('bob');
    r.send(ala, { t: 'ev', e: 'floor', n: 300 });
    expect(bob.last('ev')).toEqual({ t: 'ev', e: 'floor', n: 300, k: 'k-ala', nick: 'ala', tag: 'ALA' });
    r.send(ala, { t: 'ev', e: 'combo', n: 42 });
    expect(bob.last('ev')).toMatchObject({ e: 'combo', n: 42, k: 'k-ala' });
    expect(ala.got.filter((m) => m.t === 'ev')).toEqual([]);
  });

  test('złe zdarzenia i za częste są pomijane', () => {
    const r = room();
    const ala = r.connect('ala'), bob = r.connect('bob');
    r.send(ala, { t: 'ev', e: 'hack', n: 1 });
    r.send(ala, { t: 'ev', e: 'floor', n: 0 });
    r.send(ala, { t: 'ev', e: 'floor', n: 1.5 });
    r.send(ala, { t: 'ev', e: 'floor', n: 100 });
    r.hub.message(ala, JSON.stringify({ t: 'ev', e: 'floor', n: 200 }));   // ta sama chwila
    expect(bob.got.filter((m) => m.t === 'ev').map((m) => m.n)).toEqual([100]);
  });

  test('zdarzenie od serwera (zweryfikowany wynik) – do wszystkich poza urządzeniami tego gracza', () => {
    const r = room();
    const ala1 = r.connect('ala'), ala2 = r.connect('ala'), bob = r.connect('bob');
    r.hub.event({ t: 'ev', e: 'score', k: 'k-ala', score: 12345, over: ['k-bob'] });
    expect(bob.last('ev')).toMatchObject({ e: 'score', score: 12345, over: ['k-bob'] });
    expect([...ala1.got, ...ala2.got].filter((m) => m.t === 'ev')).toEqual([]);
  });
});
