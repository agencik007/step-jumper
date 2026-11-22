// Środowisko testów API: prawdziwa (lokalna, w pamięci) baza D1 z Wranglera i aplikacja Hono z kontrolowanym zegarem.
import { getPlatformProxy } from 'wrangler';
import { createApp } from '../../server/src/app';
import type { Env } from '../../server/src/env';
import { splitChunks } from '../../server/src/verify';
import { InputRecorder, SIM_VERSION, createState, encodeInputs, score, step } from '../../src/sim';
import type { SimState } from '../../src/sim';
import { inputByte } from '../helpers';
import type { Pilot } from '../helpers';

// wszystkie migracje z server/migrations, w kolejności nazw plików (tak jak stosuje je wrangler)
const MIGRATIONS = import.meta.glob<string>('../../server/migrations/*.sql', { query: '?raw', import: 'default', eager: true });

/** Rozdziela plik migracji na pojedyncze polecenia SQL (komentarze „--” do końca linii). */
export function sqlStatements(sql: string): string[] {
  return sql.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n').split(';').map((s) => s.trim()).filter(Boolean);
}

export const START = Date.parse('2026-11-18T12:00:00Z');

export async function startServer() {
  const proxy = await getPlatformProxy<Env>({ configPath: 'server/wrangler.jsonc', persist: false });
  const env = proxy.env;
  const db = env.DB;
  for (const name of Object.keys(MIGRATIONS).sort()) await db.batch(sqlStatements(MIGRATIONS[name]).map((s) => db.prepare(s)));

  const clock = { now: START };
  const app = createApp({ now: () => clock.now });

  async function call(method: string, path: string, opts: { token?: string; json?: unknown; body?: BodyInit; headers?: Record<string, string> } = {}) {
    const headers: Record<string, string> = { ...opts.headers };
    if (opts.token) headers.authorization = `Bearer ${opts.token}`;
    let body = opts.body;
    if (opts.json !== undefined) { headers['content-type'] = 'application/json'; body = JSON.stringify(opts.json); }
    const init: RequestInit & { duplex?: 'half' } = { method, headers, body };
    if (body instanceof ReadableStream) init.duplex = 'half';   // strumień bez Content-Length
    const res = await app.request(path, init, env);
    const text = await res.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: res.status, data, headers: res.headers };
  }

  async function newPlayer(platform = 'android'): Promise<string> {
    const r = await call('POST', '/v1/players', { json: { platform } });
    if (r.status !== 201) throw new Error(`nie udało się założyć gracza: ${r.status} ${JSON.stringify(r.data)}`);
    return r.data.token;
  }

  async function newRun(token: string): Promise<{ runId: string; seed: number }> {
    const r = await call('POST', '/v1/runs', { token, json: { simVersion: SIM_VERSION } });
    if (r.status !== 201) throw new Error(`nie udało się wydać biletu: ${r.status} ${JSON.stringify(r.data)}`);
    return r.data;
  }

  async function upload(token: string, runId: string, ticks: Uint8Array) {
    const chunks = splitChunks(ticks);
    let last: Awaited<ReturnType<typeof call>> | null = null;
    for (let i = 0; i < chunks.length; i++) {
      last = await call('PUT', `/v1/runs/${runId}/chunks/${i}`, { token, body: encodeInputs(chunks[i]), headers: { 'content-type': 'application/octet-stream' } });
      if (last.status !== 200) return last;
    }
    return last!;
  }

  /** Wysyła cały bieg i go zatwierdza. Zegar przesuwa się o czas gry, chyba że podano inaczej. */
  async function submit(token: string, runId: string, run: { ticks: Uint8Array; score: number }, o: { claimScore?: number; advanceMs?: number; skin?: string } = {}) {
    clock.now += o.advanceMs ?? Math.ceil(run.ticks.length * 1000 / 120) + 5000;
    const up = await upload(token, runId, run.ticks);
    if (up.status !== 200) return up;
    return call('POST', `/v1/runs/${runId}/finish`, {
      token, json: { score: o.claimScore ?? run.score, char: o.skin ? 'custom' : 'fox', ...(o.skin ? { skin: o.skin } : {}), style: 'classic', control: 'keys', appVersion: 'test' },
    });
  }

  async function reset() {
    await db.batch(['DELETE FROM run_chunks', 'DELETE FROM skins', 'DELETE FROM bests', 'DELETE FROM runs', 'DELETE FROM players'].map((s) => db.prepare(s)));
    clock.now = START;
  }

  return { env, db, app, clock, call, newPlayer, newRun, upload, submit, reset, dispose: () => proxy.dispose() };
}

/** Rozgrywa bieg na podanej wieży aż do końca gry. */
export function playRun(seed: number, pilot: Pilot, maxTicks = 120 * 60 * 10): { ticks: Uint8Array; score: number; state: SimState } {
  const s = createState(seed), rec = new InputRecorder();
  while (!s.over && s.tick < maxTicks) { const i = pilot.next(s); rec.push(inputByte(i)); step(s, i.axis, i.jump); }
  return { ticks: rec.ticks().slice(), score: score(s), state: s };
}
