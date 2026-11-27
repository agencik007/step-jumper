/** Powiązania Workera skonfigurowane w wrangler.jsonc. */
export interface Env {
  DB: D1Database;
  /** Limit zakładania kont na adres IP (Cloudflare Rate Limiting). */
  RL_NEW_PLAYER?: RateLimit;
  /** Lista stron (origin) oddzielonych przecinkami, z których przeglądarka może wołać API. */
  ALLOWED_ORIGINS?: string;
}

export interface Player {
  id: string;
  nick: string | null;
  banned: number;
  created_at: number;
  /** Pokój znajomych, w którym jest gracz (najwyżej jeden), albo null. */
  room_id: string | null;
}
