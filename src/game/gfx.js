// Płótno, tekstury, mapy (style graficzne) i pomocnicy rysowania.
import { H, W } from '../sim';
import { access, fontSize } from './access.js';
import { hash, reduceMotion } from './util.js';

export const stage = document.getElementById('stage');
export const canvas = document.getElementById('game');
export const mainCtx = canvas.getContext('2d');
/** Fokus z powrotem na grze (płótno) – po zamknięciu okienka albo naciśnięciu przycisku w rogu klawiaturą. */
export const focusGame = () => { try { canvas.focus({ preventScroll: true }); } catch { /* starsze przeglądarki */ } };
export let ctx = mainCtx;                              // bieżący cel rysowania (ekran albo bufor niskiej rozdzielczości)
export function setCtx(c) { ctx = c; }

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const s = Math.min(stage.clientWidth / W, stage.clientHeight / H);
  const cw = Math.max(64, Math.floor(W * s)), ch = Math.max(48, Math.floor(H * s));
  canvas.style.width = cw + 'px';
  canvas.style.height = ch + 'px';
  canvas.width = Math.round(cw * dpr);
  canvas.height = Math.round(ch * dpr);
}
new ResizeObserver(resize).observe(stage);
resize();

// ───────────────────────── tekstury ─────────────────────────
function makePattern(w, h, draw, R = 3) {
  const c = document.createElement('canvas');
  c.width = w * R; c.height = h * R;
  const g = c.getContext('2d'); g.scale(R, R); draw(g);
  const p = mainCtx.createPattern(c, 'repeat');
  p.setTransform(new DOMMatrix().scaleSelf(1 / R));
  return p;
}
export const brickPattern = makePattern(64, 32, (g) => {
  const cols = ['#252e5a', '#222a52', '#283263', '#20274d', '#242c57'];
  g.fillStyle = '#151a38'; g.fillRect(0, 0, 64, 32);
  [[0, 0], [32, 0], [-16, 16], [16, 16], [48, 16]].forEach(([x, y], i) => {
    g.fillStyle = cols[i]; g.fillRect(x + 1, y + 1, 30, 14);
    g.fillStyle = 'rgba(255,255,255,.05)'; g.fillRect(x + 1, y + 1, 30, 2);
    g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(x + 1, y + 13, 30, 2);
  });
});
export const stonePattern = makePattern(48, 48, (g) => {
  g.fillStyle = '#262d57'; g.fillRect(0, 0, 48, 48);
  [[0, 0], [-24, 24], [24, 24]].forEach(([x, y], i) => {
    g.fillStyle = i ? '#444e88' : '#4a5592'; g.fillRect(x + 1.5, y + 1.5, 45, 21);
    g.fillStyle = '#5d69aa'; g.fillRect(x + 1.5, y + 1.5, 45, 3);
    g.fillStyle = '#363f73'; g.fillRect(x + 1.5, y + 19.5, 45, 3);
  });
});
export const hatchPattern = makePattern(12, 12, (g) => {
  g.strokeStyle = 'rgba(31,42,68,.2)'; g.lineWidth = 1; g.lineCap = 'square';
  for (const o of [-12, 0, 12]) { g.beginPath(); g.moveTo(-2 + o, 14); g.lineTo(14 + o, -2); g.stroke(); }
});
const scanPattern = makePattern(4, 3, (g) => { g.fillStyle = 'rgba(0,0,0,.26)'; g.fillRect(0, 0, 4, 1); }, 1);
const grainPattern = (() => {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const g = cv.getContext('2d'), id = g.createImageData(128, 128);
  for (let i = 0; i < id.data.length; i += 4) {
    id.data[i] = id.data[i + 1] = id.data[i + 2] = Math.random() * 255 | 0;
    id.data[i + 3] = 30 + Math.random() * 60;
  }
  g.putImageData(id, 0, 0);
  return mainCtx.createPattern(cv, 'repeat');
})();

