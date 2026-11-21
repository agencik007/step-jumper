// Nowa wersja gry: build zapisuje obok strony version.json ({ version, build }, vite.config.js). Gra co jakiś czas go
// pobiera i gdy „build” jest inny niż jej własny (__BUILD_ID__), ustawia update.available – ekran tytułowy pokazuje
// wtedy przycisk PRZEŁADUJ. Tylko w buildzie produkcyjnym (w trybie deweloperskim Vite sam przeładowuje stronę).

/** Wersja tej gry (package.json). */
export const VERSION = __APP_VERSION__;

/** available – wersja na serwerze, gdy jest nowsza niż ta w pamięci przeglądarki (null = brak). */
export const update = { available: null };

const CHECK_EVERY = 5 * 60_000;       // ms
let lastCheck = 0;

async function check() {
  if (update.available || !navigator.onLine) return;
  lastCheck = Date.now();
  try {
    const res = await fetch(`version.json?t=${lastCheck}`, { cache: 'no-store' });
    if (!res.ok) return;
    const v = await res.json();
    if (typeof v?.build === 'string' && v.build !== __BUILD_ID__) update.available = String(v.version ?? '');
  } catch { /* bez sieci albo stara kopia z pamięci – spróbujemy później */ }
}

/** Sprawdza przy starcie, po powrocie do karty / sieci i co 5 minut. */
export function initUpdateCheck() {
  if (!import.meta.env.PROD) return;
  setTimeout(check, 3000);
  setInterval(check, CHECK_EVERY);
  const soon = () => { if (Date.now() - lastCheck > 30_000) check(); };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) soon(); });
  addEventListener('online', soon);
}

let reloading = false;
/** PRZEŁADUJ: service worker pobiera swoją nową wersję, potem strona wczytuje się od nowa (już z nowym kodem). */
export async function reloadForUpdate() {
  if (reloading) return;
  reloading = true;
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    await Promise.race([reg?.update(), new Promise((r) => setTimeout(r, 1500))]);
  } catch { /* przeładowanie i tak pobierze stronę z sieci */ }
  location.reload();
}
