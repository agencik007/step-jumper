// WYŚCIG w pokoju znajomych: kilka minut na tej samej wieży, kto zdobędzie więcej punktów, ten wygrywa.
// Ten plik to sesja wyścigu po stronie gry – zegar (czas serwera), bilety na kolejne biegi i tabela wyścigu.
// Ekrany i przejścia są w game.js (stan 'race'), rysowanie w render.js, serwer: server/src/match.ts.
import { online } from '../net';

/** Czas jako m:ss (zaokrąglony w górę – „0:01” do samego końca, „0:00” dopiero po nim). */
export function fmtClock(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Ten sam gracz w tabeli wyścigu i w zdarzeniach na żywo (serwer podaje oba przez nick i znacznik). */
const same = (a, b) => a.tag === b.tag && a.nick === b.nick;

export class Race {
  /** info – wyścig od serwera (MatchInfo): id, scoring, minutes, startsAt, endsAt, by. */
  constructor(info) {
    this.info = info;
    /** Tabela: [{ place, nick, tag, score, runs, floor?, combo?, me? }] – z serwera, uzupełniana zdarzeniami na żywo. */
    this.table = [];
    this.final = false;                  // tabela ostateczna (po czasie na wysłanie ostatnich biegów)
    this.ticket = null;                  // bilet na następny bieg (pobierany zawczasu – restart bez czekania na sieć)
    this.fetching = null;
    this.noTicket = false;               // serwer nie wydał biletu (brak sieci albo wyścig się skończył)
    this.pollT = -Infinity;              // ostatnie pobranie tabeli (czas gry, s)
    this.loading = false;
    this.started = false;                // pierwszy bieg już ruszył (komunikat START! tylko raz)
  }

  get id() { return this.info.id; }
  /** ms do startu (ujemne – już po starcie) i do końca wyścigu, w zegarze serwera. */
  get toStart() { return this.info.startsAt - online.serverNow(); }
  get left() { return this.info.endsAt - online.serverNow(); }
  get over() { return this.left <= 0; }

  /** Bilet na następny bieg w tle (jeden w zapasie). */
  prefetch() {
    if (this.ticket || this.fetching || this.over) return;
    this.fetching = online.matchTicket(this.id).then((t) => {
      this.fetching = null; this.ticket = t; this.noTicket = !t;
      return t;
    });
  }
  /** Bilet z zapasu (null – jeszcze go nie ma); od razu zamawia następny. */
  takeTicket() {
    const t = this.ticket;
    this.ticket = null;
    if (t) this.prefetch();
    return t;
  }

  /** Tabela z serwera (online.matchResults); now – czas gry, żeby nie pytać częściej niż co every s. */
  async refresh(now, every = 2) {
    if (this.loading || now - this.pollT < every) return;
    this.pollT = now; this.loading = true;
    const r = await online.matchResults(this.id);
    this.loading = false;
    if (!r || r.match.id !== this.id) return;
    this.info = r.match;
    this.table = r.entries;
    this.final = r.final;
  }

  /** Mój zweryfikowany bieg (odpowiedź serwera: match – mój wynik w wyścigu, liczba biegów, miejsce). */
  applyMine(m) {
    if (!m || m.id !== this.id) return;
    const me = { nick: online.nick, tag: online.tag, me: true };
    this.upsert(me, m.score, m.runs);
  }

  /**
   * Zweryfikowany bieg kogoś z pokoju (zdarzenie 'mscore' na żywo). Zwraca true, gdy ten gracz właśnie objął
   * prowadzenie (do komunikatu „prowadzi”).
   */
  applyScore(ev) {
    if (ev.match !== this.id) return false;
    const leader = this.table[0];
    this.upsert({ nick: ev.nick, tag: ev.tag }, ev.score, ev.runs);
    return !!this.table[0] && same(this.table[0], ev) && (!leader || !same(leader, ev));
  }

  upsert(who, score, runs) {
    const e = this.table.find((x) => (who.me ? x.me : same(x, who)));
    if (e) { e.score = score; e.runs = runs; } else this.table.push({ ...who, score, runs, place: 0 });
    // kolejność jak na serwerze: wynik malejąco; remisy zostają w dotychczasowej kolejności (kto pierwszy, ten wyżej)
    this.table.sort((a, b) => b.score - a.score);
    this.table.forEach((x, i) => { x.place = i + 1; });
  }

  /** Mój wiersz w tabeli (null – jeszcze żaden bieg nie dotarł). */
  get mine() { return this.table.find((e) => e.me) ?? null; }

  /** Do HUD: najlepsza trójka, a pod nią ja, jeśli jestem niżej. */
  top(n = 3) {
    const top = this.table.slice(0, n), me = this.mine;
    return me && me.place > n ? [...top, me] : top;
  }
}