// bufor niskiej rozdzielczości + raster Bayera dla mapy retro
export const lowCanvas = document.createElement('canvas');
export const lowCtx = lowCanvas.getContext('2d');
export const ditherPattern = (() => {
  const B = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const cv = document.createElement('canvas'); cv.width = cv.height = 4;
  const g = cv.getContext('2d');
  B.forEach((b, i) => {
    const v = (b + 0.5) / 16 - 0.5;
    g.fillStyle = v > 0 ? `rgba(255,255,255,${v * 0.36})` : `rgba(0,0,0,${-v * 0.5})`;
    g.fillRect(i % 4, i >> 2, 1, 1);
  });
  return lowCtx.createPattern(cv, 'repeat');
})();

// ───────────────────────── wygląd platform ─────────────────────────
// zmienia się co 100 pięter
const THEMES = [
  { top: '#f4fbff', body: '#7cc7f2', dark: '#3f8fd0', decor: 'drips',  drip: '#c9ecff' }, // lód
  { top: '#c9ced6', body: '#8b93a1', dark: '#5b6270', decor: 'seams' },                    // kamień
  { top: '#e2b071', body: '#a8713a', dark: '#6e4520', decor: 'seams' },                    // drewno
  { top: '#ffc59a', body: '#c8693a', dark: '#8a3f1e', decor: 'rivets' },                   // miedź
  { top: '#b8ec7a', body: '#5aa043', dark: '#356b2a', decor: 'drips',  drip: '#4c8f3a' }, // mech
  { top: '#ffe27a', body: '#f0642d', dark: '#9c2a14', decor: 'drips',  drip: '#ffb347' }, // lawa
  { top: '#f3d9ff', body: '#b06cf0', dark: '#6d35b0', decor: 'rivets' },                   // kryształ
  { top: '#ffffff', body: '#dfe9f7', dark: '#a9bbd6', decor: 'none' },                     // chmura
  { top: '#fff3a8', body: '#f2c230', dark: '#a87a10', decor: 'rivets' },                   // złoto
  { top: '#aaffee', body: '#16c7c0', dark: '#0b6f8a', decor: 'seams' },                    // neon
];
export const themeOf = (n) => THEMES[Math.floor(n / 100) % THEMES.length];
export const NEON = ['#5ef5ff', '#ff5ee0', '#fff36b', '#7dff8a', '#ff9a4a', '#b98cff'];
export const PENCILS = ['#3b6fd4', '#d4483b', '#2f9e5b', '#8a4fd0', '#e08a1e', '#1f9aa8'];
export const cycle = (arr, n) => arr[Math.floor(n / 100) % arr.length];
export const PEN = '#1f2a44';

/** Kolory nagród najlepszej trójki (korony, pył przy ścianach, fala uderzeniowa): 1 złoto, 2 srebro, 3 brąz. */
export const MEDALS = {
  1: { hi: '#fff6b8', mid: '#ffd24a', lo: '#c98a0c', spark: '#fffbe0', dust: ['#ffe066', '#ffd24a', '#fff3a8', '#ffb52e'] },
  2: { hi: '#ffffff', mid: '#d3dbe6', lo: '#8592a8', spark: '#ffffff', dust: ['#ffffff', '#dfe6f0', '#b9c6d8', '#eef6ff'] },
  3: { hi: '#ffd9b3', mid: '#e0915a', lo: '#94501f', spark: '#fff0e0', dust: ['#ffb27a', '#e0915a', '#ffd2a6', '#c8743e'] },
};

