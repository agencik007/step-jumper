// Głowa z aparatu: podpowiedzi przed zdjęciem, wycięcie głowy z maski postaci i kolor skóry (src/game/facefit.js).
// Twarz to sztuczna siatka 478 punktów: obrys na elipsie i kilka punktów, z których korzysta facefit.js.
import { describe, expect, it } from 'vitest';
import { FACE_FILL, FACE_OVAL, LM, OVAL, assess, headAlpha, keepAround, meanLight, skinColor } from '../src/game/facefit.js';
import { packJson, parsePackJson } from '../src/game/skinpack.js';
import { canShare } from '../src/game/skins.js';

type P = { x: number; y: number };

/**
 * Twarz o środku (cx, cy) i pół-wysokości b (ułamki obrazka o proporcjach aspect). yaw przesuwa nos w bok
 * (ułamek pół-szerokości), roll obraca całość (stopnie).
 */
function face(cx: number, cy: number, b: number, { aspect = 4 / 3, yaw = 0, roll = 0 } = {}): P[] {
  const a = (0.75 * b) / aspect;
  const p: P[] = Array.from({ length: 478 }, () => ({ x: cx, y: cy }));
  FACE_OVAL.forEach((i, k) => {
    const th = (k / FACE_OVAL.length) * Math.PI * 2;
    p[i] = { x: cx + a * Math.sin(th), y: cy - b * Math.cos(th) };
  });
  p[LM.left] = { x: cx + a, y: cy };
  p[LM.right] = { x: cx - a, y: cy };
  p[LM.eyeL] = { x: cx + 0.4 * a, y: cy - 0.15 * b };
  p[LM.eyeR] = { x: cx - 0.4 * a, y: cy - 0.15 * b };
  p[LM.nose] = { x: cx + yaw * a, y: cy + 0.25 * b };
  p[LM.cheekL] = { x: cx + 0.5 * a, y: cy + 0.1 * b };
  p[LM.cheekR] = { x: cx - 0.5 * a, y: cy + 0.1 * b };
  p[LM.forehead] = { x: cx, y: cy - 0.6 * b };
  if (!roll) return p;
  const r = (roll * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return p.map((q) => {
    const dx = (q.x - cx) * aspect, dy = q.y - cy;
    return { x: cx + (dx * c - dy * s) / aspect, y: cy + dx * s + dy * c };
  });
}

/** Twarz ustawiona idealnie w owalu okienka 4:3. */
const B_OK = (FACE_FILL.ideal * 2 * OVAL.ry) / 2;
const CY_OK = OVAL.cy + OVAL.ry * 0.12;
const good = (o = {}) => face(OVAL.cx, CY_OK, B_OK, o);

describe('podpowiedzi przed zdjęciem (assess)', () => {
  it('twarz w owalu, prosto, w świetle – można robić zdjęcie', () => {
    expect(assess([good()], 4 / 3, 140).hint).toBe('ok');
  });
  it('brak twarzy i kilka twarzy', () => {
    expect(assess([], 4 / 3).hint).toBe('noFace');
    expect(assess([good(), good()], 4 / 3).hint).toBe('many');
  });
  it('za daleko i za blisko', () => {
    expect(assess([face(OVAL.cx, CY_OK, B_OK * 0.6)], 4 / 3).hint).toBe('closer');
    expect(assess([face(OVAL.cx, CY_OK, B_OK * 1.5)], 4 / 3).hint).toBe('farther');
  });
  it('twarz poza środkiem owalu', () => {
    expect(assess([face(OVAL.cx + 0.2, CY_OK, B_OK)], 4 / 3).hint).toBe('center');
    expect(assess([face(OVAL.cx, CY_OK - 0.15, B_OK)], 4 / 3).hint).toBe('center');
  });
  it('głowa odwrócona w bok albo przechylona', () => {
    expect(assess([good({ yaw: 0.5 })], 4 / 3).hint).toBe('straight');
    expect(assess([good({ roll: 25 })], 4 / 3).hint).toBe('level');
    expect(assess([good({ roll: -25 })], 4 / 3).hint).toBe('level');
    expect(assess([good({ roll: 6 })], 4 / 3, 140).hint).toBe('ok');
  });
  it('obraz w lustrze (lewe oko po prawej) to nie przechył', () => {
    const p = good().map((q) => ({ x: 1 - q.x, y: q.y }));
    expect(assess([p], 4 / 3, 140).hint).toBe('ok');
  });
  it('za ciemno – dopiero gdy reszta się zgadza', () => {
    expect(assess([good()], 4 / 3, 30).hint).toBe('dark');
    expect(assess([good()], 4 / 3, null).hint).toBe('ok');
  });
});

describe('wycięcie głowy (headAlpha)', () => {
  const W = 200, H = 200;
  const lm = face(0.5, 0.45, 0.2, { aspect: 1 });
  const at = (al: Uint8ClampedArray, x: number, y: number) => al[Math.round(y * H) * W + Math.round(x * W)];

  it('cała klatka to człowiek: zostaje twarz i włosy, bez szyi, ramion i boków', () => {
    const person = new Float32Array(100 * 100).fill(1);     // maska w innej rozdzielczości niż zdjęcie
    const al = headAlpha(person, 100, 100, lm, W, H);
    expect(at(al, 0.5, 0.45)).toBe(255);                    // środek twarzy
    expect(at(al, 0.5, 0.15)).toBe(255);                    // włosy nad czołem
    expect(at(al, 0.5, 0.72)).toBe(0);                      // szyja pod brodą
    expect(at(al, 0.2, 0.8)).toBe(0);                       // ramię
    expect(at(al, 0.03, 0.45)).toBe(0);                     // daleko z boku
    expect(at(al, 0.5, 0.02)).toBe(255);                    // wysoka fryzura mieści się w ramce
  });
  it('tło (pewność 0) zawsze przezroczyste', () => {
    const person = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) person[y * W + x] = Math.hypot(x - 100, y - 85) < 55 ? 1 : 0;
    const al = headAlpha(person, W, H, lm, W, H);
    expect(at(al, 0.5, 0.45)).toBe(255);
    expect(at(al, 0.5, 0.1)).toBe(0);                       // poza głową z maski
  });
  it('przechylona głowa: broda wycięta wzdłuż żuchwy, nie w poziomie', () => {
    const tilted = face(0.5, 0.45, 0.2, { aspect: 1, roll: 30 });
    const al = headAlpha(new Float32Array(W * H).fill(1), W, H, tilted, W, H);
    const chin = tilted[LM.chin];
    expect(at(al, chin.x, chin.y - 0.03)).toBeGreaterThan(200);
    const below = { x: chin.x - 0.08 * Math.sin(Math.PI / 6), y: chin.y + 0.08 * Math.cos(Math.PI / 6) };
    expect(at(al, below.x, below.y)).toBe(0);
  });
});

