// Klient rankingu online: konto urządzenia, zapas biletów na biegi i kolejka wysyłek, która przeżywa brak sieci.
//
// Gra nigdy nie czeka na sieć:
//  - bilet (ziarno wieży od serwera) bierze się z zapasu natychmiast; bez biletu bieg jest po prostu poza rankingiem,
//  - zakończony bieg trafia najpierw do kolejki w pamięci urządzenia, a dopiero potem jest wysyłany;
//    jeśli sieć zawiedzie, wysyłka wznowi się przy następnej okazji (od porcji, na której stanęła).
// Protokół: server/README.md.
import { SIM_VERSION, decodeInputs, encodeInputs } from '../sim';
import { weekKey } from '../../server/src/periods';

const DAY = 86_400_000;
export const TICKET_RESERVE = 3;
/** Serwer kasuje niewykorzystane bilety po 7 dniach – klient wyrzuca je dzień wcześniej. */
export const TICKET_MAX_AGE = 6 * DAY;
const MAX_QUEUE = 20;
const TIMEOUT_MS = 10_000;
const KEY = { account: 'sj.account', tickets: 'sj.tickets', queue: 'sj.queue', enabled: 'sj.online', crown: 'sj.crown' };

/** Trwała pamięć klucz–wartość: localStorage w przeglądarce, Capacitor Preferences w aplikacji, Map w testach. */
export interface Store {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export class MemoryStore implements Store {
  private m = new Map<string, string>();
  async get(k: string) { return this.m.get(k) ?? null; }
  async set(k: string, v: string) { this.m.set(k, v); }
  async remove(k: string) { this.m.delete(k); }
}

// localStorage opisany ręcznie, żeby ten plik nie zależał od typów DOM (testy sprawdzają go razem z serwerem)
interface WebStorage { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }
const ls = (): WebStorage | undefined => (globalThis as { localStorage?: WebStorage }).localStorage;

/** localStorage; w trybie prywatnym albo przy zablokowanych danych strony po prostu nic nie pamięta. */
export class LocalStore implements Store {
  async get(k: string) { try { return ls()?.getItem(k) ?? null; } catch { return null; } }
  async set(k: string, v: string) { try { ls()?.setItem(k, v); } catch { /* brak miejsca lub zakaz */ } }
  async remove(k: string) { try { ls()?.removeItem(k); } catch { /* jw. */ } }
}

export interface Ticket { runId: string; seed: number; simVersion: number; chunkTicks: number; issuedAt: number }

export type PeriodKind = 'all' | 'week' | 'day';
/** Rankingi do obejrzenia: okresy wyników i zamknięty poprzedni tydzień. */
export type BoardKind = PeriodKind | 'lastweek';
export interface Entry {
  rank: number; nick: string | null; tag: string; score: number; floor: number; combo: number; char: string; country: string | null; me?: boolean;
  replay?: string;   // identyfikator powtórki (tylko najlepsza trójka)
}
export interface Board { period: string; entries: Entry[] }
export interface Around extends Board { rank: number | null }

export type SubmitResult =
  | { status: 'verified'; score: number; floor: number; combo: number; ticks: number; improved: Record<PeriodKind, boolean>; ranks: Record<PeriodKind, number> }
  | { status: 'queued' }                       // brak sieci – wyślę później
  | { status: 'rejected'; reason: string };    // serwer nie przyjął biegu (albo bieg przepadł razem z kontem)

export interface FinishedRun { ticket: Ticket; ticks: Uint8Array; score: number; char: string; style: string; control: string }

/** Zapis biegu do obejrzenia: ziarno wieży + wejście w każdym kroku fizyki. */
export interface Replay {
  runId: string; seed: number; simVersion: number; score: number; floor: number; combo: number;
  char: string; style: string | null; nick: string | null; tag: string; ticks: Uint8Array;
}

/** Korona za miejsce 1–3 w zamkniętym tygodniu; nosi się ją przez cały następny tydzień. */
export interface Crown { week: string; rank: number }

interface Account { playerId: string; token: string; nick: string | null }
interface QueuedRun { runId: string; chunks: string[]; nextSeq: number; score: number; char: string; style: string; control: string; appVersion: string }

export interface OnlineOptions {
  baseUrl: string;
  store: Store;
  platform: 'web' | 'android';
  appVersion: string;
  fetch?: typeof fetch;
  now?: () => number;
}

class Offline extends Error {}

const toB64 = (b: Uint8Array) => { let s = ''; for (const x of b) s += String.fromCharCode(x); return btoa(s); };
const fromB64 = (s: string) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));
function parse<T>(s: string | null, def: T): T { try { return s ? (JSON.parse(s) as T) : def; } catch { return def; } }

