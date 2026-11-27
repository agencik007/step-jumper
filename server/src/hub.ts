// Obecność w pokoju znajomych: kto jest teraz w grze i co robi (menu / bieg z piętrem i wynikiem).
//
// Jeden Durable Object na pokój (room-hub.ts) trzyma WebSockety wszystkich obecnych. Ta klasa to cała logika bez
// Cloudflare, żeby dało się ją sprawdzić w testach na udawanych gniazdach. Stan gracza jest w „załączniku” gniazda
// (serializeAttachment), bo uśpiony (hibernowany) obiekt zapomina pamięć, a załączniki przeżywają uśpienie.
//
// Protokół (JSON):
//   gra → serwer:  {t:'status', s:'menu'|'play', floor?, score?}   {t:'ping'}   {t:'ev', e:'floor'|'combo', n}
//   serwer → gra:  {t:'list', me, players:[P]}  (po połączeniu)     {t:'up', p:P}     {t:'bye', k}
//                  {t:'ev', e:'floor'|'combo', n, k, nick, tag}  – zdarzenie z biegu znajomego (od jego gry)
//                  {t:'ev', e:'score', k, nick, tag, score, floor, best, roomBest, over:[k]}  – wynik zweryfikowany przez serwer
//   P = {k, nick, tag, s, floor?, score?}  (k – stały, nieodwracalny klucz gracza; tag – jak w rankingu)
// Wynik i piętro w trakcie biegu oraz zdarzenia 'floor' / 'combo' podaje gra – serwer ich nie sprawdza. To tylko podgląd;
// ranking i zdarzenie 'score' biorą się z weryfikacji biegu (app.ts → /v1/runs/:id/finish → HUB_EVENT).

/** Wewnętrzne adresy obiektu pokoju (woła go tylko Worker – z zewnątrz nie da się ich trafić). */
export const HUB_CONNECT = 'https://room/connect', HUB_KICK = 'https://room/kick', HUB_EVENT = 'https://room/event';

export type Status = 'menu' | 'play';
export interface Player { k: string; nick: string | null; tag: string; s: Status; floor?: number; score?: number }
/** Załącznik gniazda: gracz, jego stan i chwila ostatniej wiadomości. */
export interface Att extends Player { pid: string; seen: number; last: number; evAt?: number }
/** Zdarzenia z biegu, które gra może ogłosić znajomym (piętro co setkę, duże combo). */
export const EVENTS = ['floor', 'combo'] as const;
/** Zdarzenie od gry najwyżej co tyle ms z jednego gniazda. */
export const EVENT_MIN_MS = 1_000;

/** To, czego hub potrzebuje od gniazda (WebSocket z Workers ma te metody). */
export interface HubSocket {
  send(msg: string): void;
  close(code?: number, reason?: string): void;
  serializeAttachment(v: unknown): void;
  deserializeAttachment(): unknown;
}

/** Gniazdo bez żadnej wiadomości (także ping) przez tyle ms uznajemy za martwe – np. telefon zgasł bez pożegnania. */
export const STALE_MS = 75_000;
/** Gra wysyła ping co tyle ms, gdy nie ma nic innego do powiedzenia. */
export const PING_MS = 30_000;
/** Zmiana stanu najwyżej co tyle ms z jednego gniazda – częstsze są pomijane (gra i tak wysyła rzadziej). */
export const STATUS_MIN_MS = 1_000;
/** Najwyżej tyle gniazd w pokoju (50 graczy, część na dwóch urządzeniach). */
export const MAX_SOCKETS = 100;
const MAX_MSG = 512;
const MAX_FLOOR = 1_000_000, MAX_SCORE = 1_000_000_000;

const att = (ws: HubSocket) => ws.deserializeAttachment() as Att | null;
const pub = (a: Att): Player => ({
  k: a.k, nick: a.nick, tag: a.tag, s: a.s, ...(a.s === 'play' ? { floor: a.floor ?? 0, score: a.score ?? 0 } : {}),
});
const okNum = (v: unknown, max: number) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= max;

export class Hub {
  /** sockets() – wszystkie gniazda pokoju (ctx.getWebSockets()); now – zegar (testy go podmieniają). */
  constructor(private readonly sockets: () => HubSocket[], private readonly now: () => number = Date.now) {}

  /** Czy pokój przyjmie jeszcze jedno gniazdo. */
  get hasRoom(): boolean { return this.live().length < MAX_SOCKETS; }

