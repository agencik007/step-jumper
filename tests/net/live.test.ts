// Klient pokoju na żywo (src/net/live.ts) połączony z prawdziwą logiką pokoju (server/src/hub.ts) przez udawane gniazda.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Hub } from '../../server/src/hub';
import type { HubSocket } from '../../server/src/hub';
import { CLOSE_LEFT, Live, PING_MS, PLAY_EVERY_MS } from '../../src/net/live';

let hub: Hub, server: ServerSide[] = [], received: any[] = [];
let online = true;                                     // czy „serwer” przyjmuje połączenia

class ServerSide implements HubSocket {
  private a: unknown = null;
  closed = false;
  constructor(public client: FakeWs) {}
  send(m: string) { if (!this.closed) setTimeout(() => this.client.onmessage?.({ data: m }), 0); }
  close(code = 1000) { if (this.closed) return; this.closed = true; setTimeout(() => this.client.serverClosed(code), 0); }
  serializeAttachment(v: unknown) { this.a = structuredClone(v); }
  deserializeAttachment() { return structuredClone(this.a); }
}

class FakeWs {
  readyState = 0; protocol = '';
  onopen: ((e: unknown) => void) | null = null; onclose: ((e: { code: number }) => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null; onerror: ((e: unknown) => void) | null = null;
  srv: ServerSide | null = null;
  constructor(_url: string, protocols: string[]) {
    setTimeout(() => {
      if (!online) { this.readyState = 3; this.onerror?.({}); this.onclose?.({ code: 1006 }); return; }
      const pid = protocols[1];
      this.srv = new ServerSide(this); server.push(this.srv);
      hub.join(this.srv, { pid, k: `k-${pid}`, nick: pid, tag: pid.toUpperCase().slice(0, 4) });   // jak Durable Object: przed „open”
      this.readyState = 1; this.protocol = 'sj'; this.onopen?.({});
    }, 0);
  }
  send(s: string) { received.push(JSON.parse(s)); if (this.srv && !this.srv.closed) hub.message(this.srv, s); }
  close(code = 1000) { if (this.readyState === 3) return; this.readyState = 3; if (this.srv && !this.srv.closed) { this.srv.closed = true; hub.close(this.srv); } this.onclose?.({ code }); }
  serverClosed(code: number) { if (this.readyState === 3) return; this.readyState = 3; this.onclose?.({ code }); }
}

const client = (pid: string) => new Live({ url: 'ws://test/v1/live', token: () => pid, WebSocket: FakeWs, now: () => Date.now() });
const settle = () => vi.advanceTimersByTimeAsync(10);

beforeEach(() => {
  vi.useFakeTimers({ now: 1_000_000 });
  server = []; received = []; online = true;
  hub = new Hub(() => server.filter((s) => !s.closed), () => Date.now());
});
afterEach(() => { vi.useRealTimers(); });

describe('lista obecnych w grze', () => {
  test('dwóch graczy widzi się nawzajem; „me” oznacza siebie', async () => {
    const a = client('ala'), b = client('bob');
    a.start(); await settle();
    b.start(); await settle();
    expect(a.connected && b.connected).toBe(true);
    expect(a.players.map((p) => [p.k, !!p.me])).toEqual([['k-ala', true], ['k-bob', false]]);
    expect(b.players.map((p) => [p.k, !!p.me])).toEqual([['k-ala', false], ['k-bob', true]]);
    b.stop(); await settle();
    expect(a.players.map((p) => p.k)).toEqual(['k-ala']);
    expect(b.players).toEqual([]);
  });

  test('stan biegu: od razu przy starcie biegu, potem najwyżej co PLAY_EVERY_MS', async () => {
    const a = client('ala'), b = client('bob');
    a.start(); b.start(); await settle();
    await vi.advanceTimersByTimeAsync(1500);
    received = [];
    a.setStatus('play', 0, 0); await settle();
    expect(b.players.find((p) => p.k === 'k-ala')).toMatchObject({ s: 'play', floor: 0 });
    for (let f = 1; f <= 20; f++) { a.setStatus('play', f * 10, f * 100); await vi.advanceTimersByTimeAsync(500); }
    const statuses = received.filter((m) => m.t === 'status');
    expect(statuses.length).toBeLessThanOrEqual(1 + Math.ceil(10_000 / PLAY_EVERY_MS));
    await vi.advanceTimersByTimeAsync(PLAY_EVERY_MS);
    expect(b.players.find((p) => p.k === 'k-ala')).toMatchObject({ s: 'play', floor: 200, score: 2000 });
    a.setStatus('menu'); await vi.advanceTimersByTimeAsync(1200);
    expect(b.players.find((p) => p.k === 'k-ala')).toEqual({ k: 'k-ala', nick: 'ala', tag: 'ALA', s: 'menu' });
  });

  test('bieg zaczęty tuż po połączeniu nie ginie (serwer przyjmuje zmianę raz na sekundę)', async () => {
    const a = client('ala'), b = client('bob');
    b.start(); await settle();
    a.start(); await settle();
    a.setStatus('play', 3, 50);
    await settle();
    expect(b.players.find((p) => p.k === 'k-ala')).toMatchObject({ s: 'play', floor: 3 });
  });

  test('w ciszy tylko ping co PING_MS', async () => {
    const a = client('ala');
    a.start(); await settle();
    received = [];
    await vi.advanceTimersByTimeAsync(PING_MS * 3 + 500);
    expect(received.map((m) => m.t)).toEqual(['ping', 'ping', 'ping']);
  });

  test('zerwane połączenie wraca samo; wyjście z pokoju (kod od serwera) – już nie', async () => {
    const a = client('ala'), b = client('bob');
    let left = 0;
    b.onLeft = () => left++;
    a.start(); b.start(); await settle();
    online = false;
    server.find((s) => s.client === (b as any).ws)!.close(1006);
    await settle();
    expect(b.connected).toBe(false);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(b.connected).toBe(false);
    online = true;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(b.connected).toBe(true);
    expect(a.players).toHaveLength(2);
    hub.kick('bob'); await settle();
    expect(left).toBe(1);
    expect(b.connected).toBe(false);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(b.connected).toBe(false);
    expect(a.players.map((p) => p.k)).toEqual(['k-ala']);
    expect(CLOSE_LEFT).toBe(4001);
  });

  test('find łączy wiersz rankingu z obecnym graczem', async () => {
    const a = client('ala');
    a.start(); await settle();
    expect(a.find({ tag: 'ALA', nick: 'ala' })?.k).toBe('k-ala');
    expect(a.find({ tag: 'ALA', nick: 'inny' })).toBeNull();
  });
});

describe('zdarzenia z biegów', () => {
  test('piętro i combo od jednego gracza docierają do drugiego; własne nie wracają', async () => {
    const a = client('ala'), b = client('bob'), gotA: any[] = [], gotB: any[] = [];
    a.onEvent = (e) => gotA.push(e); b.onEvent = (e) => gotB.push(e);
    a.start(); b.start(); await settle();
    a.event('floor', 100);
    a.event('combo', 30);                                // w tej samej chwili – poczeka na następny takt
    await vi.advanceTimersByTimeAsync(2500);
    expect(gotB).toEqual([
      { t: 'ev', e: 'floor', n: 100, k: 'k-ala', nick: 'ala', tag: 'ALA' },
      { t: 'ev', e: 'combo', n: 30, k: 'k-ala', nick: 'ala', tag: 'ALA' },
    ]);
    expect(gotA).toEqual([]);
  });

  test('wynik od serwera trafia do znajomych', async () => {
    const a = client('ala'), b = client('bob'), gotB: any[] = [];
    b.onEvent = (e) => gotB.push(e);
    a.start(); b.start(); await settle();
    hub.event({ t: 'ev', e: 'score', k: 'k-ala', nick: 'ala', tag: 'ALA', score: 500, floor: 40, best: true, roomBest: false, over: ['k-bob'] });
    await settle();
    expect(gotB).toEqual([expect.objectContaining({ e: 'score', score: 500, over: ['k-bob'] })]);
  });

  test('bez połączenia zdarzenia przepadają (nie zalegają na później)', async () => {
    const a = client('ala');
    a.event('floor', 100);
    a.start(); await settle();
    received = [];
    await vi.advanceTimersByTimeAsync(3000);
    expect(received.filter((m) => m.t === 'ev')).toEqual([]);
  });
});

describe('wyścig w pokoju', () => {
  test('zaproszenie i wynik w wyścigu trafiają do znajomych (od serwera)', async () => {
    const a = client('ala'), b = client('bob'), gotA: any[] = [], gotB: any[] = [];
    a.onEvent = (e) => gotA.push(e); b.onEvent = (e) => gotB.push(e);
    a.start(); b.start(); await settle();
    const match = { id: 'm1', scoring: 'best', minutes: 3, startsAt: 1, endsAt: 2, by: { nick: 'ala', tag: 'ALA' } };
    hub.event({ t: 'ev', e: 'match', k: 'k-ala', match, now: 0 });
    hub.event({ t: 'ev', e: 'mscore', k: 'k-ala', nick: 'ala', tag: 'ALA', match: 'm1', score: 700, runs: 2, last: 300 });
    await settle();
    expect(gotB).toEqual([expect.objectContaining({ e: 'match', match }), expect.objectContaining({ e: 'mscore', score: 700, runs: 2 })]);
    expect(gotA).toEqual([]);                            // własne zdarzenia nie wracają
  });
});
