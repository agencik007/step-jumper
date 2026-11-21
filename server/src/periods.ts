// Okresy rankingu. Klucze są tekstami, które sortują się jak daty – sprzątanie usuwa po prostu klucze „mniejsze” od progu.
const DAY = 86_400_000;
const pad = (n: number) => String(n).padStart(2, '0');

export type PeriodKind = 'all' | 'week' | 'day';

/** Dzień w UTC, np. 'D:2026-11-18'. */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  return `D:${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Tydzień ISO 8601 w UTC (od poniedziałku), np. 'W:2026-47'. Rok to rok czwartku danego tygodnia. */
export function weekKey(ms: number): string {
  const d = new Date(ms);
  const fromMonday = (d.getUTCDay() + 6) % 7;
  const thursday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - fromMonday + 3);
  const year = new Date(thursday).getUTCFullYear();
  const week = 1 + Math.floor((thursday - Date.UTC(year, 0, 1)) / DAY / 7);
  return `W:${year}-${pad(week)}`;
}

export function periodKey(kind: PeriodKind, ms: number): string {
  return kind === 'all' ? 'all' : kind === 'week' ? weekKey(ms) : dayKey(ms);
}

/** Wszystkie okresy, do których liczy się wynik osiągnięty w chwili ms. */
export function periodKeys(ms: number): Record<PeriodKind, string> {
  return { all: 'all', week: weekKey(ms), day: dayKey(ms) };
}

export function isPeriodKind(s: string): s is PeriodKind {
  return s === 'all' || s === 'week' || s === 'day';
}

/** Rankingi, które da się obejrzeć: okresy, do których trafiają wyniki, oraz zamknięty już poprzedni tydzień. */
export type BoardKind = PeriodKind | 'lastweek';

export function isBoardKind(s: string): s is BoardKind {
  return isPeriodKind(s) || s === 'lastweek';
}

/** Klucz okresu rankingu; 'lastweek' to tydzień ISO sprzed 7 dni. */
export function boardKey(kind: BoardKind, ms: number): string {
  return kind === 'lastweek' ? weekKey(ms - 7 * DAY) : periodKey(kind, ms);
}
