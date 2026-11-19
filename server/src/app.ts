// API rankingu Step Jumpera (Hono). Opis protokołu: docs/PLAN.md → „Rankingi i baza danych” oraz server/README.md.
import { Hono } from 'hono';
import type { Context } from 'hono';
import { cors } from 'hono/cors';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { SIM_VERSION, TICK_RATE, score } from '../../src/sim';
import type { SimState } from '../../src/sim';
import { newSecret, parseBearer, sameHash, sha256hex } from './auth';
import type { Env, Player } from './env';
import { checkNick } from './nick';
import { isPeriodKind, periodKey, periodKeys } from './periods';
import type { PeriodKind } from './periods';
import { CHUNK_TICKS, MAX_CHUNKS, Rejected, verifyChunk } from './verify';

type AppEnv = { Bindings: Env; Variables: { player: Player } };
type Ctx = Context<AppEnv>;

const HOUR = 3_600_000;
const MAX_TICKETS_PER_HOUR = 60;
const MAX_OPEN_TICKETS = 5;
const MAX_CHUNK_BYTES = 4 * CHUNK_TICKS;   // porcja to w najgorszym razie 2 bajty na krok
const TOP_DEFAULT = 50, TOP_MAX = 100, NEIGHBOURS = 5;
const ID_RE = /^[a-z0-9_-]{1,24}$/;
const PERIODS: PeriodKind[] = ['all', 'week', 'day'];

/** Odpowiedź z błędem, którą handler może po prostu rzucić. */
class ApiError extends Error {
  constructor(readonly status: ContentfulStatusCode, readonly body: Record<string, unknown>) { super(String(body.error)); }
}
const fail = (status: ContentfulStatusCode, error: string, extra: Record<string, unknown> = {}) => new ApiError(status, { error, ...extra });

async function readJson(c: Ctx): Promise<Record<string, unknown>> {
  let v: unknown;
  try { v = await c.req.json(); } catch { throw fail(400, 'bad_json'); }
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw fail(400, 'bad_json');
  return v as Record<string, unknown>;
}

const optText = (v: unknown, max: number) => (typeof v === 'string' && v.length <= max ? v : null);
const displayName = (id: string, nick: string | null) => nick ?? `Gracz ${id.slice(0, 4).toUpperCase()}`;

interface RunRow {
  id: string; player_id: string; seed: number; sim_version: number; status: string;
  issued_at: number; next_seq: number; checkpoint: string | null;
}
interface BoardRow { player_id: string; nick: string | null; country: string | null; score: number; floor: number; combo: number; char_id: string; achieved_at: number }

