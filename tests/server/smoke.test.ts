// Test „na żywo” przeciw działającemu serwerowi – lokalnemu (npm run server:dev) albo wdrożonemu.
// Domyślnie pominięty. Uruchomienie:  SMOKE_URL=http://localhost:8787 npx vitest run tests/server/smoke
// Po sobie sprząta (DELETE /v1/me), więc można go puścić także na produkcji.
import { expect, test } from 'vitest';
import { CHUNK_TICKS, splitChunks } from '../../server/src/verify';
import { SIM_VERSION, encodeInputs } from '../../src/sim';
import { idleThen, momentumPilot } from '../helpers';
import { playRun } from './harness';

const BASE: string | undefined = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.SMOKE_URL;

async function api(method: string, path: string, o: { token?: string; json?: unknown; body?: Uint8Array } = {}) {
  const headers: Record<string, string> = {};
  if (o.token) headers.authorization = `Bearer ${o.token}`;
  if (o.json !== undefined) headers['content-type'] = 'application/json';
  if (o.body) headers['content-type'] = 'application/octet-stream';
  const t0 = performance.now();
  const res = await fetch(BASE + path, { method, headers, body: o.json !== undefined ? JSON.stringify(o.json) : o.body });
  const ms = performance.now() - t0;
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null, ms };
}

test.skipIf(!BASE)('pełna ścieżka na działającym serwerze + czas weryfikacji porcji', async () => {
  const { data: player } = await api('POST', '/v1/players', { json: { platform: 'web' } });
  const token: string = player.token;
  try {
    // 1) długi bieg: mierzymy czas odpowiedzi na pełne porcje; zatwierdzenie musi odpaść jako „za szybki”
    const long = await api('POST', '/v1/runs', { token, json: { simVersion: SIM_VERSION } });
    expect(long.status).toBe(201);
    const longRun = playRun(long.data.seed, idleThen(2 * CHUNK_TICKS, momentumPilot(7)), 120 * 60 * 20);
    const timings: number[] = [];
    const ping = await api('GET', '/v1/me', { token });
    for (const [i, c] of splitChunks(longRun.ticks).entries()) {
      const r = await api('PUT', `/v1/runs/${long.data.runId}/chunks/${i}`, { token, body: encodeInputs(c) });
      expect(r.status).toBe(200);
      if (c.length === CHUNK_TICKS) timings.push(r.ms);
    }
    const fin = await api('POST', `/v1/runs/${long.data.runId}/finish`, { token, json: { score: longRun.score, char: 'fox' } });
    expect(fin.data).toEqual({ error: 'rejected', reason: 'too_fast' });
    console.log(`[smoke] bieg ${longRun.ticks.length} kroków; GET /v1/me ${ping.ms.toFixed(1)} ms; pełne porcje: ${timings.map((t) => t.toFixed(1) + ' ms').join(', ') || 'brak'}`);

    // 2) krótki bieg rozegrany „w czasie rzeczywistym”: czekamy tyle, ile trwał
    const short = await api('POST', '/v1/runs', { token, json: { simVersion: SIM_VERSION } });
    const shortRun = playRun(short.data.seed, momentumPilot(12), 120 * 60 * 20);
    await new Promise((r) => setTimeout(r, Math.ceil(shortRun.ticks.length * 1000 / 120) + 500));
    for (const [i, c] of splitChunks(shortRun.ticks).entries()) {
      expect((await api('PUT', `/v1/runs/${short.data.runId}/chunks/${i}`, { token, body: encodeInputs(c) })).status).toBe(200);
    }
    const ok = await api('POST', `/v1/runs/${short.data.runId}/finish`, { token, json: { score: shortRun.score, char: 'fox' } });
    expect(ok.data).toMatchObject({ status: 'verified', score: shortRun.score });
    const me = await api('GET', '/v1/leaderboards/day/me', { token });
    expect(me.data.entries.find((e: { me: boolean }) => e.me).score).toBe(shortRun.score);
  } finally {
    expect((await api('DELETE', '/v1/me', { token })).status).toBe(204);
  }
}, 120_000);

test.skipIf(!BASE)('pokój znajomych na żywo: WebSocket przez Durable Object', async () => {
  const a: string = (await api('POST', '/v1/players', { json: { platform: 'web' } })).data.token;
  const b: string = (await api('POST', '/v1/players', { json: { platform: 'web' } })).data.token;
  const name = `smoke ${Math.floor(Math.random() * 1e6)}`;
  const sockets: WebSocket[] = [];
  try {
    // do pokoju wchodzi się tylko z nickiem (inaczej 400 nick_required); nicki są unikalne, więc losowe
    for (const [i, token] of [a, b].entries()) {
      expect((await api('PATCH', '/v1/me', { token, json: { nick: `smoke${i}x${Math.floor(Math.random() * 1e8)}` } })).status).toBe(200);
    }
    expect((await api('POST', '/v1/rooms', { token: a, json: { name, password: 'smoke-test' } })).status).toBe(201);
    expect((await api('POST', '/v1/rooms/join', { token: b, json: { name, password: 'smoke-test' } })).status).toBe(200);
    const url = `${BASE!.replace(/^http/, 'ws')}/v1/live`;
    /** Połączenie z kolejką wiadomości; next(t) czeka na wiadomość danego typu. */
    const open = (token: string) => new Promise<{ next: (t: string) => Promise<any> }>((resolve, reject) => {
      const ws = new WebSocket(url, ['sj', token]), inbox: any[] = [], waiting: [string, (m: any) => void][] = [];
      sockets.push(ws);
      ws.addEventListener('message', (e) => {
        const m = JSON.parse(String(e.data)), i = waiting.findIndex(([t]) => t === m.t);
        if (i >= 0) waiting.splice(i, 1)[0][1](m); else inbox.push(m);
      });
      ws.addEventListener('error', () => reject(new Error('websocket')));
      ws.addEventListener('open', () => resolve({
        next: (t) => new Promise((res) => { const i = inbox.findIndex((m) => m.t === t); if (i >= 0) res(inbox.splice(i, 1)[0]); else waiting.push([t, res]); }),
      }));
    });
    const la = await open(a);
    expect((await la.next('list')).players).toHaveLength(1);
    const lb = await open(b);
    expect((await lb.next('list')).players).toHaveLength(2);
    expect((await la.next('up')).p.s).toBe('menu');
    sockets[1].send(JSON.stringify({ t: 'status', s: 'play', floor: 42, score: 777 }));
    expect((await la.next('up')).p).toMatchObject({ s: 'play', floor: 42, score: 777 });
    expect((await api('DELETE', '/v1/rooms/me', { token: b })).status).toBe(204);   // wyjście z pokoju zamyka połączenie
    expect((await la.next('bye')).k).toEqual(expect.any(String));
  } finally {
    for (const ws of sockets) ws.close();
    await api('DELETE', '/v1/me', { token: a });
    await api('DELETE', '/v1/me', { token: b });
  }
}, 30_000);