export class Online {
  enabled = true;
  /** Serwer liczy już nowszą wersją symulacji – trzeba zaktualizować grę (przeładować stronę). */
  outdated = false;
  /**
   * Serwer liczy jeszcze starszą wersją symulacji niż ta gra – zwykle to chwila między wdrożeniem gry a wdrożeniem
   * serwera. Klient nie blokuje się na stałe: każde uzupełnianie biletów pyta serwer ponownie.
   */
  serverBehind = false;
  /** Wersja symulacji, którą deklaruje klient (pole, żeby testy mogły udawać starą aplikację). */
  simVersion = SIM_VERSION;
  /** Wywoływane dla każdego biegu, który opuścił kolejkę (także wysłanego później, po powrocie sieci). */
  onResult: ((r: SubmitResult, runId: string) => void) | null = null;

  private loaded = false;               // dopóki init() nie wczyta pamięci, klient nic nie wysyła
  private account: Account | null = null;
  private list: Ticket[] = [];
  private queue: QueuedRun[] = [];
  private results = new Map<string, SubmitResult>();
  private crownSaved: Crown | null = null;
  private refilling: Promise<void> | null = null;
  private flushing: Promise<void> | null = null;
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;

  constructor(private readonly o: OnlineOptions) {
    this.fetchFn = o.fetch ?? ((...a) => fetch(...a));
    this.now = o.now ?? Date.now;
  }

  async init(): Promise<void> {
    const s = this.o.store;
    this.enabled = (await s.get(KEY.enabled)) !== '0';
    this.account = parse<Account | null>(await s.get(KEY.account), null);
    this.list = parse<Ticket[]>(await s.get(KEY.tickets), []);
    this.queue = parse<QueuedRun[]>(await s.get(KEY.queue), []);
    this.crownSaved = parse<Crown | null>(await s.get(KEY.crown), null);
    this.dropStaleTickets();
    this.loaded = true;
  }

  /** Pamięć urządzenia wczytana (do tego czasu nie wiadomo, czy gracz ma konto i nick). */
  get ready(): boolean { return this.loaded; }
  get tickets(): number { return this.list.length; }
  get pending(): number { return this.queue.length; }
  get nick(): string | null { return this.account?.nick ?? null; }
  get hasAccount(): boolean { return !!this.account; }
  /** Znacznik gracza bez nicku – ten sam, który serwer podaje w rankingu (pole tag). */
  get tag(): string | null { return this.account ? this.account.playerId.slice(0, 4).toUpperCase() : null; }

  async setEnabled(on: boolean): Promise<void> {
    this.enabled = on;
    await this.o.store.set(KEY.enabled, on ? '1' : '0');
  }

  /** Bilet na bieg z zapasu – od razu, bez czekania na sieć. Null = bieg poza rankingiem. */
  takeTicket(): Ticket | null {
    if (!this.loaded || !this.enabled || this.outdated) return null;
    this.dropStaleTickets();
    const t = this.list.shift() ?? null;
    if (t) void this.saveTickets();
    void this.refill();
    return t;
  }

  /** Uzupełnia zapas biletów (zakłada konto, jeśli trzeba). Nie rzuca wyjątków. */
  refill(): Promise<void> {
    this.refilling ??= this.doRefill().finally(() => { this.refilling = null; });
    return this.refilling;
  }

  /** Dodaje bieg do kolejki i próbuje wysłać kolejkę. */
  async submit(run: FinishedRun): Promise<SubmitResult> {
    const { ticket } = run;
    const chunks: string[] = [];
    for (let i = 0; i < run.ticks.length; i += ticket.chunkTicks) chunks.push(toB64(encodeInputs(run.ticks.subarray(i, i + ticket.chunkTicks))));
    this.queue.push({ runId: ticket.runId, chunks, nextSeq: 0, score: run.score, char: run.char, style: run.style, control: run.control, appVersion: this.o.appVersion });
    while (this.queue.length > MAX_QUEUE) this.queue.shift();
    await this.saveQueue();
    await this.flush();
    return this.results.get(ticket.runId) ?? { status: 'queued' };
  }

  /** Wysyła wszystko, co czeka w kolejce. Przy braku sieci zostawia resztę na później. Nie rzuca wyjątków. */
  flush(): Promise<void> {
    this.flushing ??= this.doFlush().finally(() => { this.flushing = null; });
    return this.flushing;
  }

  /** Tydzień, którego najlepsza trójka nosi teraz korony (klucz 'W:2026-47'). */
  get crownWeek(): string { return weekKey(this.now() - 7 * DAY); }

