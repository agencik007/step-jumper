// Sprzątanie bazy, uruchamiane raz na dobę przez cron (wrangler.jsonc → triggers).
import { dayKey, weekKey } from './periods';

const DAY = 86_400_000;

export const TICKET_TTL = 7 * DAY;     // niewykorzystany bilet (gra offline może trochę poczekać na sieć)
export const UPLOAD_TTL = DAY;         // wysyłka przerwana w połowie
export const RUN_TTL = 90 * DAY;       // zweryfikowane i odrzucone biegi

export async function cleanup(db: D1Database, now: number): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM runs WHERE status = 'issued' AND issued_at < ?").bind(now - TICKET_TTL),
    db.prepare("DELETE FROM runs WHERE status = 'uploading' AND updated_at < ?").bind(now - UPLOAD_TTL),
    // biegi z rankingu (czyjś najlepszy wynik) zostają dłużej – są potrzebne do powtórek
    db.prepare("DELETE FROM runs WHERE status IN ('verified', 'rejected') AND issued_at < ? AND id NOT IN (SELECT run_id FROM bests)").bind(now - RUN_TTL),
    // zostają bieżący i poprzedni tydzień oraz dzisiejszy i wczorajszy dzień
    db.prepare("DELETE FROM bests WHERE period LIKE 'W:%' AND period < ?").bind(weekKey(now - 7 * DAY)),
    db.prepare("DELETE FROM bests WHERE period LIKE 'D:%' AND period < ?").bind(dayKey(now - DAY)),
    // powtórki biegów, które nie są już niczyim najlepszym wynikiem
    db.prepare('DELETE FROM run_chunks WHERE run_id NOT IN (SELECT run_id FROM bests)'),
  ]);
}
