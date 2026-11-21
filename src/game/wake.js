// Ekran nie gaśnie w trakcie biegu i powtórki (Screen Wake Lock API) – w każdym trybie sterowania, także przy grze
// padem albo klawiaturą, kiedy nikt nie dotyka ekranu. Poza grą blokada jest zwalniana; przeglądarka sama ją zdejmuje,
// gdy karta schodzi w tło, a gra wtedy i tak przechodzi w pauzę.
let sentinel = null, want = false, asking = false;

export async function keepAwake(on) {
  want = on;
  if (!on) {
    const s = sentinel; sentinel = null;
    s?.release().catch(() => {});
    return;
  }
  if (sentinel || asking || typeof navigator === 'undefined' || !navigator.wakeLock) return;
  asking = true;
  try {
    const s = await navigator.wakeLock.request('screen');
    s.addEventListener('release', () => { if (sentinel === s) sentinel = null; });
    if (want) sentinel = s; else s.release().catch(() => {});
  } catch { /* odmowa (np. tryb oszczędzania energii) – gramy dalej bez blokady */ } finally { asking = false; }
}