  /** Moja korona na ten tydzień: miejsce 1–3 w zeszłym tygodniu albo null. Działa bez sieci (zapamiętana). */
  get crown(): number | null {
    const c = this.crownSaved;
    return this.enabled && this.account && c && c.week === this.crownWeek && c.rank >= 1 && c.rank <= 3 ? c.rank : null;
  }

  /**
   * Wyniki zamkniętego, poprzedniego tygodnia: najlepsi i moje miejsce. Przy okazji zapamiętuje koronę.
   * Null bez sieci.
   */
  async lastWeek(limit = 10): Promise<{ top: Board; me: Around | null } | null> {
    const [top, me] = await Promise.all([this.leaderboard('lastweek', limit), this.around('lastweek')]);
    if (!top) return null;
    if (me && this.account) {
      this.crownSaved = { week: me.period, rank: me.rank ?? 0 };
      await this.o.store.set(KEY.crown, JSON.stringify(this.crownSaved));
    }
    return { top, me };
  }

  /** Powtórka biegu z rankingu; null bez sieci, gdy jej nie ma albo gdy zapis jest uszkodzony. */
  async replay(runId: string): Promise<Replay | null> {
    try {
      const r = await this.req('GET', `/v1/replays/${encodeURIComponent(runId)}`);
      if (r.status !== 200) return null;
      const d = r.data, parts = (d.chunks as string[]).map((b) => decodeInputs(fromB64(b)));
      const ticks = new Uint8Array(parts.reduce((n, x) => n + x.length, 0));
      let at = 0;
      for (const x of parts) { ticks.set(x, at); at += x.length; }
      return {
        runId: d.runId, seed: d.seed, simVersion: d.simVersion, score: d.score, floor: d.floor, combo: d.combo,
        char: d.char, style: d.style ?? null, nick: d.nick ?? null, tag: d.tag, ticks,
      };
    } catch { return null; }
  }

  async leaderboard(kind: BoardKind, limit = 50): Promise<Board | null> {
    if (!this.enabled) return null;
    try {
      const r = await this.req('GET', `/v1/leaderboards/${kind}?limit=${limit}`);
      return r.status === 200 ? (r.data as Board) : null;
    } catch { return null; }
  }

  /** Moje miejsce z sąsiadami; null bez konta albo bez sieci. */
  async around(kind: BoardKind): Promise<Around | null> {
    if (!this.enabled || !this.account) return null;
    try {
      const r = await this.req('GET', `/v1/leaderboards/${kind}/me`, { auth: true });
      if (r.status === 401) { await this.forgetAccount(); return null; }
      return r.status === 200 ? (r.data as Around) : null;
    } catch { return null; }
  }

