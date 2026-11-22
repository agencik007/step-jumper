// Własne postacie: zapis w IndexedDB (obrazki jako Bloby – localStorage ich nie pomieści) i przygotowanie do rysowania.
// Format paczki i obliczenia: skinpack.js, rysowanie: characters.js, kreator: creator.js.
//
// Zapis postaci (rekord bazy):
//   { id, name, type: 'frames' | 'head', created, updated, files: { idle: Blob, run1: Blob, … } albo { head: Blob },
//     adjust: { klatka: { k, dx, dy } }, colors: { skin, shirt, pants, shoes }, headK }
// Obrazki są już przycięte do sylwetki i najwyżej MAX_SIDE px (prepareImage), zapisane jako PNG.
import { DEFAULT_COLORS, FRAMES, HEAD, HEAD_R, MAX_SIDE, alphaBox, biggestCircle, layoutFrames } from './skinpack.js';

const DB = 'stepjumper', STORE = 'chars';
let dbp = null;
function db() {
  if (!dbp) {
    dbp = new Promise((res, rej) => {
      if (typeof indexedDB === 'undefined') { rej(new Error('idb')); return; }
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    dbp.catch(() => { dbp = null; });
  }
  return dbp;
}
async function tx(mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(STORE, mode), req = fn(t.objectStore(STORE));
    t.oncomplete = () => res(req?.result);
    t.onerror = t.onabort = () => rej(t.error ?? new Error('idb'));
  });
}
/** Wszystkie własne postacie, od najstarszej. */
export const listChars = async () => ((await tx('readonly', (s) => s.getAll())) ?? []).sort((a, b) => a.created - b.created);
export const getChar = (id) => tx('readonly', (s) => s.get(id));
export const putChar = (rec) => tx('readwrite', (s) => s.put(rec));
export const deleteChar = (id) => tx('readwrite', (s) => s.delete(id));
export const newId = () => `c${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

// ───────────────────────── obrazki ─────────────────────────
const canvasOf = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, w); c.height = Math.max(1, h); return c; };
const toBlob = (cv) => new Promise((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error('encode'))), 'image/png'));

/**
 * Wczytany plik → PNG przycięty do sylwetki i zmniejszony do MAX_SIDE. Ponowne kodowanie przez canvas usuwa
 * też metadane i cokolwiek innego, co było w pliku. Rzuca 'decode' (nie obrazek) albo 'empty' (cały przezroczysty).
 */
export async function prepareImage(blob) {
  let bmp;
  try { bmp = await createImageBitmap(blob); } catch { throw new Error('decode'); }
  const cv = canvasOf(bmp.width, bmp.height), c = cv.getContext('2d', { willReadFrequently: true });
  c.drawImage(bmp, 0, 0);
  bmp.close?.();
  const px = c.getImageData(0, 0, cv.width, cv.height).data, a = new Uint8Array(cv.width * cv.height);
  for (let i = 0; i < a.length; i++) a[i] = px[i * 4 + 3];
  const box = alphaBox(a, cv.width, cv.height);
  if (!box) throw new Error('empty');
  const k = Math.min(1, MAX_SIDE / Math.max(box.w, box.h));
  const out = scaledCanvas(cv, box.x, box.y, box.w, box.h, Math.round(box.w * k), Math.round(box.h * k));
  return toBlob(out);
}

/** Zmniejszanie po połowie (ładniej niż jednym krokiem) aż do docelowego rozmiaru. */
function scaledCanvas(src, sx, sy, sw, sh, tw, th) {
  tw = Math.max(1, tw); th = Math.max(1, th);
  let cur = src, x = sx, y = sy, w = sw, h = sh;
  while (w / 2 >= tw && h / 2 >= th) {
    const nw = Math.ceil(w / 2), nh = Math.ceil(h / 2), cv = canvasOf(nw, nh), c = cv.getContext('2d');
    c.imageSmoothingQuality = 'high';
    c.drawImage(cur, x, y, w, h, 0, 0, nw, nh);
    cur = cv; x = 0; y = 0; w = nw; h = nh;
  }
  const out = canvasOf(tw, th), c = out.getContext('2d');
  c.imageSmoothingQuality = 'high';
  c.drawImage(cur, x, y, w, h, 0, 0, tw, th);
  return out;
}

const measured = new WeakMap();
/** Obrazek z bazy → bitmapa, wymiary i głowa (największe koło w sylwetce, liczone na pomniejszonej masce). */
function measure(blob) {
  if (!measured.has(blob)) {
    measured.set(blob, (async () => {
      const bmp = await createImageBitmap(blob);
      const k = Math.min(1, 160 / Math.max(bmp.width, bmp.height));
      const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
      const cv = canvasOf(w, h), c = cv.getContext('2d', { willReadFrequently: true });
      c.drawImage(bmp, 0, 0, w, h);
      const px = c.getImageData(0, 0, w, h).data, mask = new Uint8Array(w * h);
      for (let i = 0; i < mask.length; i++) mask[i] = px[i * 4 + 3] > 128 ? 1 : 0;
      const head = biggestCircle(mask, w, h);
      return { bmp, w: bmp.width, h: bmp.height, r: head.r / k, hx: (head.x + 0.5) / k, hy: (head.y + 0.5) / k };
    })());
  }
  return measured.get(blob);
}

/**
 * Rekord z bazy → postać do rysowania (drawHero w characters.js przyjmuje ją zamiast numeru wbudowanej postaci).
 * Klatka: { src, sw, sh, s, ax, ay } – obrazek, jego wymiary (px), jednostki planszy na piksel i punkt zaczepienia (px).
 */
export async function buildSkin(rec) {
  const skin = { id: rec.id, name: rec.name, type: rec.type, frames: {}, head: null, colors: { ...DEFAULT_COLORS, ...rec.colors }, mid: 26 };
  if (rec.type === 'head') {
    if (!rec.files?.[HEAD]) return null;
    const m = await measure(rec.files[HEAD]);
    const r = m.r > 2 ? m.r : Math.min(m.w, m.h) / 2;
    skin.head = { src: m.bmp, sw: m.w, sh: m.h, s: (HEAD_R * (rec.headK ?? 1)) / r, ax: m.hx, ay: m.hy };
    return skin;
  }
  const ms = {};
  for (const f of FRAMES) if (rec.files?.[f]) ms[f] = await measure(rec.files[f]);
  if (!Object.keys(ms).length) return null;
  const lay = layoutFrames(Object.fromEntries(Object.entries(ms).map(([k, m]) => [k, { w: m.w, h: m.h, r: m.r, hx: m.hx }])), rec.adjust);
  for (const [k, m] of Object.entries(ms)) skin.frames[k] = { src: m.bmp, sw: m.w, sh: m.h, ...lay[k] };
  const ref = skin.frames.idle ?? Object.values(skin.frames)[0];
  skin.mid = (ref.sh * ref.s) / 2;
  return skin;
}

/** Gęstość pikseli obrazków w grze: 3 px na jednostkę planszy (ekrany do 3× gęstsze niż płótno 640 × 480). */
const BAKE_PX = 3;
/** Do gry: każda klatka wcześniej zmniejszona do rozmiaru na ekranie – rysowanie co klatkę jest tańsze i ładniejsze. */
export function bakeSkin(skin) {
  if (!skin) return skin;
  const bake = (f) => {
    const tw = Math.ceil(f.sw * f.s * BAKE_PX), th = Math.ceil(f.sh * f.s * BAKE_PX);
    if (tw >= f.sw) return f;                            // obrazek i tak mały – zostaje
    const cv = scaledCanvas(f.src, 0, 0, f.sw, f.sh, tw, th), k = tw / f.sw;
    return { ...f, src: cv, sw: tw, sh: th, s: f.s / k, ax: f.ax * k, ay: f.ay * k };
  };
  const out = { ...skin, frames: {} };
  for (const [k, f] of Object.entries(skin.frames)) out.frames[k] = bake(f);
  if (skin.head) out.head = bake(skin.head);
  return out;
}

/** Postać z bazy gotowa do gry albo null (nie ma jej / nie da się wczytać). */
export async function loadSkin(id) {
  try {
    const rec = id ? await getChar(id) : null;
    return rec ? bakeSkin(await buildSkin(rec)) : null;
  } catch { return null; }
}
