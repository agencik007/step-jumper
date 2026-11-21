// Gamepady: wybór aktywnego pada, rozpoznanie rodzaju (Xbox / PlayStation / Nintendo / inny), odczyt przycisków
// i osi w jednym formacie oraz wibracje pada. Zasady sterowania (co który przycisk robi) są w input.js.
//
// Przyciski w układzie „standard” (Gamepad API) – numer oznacza położenie, a nie napis na padzie:
//   0 dolny, 1 prawy, 2 lewy, 3 górny (Xbox: A B X Y, PlayStation: ✕ ○ □ △, Nintendo: B A Y X),
//   4/5 bumpery, 6/7 spusty, 8 Select/View/Share, 9 Start/Menu/Options, 10/11 wciśnięte gałki,
//   12–15 krzyżak (góra, dół, lewo, prawo), 16 Home/PS.

export const BTN = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, SELECT: 8, START: 9, L3: 10, R3: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15, HOME: 16 };

/** Stan aktywnego pada po ostatnim odczycie. */
export const gpad = { index: -1, id: '', kind: 'generic', standard: true, buttons: [], ax: 0, ay: 0 };

/** Rodzaj pada z jego nazwy (producent: 054c Sony, 045e Microsoft, 057e Nintendo). */
export function padKind(id) {
  const s = String(id).toLowerCase();
  if (/045e|xbox|xinput|x-box/.test(s)) return 'xbox';
  if (/057e|nintendo|pro controller|joy-?con|switch/.test(s)) return 'nintendo';
  if (/054c|playstation|dualsense|dualshock|wireless controller|ps[345]/.test(s)) return 'ps';   // „Wireless Controller” to PS4 bez nazwy producenta
  return 'generic';
}

const list = () => {
  try { return navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : []; } catch { return []; }
};
const pressedOf = (p) => p.buttons.map((b) => !!b && (b.pressed || b.value > 0.5));
const busy = (p) => pressedOf(p).some(Boolean) || p.axes.slice(0, 4).some((a) => Math.abs(a) > 0.5);

/** Surowy pad o danym indeksie (do wibracji). */
export function activePad() { return list().find((p) => p.index === gpad.index) ?? null; }

/**
 * Odczytuje pady. Aktywny jest ten, którego ktoś ostatnio użył – przy kilku podłączonych
 * (np. pad i kierownica) gra słucha tego, na którym coś się dzieje.
 * Zwraca gpad albo null, gdy żadnego pada nie ma.
 */
export function readPad() {
  const pads = list();
  if (!pads.length) { gpad.index = -1; gpad.buttons = []; gpad.ax = gpad.ay = 0; return null; }
  let p = pads.find((q) => q.index === gpad.index);
  const other = pads.find((q) => q.index !== gpad.index && busy(q));
  if (!p || (other && !busy(p))) p = other ?? pads[0];
  if (p.index !== gpad.index || p.id !== gpad.id) {
    gpad.index = p.index; gpad.id = p.id; gpad.kind = padKind(p.id); gpad.standard = p.mapping === 'standard';
  }
  const b = pressedOf(p);
  while (b.length < 17) b.push(false);
  let ax = p.axes[0] || 0, ay = p.axes[1] || 0;
  if (!gpad.standard) {
    // pad bez układu „standard”: krzyżak bywa osiami 6/7 (Linux) albo „hatem” na osi 9 (Windows, DirectInput)
    let up = false, down = false, left = false, right = false;
    const hat = p.axes[9];
    if (hat !== undefined && Math.abs(hat) <= 1.01) {
      const k = Math.round((hat + 1) * 3.5);            // 0 góra, 1 góra-prawo, 2 prawo … 7 góra-lewo
      up = k === 0 || k === 1 || k === 7; right = k >= 1 && k <= 3; down = k >= 3 && k <= 5; left = k >= 5 && k <= 7;
    } else if (p.axes.length >= 8) {
      left = p.axes[6] < -0.5; right = p.axes[6] > 0.5; up = p.axes[7] < -0.5; down = p.axes[7] > 0.5;
    }
    b[BTN.UP] ||= up; b[BTN.DOWN] ||= down; b[BTN.LEFT] ||= left; b[BTN.RIGHT] ||= right;
  }
  gpad.buttons = b; gpad.ax = ax; gpad.ay = ay;
  return gpad;
}

/** Czy aktywny pad potrafi wibrować (Chrome: vibrationActuator, Firefox: hapticActuators). */
export function padRumbles() {
  const p = activePad();
  return !!(p && (p.vibrationActuator || p.hapticActuators?.length));
}
/** Wibracja pada: ms – czas, mag – siła 0…1. */
export function padRumble(ms, mag) {
  const p = activePad();
  if (!p || mag <= 0) return;
  try {
    if (p.vibrationActuator?.playEffect) {
      p.vibrationActuator.playEffect(p.vibrationActuator.type || 'dual-rumble', { startDelay: 0, duration: ms, weakMagnitude: mag, strongMagnitude: mag * 0.8 }).catch(() => {});
    } else p.hapticActuators?.[0]?.pulse?.(mag, ms);
  } catch { /* nie każdy pad i nie każda przeglądarka to ma */ }
}

// ───────────────────────── napisy przycisków ─────────────────────────
// Ikonka przycisku zależy od rodzaju pada. Kształty PlayStation rysuje render.js (✕ ○ □ △), reszta to napisy.
const FACE = {
  xbox: [['A', '#5dc21e'], ['B', '#e5322d'], ['X', '#2b7de9'], ['Y', '#f6c000']],
  ps: [['cross', '#7ca8ff'], ['circle', '#ff6b6b'], ['square', '#f49ad6'], ['triangle', '#3ddc97']],
  nintendo: [['B', '#e8e8e8'], ['A', '#e8e8e8'], ['Y', '#e8e8e8'], ['X', '#e8e8e8']],
  generic: [['A', '#cfd6e6'], ['B', '#cfd6e6'], ['X', '#cfd6e6'], ['Y', '#cfd6e6']],
};
const PILLS = {
  xbox: ['LB', 'RB', 'LT', 'RT', 'VIEW', 'MENU', 'LS', 'RS'],
  ps: ['L1', 'R1', 'L2', 'R2', 'SHARE', 'OPTIONS', 'L3', 'R3'],
  nintendo: ['L', 'R', 'ZL', 'ZR', '−', '+', 'LS', 'RS'],
  generic: ['LB', 'RB', 'LT', 'RT', 'SELECT', 'START', 'LS', 'RS'],
};
const DPAD = { 12: 'up', 13: 'down', 14: 'left', 15: 'right' };

/**
 * Jak narysować przycisk o numerze i: { face, color } (przycisk czołowy), { dpad: kierunek }
 * albo { pill: napis }. Pady bez układu „standard” mają same numery.
 */
export function glyphOf(i, kind = gpad.kind, standard = gpad.standard) {
  if (i == null) return null;
  if (!standard && i < 12) return { pill: `#${i + 1}` };
  if (i <= 3) { const [face, color] = FACE[kind][i]; return { face, color }; }
  if (i <= 11) return { pill: PILLS[kind][i - 4] };
  if (DPAD[i]) return { dpad: DPAD[i] };
  if (i === 16) return { pill: kind === 'ps' ? 'PS' : 'HOME' };
  return { pill: `#${i + 1}` };
}
/** Nazwa rodzaju pada do komunikatów (null = zwykły pad – tekst z tłumaczeń). */
export const KIND_NAMES = { xbox: 'Xbox', ps: 'PlayStation', nintendo: 'Nintendo', generic: null };
