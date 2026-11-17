// Drobne narzędzia warstwy prezentacji. Math.random wolno używać tylko tutaj i w efektach – nigdy w src/sim.
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const mod = (v, m) => ((v % m) + m) % m;
export const rand = (a, b) => a + Math.random() * (b - a);
export const hash = (a, b = 0) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };
export const easeOutBack = (x) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
export const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

export function loadJSON(key, def) {
  try { return { ...def, ...JSON.parse(localStorage.getItem(key) || '{}') }; } catch { return { ...def }; }
}
export function saveJSON(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch {} }
