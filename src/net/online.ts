// Klient rankingu online: konto urządzenia, zapas biletów na biegi i kolejka wysyłek, która przeżywa brak sieci.
//
// Gra nigdy nie czeka na sieć:
//  - bilet (ziarno wieży od serwera) bierze się z zapasu natychmiast; bez biletu bieg jest po prostu poza rankingiem,
//  - zakończony bieg trafia najpierw do kolejki w pamięci urządzenia, a dopiero potem jest wysyłany;
//    jeśli sieć zawiedzie, wysyłka wznowi się przy następnej okazji (od porcji, na której stanęła).
// Protokół: server/README.md.
import { SIM_VERSION, decodeInputs, encodeInputs } from '../sim';
import { sha256hex } from '../../server/src/auth';
import { weekKey } from '../../server/src/periods';

const DAY = 86_400_000;
export const TICKET_RESERVE = 3;
/** Serwer kasuje niewykorzystane bilety po 7 dniach – klient wyrzuca je dzień wcześniej. */
export const TICKET_MAX_AGE = 6 * DAY;
const MAX_QUEUE = 20;
const TIMEOUT_MS = 10_000;
const KEY = { account: 'sj.account', tickets: 'sj.tickets', queue: 'sj.queue', enabled: 'sj.online', crown: 'sj.crown', skins: 'sj.skins', room: 'sj.room' };
/** Paczka własnej postaci: najwyżej tyle bajtów (jak MAX_SKIN_BYTES na serwerze). */
export const MAX_SKIN_BYTES = 1_500_000;
const HASH_RE = /^[0-9a-f]{64}$/;

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
  skin?: string;     // skrót paczki własnej postaci do pobrania (tylko najlepsza trójka, char = 'custom')
}
export interface Board { period: string; entries: Entry[] }
export interface Around extends Board { rank: number | null }

export type SubmitResult =
  | { status: 'verified'; score: number; floor: number; combo: number; ticks: number; improved: Record<PeriodKind, boolean>; ranks: Record<PeriodKind, number>; needSkin?: boolean }
  | { status: 'queued' }                       // brak sieci – wyślę później
  | { status: 'rejected'; reason: string };    // serwer nie przyjął biegu (albo bieg przepadł razem z kontem)

export interface FinishedRun { ticket: Ticket; ticks: Uint8Array; score: number; char: string; style: string; control: string; skin?: string }

/** Zapis biegu do obejrzenia: ziarno wieży + wejście w każdym kroku fizyki. */
export interface Replay {
  runId: string; seed: number; simVersion: number; score: number; floor: number; combo: number;
  char: string; style: string | null; nick: string | null; tag: string; ticks: Uint8Array;
  skin: string | null;   // skrót paczki własnej postaci (char = 'custom'), jeśli serwer ją ma
}

/** Pokój znajomych, w którym jest gracz (najwyżej jeden). */
export interface Room { name: string }
export interface RoomMember { nick: string | null; tag: string; me?: boolean }
export type RoomResult = { ok: true; room: Room } | { ok: false; error: string };
/** Ranking pokoju w tym samym kształcie co ogólny: najlepsi (top) i moje miejsce (me). */
export interface RoomBoard { top: Board; me: Around }

/** Korona za miejsce 1–3 w zamkniętym tygodniu; nosi się ją przez cały następny tydzień. */
export interface Crown { week: string; rank: number }