// ───────────────────────── mapy (style graficzne) ─────────────────────────
const UI_ICE = {
  text: '#ffffff', stroke: '#0b1030', label: '#9fb4ee', hint: '#cfe3ff', gold: '#ffe066', mint: '#7ef0e0', warn: '#ff7a59', note: '#ffe680',
  panel: 'rgba(12,16,44,.84)', line: 'rgba(159,216,255,.35)', frame: '#12173a', dim: '6,9,28',
  meterBg: '#262d57', off: '#3a4478', offText: '#8f9bd0', sel: 'rgba(255,224,102,.16)',
  btn: '#ffd24a', btnText: '#12173a', title: ['#ffffff', '#a9e4ff', '#4aa8f0'], titleStroke: '#12327a',
};
const UI_NEON = {
  text: '#ffffff', stroke: '#12002b', label: '#ff8bec', hint: '#9ef7ff', gold: '#fff36b', mint: '#5ef5ff', warn: '#ff4f8b', note: '#fff36b',
  panel: 'rgba(16,2,40,.86)', line: 'rgba(94,245,255,.6)', frame: '#12002b', dim: '8,0,24',
  meterBg: '#2a0a4a', off: '#3b1a66', offText: '#9a7ad0', sel: 'rgba(94,245,255,.16)',
  btn: '#ff5ee0', btnText: '#12002b', title: ['#ffffff', '#ffb3f3', '#ff3fd0'], titleStroke: '#5a0a8a',
};
const UI_SKETCH = {
  text: PEN, stroke: '#f7f2e4', label: '#5a6a8c', hint: '#3b4a6b', gold: '#c2410c', mint: '#0f766e', warn: '#c81e1e', note: '#7a4f00',
  panel: 'rgba(255,253,244,.93)', line: 'rgba(31,42,68,.6)', frame: PEN, dim: '247,242,228',
  meterBg: '#e4dcc6', off: '#d9d0b8', offText: '#8a8468', sel: 'rgba(194,65,12,.13)',
  btn: PEN, btnText: '#fffdf4', title: ['#3b6fd4', '#2d55b0', '#1f3a7a'], titleStroke: '#f7f2e4',
};
const BASE_FONT = '"Trebuchet MS", "Segoe UI", system-ui, sans-serif';

export const STYLES = [
  { id: 'ice', name: 'Zamieć', desc: 'mroźna klasyka', world: 'ice', ui: UI_ICE },
  { id: 'film', name: 'Stare kino', desc: 'czarno-biała taśma z rysami i ziarnem', world: 'ice', ui: UI_ICE,
    filter: 'grayscale(1) sepia(.3) contrast(1.15) brightness(1.3)', font: 'Georgia, "Times New Roman", serif', post: filmPost },
  { id: 'retro', name: 'Retro LCD', desc: 'cztery odcienie zieleni i grube piksele', world: 'ice', ui: UI_ICE,
    filter: 'url(#fx-retro)', pixel: 2, font: '"Courier New", ui-monospace, monospace' },
  { id: 'neon', name: 'Neon', desc: 'świecące kontury na siatce', world: 'neon', ui: UI_NEON, post: neonPost },
  { id: 'sketch', name: 'Zeszyt', desc: 'ołówek na papierze w kratkę', world: 'sketch', ui: UI_SKETCH,
    font: '"Comic Sans MS", "Segoe Print", "Bradley Hand", cursive', post: sketchPost },
];
export let style = STYLES[0], ui = style.ui, FONT = BASE_FONT;
export function applyStyle(idx) {
  style = STYLES[idx]; ui = style.ui; FONT = style.font || BASE_FONT;
  setMapFilter(true);
}
let shownFilter = null;
/** Filtr koloru mapy na płótnie (Stare kino, Retro LCD); bez niego, gdy efekty map są wyłączone albo on = false. */
export function setMapFilter(on) {
  const f = on && access.fx ? style.filter || '' : '';
  if (f !== shownFilter) { canvas.style.filter = f; shownFilter = f; }
}