export function createApp(deps: { now?: () => number } = {}) {
  const now = deps.now ?? Date.now;
  const app = new Hono<AppEnv>();

  app.use('*', cors({
    origin: (origin, c: Ctx) => ((c.env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).includes(origin) ? origin : null),
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowHeaders: ['authorization', 'content-type'],
    maxAge: 86_400,
  }));

  app.onError((err, c) => {
    if (err instanceof ApiError) return c.json(err.body, err.status);
    console.error(err);
    return c.json({ error: 'internal' }, 500);
  });
  app.notFound((c) => c.json({ error: 'not_found' }, 404));

  /** Uwierzytelnia gracza z nagłówka Authorization i odkłada go w c.var.player. */
  async function requirePlayer(c: Ctx, next: () => Promise<void>) {
    const cred = parseBearer(c.req.header('authorization'));
    if (!cred) throw fail(401, 'unauthorized');
    const row = await c.env.DB.prepare('SELECT id, token_hash, nick, banned, created_at, last_seen_at FROM players WHERE id = ?')
      .bind(cred.id).first<Player & { token_hash: string; last_seen_at: number }>();
    if (!row || !sameHash(row.token_hash, await sha256hex(cred.secret))) throw fail(401, 'unauthorized');
    const t = now();
    if (t - row.last_seen_at > HOUR) await c.env.DB.prepare('UPDATE players SET last_seen_at = ? WHERE id = ?').bind(t, row.id).run();
    c.set('player', { id: row.id, nick: row.nick, banned: row.banned, created_at: row.created_at });
    await next();
  }

  // ───────────────────────── gracze ─────────────────────────

  app.post('/v1/players', async (c) => {
    const body = await readJson(c);
    if (body.platform !== 'android' && body.platform !== 'web') throw fail(400, 'bad_request');
    // Limit na adres IP. Cloudflare zawsze dodaje ten nagłówek; brakuje go tylko przy wywołaniach lokalnych.
    const ip = c.req.header('cf-connecting-ip');
    if (ip && c.env.RL_NEW_PLAYER && !(await c.env.RL_NEW_PLAYER.limit({ key: ip })).success) throw fail(429, 'too_many_players');

    const id = crypto.randomUUID(), secret = newSecret(), t = now();
    const country = (c.req.raw as { cf?: { country?: string } }).cf?.country ?? null;
    await c.env.DB.prepare('INSERT INTO players (id, token_hash, platform, country, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(id, await sha256hex(secret), body.platform, country, t, t).run();
    return c.json({ playerId: id, token: `${id}.${secret}` }, 201);
  });

  app.get('/v1/me', requirePlayer, (c) => {
    const p = c.var.player;
    return c.json({ playerId: p.id, nick: p.nick, createdAt: p.created_at });
  });

  app.patch('/v1/me', requirePlayer, async (c) => {
    const check = checkNick((await readJson(c)).nick);
    if (!check.ok) throw fail(400, `nick_${check.reason}`);
    try {
      await c.env.DB.prepare('UPDATE players SET nick = ?, nick_key = ? WHERE id = ?').bind(check.nick, check.key, c.var.player.id).run();
    } catch (e) {
      if (String(e).includes('UNIQUE')) throw fail(409, 'nick_taken');
      throw e;
    }
    return c.json({ nick: check.nick });
  });

  // Usunięcie konta i wszystkich danych gracza (wymóg Google Play).
  app.delete('/v1/me', requirePlayer, async (c) => {
    const id = c.var.player.id, db = c.env.DB;
    await db.batch([
      db.prepare('DELETE FROM bests WHERE player_id = ?').bind(id),
      db.prepare('DELETE FROM runs WHERE player_id = ?').bind(id),
      db.prepare('DELETE FROM players WHERE id = ?').bind(id),
    ]);
    return c.body(null, 204);
  });

  // ───────────────────────── biegi ─────────────────────────

  // Bilet na bieg: ziarno wieży wybiera serwer, więc nie da się „wylosować” sobie łatwej wieży.
  app.post('/v1/runs', requirePlayer, async (c) => {
    const body = await readJson(c);
    if (body.simVersion !== SIM_VERSION) throw fail(409, 'update_required', { simVersion: SIM_VERSION });
    const mode = body.mode ?? 'classic';
    if (mode !== 'classic') throw fail(400, 'bad_request');
    const p = c.var.player, db = c.env.DB, t = now();
    if (p.banned) throw fail(403, 'banned');

    const hour = Math.floor(t / HOUR);
    const counted = await db.prepare(
      'UPDATE players SET ticket_count = CASE WHEN ticket_hour = ?1 THEN ticket_count + 1 ELSE 1 END, ticket_hour = ?1 ' +
      'WHERE id = ?2 AND (ticket_hour != ?1 OR ticket_count < ?3)',
    ).bind(hour, p.id, MAX_TICKETS_PER_HOUR).run();
    if (!counted.meta.changes) throw fail(429, 'too_many_runs');

    const id = crypto.randomUUID();
    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    await db.batch([
      db.prepare("INSERT INTO runs (id, player_id, mode, seed, sim_version, status, issued_at, updated_at) VALUES (?, ?, ?, ?, ?, 'issued', ?, ?)")
        .bind(id, p.id, mode, seed, SIM_VERSION, t, t),
      // klient trzyma kilka biletów w zapasie (gra offline); nadmiarowe, najstarsze przepadają
      db.prepare("DELETE FROM runs WHERE id IN (SELECT id FROM runs WHERE player_id = ? AND status = 'issued' ORDER BY issued_at DESC LIMIT -1 OFFSET ?)")
        .bind(p.id, MAX_OPEN_TICKETS),
    ]);
    return c.json({ runId: id, seed, simVersion: SIM_VERSION, chunkTicks: CHUNK_TICKS }, 201);
  });

  async function loadRun(c: Ctx): Promise<RunRow> {
    const run = await c.env.DB.prepare('SELECT id, player_id, seed, sim_version, status, issued_at, next_seq, checkpoint FROM runs WHERE id = ? AND player_id = ?')
      .bind(c.req.param('id'), c.var.player.id).first<RunRow>();
    if (!run) throw fail(404, 'not_found');
    if (run.status === 'verified' || run.status === 'rejected') throw fail(409, 'run_closed', { status: run.status });
    return run;
  }

  async function reject(c: Ctx, runId: string, reason: string): Promise<never> {
    await c.env.DB.prepare("UPDATE runs SET status = 'rejected', reject_reason = ?, checkpoint = NULL, updated_at = ? WHERE id = ?")
      .bind(reason, now(), runId).run();
    throw fail(422, 'rejected', { reason });
  }

  // Porcja zapisu wejść (encodeInputs z maks. CHUNK_TICKS kroków). Porcje idą po kolei; powtórzenie już przyjętej jest nieszkodliwe.
  app.put('/v1/runs/:id/chunks/:seq', requirePlayer, async (c) => {
    if (Number(c.req.header('content-length') ?? 0) > MAX_CHUNK_BYTES) throw fail(413, 'too_large');
    const seq = Number(c.req.param('seq'));
    if (!Number.isInteger(seq) || seq < 0) throw fail(404, 'not_found');
    const run = await loadRun(c);
    const data = new Uint8Array(await c.req.arrayBuffer());
    if (data.length > MAX_CHUNK_BYTES) throw fail(413, 'too_large');

    if (seq < run.next_seq) return c.json({ nextSeq: run.next_seq, duplicate: true });
    if (seq > run.next_seq) throw fail(409, 'seq', { nextSeq: run.next_seq });
    if (run.sim_version !== SIM_VERSION) return reject(c, run.id, 'sim_version');
    if (seq >= MAX_CHUNKS) return reject(c, run.id, 'too_long');

    let state: SimState;
    try {
      state = verifyChunk(run.seed, run.checkpoint ? JSON.parse(run.checkpoint) : null, data);
    } catch (e) {
      if (e instanceof Rejected) return reject(c, run.id, e.reason);
      throw e;
    }
    const saved = await c.env.DB.prepare(
      "UPDATE runs SET status = 'uploading', checkpoint = ?, ticks = ?, next_seq = next_seq + 1, updated_at = ? WHERE id = ? AND next_seq = ?",
    ).bind(JSON.stringify(state), state.tick, now(), run.id, seq).run();
    if (!saved.meta.changes) throw fail(409, 'seq', { nextSeq: seq + 1 });   // równoległa wysyłka tej samej porcji
    return c.json({ nextSeq: seq + 1, ticks: state.tick, over: state.over });
  });

  async function rankOf(db: D1Database, period: string, b: { score: number; achieved_at: number; player_id: string }): Promise<number> {
    const r = await db.prepare(
      'SELECT COUNT(*) + 1 AS rank FROM bests b JOIN players p ON p.id = b.player_id WHERE b.period = ?1 AND p.banned = 0 AND ' +
      '(b.score > ?2 OR (b.score = ?2 AND (b.achieved_at < ?3 OR (b.achieved_at = ?3 AND b.player_id < ?4))))',
    ).bind(period, b.score, b.achieved_at, b.player_id).first<{ rank: number }>();
    return r!.rank;
  }

  // Zatwierdzenie biegu: symulacja musi dojść do końca gry, a wynik zgadzać się z tym, który widział gracz.
  app.post('/v1/runs/:id/finish', requirePlayer, async (c) => {
    const run = await loadRun(c);
    const body = await readJson(c);
    const char = typeof body.char === 'string' && ID_RE.test(body.char) ? body.char : null;
    if (!Number.isInteger(body.score) || !char) throw fail(400, 'bad_request');

    const state: SimState | null = run.checkpoint ? JSON.parse(run.checkpoint) : null;
    if (!state?.over) return reject(c, run.id, 'not_over');
    const t = now();
    if (t - run.issued_at < (state.tick * 1000) / TICK_RATE) return reject(c, run.id, 'too_fast');
    const sc = score(state);
    if (body.score !== sc) return reject(c, run.id, 'score_mismatch');

    const db = c.env.DB, p = c.var.player, keys = periodKeys(t);
    const prev = new Map(
      (await db.prepare('SELECT period, score, achieved_at FROM bests WHERE player_id = ? AND period IN (?, ?, ?)')
        .bind(p.id, keys.all, keys.week, keys.day).all<{ period: string; score: number; achieved_at: number }>()).results.map((r) => [r.period, r]),
    );
    const upsert = db.prepare(
      'INSERT INTO bests (period, player_id, score, floor, combo, char_id, run_id, achieved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ' +
      'ON CONFLICT (period, player_id) DO UPDATE SET score = excluded.score, floor = excluded.floor, combo = excluded.combo, ' +
      'char_id = excluded.char_id, run_id = excluded.run_id, achieved_at = excluded.achieved_at WHERE excluded.score > bests.score',
    );
    await db.batch([
      db.prepare(
        "UPDATE runs SET status = 'verified', checkpoint = NULL, finished_at = ?, updated_at = ?, score = ?, floor = ?, combo = ?, " +
        'char_id = ?, style_id = ?, control = ?, app_version = ? WHERE id = ?',
      ).bind(t, t, sc, state.maxFloor, state.bestCombo, char, optText(body.style, 24), optText(body.control, 24), optText(body.appVersion, 32), run.id),
      ...PERIODS.map((k) => upsert.bind(keys[k], p.id, sc, state.maxFloor, state.bestCombo, char, run.id, t)),
    ]);

    const improved = {} as Record<PeriodKind, boolean>, ranks = {} as Record<PeriodKind, number>;
    for (const k of PERIODS) {
      const old = prev.get(keys[k]);
      improved[k] = !old || sc > old.score;
      ranks[k] = await rankOf(db, keys[k], improved[k] ? { score: sc, achieved_at: t, player_id: p.id } : { ...old!, player_id: p.id });
    }
    return c.json({ status: 'verified', score: sc, floor: state.maxFloor, combo: state.bestCombo, ticks: state.tick, improved, ranks });
  });

  // ───────────────────────── rankingi ─────────────────────────

  const BOARD_SELECT =
    'SELECT b.player_id, p.nick, p.country, b.score, b.floor, b.combo, b.char_id, b.achieved_at ' +
    'FROM bests b JOIN players p ON p.id = b.player_id WHERE b.period = ? AND p.banned = 0 ' +
    'ORDER BY b.score DESC, b.achieved_at ASC, b.player_id ASC LIMIT ? OFFSET ?';
  const entry = (r: BoardRow, rank: number) => ({
    rank, name: displayName(r.player_id, r.nick), score: r.score, floor: r.floor, combo: r.combo, char: r.char_id, country: r.country,
  });
  function periodParam(c: Ctx): string {
    const kind = c.req.param('period') ?? '';
    if (!isPeriodKind(kind)) throw fail(404, 'not_found');
    return periodKey(kind, now());
  }

  app.get('/v1/leaderboards/:period', async (c) => {
    const period = periodParam(c);
    const limit = Math.min(TOP_MAX, Math.max(1, Number(c.req.query('limit')) || TOP_DEFAULT));
    const { results } = await c.env.DB.prepare(BOARD_SELECT).bind(period, limit, 0).all<BoardRow>();
    c.header('cache-control', 'public, max-age=30');
    return c.json({ period, entries: results.map((r, i) => entry(r, i + 1)) });
  });

  app.get('/v1/leaderboards/:period/me', requirePlayer, async (c) => {
    const period = periodParam(c), db = c.env.DB, me = c.var.player.id;
    c.header('cache-control', 'private, no-store');
    const mine = await db.prepare('SELECT score, achieved_at FROM bests WHERE period = ? AND player_id = ?').bind(period, me)
      .first<{ score: number; achieved_at: number }>();
    if (!mine || c.var.player.banned) return c.json({ period, rank: null, entries: [] });
    const rank = await rankOf(db, period, { ...mine, player_id: me });
    const offset = Math.max(0, rank - 1 - NEIGHBOURS);
    const { results } = await db.prepare(BOARD_SELECT).bind(period, 2 * NEIGHBOURS + 1, offset).all<BoardRow>();
    return c.json({ period, rank, entries: results.map((r, i) => ({ ...entry(r, offset + i + 1), me: r.player_id === me })) });
  });

  return app;
}