interface Account { playerId: string; token: string; nick: string | null }
interface QueuedRun { runId: string; chunks: string[]; nextSeq: number; score: number; char: string; style: string; control: string; appVersion: string; skin?: string }

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
  /** Serwer odpowiedział na ostatnie zapytanie (false: brak sieci albo jeszcze nie pytaliśmy). */
  reachable = false;
  /** Wersja symulacji, którą deklaruje klient (pole, żeby testy mogły udawać starą aplikację). */
  simVersion = SIM_VERSION;
  /** Wywoływane dla każdego biegu, który opuścił kolejkę (także wysłanego później, po powrocie sieci). */
  onResult: ((r: SubmitResult, runId: string) => void) | null = null;
  /**
   * Bajty paczki własnej postaci o danym skrócie (gra trzyma je w IndexedDB). Serwer prosi o paczkę, gdy bieg tą postacią
   * wejdzie do najlepszej trójki; null – gra już jej nie ma.
   */
  skinSource: ((hash: string) => Promise<Uint8Array | null>) | null = null;

  private loaded = false;               // dopóki init() nie wczyta pamięci, klient nic nie wysyła
  private account: Account | null = null;
  private list: Ticket[] = [];
  private queue: QueuedRun[] = [];
  private results = new Map<string, SubmitResult>();
  private crownSaved: Crown | null = null;
  private roomSaved: Room | null = null;
  private skinsWaiting: string[] = [];   // paczki postaci, o które prosił serwer, a których nie udało się jeszcze wysłać
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
    this.roomSaved = parse<Room | null>(await s.get(KEY.room), null);
    this.skinsWaiting = parse<string[]>(await s.get(KEY.skins), []).filter((h) => HASH_RE.test(h));
    this.dropStaleTickets();
    this.loaded = true;
  }

  /** Pamięć urządzenia wczytana (do tego czasu nie wiadomo, czy gracz ma konto i nick). */
  get ready(): boolean { return this.loaded; }
  get tickets(): number { return this.list.length; }
  get pending(): number { return this.queue.length; }
  get nick(): string | null { return this.account?.nick ?? null; }
  get hasAccount(): boolean { return !!this.account; }
  /** Token konta (połączenie na żywo z pokojem podaje go sam – live.ts); null bez konta. */
  get token(): string | null { return this.account?.token ?? null; }
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
    this.queue.push({
      runId: ticket.runId, chunks, nextSeq: 0, score: run.score, char: run.char, style: run.style, control: run.control, appVersion: this.o.appVersion,
      ...(run.skin && HASH_RE.test(run.skin) ? { skin: run.skin } : {}),
    });
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

  /** Paczka własnej postaci z najlepszej trójki (ZIP); null bez sieci, gdy jej nie ma albo gdy nie zgadza się skrót. */
  async skinPack(hash: string): Promise<Uint8Array | null> {
    if (!HASH_RE.test(hash)) return null;
    try {
      const r = await this.fetchFn(`${this.o.baseUrl}/v1/skins/${hash}`, { signal: AbortSignal.timeout(TIMEOUT_MS * 3) });
      if (r.status !== 200) return null;
      const data = new Uint8Array(await r.arrayBuffer());
      if (data.length > MAX_SKIN_BYTES) return null;
      return (await sha256hex(data)) === hash ? data : null;
    } catch { return null; }
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
        char: d.char, style: d.style ?? null, nick: d.nick ?? null, tag: d.tag, ticks, skin: typeof d.skin === 'string' && HASH_RE.test(d.skin) ? d.skin : null,
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

  // ───────────────────────── pokoje znajomych ─────────────────────────

  /** Mój pokój znajomych (zapamiętany na urządzeniu, odświeżany przez roomInfo) albo null. */
  get room(): Room | null { return this.enabled && this.account ? this.roomSaved : null; }

  /** Nowy pokój o unikalnej nazwie z hasłem; gracz od razu w nim jest (i wychodzi z poprzedniego). */
  createRoom(name: string, password: string): Promise<RoomResult> { return this.roomCall('/v1/rooms', name, password); }
  /** Dołączenie do pokoju nazwą i hasłem. */
  joinRoom(name: string, password: string): Promise<RoomResult> { return this.roomCall('/v1/rooms/join', name, password); }

  /** Wyjście z pokoju. False = brak sieci, nic nie zmieniono. */
  async leaveRoom(): Promise<boolean> {
    if (!this.account) { await this.saveRoom(null); return true; }
    try {
      const r = await this.req('DELETE', '/v1/rooms/me', { auth: true });
      if (r.status === 401) await this.forgetAccount();
      else if (r.status !== 204) return false;
    } catch { return false; }
    await this.saveRoom(null);
    return true;
  }

  /** Mój pokój i jego gracze prosto z serwera (przy okazji odświeża zapamiętany pokój); null bez sieci i bez pokoju. */
  async roomInfo(): Promise<(Room & { members: RoomMember[] }) | null> {
    if (!this.enabled || !this.account) return null;
    try {
      const r = await this.req('GET', '/v1/rooms/me', { auth: true });
      if (r.status === 401) { await this.forgetAccount(); return null; }
      if (r.status !== 200) return null;
      const room = r.data.room as (Room & { members: RoomMember[] }) | null;
      await this.saveRoom(room ? { name: room.name } : null);
      return room;
    } catch { return null; }
  }

  /** Ranking mojego pokoju; null bez sieci albo poza pokojem (wtedy zapomina pokój). */
  async roomBoard(kind: BoardKind): Promise<RoomBoard | null> {
    if (!this.enabled || !this.account) return null;
    try {
      const r = await this.req('GET', `/v1/rooms/me/leaderboards/${kind}`, { auth: true });
      if (r.status === 401) { await this.forgetAccount(); return null; }
      if (r.status === 404 && r.data?.error === 'no_room') { await this.saveRoom(null); return null; }
      if (r.status !== 200) return null;
      const d = r.data as { period: string; room: Room; rank: number | null; entries: Entry[] };
      if (d.room.name !== this.roomSaved?.name) await this.saveRoom(d.room);
      return { top: { period: d.period, entries: d.entries }, me: { period: d.period, rank: d.rank, entries: d.entries.filter((e) => e.me) } };
    } catch { return null; }
  }

  private async roomCall(path: string, name: string, password: string): Promise<RoomResult> {
    if (!this.loaded || !this.enabled) return { ok: false, error: 'offline' };
    try {
      if (!(await this.ensureAccount())) return { ok: false, error: 'offline' };
      const r = await this.req('POST', path, { auth: true, json: { name, password } });
      if (r.status === 200 || r.status === 201) {
        await this.saveRoom({ name: r.data.room.name });
        return { ok: true, room: this.roomSaved! };
      }
      if (r.status === 401) await this.forgetAccount();
      return { ok: false, error: r.data?.error ?? 'error' };
    } catch { return { ok: false, error: 'offline' }; }
  }

  private async saveRoom(room: Room | null): Promise<void> {
    this.roomSaved = room;
    if (room) await this.o.store.set(KEY.room, JSON.stringify(room)); else await this.o.store.remove(KEY.room);
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
    this.account = null; this.list = []; this.queue = []; this.results.clear(); this.crownSaved = null; this.skinsWaiting = []; this.roomSaved = null;
    const s = this.o.store;
    await Promise.all([s.remove(KEY.account), s.remove(KEY.tickets), s.remove(KEY.queue), s.remove(KEY.crown), s.remove(KEY.skins), s.remove(KEY.room)]);
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
    try { await this.sendWaitingSkins(); } catch (err) { if (err instanceof Offline) return; throw err; }
    while (this.queue.length) {
      const e = this.queue[0];
      let result: SubmitResult | 'retry';
      try { result = await this.sendOne(e); } catch (err) { if (err instanceof Offline) return; throw err; }
      if (result === 'retry') { await this.saveQueue(); return; }
      this.queue.shift();
      await this.saveQueue();
      this.results.set(e.runId, result);
      if (result.status === 'verified' && result.needSkin && e.skin) await this.queueSkin(e.skin);
      this.onResult?.(result, e.runId);
    }
  }

  /** Serwer prosi o paczkę postaci (bieg wszedł do trójki): wysyłka od razu, a bez sieci – przy następnej okazji. */
  private async queueSkin(hash: string): Promise<void> {
    if (!this.skinsWaiting.includes(hash)) this.skinsWaiting.push(hash);
    while (this.skinsWaiting.length > 5) this.skinsWaiting.shift();
    await this.o.store.set(KEY.skins, JSON.stringify(this.skinsWaiting));
    try { await this.sendWaitingSkins(); } catch (err) { if (!(err instanceof Offline)) throw err; }
  }

  private async sendWaitingSkins(): Promise<void> {
    while (this.skinsWaiting.length && this.account) {
      const hash = this.skinsWaiting[0];
      const data = await this.skinSource?.(hash).catch(() => null) ?? null;
      if (data) {
        const r = await this.req('PUT', `/v1/skins/${hash}`, { auth: true, body: data, type: 'application/zip' });
        if (r.status >= 500 || r.status === 429) return;          // spróbujemy później
      }
      this.skinsWaiting.shift();                                  // wysłana albo nie do wysłania (brak paczki, odmowa)
      await this.o.store.set(KEY.skins, JSON.stringify(this.skinsWaiting));
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
      auth: true, json: { score: e.score, char: e.char, style: e.style, control: e.control, appVersion: e.appVersion, ...(e.skin ? { skin: e.skin } : {}) },
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
    await Promise.all([this.o.store.remove(KEY.account), this.saveTickets(), this.saveRoom(null)]);
  }

  private async req(method: string, path: string, o: { auth?: boolean; json?: unknown; body?: Uint8Array; type?: string } = {}): Promise<{ status: number; data: any }> {
    const headers: Record<string, string> = {};
    if (o.auth && this.account) headers.authorization = `Bearer ${this.account.token}`;
    let body: BodyInit | undefined;
    if (o.json !== undefined) { headers['content-type'] = 'application/json'; body = JSON.stringify(o.json); }
    if (o.body) { headers['content-type'] = o.type ?? 'application/octet-stream'; body = o.body as BodyInit; }
    let res: Response;
    try {
      // cache: no-store – gra sama trzyma ranking 30 s, a po zmianie nicku albo nowym wyniku musi zobaczyć świeże dane
      res = await this.fetchFn(this.o.baseUrl + path, { method, headers, body, cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      this.reachable = false;
      throw new Offline();
    }
    this.reachable = true;
    const text = await res.text().catch(() => '');
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* nie-JSON, np. strona błędu */ }
    return { status: res.status, data };
  }

  private saveAccount() { return this.o.store.set(KEY.account, JSON.stringify(this.account)); }
  private saveTickets() { return this.o.store.set(KEY.tickets, JSON.stringify(this.list)); }
  private saveQueue() { return this.o.store.set(KEY.queue, JSON.stringify(this.queue)); }
}