  /** Nowe gniazdo gracza (już przyjęte przez acceptWebSocket): lista dla niego, nowina dla reszty. */
  join(ws: HubSocket, who: { pid: string; k: string; nick: string | null; tag: string }): void {
    const t = this.now();
    ws.serializeAttachment({ ...who, s: 'menu', seen: t, last: 0 } satisfies Att);
    this.sweep();
    ws.send(JSON.stringify({ t: 'list', me: who.k, players: this.players() }));
    this.broadcast({ t: 'up', p: this.player(who.k)! }, ws);
  }

  message(ws: HubSocket, raw: string | ArrayBuffer): void {
    const a = att(ws);
    if (!a || typeof raw !== 'string' || raw.length > MAX_MSG) return;
    let m: Record<string, unknown>;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m !== 'object') return;
    const t = this.now();
    a.seen = t;
    if (m.t === 'ev' && (EVENTS as readonly unknown[]).includes(m.e) && okNum(m.n, MAX_FLOOR) && (m.n as number) > 0 && t - (a.evAt ?? 0) >= EVENT_MIN_MS) {
      a.evAt = t;
      ws.serializeAttachment(a);
      this.event({ t: 'ev', e: m.e, n: m.n, k: a.k, nick: a.nick, tag: a.tag });
    } else if (m.t === 'status' && (m.s === 'menu' || m.s === 'play') && t - a.last >= STATUS_MIN_MS) {
      a.s = m.s; a.last = t;
      if (m.s === 'play') { a.floor = okNum(m.floor, MAX_FLOOR) ? (m.floor as number) : 0; a.score = okNum(m.score, MAX_SCORE) ? (m.score as number) : 0; }
      else { delete a.floor; delete a.score; }
      ws.serializeAttachment(a);
      this.broadcast({ t: 'up', p: this.player(a.k)! });
    } else {
      ws.serializeAttachment(a);                       // ping (albo nieznana wiadomość): tylko „żyję”
    }
    this.sweep();
  }

  /** Gniazdo się zamknęło (albo zostało zamknięte przez serwer). */
  close(ws: HubSocket): void {
    const a = att(ws);
    if (!a) return;
    ws.serializeAttachment(null);                      // od teraz to gniazdo się nie liczy
    const p = this.player(a.k);                        // gracz może mieć jeszcze inne urządzenie
    this.broadcast(p ? { t: 'up', p } : { t: 'bye', k: a.k });
  }

  /** Zdarzenie gracza msg.k dla wszystkich pozostałych w pokoju (jego własne urządzenia go nie dostają). */
  event(msg: { k: string } & Record<string, unknown>): void {
    const s = JSON.stringify(msg);
    for (const ws of this.live()) if (att(ws)!.k !== msg.k) { try { ws.send(s); } catch { /* zamyka się */ } }
  }

  /** Gracz wyszedł z pokoju (albo usunął konto): zamykamy wszystkie jego gniazda. */
  kick(pid: string): void {
    for (const ws of this.live()) if (att(ws)!.pid === pid) { this.close(ws); try { ws.close(4001, 'left'); } catch { /* już zamknięte */ } }
  }

  /** Lista obecnych: jeden wpis na gracza (z kilku urządzeń bierzemy to, które odezwało się ostatnio). */
  players(): Player[] {
    const best = new Map<string, Att>();
    for (const ws of this.live()) { const a = att(ws)!; const b = best.get(a.k); if (!b || a.seen > b.seen) best.set(a.k, a); }
    return [...best.values()].map(pub);
  }

  private player(k: string): Player | null { return this.players().find((p) => p.k === k) ?? null; }

  private live(): HubSocket[] { return this.sockets().filter((ws) => att(ws)); }

  /** Zamyka gniazda, które milczą dłużej niż STALE_MS. */
  private sweep(): void {
    const t = this.now();
    for (const ws of this.live()) {
      if (t - att(ws)!.seen <= STALE_MS) continue;
      this.close(ws);
      try { ws.close(4000, 'stale'); } catch { /* już zamknięte */ }
    }
  }

  private broadcast(msg: object, except?: HubSocket): void {
    const s = JSON.stringify(msg);
    for (const ws of this.live()) if (ws !== except) { try { ws.send(s); } catch { /* zamyka się – obsłuży close */ } }
  }
}
