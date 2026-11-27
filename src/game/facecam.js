// Głowa z aparatu (KREATOR → „Głowa z aparatu”): podgląd z przedniego aparatu, wykrywanie twarzy na żywo z podpowiedziami,
// zdjęcie (samo, gdy twarz stoi dobrze przez chwilę, albo przyciskiem) i wycięcie głowy z tła. Wszystko liczy przeglądarka
// (MediaPipe: Face Landmarker + Image Segmenter, WebAssembly) – zdjęcie nie opuszcza urządzenia.
//
// Moduł ładuje się dopiero po wejściu w aparat (dynamiczny import w creator.js), razem z biblioteką i modelami
// (src/assets/models), więc gra bez tej funkcji nie pobiera ani bajta więcej. Obliczenia bez DOM: facefit.js.
import { FaceLandmarker, ImageSegmenter } from '@mediapipe/tasks-vision';
import wasmLoaderPath from '@mediapipe/tasks-vision/vision_wasm_internal.js?url';
import wasmBinaryPath from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url';
import faceModel from '../assets/models/face_landmarker.task?url';
import segModel from '../assets/models/selfie_segmenter.tflite?url';
import { OVAL, assess, headAlpha, meanLight, skinColor } from './facefit.js';

const FILESET = { wasmLoaderPath, wasmBinaryPath };
/** Tyle sekund twarz musi stać dobrze, zanim aparat sam zrobi zdjęcie. */
export const HOLD_S = 1.2;
/** Największy bok zdjęcia do wycinania (px) i wyciętej głowy. */
const WORK_SIDE = 1280, OUT_SIDE = 512;

let models = null;
/** Modele MediaPipe – wczytywane raz (najpierw na karcie graficznej, a gdy się nie da – na procesorze). */
export function loadModels() {
  models ??= (async () => {
    const make = async (delegate) => {
      const lm = await FaceLandmarker.createFromOptions(FILESET, {
        baseOptions: { modelAssetPath: faceModel, delegate }, runningMode: 'VIDEO', numFaces: 2,
        minFaceDetectionConfidence: 0.5, minFacePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
      });
      return lm;
    };
    let lm;
    try { lm = await make('GPU'); } catch { lm = await make('CPU'); }
    const seg = await ImageSegmenter.createFromOptions(FILESET, {
      baseOptions: { modelAssetPath: segModel, delegate: 'CPU' }, runningMode: 'IMAGE', outputConfidenceMasks: true, outputCategoryMask: false,
    });
    return { lm, seg, mode: 'VIDEO' };
  })();
  models.catch(() => { models = null; });
  return models;
}
async function setMode(m, mode) {
  if (m.mode === mode) return;
  await m.lm.setOptions({ runningMode: mode });
  m.mode = mode;
}

const canvasOf = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, w); c.height = Math.max(1, h); return c; };
const toBlob = (cv) => new Promise((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error('encode'))), 'image/png'));

/** Błąd aparatu: 'denied' (brak zgody), 'none' (brak aparatu / strona bez HTTPS) albo 'busy' (aparat zajęty). */
const camError = (e) => Object.assign(new Error('cam'), {
  cam: e?.name === 'NotAllowedError' || e?.name === 'SecurityError' ? 'denied' : e?.name === 'NotReadableError' || e?.name === 'AbortError' ? 'busy' : 'none',
});

/**
 * Aparat w elemencie <video>. onState({ hint, progress, box }) dostaje podpowiedź co klatkę;
 * onAuto() – gdy twarz stała dobrze przez HOLD_S (wtedy wywołujący robi zdjęcie).
 */
export class FaceCam {
  constructor(video, overlay, { onState, onAuto }) {
    this.video = video; this.overlay = overlay; this.onState = onState; this.onAuto = onAuto;
    this.stream = null; this.raf = 0; this.okSince = 0; this.lastT = -1; this.light = null; this.lightAt = 0;
    this.faces = []; this.auto = true;
    this.tiny = canvasOf(48, 36);
  }

