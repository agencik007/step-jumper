// Wyścig w pokoju znajomych: kilka minut na tej samej wieży, kto zdobędzie więcej punktów, ten wygrywa.
//
// Tu jest cała logika bez bazy i bez Cloudflare (stałe, limit kroków biegu, budżet czasu, tabela wyników),
// żeby dało się ją sprawdzić w testach. Zapytania i API – app.ts, opis – server/README.md.
//
// Przebieg:
//   1. ktoś z pokoju zakłada wyścig (czas, punktacja); start za MATCH_LEAD_MS – odliczanie u wszystkich,
//   2. każdy bieg to bilet z ziarnem wyścigu (ta sama wieża dla wszystkich) i limitem kroków do końca wyścigu,
//   3. bieg kończy upadek albo koniec czasu – wtedy gra ucina bieg, a trwające combo zostaje zaliczone (timeUp w sim),
//   4. MATCH_GRACE_MS po końcu tabela jest ostateczna (czas na wysłanie ostatnich biegów) i trafia do match_results.
import { TICK_RATE } from '../../src/sim';

/** Do wyboru przy zakładaniu: tyle minut trwa wyścig. */
export const MATCH_MINUTES = [2, 3, 5, 10] as const;
/** Punktacja: najlepszy bieg albo suma wszystkich biegów z wyścigu. */
export const SCORINGS = ['best', 'sum'] as const;
export type Scoring = (typeof SCORINGS)[number];
/** Odliczanie przed startem: tyle ms od założenia wyścigu (zaproszenie zdąży dojść do wszystkich). */
export const MATCH_LEAD_MS = 15_000;
/** Po końcu wyścigu tyle ms na wysłanie ostatnich biegów; potem tabela jest ostateczna. */
export const MATCH_GRACE_MS = 20_000;
/** Bieg ucięty zegarem serwer przyjmie najwcześniej tyle ms przed końcem (różnica zegarów urządzenia i serwera). */
export const MATCH_CUT_EARLY_MS = 3_000;
/** Zakończony wyścig jest jeszcze tyle ms „bieżącym” wyścigiem pokoju (wyniki, rewanż). */
export const MATCH_SHOW_MS = 10 * 60_000;
/** Zapas budżetu czasu gracza ponad długość wyścigu (w krokach symulacji). */
export const BUDGET_SLACK_TICKS = 2 * TICK_RATE;
/** Wyścigi i ich wyniki leżą w bazie tyle ms po końcu (liga pokoju liczy bieżący i zeszły tydzień). */
export const MATCH_TTL = 15 * 86_400_000;

export interface MatchTimes { starts_at: number; ends_at: number; minutes: number }

export const isMinutes = (v: unknown): v is number => (MATCH_MINUTES as readonly unknown[]).includes(v);
export const isScoring = (v: unknown): v is Scoring => (SCORINGS as readonly unknown[]).includes(v);

/** Najwięcej kroków biegu z biletem wydanym w chwili issuedAt: tyle, ile zostało do końca wyścigu (od startu, nie od odliczania). */
export function maxTicks(m: MatchTimes, issuedAt: number): number {
  return Math.max(0, Math.ceil(((m.ends_at - Math.max(issuedAt, m.starts_at)) * TICK_RATE) / 1000));
}

/**
 * Budżet czasu gracza: łączna liczba kroków wszystkich jego biegów w wyścigu. Uczciwy gracz zawsze się w nim mieści
 * (biegi idą jeden po drugim, a wyścig trwa tyle minut), za to dwa urządzenia na jednym koncie grające naraz nie
 * podwoją SUMY biegów.
 */
export const budgetTicks = (m: MatchTimes) => m.minutes * 60 * TICK_RATE + BUDGET_SLACK_TICKS;

export interface MatchRun { player_id: string; score: number; ticks: number; floor: number; combo: number; issued_at: number; finished_at: number }
export interface Standing { player_id: string; score: number; runs: number; floor: number; combo: number; at: number; place: number }

/**
 * Tabela wyścigu z zweryfikowanych biegów. Biegi gracza liczą się w kolejności wydania biletów, póki mieszczą się
 * w budżecie czasu – nadmiarowe odpadają. Wynik: najlepszy bieg albo suma; remis wygrywa ten, kto osiągnął wynik
 * wcześniej (dla sumy – kto wcześniej skończył ostatni liczony bieg).
 */
export function standings(runs: MatchRun[], scoring: Scoring, budget: number): Standing[] {
  const by = new Map<string, MatchRun[]>();
  for (const r of runs) { const l = by.get(r.player_id); if (l) l.push(r); else by.set(r.player_id, [r]); }
  const out: Standing[] = [];
  for (const [player_id, list] of by) {
    list.sort((a, b) => a.issued_at - b.issued_at || a.finished_at - b.finished_at);
    let used = 0;
    const counted: MatchRun[] = [];
    for (const r of list) { if (used + r.ticks > budget) break; used += r.ticks; counted.push(r); }
    if (!counted.length) continue;
    const s: Standing = { player_id, score: 0, runs: counted.length, floor: 0, combo: 0, at: 0, place: 0 };
    for (const r of counted) {
      s.floor = Math.max(s.floor, r.floor); s.combo = Math.max(s.combo, r.combo);
      if (scoring === 'sum') { s.score += r.score; s.at = Math.max(s.at, r.finished_at); }
      else if (r.score > s.score || !s.at) { s.score = r.score; s.at = r.finished_at; }
    }
    out.push(s);
  }
  out.sort((a, b) => b.score - a.score || a.at - b.at || (a.player_id < b.player_id ? -1 : 1));
  out.forEach((s, i) => { s.place = i + 1; });
  return out;
}
