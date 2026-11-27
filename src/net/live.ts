// Pokój znajomych na żywo: WebSocket do serwera (GET /v1/live → Durable Object pokoju, server/src/hub.ts).
// Daje listę obecnych graczy pokoju i ich stan (w menu / w biegu z piętrem i wynikiem) i wysyła stan tego gracza,
// a także zdarzenia z biegów: od gier znajomych (piętro, combo) i od serwera (zweryfikowany wynik, rekord, wyprzedzenie).
//
// Oszczędnie, bo każda wiadomość do serwera kosztuje: stan biegu najwyżej co PLAY_EVERY_MS i tylko gdy się zmienił,
// ping dopiero po PING_MS ciszy. Gra zamyka połączenie, gdy karta jest w tle (gracza i tak wtedy nie ma).

/** Jak w server/src/hub.ts (Player) – osobna kopia, bo ten plik idzie do przeglądarki. */
export interface LivePlayer { k: string; nick: string | null; tag: string; s: 'menu' | 'play'; floor?: number; score?: number; me?: boolean }

/** Zdarzenie z biegu znajomego (jak w server/src/hub.ts). 'score' – wynik zweryfikowany przez serwer. */
export type LiveEvent =
  | { e: 'floor' | 'combo'; n: number; k: string; nick: string | null; tag: string }
  | { e: 'score'; k: string; nick: string | null; tag: string; score: number; floor: number; best: boolean; roomBest: boolean; over: string[] }
  /** Ktoś z pokoju założył wyścig (od serwera); now – czas serwera w chwili założenia. */
  | { e: 'match'; k: string; match: import('./online').MatchInfo; now: number }
  /** Zweryfikowany bieg w wyścigu: wynik gracza w tabeli wyścigu (score), liczba jego biegów i wynik tego biegu (last). */
  | { e: 'mscore'; k: string; nick: string | null; tag: string; match: string; score: number; runs: number; last: number };

/** Gra ogłasza znajomym każdą kolejną setkę pięter i combo od LIVE_COMBO pięter (zasady gry: RULE_VARS w rules.js). */
export const LIVE_FLOOR_EVERY = 100, LIVE_COMBO = 25;

export const PLAY_EVERY_MS = 5_000;
export const PING_MS = 30_000;          // jak PING_MS w hub.ts
const STATUS_GAP_MS = 1_100;           // trochę więcej niż STATUS_MIN_MS w hub.ts
const EVENT_GAP_MS = 1_100;            // jak wyżej – EVENT_MIN_MS
const MAX_EVENTS = 3;                  // zdarzeń czekających na wysłanie (starsze przepadają)
const RETRY_MIN_MS = 2_000, RETRY_MAX_MS = 60_000;
/** Kod zamknięcia od serwera: gracz wyszedł z pokoju – nie łączymy się ponownie. */
export const CLOSE_LEFT = 4001;

interface Sock {
  readyState: number; protocol: string;
  onopen: ((e: unknown) => void) | null; onclose: ((e: { code: number }) => void) | null;
  onmessage: ((e: { data: unknown }) => void) | null; onerror: ((e: unknown) => void) | null;
  send(s: string): void; close(code?: number): void;
}
type SockCtor = new (url: string, protocols: string[]) => Sock;

export interface LiveOptions {
  /** Adres ws(s)://…/v1/live. */
  url: string;
  /** Token konta (jak w nagłówku Authorization); null – brak konta. */
  token: () => string | null;
  WebSocket?: SockCtor;
  now?: () => number;
}

export class Live {
  /** Obecni gracze pokoju (z tym graczem – me: true), w kolejności dołączania. */
  players: LivePlayer[] = [];
  connected = false;
  /** Wywoływane po każdej zmianie listy albo połączenia. */
  onChange: (() => void) | null = null;
  /** Serwer zamknął połączenie, bo gracz nie jest już w pokoju (wyszedł na innym urządzeniu). */
  onLeft: (() => void) | null = null;
  /** Zdarzenie z biegu znajomego (nigdy własne). */
  onEvent: ((ev: LiveEvent) => void) | null = null;

  private ws: Sock | null = null;
  private want = false;
  private me: string | null = null;
  private status: { s: 'menu' | 'play'; floor: number; score: number } = { s: 'menu', floor: 0, score: 0 };
  private sent: { s: string; floor: number; score: number; at: number } | null = null;
  private lastSend = 0;
  private events: { e: 'floor' | 'combo'; n: number }[] = [];
  private eventAt = 0;
  private retryMs = RETRY_MIN_MS;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private tick: ReturnType<typeof setInterval> | null = null;
  private readonly Ws: SockCtor;
  private readonly now: () => number;

  constructor(private readonly o: LiveOptions) {
    this.Ws = o.WebSocket ?? (globalThis as unknown as { WebSocket: SockCtor }).WebSocket;
    this.now = o.now ?? Date.now;
  }

  /** Łączy (i potem sam wznawia połączenie). Nic nie robi, gdy już działa. */
  start(): void {
    this.want = true;
    if (!this.ws && !this.retryTimer) this.connect();
  }

  /** Rozłącza i nie wznawia. */
  stop(): void {
    this.want = false;
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    const ws = this.ws;
    this.ws = null;
    if (ws) { ws.onclose = null; try { ws.close(1000); } catch { /* już zamknięte */ } }
    this.down();
  }

  /** Nowe połączenie od zera (np. po zmianie nicku albo pokoju). */
  restart(): void { this.stop(); this.start(); }