  async setNick(nick: string): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!this.loaded) return { ok: false, error: 'offline' };
    try {
      if (!(await this.ensureAccount())) return { ok: false, error: 'offline' };
      const r = await this.req('PATCH', '/v1/me', { auth: true, json: { nick } });
      if (r.status === 200) {
        this.account!.nick = r.data.nick;
        await this.saveAccount();
        return { ok: true };
      }
      if (r.status === 401) await this.forgetAccount();
      return { ok: false, error: r.data?.error ?? 'error' };
    } catch { return { ok: false, error: 'offline' }; }
  }

  /** Usuwa konto i wyniki z serwera oraz wszystkie dane rankingu z urządzenia. False = brak sieci, nic nie zmieniono. */
  async deleteData(): Promise<boolean> {
    if (!this.loaded) return false;
    await this.refilling; await this.flushing;
    if (this.account) {
      try {
        const r = await this.req('DELETE', '/v1/me', { auth: true });
        if (r.status !== 204 && r.status !== 401) return false;
      } catch { return false; }
    }
    this.account = null; this.list = []; this.queue = []; this.results.clear(); this.crownSaved = null;
    const s = this.o.store;
    await Promise.all([s.remove(KEY.account), s.remove(KEY.tickets), s.remove(KEY.queue), s.remove(KEY.crown)]);
    return true;
  }

  // ───────────────────────── wnętrze ─────────────────────────

  private dropStaleTickets(): void {
    const t = this.now();
    this.list = this.list.filter((k) => k.simVersion === this.simVersion && t - k.issuedAt < TICKET_MAX_AGE);
  }

  private async doRefill(): Promise<void> {
    if (!this.loaded || !this.enabled || this.outdated) return;
    try {
      for (let guard = 0; this.list.length < TICKET_RESERVE && guard < TICKET_RESERVE + 2; guard++) {
        if (!(await this.ensureAccount())) return;
        const r = await this.req('POST', '/v1/runs', { auth: true, json: { simVersion: this.simVersion } });
        if (r.status === 201) {
          this.serverBehind = false;
          this.list.push({ runId: r.data.runId, seed: r.data.seed, simVersion: r.data.simVersion, chunkTicks: r.data.chunkTicks, issuedAt: this.now() });
          await this.saveTickets();
        } else if (r.status === 409 && r.data?.error === 'update_required') {
          if (Number(r.data.simVersion) < this.simVersion) { this.serverBehind = true; return; }   // to serwer jest stary – spróbujemy później
          this.outdated = true; this.list = []; await this.saveTickets();
          return;
        } else if (r.status === 401) {
          await this.forgetAccount();          // konto zniknęło z serwera – w następnym obrocie załóż nowe
        } else {
          return;                              // limit, blokada albo błąd serwera – spróbujemy przy następnym biegu
        }
      }
    } catch (e) {
      if (!(e instanceof Offline)) throw e;
    }
  }

  private async doFlush(): Promise<void> {
    if (!this.loaded || !this.enabled) return;
    while (this.queue.length) {
      const e = this.queue[0];
      let result: SubmitResult | 'retry';
      try { result = await this.sendOne(e); } catch (err) { if (err instanceof Offline) return; throw err; }
      if (result === 'retry') { await this.saveQueue(); return; }
      this.queue.shift();
      await this.saveQueue();
      this.results.set(e.runId, result);
      this.onResult?.(result, e.runId);
    }
  }

  private async sendOne(e: QueuedRun): Promise<SubmitResult | 'retry'> {
    if (!this.account) return { status: 'rejected', reason: 'lost' };
    const final = (r: { status: number; data: any }): SubmitResult | 'retry' | null => {
      if (r.status === 422) return { status: 'rejected', reason: r.data?.reason ?? 'rejected' };
      if (r.status === 409 && r.data?.error === 'run_closed') return { status: 'rejected', reason: 'run_closed' };
      if (r.status === 404 || r.status === 401) return { status: 'rejected', reason: 'lost' };
      return null;
    };
    while (e.nextSeq < e.chunks.length) {
      const r = await this.req('PUT', `/v1/runs/${e.runId}/chunks/${e.nextSeq}`, { auth: true, body: fromB64(e.chunks[e.nextSeq]) });
      if (r.status === 200 || (r.status === 409 && r.data?.error === 'seq')) {
        e.nextSeq = r.data.nextSeq;
        await this.saveQueue();
        continue;
      }
      return final(r) ?? 'retry';
    }
    const r = await this.req('POST', `/v1/runs/${e.runId}/finish`, {
      auth: true, json: { score: e.score, char: e.char, style: e.style, control: e.control, appVersion: e.appVersion },
    });
    if (r.status === 200) return r.data as SubmitResult;
    return final(r) ?? 'retry';
  }

  /** Zwraca konto, zakładając je w razie potrzeby; false, gdy serwer odmówił (limit). Brak sieci → Offline. */
  private async ensureAccount(): Promise<boolean> {
    if (this.account) return true;
    const r = await this.req('POST', '/v1/players', { json: { platform: this.o.platform } });
    if (r.status !== 201) return false;
    this.account = { playerId: r.data.playerId, token: r.data.token, nick: null };
    await this.saveAccount();
    return true;
  }

  private async forgetAccount(): Promise<void> {
    this.account = null; this.list = [];
    await Promise.all([this.o.store.remove(KEY.account), this.saveTickets()]);
  }

  private async req(method: string, path: string, o: { auth?: boolean; json?: unknown; body?: Uint8Array } = {}): Promise<{ status: number; data: any }> {
    const headers: Record<string, string> = {};
    if (o.auth && this.account) headers.authorization = `Bearer ${this.account.token}`;
    let body: BodyInit | undefined;
    if (o.json !== undefined) { headers['content-type'] = 'application/json'; body = JSON.stringify(o.json); }
    if (o.body) { headers['content-type'] = 'application/octet-stream'; body = o.body as BodyInit; }
    let res: Response;
    try {
      // cache: no-store – gra sama trzyma ranking 30 s, a po zmianie nicku albo nowym wyniku musi zobaczyć świeże dane
      res = await this.fetchFn(this.o.baseUrl + path, { method, headers, body, cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      throw new Offline();
    }
    const text = await res.text().catch(() => '');
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* nie-JSON, np. strona błędu */ }
    return { status: res.status, data };
  }

  private saveAccount() { return this.o.store.set(KEY.account, JSON.stringify(this.account)); }
  private saveTickets() { return this.o.store.set(KEY.tickets, JSON.stringify(this.list)); }
  private saveQueue() { return this.o.store.set(KEY.queue, JSON.stringify(this.queue)); }
}