  /** Włącza przedni aparat. Rzuca błąd z polem cam (camError). */
  async start() {
    if (!navigator.mediaDevices?.getUserMedia) throw camError({ name: 'NotFoundError' });
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: false, video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
      });
    } catch (e) { throw camError(e); }
    const v = this.video;
    v.srcObject = this.stream;
    v.muted = true; v.playsInline = true;
    await v.play().catch(() => {});
    if (!v.videoWidth) await new Promise((r) => v.addEventListener('loadedmetadata', r, { once: true }));
  }

  /** Pętla wykrywania twarzy (po wczytaniu modeli). */
  async run() {
    const m = await loadModels();
    await setMode(m, 'VIDEO');
    this.okSince = 0;
    const tick = (now) => {
      if (!this.stream) return;
      this.raf = requestAnimationFrame(tick);
      const v = this.video;
      if (v.readyState < 2 || v.currentTime === this.lastT) return;
      this.lastT = v.currentTime;
      let res;
      try { res = m.lm.detectForVideo(v, now); } catch { return; }
      this.faces = res.faceLandmarks ?? [];
      const view = this.view();
      const faces = this.faces.map((p) => p.map((q) => view.map(q)));
      if (now - this.lightAt > 250 && faces.length === 1) { this.lightAt = now; this.light = this.faceLight(this.faces[0]); }
      const a = assess(faces, view.aspect, faces.length === 1 ? this.light : null);
      if (a.hint === 'ok') this.okSince ||= now; else this.okSince = 0;
      const progress = this.okSince ? Math.min(1, (now - this.okSince) / (HOLD_S * 1000)) : 0;
      this.draw(a, progress, view);
      this.onState({ ...a, progress });
      if (progress >= 1 && this.auto) { this.okSince = 0; this.onAuto(); }
    };
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(tick);
  }

  pause() { cancelAnimationFrame(this.raf); this.raf = 0; this.okSince = 0; }

  stop() {
    this.pause();
    for (const tr of this.stream?.getTracks() ?? []) tr.stop();
    this.stream = null;
    this.video.srcObject = null;
    const c = this.overlay.getContext('2d');
    c.clearRect(0, 0, this.overlay.width, this.overlay.height);
  }

  /**
   * Jak obraz z aparatu leży w okienku: wypełnia je (object-fit: cover) i jest odbity jak w lustrze.
   * map(q) zamienia punkt obrazu (0…1) na punkt okienka (0…1).
   */
  view() {
    const v = this.video, r = v.getBoundingClientRect();
    const bw = r.width || 1, bh = r.height || 1, vw = v.videoWidth || 1, vh = v.videoHeight || 1;
    const k = Math.max(bw / vw, bh / vh), ox = (bw - vw * k) / 2, oy = (bh - vh * k) / 2;
    return {
      bw, bh, aspect: bw / bh, k, ox, oy,
      map: (q) => ({ x: 1 - (q.x * vw * k + ox) / bw, y: (q.y * vh * k + oy) / bh }),
    };
  }

  /** Średnia jasność twarzy z małej kopii klatki. */
  faceLight(p) {
    const c = this.tiny.getContext('2d', { willReadFrequently: true });
    c.drawImage(this.video, 0, 0, this.tiny.width, this.tiny.height);
    const px = c.getImageData(0, 0, this.tiny.width, this.tiny.height).data;
    let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
    for (const q of p) { x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); }
    return meanLight(px, this.tiny.width, this.tiny.height, x0, y0, x1, y1);
  }

  /** Owal i postęp na nakładce nad podglądem. */
  draw(a, progress, view) {
    const cv = this.overlay, d = Math.min(3, devicePixelRatio || 1);
    const w = Math.round(view.bw * d), h = Math.round(view.bh * d);
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    drawOval(cv.getContext('2d'), view.bw, view.bh, d, a.hint === 'ok' ? '#7ef0c0' : a.hint === 'noFace' ? '#ffffff' : '#ffd24a', progress);
  }

  /** Bieżąca klatka jako płótno (odbita jak w podglądzie, najwyżej WORK_SIDE px). */
  grab() {
    const v = this.video, k = Math.min(1, WORK_SIDE / Math.max(v.videoWidth, v.videoHeight));
    const cv = canvasOf(Math.round(v.videoWidth * k), Math.round(v.videoHeight * k)), c = cv.getContext('2d');
    c.translate(cv.width, 0); c.scale(-1, 1);
    c.drawImage(v, 0, 0, cv.width, cv.height);
    return cv;
  }
}