describe('spójny kawałek wokół twarzy (keepAround)', () => {
  it('ręka obok głowy, oddzielona tłem, znika', () => {
    const w = 30, h = 10, al = new Uint8ClampedArray(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x < 10 || x > 20) al[y * w + x] = 255;
    al[5 * w + 10] = 60;                                    // miękka krawędź przy głowie zostaje
    keepAround(al, w, h, 3, 5);
    expect(al[5 * w + 3]).toBe(255);
    expect(al[5 * w + 10]).toBe(60);
    expect(al[5 * w + 25]).toBe(0);
  });
});

describe('kolor skóry i jasność', () => {
  it('jednolity obrazek daje swój kolor', () => {
    const w = 40, h = 40, px = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) px.set([200, 150, 120, 255], i * 4);
    expect(skinColor(px, w, h, face(0.5, 0.5, 0.3, { aspect: 1 }))).toBe('#c89678');
    expect(meanLight(px, w, h, 0, 0, 1, 1)).toBeCloseTo(0.299 * 200 + 0.587 * 150 + 0.114 * 120, 5);
  });
});

describe('postać ze zdjęcia twarzy nie jest udostępniana', () => {
  const rec = { name: 'Ja', type: 'head', headK: 1.5, colors: {}, share: true, photo: true };
  it('nawet ze zgodą', () => {
    expect(canShare(rec)).toBe(false);
    expect(canShare({ ...rec, photo: false })).toBe(true);
    expect(canShare({ ...rec, type: 'frames' })).toBe(true);   // zostały klatki – zdjęcia już nie ma
  });
  it('znacznik zdjęcia przechodzi przez eksport i import ZIP', () => {
    expect(parsePackJson(JSON.stringify(packJson(rec)))?.photo).toBe(true);
    expect(parsePackJson(JSON.stringify(packJson({ ...rec, photo: false })))?.photo).toBe(false);
  });
});
