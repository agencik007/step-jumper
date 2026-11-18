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