/** Owal: przyciemnione tło dookoła, obrys w kolorze podpowiedzi i łuk postępu (zdjęcie za chwilę). */
export function drawOval(c, bw, bh, d, color, progress = 0) {
  c.setTransform(d, 0, 0, d, 0, 0);
  c.clearRect(0, 0, bw, bh);
  const cx = OVAL.cx * bw, cy = OVAL.cy * bh, ry = OVAL.ry * bh, rx = ry * OVAL.aspect;
  c.fillStyle = 'rgba(5,7,20,.55)';
  c.beginPath(); c.rect(0, 0, bw, bh); c.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2, true); c.fill('evenodd');
  c.lineWidth = 3; c.strokeStyle = color;
  c.beginPath(); c.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); c.stroke();
  if (progress > 0) {
    c.lineWidth = 7; c.lineCap = 'round'; c.strokeStyle = '#7ef0c0';
    c.beginPath(); c.ellipse(cx, cy, rx + 7, ry + 7, 0, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2); c.stroke();
  }
}

/** Zdjęcie z galerii jako płótno (najwyżej WORK_SIDE px, bez odbicia). */
export async function imageCanvas(file) {
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { throw Object.assign(new Error('decode'), { cam: 'image' }); }
  const k = Math.min(1, WORK_SIDE / Math.max(bmp.width, bmp.height));
  const cv = canvasOf(Math.round(bmp.width * k), Math.round(bmp.height * k));
  cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
  bmp.close?.();
  return cv;
}

/**
 * Zdjęcie → wycięta głowa: { blob (PNG z przezroczystym tłem), skin ('#rrggbb') }.
 * live = klatka z aparatu: wykrywanie zostaje w trybie wideo (przełączanie trybu w MediaPipe buduje wszystko od nowa
 * i trwa kilka sekund), zdjęcie z galerii – tryb pojedynczego obrazka.
 * Rzuca błąd z polem cam: 'face' (brak twarzy) albo 'many' (kilka twarzy).
 * @param {HTMLCanvasElement} cv
 */
export async function cutHead(cv, live = false) {
  const m = await loadModels();
  await setMode(m, live ? 'VIDEO' : 'IMAGE');
  const faces = (live ? m.lm.detectForVideo(cv, performance.now()) : m.lm.detect(cv)).faceLandmarks ?? [];
  if (!faces.length) throw Object.assign(new Error('face'), { cam: 'face' });
  if (faces.length > 1) throw Object.assign(new Error('many'), { cam: 'many' });
  const lm = faces[0];
  let person = null, mw = 0, mh = 0;
  m.seg.segment(cv, (res) => {
    const mask = res.confidenceMasks?.[0];
    if (!mask) return;
    mw = mask.width; mh = mask.height;
    person = mask.getAsFloat32Array().slice();          // maska ważna tylko w tym wywołaniu – kopiujemy
  });
  if (!person) throw Object.assign(new Error('seg'), { cam: 'face' });
  const w = cv.width, h = cv.height, c = cv.getContext('2d', { willReadFrequently: true });
  const img = c.getImageData(0, 0, w, h);
  const alpha = headAlpha(person, mw, mh, lm, w, h);
  const skin = skinColor(img.data, w, h, lm);
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = alpha[y * w + x];
      img.data[(y * w + x) * 4 + 3] = a;
      if (a > 16) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
  }
  if (x1 < 0) throw Object.assign(new Error('empty'), { cam: 'face' });
  const full = canvasOf(w, h);
  full.getContext('2d').putImageData(img, 0, 0);
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1, k = Math.min(1, OUT_SIDE / Math.max(bw, bh));
  const out = canvasOf(Math.round(bw * k), Math.round(bh * k)), o = out.getContext('2d');
  o.imageSmoothingQuality = 'high';
  o.drawImage(full, x0, y0, bw, bh, 0, 0, out.width, out.height);
  return { blob: await toBlob(out), skin };
}
