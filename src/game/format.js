// Liczby i daty w języku gracza: 12 345 / 12,345 / 12.345 i godzina zamknięcia rankingu w jego strefie czasowej.
import { lang } from './i18n.js';

const nums = new Map();
/** Liczba z separatorami tysięcy wg języka gry (inne wartości bez zmian). */
export function fmt(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return String(n ?? '');
  let f = nums.get(lang());
  if (!f) { f = new Intl.NumberFormat(lang()); nums.set(lang(), f); }
  return f.format(n);
}

const DAY = 86_400_000;
/**
 * Chwila zamknięcia rankingu dnia albo tygodnia – tak jak liczy serwer (server/src/periods.ts): dzień w UTC,
 * tydzień ISO od poniedziałku 00:00 UTC. Dla innych zakładek null.
 */
export function periodEnd(kind, now = Date.now()) {
  const d = new Date(now), y = d.getUTCFullYear(), m = d.getUTCMonth(), day = d.getUTCDate();
  if (kind === 'day') return Date.UTC(y, m, day + 1);
  if (kind === 'week') return Date.UTC(y, m, day - ((d.getUTCDay() + 6) % 7) + 7);
  return null;
}

/** Chwila zamknięcia w czasie gracza (np. „pon., 24 lis, 01:00”). */
export function fmtWhen(ms) {
  return new Intl.DateTimeFormat(lang(), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(ms);
}
/**
 * Ile zostało, po ludzku: „za 3 dni”, „za 26 godzin”, „za 12 minut”. Poniżej dwóch dni w godzinach – „jutro” przy
 * 26 godzinach byłoby mylące. Zawsze liczbą (numeric: 'always'), żeby nie było „jutro” ani „za dzień”.
 */
export function fmtLeft(ms, now = Date.now()) {
  const left = Math.max(0, ms - now), rtf = new Intl.RelativeTimeFormat(lang(), { numeric: 'always' });
  if (left >= 2 * DAY) return rtf.format(Math.floor(left / DAY), 'day');
  if (left >= 3_600_000) return rtf.format(Math.floor(left / 3_600_000), 'hour');
  return rtf.format(Math.max(1, Math.ceil(left / 60_000)), 'minute');
}
