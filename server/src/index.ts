// Punkt wejścia Workera: API (fetch), połączenia na żywo z pokojami (/v1/live) i dobowe sprzątanie bazy (scheduled).
import { createApp } from './app';
import { cleanup } from './cleanup';
import type { Env } from './env';
import { handleLive } from './live';

export { RoomHub } from './room-hub';

const app = createApp();

export default {
  // WebSocket pokoju omija Hono: odpowiedź 101 z gniazdem idzie prosto z Durable Object (bez nagłówków CORS)
  fetch: (req, env, ctx) => (new URL(req.url).pathname === '/v1/live' ? handleLive(req, env) : app.fetch(req, env, ctx)),
  scheduled(_event, env, ctx) {
    ctx.waitUntil(cleanup(env.DB, Date.now()));
  },
} satisfies ExportedHandler<Env>;