function filmPost(g) {
  const c = ctx, f = Math.floor(g.t * 16);            // efekty „skaczą” jak klatki taśmy
  c.save();
  c.globalAlpha = 0.55; c.translate(-hash(f, 1) * 128, -hash(f, 2) * 128);
  c.fillStyle = grainPattern; c.fillRect(0, 0, W + 128, H + 128);
  c.restore();
  if (!reduceMotion) {
    c.fillStyle = `rgba(255,255,255,${0.015 + hash(f, 3) * 0.05})`; c.fillRect(0, 0, W, H);
    // przyciemnienie taśmy: najwyżej raz na sekundę (bezpieczny limit migania to 3 błyski na sekundę)
    const sec = Math.floor(g.t);
    if (f % 16 === Math.floor(hash(sec, 5) * 16) && hash(sec, 4) > 0.4) { c.fillStyle = 'rgba(0,0,0,.12)'; c.fillRect(0, 0, W, H); }
  }
  c.strokeStyle = 'rgba(255,255,255,.4)'; c.lineWidth = 1;
  for (let i = 0; i < 2; i++) {                        // pionowe rysy
    const life = Math.floor(g.t * 1.3 + i * 0.5);
    if (hash(life, 10 + i) > 0.4) {
      const x = hash(life, 20 + i) * W + (hash(f, 30 + i) - 0.5) * 3;
      c.beginPath(); c.moveTo(x, 0); c.lineTo(x + (hash(life, 40 + i) - 0.5) * 6, H); c.stroke();
    }
  }
  c.fillStyle = 'rgba(15,15,15,.75)';
  for (let i = 0; i < 3; i++) {                        // paprochy
    if (hash(f, 50 + i) > 0.6) {
      c.beginPath();
      c.ellipse(hash(f, 60 + i) * W, hash(f, 70 + i) * H, 1 + hash(f, 80 + i) * 2.5, 1 + hash(f, 90 + i) * 1.5, hash(f, 95 + i) * 3, 0, 7);
      c.fill();
    }
  }
  const v = c.createRadialGradient(W / 2, H / 2, H * 0.38, W / 2, H / 2, H * 0.9);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,.8)');
  c.fillStyle = v; c.fillRect(0, 0, W, H);
}
function neonPost() {
  const c = ctx;
  c.fillStyle = scanPattern; c.fillRect(0, 0, W, H);
  const v = c.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, H * 0.95);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(10,0,30,.6)');
  c.fillStyle = v; c.fillRect(0, 0, W, H);
}
function sketchPost() {
  const c = ctx;
  c.save(); c.globalAlpha = 0.18; c.fillStyle = grainPattern; c.fillRect(0, 0, W, H); c.restore();
}

// ───────────────────────── rysowanie – pomocnicze ─────────────────────────
/** Napis; rozmiar rośnie albo maleje z ustawieniem OPCJE → DOSTĘPNOŚĆ → Rozmiar tekstu (access.js). */
export function text(str, x, y, { size = 16, color = ui.text, align = 'center', stroke = ui.stroke, sw = 4, weight = 800, maxW } = {}) {
  ctx.font = `${weight} ${fontSize(size)}px ${FONT}`;
  ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  if (sw > 0) { ctx.strokeStyle = stroke; ctx.lineWidth = sw; ctx.strokeText(str, x, y, maxW); }
  ctx.fillStyle = color; ctx.fillText(str, x, y, maxW);
}
export function rr(x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }
export function burst(x, y, r1, r2, n, rot) {
  ctx.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 ? r1 : r2, a = rot + i * Math.PI / n;
    ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  ctx.closePath();
}
export function wobblyRect(x, y, w, h, seed, amp = 1.2) {     // „odręczny” prostokąt
  const n = Math.max(2, Math.round(w / 36));
  let k = 0;
  const j = () => (hash(seed, k++) - 0.5) * 2 * amp;
  ctx.beginPath();
  for (let i = 0; i <= n; i++) ctx.lineTo(x + (w * i) / n + j(), y + j());
  ctx.lineTo(x + w + j(), y + h / 2 + j());
  for (let i = n; i >= 0; i--) ctx.lineTo(x + (w * i) / n + j(), y + h + j());
  ctx.lineTo(x + j(), y + h / 2 + j());
  ctx.closePath();
}
