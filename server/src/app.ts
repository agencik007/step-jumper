// API rankingu Step Jumpera (Hono). Opis protokołu: docs/PLAN.md → „Rankingi i baza danych” oraz server/README.md.
import { Hono } from 'hono';
import type { Context } from 'hono';
import { cors } from 'hono/cors';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { SIM_VERSION, TICK_RATE, score } from '../../src/sim';
import type { SimState } from '../../src/sim';
import { checkPassword, newSalt, newSecret, parseBearer, passwordHash, sameHash, sha256hex } from './auth';
import type { Env, Player } from './env';
import { kickFromRoom, liveKey, roomEvent } from './live';
import {
  MATCH_CUT_EARLY_MS, MATCH_GRACE_MS, MATCH_LEAD_MS, MATCH_SHOW_MS, budgetTicks, isMinutes, isScoring, maxTicks, standings,
} from './match';
import type { MatchRun, Scoring } from './match';
import { checkNick, checkRoomName } from './nick';
import { boardKey, isBoardKind, periodKeys } from './periods';
import type { PeriodKind } from './periods';
import { CHUNK_TICKS, MAX_CHUNKS, Rejected, verifyChunk } from './verify';

type AppEnv = { Bindings: Env; Variables: { player: Player } };
type Ctx = Context<AppEnv>;

const HOUR = 3_600_000;
const MAX_TICKETS_PER_HOUR = 180;   // krótkie biegi i szybkie restarty są w tej grze normalne
const MAX_OPEN_TICKETS = 5;
const MAX_OPEN_MATCH_TICKETS = 2;
const MAX_CHUNK_BYTES = 4 * CHUNK_TICKS;   // porcja to w najgorszym razie 2 bajty na krok
const TOP_DEFAULT = 50, TOP_MAX = 100, NEIGHBOURS = 5;
const ID_RE = /^[a-z0-9_-]{1,24}$/;
const PERIODS: PeriodKind[] = ['all', 'week', 'day'];
/** Tylu najlepszym graczom ranking podaje identyfikator powtórki i paczkę własnej postaci. */
const REPLAY_TOP = 3;
/** Paczka własnej postaci (ZIP z kreatora, klatki do 400 px) – D1 mieści w wierszu do 2 MB. */
export const MAX_SKIN_BYTES = 1_500_000;
const HASH_RE = /^[0-9a-f]{64}$/;
/** Pokoje znajomych: tylu graczy mieści pokój. */
export const ROOM_MAX_MEMBERS = 50;
/** Zgadywanie hasła pokoju: najwyżej tyle błędnych prób w oknie czasu – potem pokój czeka na koniec okna. */
export const ROOM_FAIL_MAX = 20, ROOM_FAIL_WINDOW = 10 * 60_000;

/** Odpowiedź z błędem, którą handler może po prostu rzucić. */
class ApiError extends Error {
  constructor(readonly status: ContentfulStatusCode, readonly body: Record<string, unknown>) { super(String(body.error)); }
}
const fail = (status: ContentfulStatusCode, error: string, extra: Record<string, unknown> = {}) => new ApiError(status, { error, ...extra });

/** Czyta ciało zapytania, przerywając, gdy przekroczy limit – bez wczytywania całości do pamięci. */
async function readCapped(req: Request, max: number): Promise<Uint8Array> {
  if (Number(req.headers.get('content-length') ?? 0) > max) throw fail(413, 'too_large');
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader(), out = new Uint8Array(max);
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return out.subarray(0, n);
    if (n + value.length > max) { await reader.cancel(); throw fail(413, 'too_large'); }
    out.set(value, n); n += value.length;
  }
}

async function readJson(c: Ctx): Promise<Record<string, unknown>> {
  let v: unknown;
  try { v = await c.req.json(); } catch { throw fail(400, 'bad_json'); }
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw fail(400, 'bad_json');
  return v as Record<string, unknown>;
}

function toB64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s);
}

const optText = (v: unknown, max: number) => (typeof v === 'string' && v.length <= max ? v : null);
/** Krótki, stały znacznik gracza bez nicku (gra pokazuje go jako „Gracz AB12”, „Player AB12”… – zależnie od języka). */
const playerTag = (id: string) => id.slice(0, 4).toUpperCase();

interface RunRow {
  id: string; player_id: string; seed: number; sim_version: number; status: string;
  issued_at: number; next_seq: number; checkpoint: string | null;
  mode: string; match_id: string | null; max_ticks: number | null;
}
/** Wyścig w pokoju (tabela matches). */
interface MatchRow {
  id: string; room_id: string; kind: string; scoring: Scoring; seed: number; sim_version: number; minutes: number;
  created_by: string; starts_at: number; ends_at: number; created_at: number;
}
const MATCH_COLS = 'id, room_id, kind, scoring, seed, sim_version, minutes, created_by, starts_at, ends_at, created_at';
interface BoardRow {
  player_id: string; nick: string | null; country: string | null; score: number; floor: number; combo: number; char_id: string; achieved_at: number;
  run_id: string; has_replay: number; skin: string | null; has_skin: number;
}