  /** Stan tego gracza; wysyłany od razu przy zmianie menu ↔ bieg, a w biegu najwyżej co PLAY_EVERY_MS. */
  setStatus(s: 'menu' | 'play', floor = 0, score = 0): void {
    this.status = { s, floor: s === 'play' ? floor : 0, score: s === 'play' ? score : 0 };
    if (!this.sent || this.sent.s !== s) this.flush();
  }

  /** Zdarzenie z własnego biegu dla znajomych (piętro co setkę, duże combo). Bez połączenia – przepada. */
  event(e: 'floor' | 'combo', n: number): void {
    if (!this.connected) return;
    this.events.push({ e, n });
    if (this.events.length > MAX_EVENTS) this.events.shift();
    this.sendEvent();
  }

  private sendEvent(): void {
    // serwer przyjmuje zdarzenie najwyżej raz na sekundę z jednego gniazda – reszta czeka na następny takt
    if (!this.events.length || this.now() - this.eventAt < EVENT_GAP_MS) return;
    const ev = this.events.shift()!;
    this.send({ t: 'ev', e: ev.e, n: ev.n });
    this.eventAt = this.now();
  }

  /** Co sekundę (timer połączenia): zaległe zdarzenie, stan biegu albo ping. */
  pulse(): void {
    if (!this.connected) return;
    this.sendEvent();
    const t = this.now(), st = this.status, sent = this.sent;
    const changed = !sent || sent.s !== st.s || sent.floor !== st.floor || sent.score !== st.score;
    if (changed && (!sent || sent.s !== st.s || t - sent.at >= PLAY_EVERY_MS)) this.flush();
    else if (t - this.lastSend >= PING_MS) this.send({ t: 'ping' });
  }

  private flush(): void {
    // serwer przyjmuje zmianę stanu najwyżej raz na sekundę (STATUS_MIN_MS) – szybszą wyśle następny takt
    if (!this.connected || (this.sent && this.now() - this.sent.at < STATUS_GAP_MS)) return;
    const st = this.status;
    this.send(st.s === 'play' ? { t: 'status', s: 'play', floor: st.floor, score: st.score } : { t: 'status', s: 'menu' });
    this.sent = { ...st, at: this.now() };
  }

  private send(m: object): void {
    try { this.ws?.send(JSON.stringify(m)); this.lastSend = this.now(); } catch { /* zamyka się – obsłuży onclose */ }
  }

  private connect(): void {
    this.retryTimer = null;
    const token = this.o.token();
    if (!this.want || !token) return;
    let ws: Sock;
    try { ws = new this.Ws(this.o.url, ['sj', token]); } catch { this.retry(); return; }
    this.ws = ws;
    ws.onopen = () => {
      this.connected = true; this.retryMs = RETRY_MIN_MS; this.lastSend = this.now();
      this.sent = { s: 'menu', floor: 0, score: 0, at: 0 };   // serwer zaczyna od „menu” – wysyłamy tylko inny stan
      if (this.status.s !== 'menu') this.flush();
      this.tick ??= setInterval(() => this.pulse(), 1000);
    };
    ws.onmessage = (e) => this.receive(e.data);
    ws.onerror = () => { /* po błędzie zawsze przychodzi onclose */ };
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.down();
      if (e.code === CLOSE_LEFT) { this.want = false; this.onLeft?.(); return; }
      this.retry();
    };
  }

  private retry(): void {
    if (!this.want || this.retryTimer) return;
    this.retryTimer = setTimeout(() => this.connect(), this.retryMs);
    this.retryMs = Math.min(RETRY_MAX_MS, this.retryMs * 2);
  }

  private down(): void {
    if (this.tick) { clearInterval(this.tick); this.tick = null; }
    const was = this.connected || this.players.length;
    this.connected = false; this.players = []; this.me = null; this.sent = null; this.events = [];
    if (was) this.onChange?.();
  }

  private receive(data: unknown): void {
    let m: { t?: string; me?: string; players?: LivePlayer[]; p?: LivePlayer; k?: string };
    try { m = JSON.parse(String(data)); } catch { return; }
    if (m.t === 'ev') {
      const ev = m as unknown as LiveEvent;
      if (ev.k !== this.me && ['floor', 'combo', 'score', 'match', 'mscore'].includes(ev.e)) this.onEvent?.(ev);
      return;
    }
    if (m.t === 'list' && Array.isArray(m.players)) {
      this.me = m.me ?? null;
      this.players = m.players.map((p) => this.mark(p));
    } else if (m.t === 'up' && m.p) {
      const p = this.mark(m.p), i = this.players.findIndex((x) => x.k === p.k);
      if (i >= 0) this.players[i] = p; else this.players.push(p);
    } else if (m.t === 'bye' && m.k) {
      this.players = this.players.filter((x) => x.k !== m.k);
    } else return;
    this.onChange?.();
  }

  private mark(p: LivePlayer): LivePlayer { return p.k === this.me ? { ...p, me: true } : p; }

  /** Mój klucz na liście obecnych (gdy połączony) – po nim gra poznaje, że to mnie ktoś wyprzedził. */
  get myKey(): string | null { return this.me; }

  /** Gracz z listy obecnych, który odpowiada wierszowi rankingu (ten sam znacznik i nick). */
  find(e: { tag: string; nick: string | null }): LivePlayer | null {
    return this.players.find((p) => p.tag === e.tag && p.nick === e.nick) ?? null;
  }
}
