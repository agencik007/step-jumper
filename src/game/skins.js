// Własne postacie: zapis w IndexedDB (obrazki jako Bloby – localStorage ich nie pomieści) i przygotowanie do rysowania.
// Format paczki i obliczenia: skinpack.js, rysowanie: characters.js, kreator: creator.js.
//
// Zapis postaci (rekord bazy):
//   { id, name, type: 'frames' | 'head', created, updated, files: { idle: Blob, run1: Blob, … } albo { head: Blob },
//     adjust: { klatka: { k, dx, dy } }, colors: { skin, shirt, pants, shoes }, headK,
//     source?: skrót paczki z rankingu (postać wczytana z najlepszej trójki), author?: nick jej właściciela,
//     share: zgoda gracza na udostępnienie (pole w edycji postaci) – bez niej postać nie trafia na serwer }
// Obrazki są już przycięte do sylwetki i najwyżej MAX_SIDE px (prepareImage), zapisane jako PNG.
//
// Drugi magazyn – 'packs': paczki ZIP do wysłania na serwer (postać w najlepszej trójce rankingu), { hash, key, data, at }.
// key = id postaci + czas zmiany, więc ta sama postać ma zawsze tę samą paczkę i ten sam skrót.
import {
  DEFAULT_COLORS, FRAMES, HEAD, HEAD_R, MAX_CHARS, MAX_FILE, MAX_SIDE, PACK_JSON, alphaBox, assignFiles, biggestCircle, cleanName, layoutFrames, packJson,
  parsePackJson,
} from './skinpack.js';
import { unzip, zipFiles } from './zip.js';

const DB = 'stepjumper', STORE = 'chars', PACKS = 'packs';
let dbp = null;
function db() {
  if (!dbp) {
    dbp = new Promise((res, rej) => {
      if (typeof indexedDB === 'undefined') { rej(new Error('idb')); return; }
      const r = indexedDB.open(DB, 2);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: 'id' });
        if (!d.objectStoreNames.contains(PACKS)) d.createObjectStore(PACKS, { keyPath: 'hash' });
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    dbp.catch(() => { dbp = null; });
  }
  return dbp;
}
async function tx(mode, fn, store = STORE) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode), req = fn(t.objectStore(store));
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

// ───────────────────────── paczki: wczytywanie (kreator, ranking) ─────────────────────────
/** Błąd z kluczem tekstu (strings.js, cr.err.*) do pokazania graczowi. */
export const failure = (key, vars) => Object.assign(new Error(key), { key, vars });
const baseName = (n) => String(n).split(/[\\/]/).pop();

/** ZIP → pliki paczki (obrazki i character.json) jako { name, blob }. */
export async function unpackZip(bytes) {
  let un;
  try {
    un = await unzip(bytes, { maxTotal: 96 * 1024 * 1024, wanted: (n) => /\.(png|webp|json)$/i.test(n) });
  } catch (e) { throw failure(e.message === 'big' ? 'cr.err.big' : 'cr.err.zip'); }
  return un.map((u) => ({ name: u.name, blob: new Blob([u.data]) }));
}

/**
 * Pliki paczki → klatki postaci: przypisanie po nazwach (skinpack.js → assignFiles), ustawienia z character.json
 * i obrazki przygotowane do zapisu (prepareImage, wszystkie naraz). Rzuca failure('cr.err.…').
 * @param {{ name: string, blob: Blob }[]} entries
 */
export async function readPack(entries) {
  const json = entries.find((e) => baseName(e.name).toLowerCase() === PACK_JSON);
  const cfg = json ? parsePackJson(await json.blob.text()) : null;
  const a = assignFiles(entries.map((e) => e.name));
  if (!a.type) throw failure('cr.err.none');
  const byName = new Map(entries.map((e) => [e.name, e.blob]));
  const pairs = Object.entries(a.map);
  if (pairs.some(([, name]) => byName.get(name).size > MAX_FILE)) throw failure('cr.err.big');
  // wszystkie obrazki naraz: kodowanie PNG bywa wolne (przeglądarka robi je w tle), a równolegle trwa tyle co jedno
  const ready = await Promise.all(pairs.map(([, name]) => prepareImage(byName.get(name)).catch(() => null)));
  const bad = pairs.findIndex((_, i) => !ready[i]);
  if (bad >= 0) throw failure('cr.err.image', { file: baseName(pairs[bad][1]) });
  return { type: a.type, byOrder: a.byOrder, extra: a.extra.map(baseName), cfg, files: Object.fromEntries(pairs.map(([role], i) => [role, ready[i]])) };
}

/** Postać z rankingu (paczka ZIP o skrócie hash) jako rekord – bez zapisu (powtórki, podium). */
async function recordFromPack(bytes, hash, author) {
  const p = await readPack(await unpackZip(bytes));
  return {
    id: newId(), name: cleanName(p.cfg?.name || author, 'TOP3'), type: p.type, files: p.files, adjust: p.cfg?.adjust ?? {},
    colors: p.cfg?.colors ?? { ...DEFAULT_COLORS }, headK: p.cfg?.headK ?? 1, created: Date.now(), source: hash, author: cleanName(author), share: false,
  };
}

