// Własne postacie z obrazków: format paczki i obliczenia bez DOM (testy: tests/skinpack.test.ts).
//
// Paczka to ZIP (albo kilka plików PNG naraz) z obrazkami nazwanymi tak jak klatki niżej – po nazwie kreator wie,
// co jest czym. Druga możliwość: sam head.png (głowa), a resztę ciała gra rysuje kodem. Opis dla twórców: docs/POSTACIE.md.
// Wygląd nie zmienia rozgrywki – symulacja (src/sim) nie wie nic o obrazkach.

/** 12 klatek w kolejności, w jakiej podaje je kreator; nazwa pliku = `${klatka}.png`. */
export const FRAMES = ['idle', 'run1', 'run2', 'run3', 'run4', 'jump1', 'jump2', 'jump3', 'land', 'fall', 'dead', 'cheer'];
export const HEAD = 'head';
export const PACK_JSON = 'character.json';
export const PACK_FORMAT = 1;

export const MAX_CHARS = 10;            // tyle własnych postaci mieści kreator
export const MAX_FILE = 8 * 1024 * 1024; // B – jeden obrazek przed obróbką
export const MAX_ZIP = 48 * 1024 * 1024; // B – cały plik ZIP
export const MAX_SIDE = 1024;            // px – większe obrazki kreator zmniejsza przy wczytaniu
export const NAME_MAX = 16;

/** Wysokość klatki „stoi” w grze (jednostki planszy, jak wbudowane postacie). */
export const TARGET_H = 60;
/** Promień głowy (jednostki) w postaci „sama głowa” przy wielkości 100%. */
export const HEAD_R = 11.5;
/** Klatki, których brakuje, zastępują podobne (aż do „stoi”). */
export const FALLBACK = {
  idle: null, run1: 'idle', run2: 'run1', run3: 'run1', run4: 'run2', jump1: 'land', jump2: 'jump3', jump3: 'jump2',
  land: 'jump1', fall: 'jump3', dead: 'idle', cheer: 'jump2',
};
export const DEFAULT_COLORS = { skin: '#f2c19c', shirt: '#c7d6f7', pants: '#1f2747', shoes: '#f4f6fb' };
export const COLOR_KEYS = Object.keys(DEFAULT_COLORS);

/** Zakresy poprawek kreatora: wielkość (mnożnik) i przesunięcie (jednostki planszy). */
export const ADJ = { kMin: 0.4, kMax: 2.5, dMax: 30 };

const clampN = (v, a, b, def) => (Number.isFinite(Number(v)) ? Math.max(a, Math.min(b, Number(v))) : def);
const baseName = (path) => String(path).split(/[\\/]/).pop() ?? '';
const isImage = (name) => /\.(png|webp)$/i.test(name);
/** Nazwa pliku bez rozszerzenia, małymi literami (Run1.PNG → run1). */
const stem = (name) => baseName(name).replace(/\.[^.]+$/, '').trim().toLowerCase();
/** Pliki z macOS / ukryte – pomijamy. */
const junk = (path) => /(^|\/)(__MACOSX|\.)/.test(String(path).replace(/\\/g, '/'));
/** Liczba z nazwy pliku do porządku „Obrazek (3).png”; bez liczby = 0. */
const numberIn = (name) => { const m = stem(name).match(/(\d+)(?!.*\d)/); return m ? Number(m[1]) : 0; };

/**
 * Przypisuje pliki do klatek. Najpierw po nazwach (idle.png, run1.png …, head.png); gdy żadna nazwa nie pasuje,
 * a obrazków jest 12 – po kolei według numeru w nazwie (tak nazywają pliki generatory obrazków), a jeden obrazek to głowa.
 * @param {string[]} names ścieżki plików z paczki
 * @returns {{ type: 'frames' | 'head' | null, map: Record<string, string>, byOrder: boolean, extra: string[] }}
 */
