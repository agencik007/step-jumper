// Połączenie na żywo z pokojem znajomych: GET /v1/live (WebSocket) → Durable Object pokoju (room-hub.ts).
//
// Przeglądarka nie pozwala dodać nagłówka Authorization do WebSocketu, a token w adresie trafiałby do logów.
// Dlatego gra podaje token jako drugi „podprotokół”: new WebSocket(url, ['sj', token]).
import { parseBearer, sameHash, sha256hex } from './auth';
import type { Env } from './env';
import { HUB_CONNECT, HUB_EVENT, HUB_KICK } from './hub';

const json = (status: number, error: string) => new Response(JSON.stringify({ error }), { status, headers: { 'content-type': 'application/json' } });

/** Stały klucz gracza na liście obecnych: nie zdradza identyfikatora konta. */
export const liveKey = async (pid: string) => (await sha256hex(`live:${pid}`)).slice(0, 16);

export async function handleLive(req: Request, env: Env): Promise<Response> {
  if (req.headers.get('upgrade')?.toLowerCase() !== 'websocket') return json(426, 'websocket_required');
  const origin = req.headers.get('origin');
  if (origin && !(env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).includes(origin)) return json(403, 'origin');
  if (!env.ROOMS) return json(503, 'no_live');

  const protos = (req.headers.get('sec-websocket-protocol') ?? '').split(',').map((s) => s.trim());
  const cred = protos[0] === 'sj' ? parseBearer(`Bearer ${protos[1] ?? ''}`) : null;
  if (!cred) return json(401, 'unauthorized');
  const p = await env.DB.prepare('SELECT id, token_hash, nick, banned, room_id FROM players WHERE id = ?').bind(cred.id)
    .first<{ id: string; token_hash: string; nick: string | null; banned: number; room_id: string | null }>();
  if (!p || !sameHash(p.token_hash, await sha256hex(cred.secret))) return json(401, 'unauthorized');
  if (p.banned) return json(403, 'banned');
  if (!p.room_id) return json(404, 'no_room');

  const who = { pid: p.id, k: await liveKey(p.id), nick: p.nick, tag: p.id.slice(0, 4).toUpperCase() };
  const stub = env.ROOMS.get(env.ROOMS.idFromName(p.room_id));
  return stub.fetch(HUB_CONNECT, { headers: { upgrade: 'websocket', 'x-player': JSON.stringify(who) } });
}

/** Gracz wyszedł z pokoju albo usunął konto: pokój zamyka jego połączenia. Błąd nie psuje zapytania, które to wywołało. */
export async function kickFromRoom(env: Env, roomId: string, pid: string): Promise<void> {
  if (!env.ROOMS) return;
  try {
    await env.ROOMS.get(env.ROOMS.idFromName(roomId)).fetch(HUB_KICK, { method: 'POST', body: JSON.stringify({ pid }) });
  } catch (e) {
    console.error('kick', e);
  }
}

/** Zdarzenie dla wszystkich w pokoju (np. zweryfikowany wynik). Błąd nie psuje zapytania, które to wywołało. */
export async function roomEvent(env: Env, roomId: string, msg: { k: string } & Record<string, unknown>): Promise<void> {
  if (!env.ROOMS) return;
  try {
    await env.ROOMS.get(env.ROOMS.idFromName(roomId)).fetch(HUB_EVENT, { method: 'POST', body: JSON.stringify(msg) });
  } catch (e) {
    console.error('room event', e);
  }
}