/** Wysyłka zdarzenia do pokoju na żywo; testy podmieniają ją, żeby zobaczyć, co poszłoby do znajomych. */
type RoomEventFn = (env: Env, roomId: string, msg: { k: string } & Record<string, unknown>) => Promise<void> | void;

export function createApp(deps: { now?: () => number; roomEvent?: RoomEventFn } = {}) {
  const now = deps.now ?? Date.now;
  const sendRoomEvent: RoomEventFn = deps.roomEvent ?? roomEvent;
  /** Praca w tle po odpowiedzi (waitUntil); bez kontekstu wykonania (testy) – czekamy na nią od razu. */
  async function later(c: Ctx, job: Promise<unknown>) {
    try { c.executionCtx.waitUntil(job); } catch { await job; }
  }
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
    const row = await c.env.DB.prepare('SELECT id, token_hash, nick, banned, created_at, last_seen_at, room_id FROM players WHERE id = ?')
      .bind(cred.id).first<Player & { token_hash: string; last_seen_at: number }>();
    if (!row || !sameHash(row.token_hash, await sha256hex(cred.secret))) throw fail(401, 'unauthorized');
    const t = now();
    if (t - row.last_seen_at > HOUR) await c.env.DB.prepare('UPDATE players SET last_seen_at = ? WHERE id = ?').bind(t, row.id).run();
    c.set('player', { id: row.id, nick: row.nick, banned: row.banned, created_at: row.created_at, room_id: row.room_id });
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

  app.get('/v1/me', requirePlayer, async (c) => {
    const p = c.var.player;
    const room = p.room_id ? await c.env.DB.prepare('SELECT name FROM rooms WHERE id = ?').bind(p.room_id).first<{ name: string }>() : null;
    return c.json({ playerId: p.id, nick: p.nick, createdAt: p.created_at, room: room ? { name: room.name } : null });
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
      ...leaveRoom(db, c.var.player),
      db.prepare('DELETE FROM run_chunks WHERE run_id IN (SELECT id FROM runs WHERE player_id = ?)').bind(id),
      db.prepare('DELETE FROM skins WHERE player_id = ?').bind(id),
      db.prepare('DELETE FROM bests WHERE player_id = ?').bind(id),
      db.prepare('DELETE FROM match_results WHERE player_id = ?').bind(id),
      db.prepare('DELETE FROM runs WHERE player_id = ?').bind(id),
      db.prepare('DELETE FROM players WHERE id = ?').bind(id),
    ]);
    kickLater(c, c.var.player.room_id);
    return c.body(null, 204);
  });

  // ───────────────────────── biegi ─────────────────────────

  // Bilet na bieg: ziarno wieży wybiera serwer, więc nie da się „wylosować” sobie łatwej wieży.
  app.post('/v1/runs', requirePlayer, async (c) => {
    const body = await readJson(c);
    if (body.simVersion !== SIM_VERSION) throw fail(409, 'update_required', { simVersion: SIM_VERSION });
    const mode = body.mode ?? 'classic';
    if (mode !== 'classic' && mode !== 'match') throw fail(400, 'bad_request');
    const p = c.var.player, db = c.env.DB, t = now();
    if (p.banned) throw fail(403, 'banned');
    // bilet na bieg w wyścigu: wieża wyścigu i limit kroków do jego końca (sprawdzamy przed liczeniem limitu biletów)
    let match: MatchRow | null = null;
    if (mode === 'match') {
      match = typeof body.match === 'string'
        ? await db.prepare(`SELECT ${MATCH_COLS} FROM matches WHERE id = ?`).bind(body.match).first<MatchRow>()
        : null;
      if (!match || match.room_id !== p.room_id) throw fail(404, 'match_not_found');
      if (t >= match.ends_at) throw fail(409, 'match_over');
    }

    const hour = Math.floor(t / HOUR);
    const counted = await db.prepare(
      'UPDATE players SET ticket_count = CASE WHEN ticket_hour = ?1 THEN ticket_count + 1 ELSE 1 END, ticket_hour = ?1 ' +
      'WHERE id = ?2 AND (ticket_hour != ?1 OR ticket_count < ?3)',
    ).bind(hour, p.id, MAX_TICKETS_PER_HOUR).run();
    if (!counted.meta.changes) throw fail(429, 'too_many_runs');

    const id = crypto.randomUUID();
    if (match) {
      const limit = maxTicks(match, t);
      await db.batch([
        db.prepare("INSERT INTO runs (id, player_id, mode, seed, sim_version, status, issued_at, updated_at, match_id, max_ticks) VALUES (?, ?, 'match', ?, ?, 'issued', ?, ?, ?, ?)")
          .bind(id, p.id, match.seed, SIM_VERSION, t, t, match.id, limit),
        // gra trzyma w zapasie bilet na następny bieg wyścigu; nadmiarowe, najstarsze przepadają
        db.prepare("DELETE FROM runs WHERE id IN (SELECT id FROM runs WHERE player_id = ? AND match_id = ? AND status = 'issued' ORDER BY issued_at DESC LIMIT -1 OFFSET ?)")
          .bind(p.id, match.id, MAX_OPEN_MATCH_TICKETS),
      ]);
      return c.json({
        runId: id, seed: match.seed, simVersion: SIM_VERSION, chunkTicks: CHUNK_TICKS,
        match: match.id, maxTicks: limit, startsAt: match.starts_at, endsAt: match.ends_at, now: t,
      }, 201);
    }
    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    await db.batch([
      db.prepare("INSERT INTO runs (id, player_id, mode, seed, sim_version, status, issued_at, updated_at) VALUES (?, ?, ?, ?, ?, 'issued', ?, ?)")
        .bind(id, p.id, mode, seed, SIM_VERSION, t, t),
      // klient trzyma kilka biletów w zapasie (gra offline); nadmiarowe, najstarsze przepadają
      db.prepare("DELETE FROM runs WHERE id IN (SELECT id FROM runs WHERE player_id = ? AND mode = 'classic' AND status = 'issued' ORDER BY issued_at DESC LIMIT -1 OFFSET ?)")
        .bind(p.id, MAX_OPEN_TICKETS),
    ]);
    return c.json({ runId: id, seed, simVersion: SIM_VERSION, chunkTicks: CHUNK_TICKS }, 201);
  });

  async function loadRun(c: Ctx): Promise<RunRow> {
    const run = await c.env.DB.prepare(
      'SELECT id, player_id, seed, sim_version, status, issued_at, next_seq, checkpoint, mode, match_id, max_ticks FROM runs WHERE id = ? AND player_id = ?',
    )
      .bind(c.req.param('id'), c.var.player.id).first<RunRow>();
    if (!run) throw fail(404, 'not_found');
    if (run.status === 'verified' || run.status === 'rejected') throw fail(409, 'run_closed', { status: run.status });
    return run;
  }

  async function reject(c: Ctx, runId: string, reason: string): Promise<never> {
    const db = c.env.DB;
    await db.batch([
      db.prepare("UPDATE runs SET status = 'rejected', reject_reason = ?, checkpoint = NULL, updated_at = ? WHERE id = ?").bind(reason, now(), runId),
      db.prepare('DELETE FROM run_chunks WHERE run_id = ?').bind(runId),
    ]);
    throw fail(422, 'rejected', { reason });
  }

  // Porcja zapisu wejść (encodeInputs z maks. CHUNK_TICKS kroków). Porcje idą po kolei; powtórzenie już przyjętej jest nieszkodliwe.
  app.put('/v1/runs/:id/chunks/:seq', requirePlayer, async (c) => {
    const seq = Number(c.req.param('seq'));
    if (!Number.isInteger(seq) || seq < 0) throw fail(404, 'not_found');
    const run = await loadRun(c);
    const data = await readCapped(c.req.raw, MAX_CHUNK_BYTES);

    if (seq < run.next_seq) return c.json({ nextSeq: run.next_seq, duplicate: true });
    if (seq > run.next_seq) throw fail(409, 'seq', { nextSeq: run.next_seq });
    if (run.sim_version !== SIM_VERSION) return reject(c, run.id, 'sim_version');
    if (seq >= MAX_CHUNKS) return reject(c, run.id, 'too_long');
    // ?end=time – ostatnia porcja biegu z wyścigu, uciętego zegarem (tylko wyścig i dopiero pod koniec wyścigu)
    const cut = c.req.query('end') === 'time';
    if (cut) {
      const m = run.match_id ? await loadMatch(c.env.DB, run.match_id) : null;
      if (run.mode !== 'match' || !m) throw fail(400, 'bad_request');
      if (now() < m.ends_at - MATCH_CUT_EARLY_MS) return reject(c, run.id, 'cut_early');
    }

    let state: SimState;
    try {
      state = verifyChunk(run.seed, run.checkpoint ? JSON.parse(run.checkpoint) : null, data, { cut });
    } catch (e) {
      if (e instanceof Rejected) return reject(c, run.id, e.reason);
      throw e;
    }
    if (run.max_ticks !== null && state.tick > run.max_ticks) return reject(c, run.id, 'too_long');
    const db = c.env.DB;
    const [saved] = await db.batch([
      db.prepare(
        "UPDATE runs SET status = 'uploading', checkpoint = ?, ticks = ?, next_seq = next_seq + 1, updated_at = ? WHERE id = ? AND next_seq = ?",
      ).bind(JSON.stringify(state), state.tick, now(), run.id, seq),
      // porcja zostaje na powtórkę; przy równoległej wysyłce tej samej porcji wygrywa ta, która pierwsza przesunęła next_seq
      db.prepare('INSERT OR IGNORE INTO run_chunks (run_id, seq, data) VALUES (?, ?, ?)').bind(run.id, seq, data),
    ]);
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
    // własna postać z KREATORA: skrót paczki, którą gracz wyśle, jeśli bieg trafi do najlepszej trójki
    const skin = char === 'custom' && typeof body.skin === 'string' && HASH_RE.test(body.skin) ? body.skin : null;

    const state: SimState | null = run.checkpoint ? JSON.parse(run.checkpoint) : null;
    if (!state?.over) return reject(c, run.id, 'not_over');
    const t = now();
    if (t - run.issued_at < (state.tick * 1000) / TICK_RATE) return reject(c, run.id, 'too_fast');
    const sc = score(state);
    if (body.score !== sc) return reject(c, run.id, 'score_mismatch');
    if (run.mode === 'match') return finishMatchRun(c, run, state, sc, char, skin, body);

    const db = c.env.DB, p = c.var.player, keys = periodKeys(t);
    const prev = new Map(
      (await db.prepare('SELECT period, score, achieved_at FROM bests WHERE player_id = ? AND period IN (?, ?, ?)')
        .bind(p.id, keys.all, keys.week, keys.day).all<{ period: string; score: number; achieved_at: number }>()).results.map((r) => [r.period, r]),
    );
    const upsert = db.prepare(
      'INSERT INTO bests (period, player_id, score, floor, combo, char_id, skin, run_id, achieved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ' +
      'ON CONFLICT (period, player_id) DO UPDATE SET score = excluded.score, floor = excluded.floor, combo = excluded.combo, ' +
      'char_id = excluded.char_id, skin = excluded.skin, run_id = excluded.run_id, achieved_at = excluded.achieved_at WHERE excluded.score > bests.score',
    );
    await db.batch([
      db.prepare(
        "UPDATE runs SET status = 'verified', checkpoint = NULL, finished_at = ?, updated_at = ?, score = ?, floor = ?, combo = ?, " +
        'char_id = ?, skin = ?, style_id = ?, control = ?, app_version = ? WHERE id = ?',
      ).bind(t, t, sc, state.maxFloor, state.bestCombo, char, skin, optText(body.style, 24), optText(body.control, 24), optText(body.appVersion, 32), run.id),
      ...PERIODS.map((k) => upsert.bind(keys[k], p.id, sc, state.maxFloor, state.bestCombo, char, skin, run.id, t)),
      // powtórki trzymamy tylko dla biegów, które są czyimś najlepszym wynikiem (ten bieg albo wyparte nim starsze)
      db.prepare(
        'DELETE FROM run_chunks WHERE run_id IN (SELECT id FROM runs WHERE player_id = ?1) AND run_id NOT IN (SELECT run_id FROM bests WHERE player_id = ?1)',
      ).bind(p.id),
    ]);

    const improved = {} as Record<PeriodKind, boolean>, ranks = {} as Record<PeriodKind, number>;
    for (const k of PERIODS) {
      const old = prev.get(keys[k]);
      improved[k] = !old || sc > old.score;
      ranks[k] = await rankOf(db, keys[k], improved[k] ? { score: sc, achieved_at: t, player_id: p.id } : { ...old!, player_id: p.id });
    }
    // bieg z własną postacią wszedł do najlepszej trójki, a serwer nie ma jeszcze tej paczki – gra ją dośle (PUT /v1/skins/:hash)
    const top = PERIODS.some((k) => improved[k] && ranks[k] <= REPLAY_TOP);
    const needSkin = !!skin && top && !(await db.prepare('SELECT 1 FROM skins WHERE hash = ?').bind(skin).first());
    // pokój znajomych: wynik idzie do znajomych na żywo, ale tylko gdy coś znaczy – najlepszy dziś (stąd też rekord
    // życiowy, rekord pokoju i wyprzedzenie kogoś w tygodniu). Co gorszego niż rekord dnia – znajomych nie zajmuje.
    if (p.room_id && improved.day) {
      await later(c, (async () => {
        const others = (await db.prepare(
          'SELECT b.period, b.player_id, b.score FROM bests b JOIN players q ON q.id = b.player_id ' +
          'WHERE b.period IN (?, ?) AND q.room_id = ? AND q.banned = 0 AND b.player_id != ?',
        ).bind(keys.week, keys.all, p.room_id, p.id).all<{ period: string; player_id: string; score: number }>()).results;
        const oldWeek = prev.get(keys.week)?.score ?? null, allTime = others.filter((r) => r.period === keys.all);
        // wyprzedzeni w tygodniu: byli nad (albo równo z) moim starym wynikiem, a są pod nowym
        const over = improved.week ? others.filter((r) => r.period === keys.week && r.score < sc && (oldWeek === null || r.score >= oldWeek)) : [];
        await sendRoomEvent(c.env, p.room_id!, {
          t: 'ev', e: 'score', k: await liveKey(p.id), nick: p.nick, tag: playerTag(p.id), score: sc, floor: state.maxFloor,
          best: improved.all, roomBest: improved.all && allTime.length > 0 && allTime.every((r) => r.score < sc),
          over: await Promise.all(over.map((r) => liveKey(r.player_id))),
        });
      })().catch((e) => console.error('room score', e)));
    }
    return c.json({ status: 'verified', score: sc, floor: state.maxFloor, combo: state.bestCombo, ticks: state.tick, improved, ranks, ...(needSkin ? { needSkin } : {}) });
  });

  // ───────────────────────── rankingi ─────────────────────────

  const BOARD_SELECT =
    'SELECT b.player_id, p.nick, p.country, b.score, b.floor, b.combo, b.char_id, b.achieved_at, b.run_id, b.skin, ' +
    'EXISTS (SELECT 1 FROM run_chunks k WHERE k.run_id = b.run_id) AS has_replay, ' +
    'EXISTS (SELECT 1 FROM skins s WHERE s.hash = b.skin) AS has_skin ' +
    'FROM bests b JOIN players p ON p.id = b.player_id WHERE b.period = ? AND p.banned = 0 ' +
    'ORDER BY b.score DESC, b.achieved_at ASC, b.player_id ASC LIMIT ? OFFSET ?';
  const ROOM_BOARD_SELECT = BOARD_SELECT.replace('WHERE b.period = ?', 'WHERE b.period = ? AND p.room_id = ?')
    .replace(' LIMIT ? OFFSET ?', ` LIMIT ${ROOM_MAX_MEMBERS}`);
  const entry = (r: BoardRow, rank: number) => ({
    rank, nick: r.nick, tag: playerTag(r.player_id), score: r.score, floor: r.floor, combo: r.combo, char: r.char_id, country: r.country,
    // najlepsza trójka: identyfikator biegu do obejrzenia (GET /v1/replays/:id)
    ...(rank <= REPLAY_TOP && r.has_replay ? { replay: r.run_id } : {}),
    // i własna postać do wczytania w grze (GET /v1/skins/:hash)
    ...(rank <= REPLAY_TOP && r.skin && r.has_skin ? { skin: r.skin } : {}),
  });
  function periodParam(c: Ctx): string {
    const kind = c.req.param('period') ?? '';
    if (!isBoardKind(kind)) throw fail(404, 'not_found');
    return boardKey(kind, now());
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

  // ───────────────────────── pokoje znajomych ─────────────────────────

  /** Po wyjściu z pokoju (oldRoom) jego obiekt na żywo zamyka połączenia gracza – w tle, odpowiedź na to nie czeka. */
  function kickLater(c: Ctx, oldRoom: string | null, newRoom: string | null = null) {
    if (!oldRoom || oldRoom === newRoom) return;
    void later(c, kickFromRoom(c.env, oldRoom, c.var.player.id));
  }

  /** Wyjście gracza z pokoju; pusty pokój znika (zwalnia nazwę). */
  function leaveRoom(db: D1Database, p: Player): D1PreparedStatement[] {
    if (!p.room_id) return [];
    return [
      db.prepare('UPDATE players SET room_id = NULL WHERE id = ?').bind(p.id),
      db.prepare('DELETE FROM rooms WHERE id = ?1 AND NOT EXISTS (SELECT 1 FROM players WHERE room_id = ?1)').bind(p.room_id),
    ];
  }
  /** Wejście do pokoju roomId (z wyjściem z poprzedniego). */
  function enterRoom(db: D1Database, p: Player, roomId: string): D1PreparedStatement[] {
    return [
      db.prepare('UPDATE players SET room_id = ? WHERE id = ?').bind(roomId, p.id),
      ...(p.room_id && p.room_id !== roomId
        ? [db.prepare('DELETE FROM rooms WHERE id = ?1 AND NOT EXISTS (SELECT 1 FROM players WHERE room_id = ?1)').bind(p.room_id)]
        : []),
    ];
  }
  const memberCount = async (db: D1Database, roomId: string) =>
    (await db.prepare('SELECT COUNT(*) AS n FROM players WHERE room_id = ?').bind(roomId).first<{ n: number }>())!.n;

  // Nowy pokój: nazwa unikalna bez względu na wielkość liter, hasło trzymamy tylko jako skrót. Twórca od razu jest w środku.
  app.post('/v1/rooms', requirePlayer, async (c) => {
    const body = await readJson(c), p = c.var.player, db = c.env.DB;
    if (p.banned) throw fail(403, 'banned');
    if (!p.nick) throw fail(400, 'nick_required');          // znajomi muszą wiedzieć, kto jest w pokoju
    const name = checkRoomName(body.name);
    if (!name.ok) throw fail(400, `room_${name.reason}`);
    const pass = checkPassword(body.password);
    if (pass === null) throw fail(400, 'room_pass');
    const id = crypto.randomUUID(), salt = newSalt();
    try {
      await db.batch([
        db.prepare('INSERT INTO rooms (id, name, name_key, pass_salt, pass_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)')
          .bind(id, name.nick, name.key, salt, await passwordHash(pass, salt), now()),
        ...enterRoom(db, p, id),
      ]);
    } catch (e) {
      if (String(e).includes('UNIQUE')) throw fail(409, 'room_taken');
      throw e;
    }
    kickLater(c, p.room_id, id);
    return c.json({ room: { name: name.nick, members: 1 } }, 201);
  });

  // Dołączenie nazwą i hasłem. Gracz jest najwyżej w jednym pokoju – wejście do nowego to wyjście ze starego.
  app.post('/v1/rooms/join', requirePlayer, async (c) => {
    const body = await readJson(c), p = c.var.player, db = c.env.DB, t = now();
    if (p.banned) throw fail(403, 'banned');
    if (!p.nick) throw fail(400, 'nick_required');
    const name = checkRoomName(body.name);
    const room = name.ok
      ? await db.prepare('SELECT id, name, pass_salt, pass_hash, fail_window, fail_count FROM rooms WHERE name_key = ?').bind(name.key)
        .first<{ id: string; name: string; pass_salt: string; pass_hash: string; fail_window: number; fail_count: number }>()
      : null;
    if (!room) throw fail(404, 'room_not_found');
    if (room.id === p.room_id) return c.json({ room: { name: room.name, members: await memberCount(db, room.id) } });

    const win = Math.floor(t / ROOM_FAIL_WINDOW);
    if (room.fail_window === win && room.fail_count >= ROOM_FAIL_MAX) throw fail(429, 'room_locked');
    const pass = checkPassword(body.password);
    if (pass === null || !sameHash(room.pass_hash, await passwordHash(pass, room.pass_salt))) {
      await db.prepare('UPDATE rooms SET fail_count = CASE WHEN fail_window = ?1 THEN fail_count + 1 ELSE 1 END, fail_window = ?1 WHERE id = ?2')
        .bind(win, room.id).run();
      throw fail(403, 'room_password');
    }
    const n = await memberCount(db, room.id);
    if (n >= ROOM_MAX_MEMBERS) throw fail(409, 'room_full');
    await db.batch(enterRoom(db, p, room.id));
    kickLater(c, p.room_id, room.id);
    return c.json({ room: { name: room.name, members: n + 1 } });
  });

  app.delete('/v1/rooms/me', requirePlayer, async (c) => {
    const stmts = leaveRoom(c.env.DB, c.var.player);
    if (stmts.length) await c.env.DB.batch(stmts);
    kickLater(c, c.var.player.room_id);
    return c.body(null, 204);
  });

  /** Pokój gracza (nazwa) albo błąd 404 no_room. */
  async function myRoom(c: Ctx): Promise<{ id: string; name: string }> {
    const id = c.var.player.room_id;
    const room = id ? await c.env.DB.prepare('SELECT id, name FROM rooms WHERE id = ?').bind(id).first<{ id: string; name: string }>() : null;
    if (!room) throw fail(404, 'no_room');
    return room;
  }

  // Mój pokój i jego gracze (bez zablokowanych).
  app.get('/v1/rooms/me', requirePlayer, async (c) => {
    c.header('cache-control', 'private, no-store');
    const me = c.var.player.id;
    if (!c.var.player.room_id) return c.json({ room: null });
    const room = await myRoom(c);
    const { results } = await c.env.DB.prepare(
      'SELECT id, nick FROM players WHERE room_id = ? AND banned = 0 ORDER BY nick_key IS NULL, nick_key, id',
    ).bind(room.id).all<{ id: string; nick: string | null }>();
    return c.json({ room: { name: room.name, members: results.map((r) => ({ nick: r.nick, tag: playerTag(r.id), ...(r.id === me ? { me: true } : {}) })) } });
  });

  // Ranking pokoju: te same najlepsze wyniki co w rankingu ogólnym, tylko graczy z pokoju (wszyscy – pokój jest mały).
  app.get('/v1/rooms/me/leaderboards/:period', requirePlayer, async (c) => {
    c.header('cache-control', 'private, no-store');
    const period = periodParam(c), room = await myRoom(c), me = c.var.player.id;
    const { results } = await c.env.DB.prepare(ROOM_BOARD_SELECT).bind(period, room.id).all<BoardRow>();
    const entries = results.map((r, i) => ({ ...entry(r, i + 1), ...(r.player_id === me ? { me: true } : {}) }));
    return c.json({ period, room: { name: room.name }, rank: entries.find((e) => e.me)?.rank ?? null, entries });
  });

  // ───────────────────────── wyścigi w pokoju ─────────────────────────

  async function loadMatch(db: D1Database, id: string): Promise<MatchRow | null> {
    return db.prepare(`SELECT ${MATCH_COLS} FROM matches WHERE id = ?`).bind(id).first<MatchRow>();
  }
  /** Wyścig w postaci dla gry (bez ziarna – to przychodzi z biletem). */
  async function matchInfo(db: D1Database, m: MatchRow) {
    const by = await db.prepare('SELECT nick FROM players WHERE id = ?').bind(m.created_by).first<{ nick: string | null }>();
    return {
      id: m.id, scoring: m.scoring, minutes: m.minutes, startsAt: m.starts_at, endsAt: m.ends_at,
      by: { nick: by?.nick ?? null, tag: playerTag(m.created_by) },
    };
  }
  /** Najnowszy wyścig pokoju, który jeszcze trwa albo skończył się niedawno (wyniki, rewanż). */
  async function currentMatch(db: D1Database, roomId: string, t: number): Promise<MatchRow | null> {
    return db.prepare(`SELECT ${MATCH_COLS} FROM matches WHERE room_id = ? AND kind = 'race' AND ends_at > ? ORDER BY created_at DESC LIMIT 1`)
      .bind(roomId, t - MATCH_SHOW_MS).first<MatchRow>();
  }
  /** Zweryfikowane biegi wyścigu (gracze z blokadą się nie liczą). */
  async function matchRuns(db: D1Database, matchId: string): Promise<MatchRun[]> {
    return (await db.prepare(
      "SELECT r.player_id, r.score, r.ticks, r.floor, r.combo, r.issued_at, r.finished_at FROM runs r JOIN players p ON p.id = r.player_id " +
      "WHERE r.match_id = ? AND r.status = 'verified' AND p.banned = 0",
    ).bind(matchId).all<MatchRun>()).results;
  }

  // Zatwierdzenie biegu z wyścigu: do tabeli wyścigu, nie do rankingu. Znajomi dostają nowy wynik na żywo.
  async function finishMatchRun(c: Ctx, run: RunRow, state: SimState, sc: number, char: string, skin: string | null, body: Record<string, unknown>) {
    const db = c.env.DB, p = c.var.player, t = now();
    const m = run.match_id ? await loadMatch(db, run.match_id) : null;
    if (!m || t > m.ends_at + MATCH_GRACE_MS) return reject(c, run.id, 'match_closed');
    await db.batch([
      db.prepare(
        "UPDATE runs SET status = 'verified', checkpoint = NULL, finished_at = ?, updated_at = ?, score = ?, floor = ?, combo = ?, " +
        'char_id = ?, skin = ?, style_id = ?, control = ?, app_version = ? WHERE id = ?',
      ).bind(t, t, sc, state.maxFloor, state.bestCombo, char, skin, optText(body.style, 24), optText(body.control, 24), optText(body.appVersion, 32), run.id),
      db.prepare('DELETE FROM run_chunks WHERE run_id = ?').bind(run.id),   // bez powtórek
    ]);
    const table = standings(await matchRuns(db, m.id), m.scoring, budgetTicks(m));
    const mine = table.find((s) => s.player_id === p.id);
    const standing = { score: mine?.score ?? 0, runs: mine?.runs ?? 0, place: mine?.place ?? null };
    await later(c, (async () => {
      await sendRoomEvent(c.env, m.room_id, {
        t: 'ev', e: 'mscore', k: await liveKey(p.id), nick: p.nick, tag: playerTag(p.id), match: m.id, score: standing.score, runs: standing.runs, last: sc,
      });
    })().catch((e) => console.error('match score', e)));
    return c.json({ status: 'verified', score: sc, floor: state.maxFloor, combo: state.bestCombo, ticks: state.tick, match: { id: m.id, ...standing } });
  }

  // Nowy wyścig w moim pokoju. Naraz trwa najwyżej jeden – kto się spóźni, dostaje bieżący i do niego dołącza.
  app.post('/v1/rooms/me/matches', requirePlayer, async (c) => {
    const body = await readJson(c), p = c.var.player, db = c.env.DB, t = now();
    if (p.banned) throw fail(403, 'banned');
    if (!isMinutes(body.minutes) || !isScoring(body.scoring)) throw fail(400, 'bad_request');
    const room = await myRoom(c);
    const running = await currentMatch(db, room.id, t);
    if (running && running.ends_at > t) throw fail(409, 'match_running', { match: await matchInfo(db, running), now: t });
    const m: MatchRow = {
      id: crypto.randomUUID(), room_id: room.id, kind: 'race', scoring: body.scoring, seed: crypto.getRandomValues(new Uint32Array(1))[0],
      sim_version: SIM_VERSION, minutes: body.minutes, created_by: p.id, starts_at: t + MATCH_LEAD_MS,
      ends_at: t + MATCH_LEAD_MS + body.minutes * 60_000, created_at: t,
    };
    await db.prepare(`INSERT INTO matches (${MATCH_COLS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(m.id, m.room_id, m.kind, m.scoring, m.seed, m.sim_version, m.minutes, m.created_by, m.starts_at, m.ends_at, m.created_at).run();
    const info = { ...(await matchInfo(db, m)), by: { nick: p.nick, tag: playerTag(p.id) } };
    await later(c, (async () => { await sendRoomEvent(c.env, room.id, { t: 'ev', e: 'match', k: await liveKey(p.id), match: info, now: t }); })()
      .catch((e) => console.error('match', e)));
    return c.json({ match: info, now: t }, 201);
  });

  // Bieżący (albo niedawno skończony) wyścig mojego pokoju i czas serwera – gra ustawia według niego swój zegar wyścigu.
  app.get('/v1/rooms/me/match', requirePlayer, async (c) => {
    c.header('cache-control', 'private, no-store');
    const t = now(), db = c.env.DB;
    if (!c.var.player.room_id) return c.json({ match: null, now: t });
    const m = await currentMatch(db, c.var.player.room_id, t);
    return c.json({ match: m ? await matchInfo(db, m) : null, now: t });
  });

  // Tabela wyścigu. Po końcu wyścigu i czasie na wysłanie biegów jest ostateczna – pierwszy odczyt zapisuje ją w match_results.
  app.get('/v1/rooms/me/matches/:id', requirePlayer, async (c) => {
    c.header('cache-control', 'private, no-store');
    const db = c.env.DB, t = now(), me = c.var.player.id;
    const m = await loadMatch(db, c.req.param('id') ?? '');
    if (!m || m.room_id !== c.var.player.room_id) throw fail(404, 'match_not_found');
    const final = t > m.ends_at + MATCH_GRACE_MS;
    let table: { player_id: string; place: number; score: number; runs: number; floor: number; combo: number }[];
    const saved = final
      ? (await db.prepare('SELECT player_id, place, score, runs, floor, combo FROM match_results WHERE match_id = ? ORDER BY place').bind(m.id).all<typeof table[number]>()).results
      : [];
    if (saved.length) table = saved;
    else {
      table = standings(await matchRuns(db, m.id), m.scoring, budgetTicks(m));
      if (final && table.length) {
        const ins = db.prepare('INSERT OR IGNORE INTO match_results (match_id, player_id, place, score, runs, floor, combo) VALUES (?, ?, ?, ?, ?, ?, ?)');
        await db.batch(table.map((s) => ins.bind(m.id, s.player_id, s.place, s.score, s.runs, s.floor, s.combo)));
      }
    }
    const ids = table.map((s) => s.player_id);
    const nicks = new Map(ids.length
      ? (await db.prepare(`SELECT id, nick FROM players WHERE id IN (${ids.map(() => '?').join(', ')})`).bind(...ids).all<{ id: string; nick: string | null }>()).results.map((r) => [r.id, r.nick])
      : []);
    return c.json({
      match: await matchInfo(db, m), final, now: t,
      entries: table.map((s) => ({
        place: s.place, nick: nicks.get(s.player_id) ?? null, tag: playerTag(s.player_id), score: s.score, runs: s.runs, floor: s.floor, combo: s.combo,
        ...(s.player_id === me ? { me: true } : {}),
      })),
    });
  });

  // ───────────────────────── powtórki ─────────────────────────

  // Zapis biegu do obejrzenia w grze: ziarno wieży + porcje sterowania. Zapis się nie zmienia, więc może długo leżeć w cache.
  app.get('/v1/replays/:id', async (c) => {
    const id = c.req.param('id'), db = c.env.DB;
    const run = await db.prepare(
      'SELECT r.id, r.seed, r.sim_version, r.next_seq, r.ticks, r.score, r.floor, r.combo, r.char_id, r.style_id, r.finished_at, ' +
      'EXISTS (SELECT 1 FROM skins s WHERE s.hash = r.skin) AS has_skin, r.skin, ' +
      'p.id AS player_id, p.nick, p.banned FROM runs r JOIN players p ON p.id = r.player_id WHERE r.id = ? AND r.status = \'verified\'',
    ).bind(id).first<{
      id: string; seed: number; sim_version: number; next_seq: number; ticks: number; score: number; floor: number; combo: number;
      char_id: string; style_id: string | null; finished_at: number; player_id: string; nick: string | null; banned: number;
      skin: string | null; has_skin: number;
    }>();
    if (!run || run.banned) throw fail(404, 'not_found');
    const { results } = await db.prepare('SELECT seq, data FROM run_chunks WHERE run_id = ? ORDER BY seq').bind(id).all<{ seq: number; data: ArrayBuffer | number[] }>();
    if (results.length !== run.next_seq || results.some((r, i) => r.seq !== i)) throw fail(404, 'not_found');
    c.header('cache-control', 'public, max-age=86400');
    return c.json({
      runId: run.id, seed: run.seed, simVersion: run.sim_version, ticks: run.ticks, score: run.score, floor: run.floor, combo: run.combo,
      char: run.char_id, style: run.style_id, nick: run.nick, tag: playerTag(run.player_id), finishedAt: run.finished_at,
      ...(run.skin && run.has_skin ? { skin: run.skin } : {}),
      chunks: results.map((r) => toB64(new Uint8Array(r.data))),
    });
  });

  // ───────────────────────── własne postacie ─────────────────────────

  // Paczka postaci z najlepszej trójki: serwer przyjmie ją tylko od gracza, którego wynik w rankingu jest rozegrany tą postacią,
  // i tylko gdy skrót zgadza się z zawartością. Zawartości (obrazków) nie rozpakowuje – gra sprawdza ją przy wczytaniu.
  app.put('/v1/skins/:hash', requirePlayer, async (c) => {
    const hash = c.req.param('hash') ?? '', db = c.env.DB, p = c.var.player;
    if (!HASH_RE.test(hash)) throw fail(404, 'not_found');
    if (p.banned) throw fail(403, 'banned');
    const data = await readCapped(c.req.raw, MAX_SKIN_BYTES);
    if (data.length < 4 || data[0] !== 0x50 || data[1] !== 0x4b || data[2] !== 3 || data[3] !== 4) throw fail(400, 'bad_skin');
    if ((await sha256hex(data)) !== hash) throw fail(400, 'hash_mismatch');
    if (!(await db.prepare('SELECT 1 FROM bests WHERE player_id = ? AND skin = ?').bind(p.id, hash).first())) throw fail(403, 'not_needed');
    await db.prepare('INSERT OR IGNORE INTO skins (hash, player_id, data, created_at) VALUES (?, ?, ?, ?)').bind(hash, p.id, data, now()).run();
    return c.json({ hash }, 201);
  });

  // Pobranie paczki postaci. Zawartość pod danym skrótem nigdy się nie zmienia, więc może leżeć w cache bez końca.
  app.get('/v1/skins/:hash', async (c) => {
    const hash = c.req.param('hash') ?? '';
    if (!HASH_RE.test(hash)) throw fail(404, 'not_found');
    const row = await c.env.DB.prepare('SELECT s.data FROM skins s JOIN players p ON p.id = s.player_id WHERE s.hash = ? AND p.banned = 0')
      .bind(hash).first<{ data: ArrayBuffer | number[] }>();
    if (!row) throw fail(404, 'not_found');
    return c.body(new Uint8Array(row.data), 200, { 'content-type': 'application/zip', 'cache-control': 'public, max-age=31536000, immutable' });
  });

  return app;
}