/** Postać z rankingu do obejrzenia (gotowa do gry, niezapisana) albo null. */
export async function previewPack(bytes, hash) {
  try { return bakeSkin(await buildSkin(await recordFromPack(bytes, hash, ''))); } catch { return null; }
}

/**
 * „⬇ POSTAĆ” w rankingu: zapisuje postać z najlepszej trójki wśród własnych (ta sama paczka drugi raz – nie dubluje)
 * i zwraca jej rekord. Rzuca failure('cr.err.limit' …), gdy nie ma już miejsca.
 */
export async function saveFromPack(bytes, hash, author) {
  const list = await listChars();
  const had = list.find((r) => r.source === hash);
  if (had) return had;
  if (list.length >= MAX_CHARS) throw failure('cr.err.limit', { max: MAX_CHARS });
  const rec = await recordFromPack(bytes, hash, author);
  await putChar(rec);
  return rec;
}

// ───────────────────────── paczki: wysyłanie (najlepsza trójka) ─────────────────────────
/** Paczka na serwer: klatki zmniejszone jednakowo do najwyżej SHARE_SIDE px (gra rysuje postać w ok. 180 px). */
const SHARE_SIDE = 480, SHARE_MAX = 1_400_000, PACKS_KEEP = 8;
const packKey = (rec) => `${rec.id}:${rec.updated ?? rec.created}`;
const sha256 = async (bytes) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');

/** ZIP postaci jak z eksportu (character.json + obrazki), stała data plików – ta sama zawartość daje te same bajty. */
export async function packZip(rec, scale = 1) {
  const enc = new TextEncoder();
  const keep = rec.type === 'head' ? [HEAD] : FRAMES;
  const files = [{ name: PACK_JSON, data: enc.encode(`${JSON.stringify(packJson(rec), null, 2)}\n`) }];
  for (const k of keep) {
    if (!rec.files?.[k]) continue;
    let blob = rec.files[k];
    if (scale < 1) {
      const bmp = await createImageBitmap(blob);
      const cv = scaledCanvas(bmp, 0, 0, bmp.width, bmp.height, Math.round(bmp.width * scale), Math.round(bmp.height * scale));
      blob = await toBlob(cv);
    }
    files.push({ name: `${k}.png`, data: new Uint8Array(await blob.arrayBuffer()) });
  }
  return zipFiles(files, new Date(2026, 0, 1));
}

/**
 * Skrót paczki postaci do rankingu (liczona raz i trzymana w magazynie 'packs'). Wszystkie klatki zmniejszone tym samym
 * mnożnikiem, więc skala klatek względem siebie się nie zmienia. Null, gdy gracz nie zgodził się udostępnić postaci
 * albo nie da się jej spakować w limicie serwera – wtedy bieg idzie do rankingu bez skrótu i serwer o paczkę nie poprosi.
 */
export async function sharePack(id) {
  try {
    const rec = await getChar(id);
    if (!rec?.share) return null;
    const key = packKey(rec);
    const cached = (await tx('readonly', (s) => s.getAll(), PACKS)).find((p) => p.key === key);
    if (cached) return cached.hash;
    const sides = await Promise.all(Object.values(rec.files ?? {}).map(async (b) => { const m = await measure(b); return Math.max(m.w, m.h); }));
    let scale = Math.min(1, SHARE_SIDE / Math.max(1, ...sides)), bytes = await packZip(rec, scale);
    for (let i = 0; bytes.length > SHARE_MAX && i < 4; i++) { scale *= 0.75; bytes = await packZip(rec, scale); }
    if (bytes.length > SHARE_MAX) return null;
    const hash = await sha256(bytes);
    await tx('readwrite', (s) => s.put({ hash, key, data: new Blob([bytes]), at: Date.now() }), PACKS);
    const all = (await tx('readonly', (s) => s.getAll(), PACKS)).sort((a, b) => b.at - a.at);
    for (const old of all.slice(PACKS_KEEP)) await tx('readwrite', (s) => s.delete(old.hash), PACKS);
    return hash;
  } catch { return null; }
}

/**
 * Bajty paczki o danym skrócie (dla klienta rankingu, gdy serwer o nią prosi) albo null – także wtedy, gdy gracz
 * w międzyczasie cofnął zgodę na udostępnienie albo usunął postać.
 */
export async function packBytes(hash) {
  try {
    const p = await tx('readonly', (s) => s.get(hash), PACKS);
    if (!p || !(await getChar(p.key.split(':')[0]))?.share) return null;
    return new Uint8Array(await p.data.arrayBuffer());
  } catch { return null; }
}
