// Oszczędzanie baterii (OPCJE → Oszczędzanie baterii): obraz co drugą klatkę (najwyżej 30 kl./s) i ostrość płótna
// do 1,5× zamiast 3×. Fizyka liczy się dalej w stałych krokach (STEP), więc rozgrywka i zapis biegu się nie zmieniają.
// AUTO włącza oszczędzanie, gdy bateria ma ≤ 20% i telefon się nie ładuje (Battery API – Chrome na Androidzie;
// gdzie go nie ma, AUTO znaczy „wyłączone”).
export const POWER_MODES = ['off', 'auto', 'on'];
export const power = { mode: 'auto', low: false };
export const saving = () => power.mode === 'on' || (power.mode === 'auto' && power.low);
export const FPS_SAVE = 30, DPR_SAVE = 1.5;

let onChange = () => {};
/** Podpina Battery API; change() – po każdej zmianie, która może przełączyć oszczędzanie. */
export function initPower(change) {
  onChange = change;
  navigator.getBattery?.().then((b) => {
    const upd = () => { const low = !b.charging && b.level <= 0.2; if (low !== power.low) { power.low = low; onChange(); } };
    b.addEventListener?.('levelchange', upd);
    b.addEventListener?.('chargingchange', upd);
    upd();
  }).catch(() => {});
  onChange();
}
export function setPowerMode(m) {
  power.mode = POWER_MODES.includes(m) ? m : 'auto';
  onChange();
}