export function assignFiles(names) {
  const imgs = names.filter((n) => isImage(n) && !junk(n));
  const map = {}, used = new Set();
  for (const n of imgs) {
    const s = stem(n);
    if ((FRAMES.includes(s) || s === HEAD) && !map[s]) { map[s] = n; used.add(n); }
  }
  const frames = FRAMES.filter((f) => map[f]);
  if (frames.length) return { type: 'frames', map: pick(map, FRAMES), byOrder: false, extra: imgs.filter((n) => !used.has(n)) };
  if (map[HEAD]) return { type: 'head', map: { head: map[HEAD] }, byOrder: false, extra: imgs.filter((n) => !used.has(n)) };
  if (imgs.length === 1) return { type: 'head', map: { head: imgs[0] }, byOrder: true, extra: [] };
  if (imgs.length >= FRAMES.length) {
    const sorted = [...imgs].sort((a, b) => numberIn(a) - numberIn(b) || a.localeCompare(b));
    const m = {};
    FRAMES.forEach((f, i) => { m[f] = sorted[i]; });
    return { type: 'frames', map: m, byOrder: true, extra: sorted.slice(FRAMES.length) };
  }
  return { type: null, map: {}, byOrder: false, extra: imgs };
}
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k]).map((k) => [k, o[k]]));

/** Klatka do narysowania: ta albo najbliższa z łańcucha zastępstw, którą postać ma. */
export function resolveFrame(role, has) {
  let r = role;
  for (let i = 0; r && i < FRAMES.length; i++) {
    if (has(r)) return r;
    r = FALLBACK[r];
  }
  return has('idle') ? 'idle' : null;
}

/**
 * Która klatka teraz – ze stanu bohatera (czysto wizualnie, niczego nie liczy w symulacji).
 * pose: 'dead' | 'cheer' | null (w kreatorze – dowolna klatka do pokazania); air – w locie; vy – prędkość pionowa (ujemna = w górę); run 0…1 – bieg;
 * phase – faza kroku (rośnie z przebytą drogą); squash – spłaszczenie po wybiciu (< 0) i lądowaniu (> 0).
 * @param {{ pose?: string | null, air?: boolean, vy?: number, run?: number, phase?: number, squash?: number }} st
 */
export function pickFrame({ pose = null, air = false, vy = 0, run = 0, phase = 0, squash = 0 }) {
  if (pose) return pose;                               // 'dead', 'cheer' albo – w kreatorze – dowolna klatka
  if (air) {
    if (squash < -0.25) return 'jump1';                // chwila wybicia
    if (vy < -160) return 'jump2';
    if (vy > 760) return 'fall';                        // długi spadek (np. po wyrzucie albo z kilku pięter)
    return 'jump3';
  }
  if (squash > 0.35) return 'land';
  if (run > 0.05) {
    const q = Math.floor(phase / (Math.PI / 2));        // 4 klatki na pełny krok (2π – tyle, co jeden cykl nóg wbudowanych postaci)
    return `run${(((q % 4) + 4) % 4) + 1}`;
  }
  return 'idle';
}

/**
 * Promień i środek największego koła mieszczącego się w sylwetce (transformata odległości 3-4).
 * U postaci z dużą głową to głowa – po niej kreator wyrównuje skalę klatek i ustawia je w poziomie.
 * @param {Uint8Array} mask 1 = postać, 0 = tło (wiersz po wierszu)
 */
export function biggestCircle(mask, w, h) {
  const INF = 1e9, W2 = w + 2, d = new Float64Array(W2 * (h + 2));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d[(y + 1) * W2 + x + 1] = mask[y * w + x] ? INF : 0;
  for (let y = 1; y <= h; y++) {
    for (let x = 1; x <= w; x++) {
      const i = y * W2 + x;
      if (d[i]) d[i] = Math.min(d[i], d[i - 1] + 3, d[i - W2] + 3, d[i - W2 - 1] + 4, d[i - W2 + 1] + 4);
    }
  }
  let best = 0, bx = w / 2, by = h / 2;
  for (let y = h; y >= 1; y--) {
    for (let x = w; x >= 1; x--) {
      const i = y * W2 + x;
      if (d[i]) d[i] = Math.min(d[i], d[i + 1] + 3, d[i + W2] + 3, d[i + W2 + 1] + 4, d[i + W2 - 1] + 4);
      if (d[i] > best) { best = d[i]; bx = x - 1; by = y - 1; }
    }
  }
  return { r: best / 3, x: bx, y: by };
}

