// Punkt wejścia Workera: API (fetch) i dobowe sprzątanie bazy (scheduled).
import { createApp } from './app';
import { cleanup } from './cleanup';
import type { Env } from './env';

const app = createApp();

export default {
  fetch: app.fetch,
  scheduled(_event, env, ctx) {
    ctx.waitUntil(cleanup(env.DB, Date.now()));
  },
} satisfies ExportedHandler<Env>;