/** Prostokąt nieprzezroczystych pikseli (alfa > próg) albo null dla pustego obrazka. */
export function alphaBox(alpha, w, h, thr = 24) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (alpha[y * w + x] > thr) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

const median = (a) => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/**
 * Skala i punkt zaczepienia każdej klatki. measures[klatka] = { w, h, r, hx } – wymiary przyciętego obrazka (px),
 * promień głowy i jej środek w poziomie. Klatki o głowie podobnej do mediany (±20%) są w tej samej skali co reszta,
 * a wyraźnie inne (np. „stoi” narysowane 2× większe) kreator przeskalowuje do mediany. Potem całość tak, żeby
 * „stoi” miało TARGET_H jednostek wysokości. Zaczepienie: środek głowy w poziomie, dół obrazka (stopy) w pionie.
 * @returns {Record<string, { s: number, ax: number, ay: number }>} s – jednostki planszy na piksel, ax/ay – piksele
 */
export function layoutFrames(measures, adjust = {}) {
  const roles = Object.keys(measures);
  if (!roles.length) return {};
  const rs = roles.map((k) => measures[k].r).filter((r) => r > 0);
  const med = rs.length ? median(rs) : 1;
  const norm = (k) => { const r = measures[k].r; return r > 0 && Math.abs(r / med - 1) > 0.2 ? med / r : 1; };
  const ref = measures.idle ? 'idle' : roles[0];
  const u = TARGET_H / Math.max(1, measures[ref].h * norm(ref));
  const out = {};
  for (const k of roles) {
    const m = measures[k], a = cleanAdjust(adjust[k]);
    const s = u * norm(k) * a.k;
    const hx = m.r > 0 ? m.hx : m.w / 2;
    out[k] = { s, ax: hx - a.dx / s, ay: m.h + a.dy / s };
  }
  return out;
}

/** Poprawka jednej klatki z kreatora / pliku: wielkość (mnożnik) i przesunięcie (jednostki; dy > 0 = w górę). */
export function cleanAdjust(a) {
  return { k: clampN(a?.k, ADJ.kMin, ADJ.kMax, 1), dx: clampN(a?.dx, -ADJ.dMax, ADJ.dMax, 0), dy: clampN(a?.dy, -ADJ.dMax, ADJ.dMax, 0) };
}

const HEX = /^#[0-9a-f]{6}$/i;
/** Nazwa postaci: bez znaków sterujących, przycięta. */
export const cleanName = (s, def = '') => String(s ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX) || def;

/** Ustawienia z character.json (wszystko opcjonalne, złe wartości → domyślne). */
export function parsePackJson(text) {
  let j;
  try { j = JSON.parse(text); } catch { return null; }
  if (!j || typeof j !== 'object') return null;
  const colors = { ...DEFAULT_COLORS };
  for (const k of COLOR_KEYS) if (HEX.test(j.colors?.[k] ?? '')) colors[k] = j.colors[k].toLowerCase();
  const adjust = {};
  for (const f of FRAMES) if (j.adjust?.[f]) adjust[f] = cleanAdjust(j.adjust[f]);
  return {
    name: cleanName(j.name), type: j.type === 'head' ? 'head' : j.type === 'frames' ? 'frames' : null,
    adjust, colors, headK: clampN(j.head?.k, ADJ.kMin, ADJ.kMax, 1),
  };
}

/** character.json do eksportu (tylko to, co da się odtworzyć na innym urządzeniu). */
export function packJson(rec) {
  const adjust = {};
  for (const [k, a] of Object.entries(rec.adjust ?? {})) {
    const c = cleanAdjust(a);
    if (c.k !== 1 || c.dx || c.dy) adjust[k] = c;
  }
  return {
    format: PACK_FORMAT, game: 'step-jumper', name: rec.name, type: rec.type,
    ...(rec.type === 'head' ? { head: { k: rec.headK ?? 1 }, colors: { ...DEFAULT_COLORS, ...rec.colors } } : { adjust }),
  };
}

/** Nazwa pliku ZIP z eksportu: postac-<nazwa>.zip (litery, cyfry, myślniki). */
export function zipName(name) {
  const slug = String(name).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/Ł/g, 'L')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);
  return `postac-${slug || 'moja'}.zip`;
}
