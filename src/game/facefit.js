// Głowa z aparatu – obliczenia bez DOM i bez MediaPipe (testy: tests/facefit.test.ts).
//
// Wejście to punkty twarzy z MediaPipe Face Landmarker (478 punktów, współrzędne 0…1 obrazka) i maska postaci
// z MediaPipe Image Segmenter (selfie_segmenter: pewność 0…1, że piksel to człowiek). Stąd:
//   assess()    – podpowiedź dla gracza przed zdjęciem (przybliż się, patrz prosto…), jak przy weryfikacji w banku,
//   headAlpha() – przezroczystość wyciętej głowy: człowiek z maski, ale tylko powyżej linii żuchwy (bez szyi i ramion)
//                 i tylko spójny kawałek wokół twarzy (bez rąk i drugiej osoby obok),
//   skinColor() – kolor skóry z policzków i czoła (dłonie postaci w kolorze twarzy).

/** Obrys twarzy (MediaPipe FACEMESH_FACE_OVAL), zgodnie z ruchem wskazówek zegara od czoła. */
export const FACE_OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];
/** Ważne punkty siatki twarzy. Prawa / lewa – z punktu widzenia osoby na zdjęciu. */
export const LM = { top: 10, chin: 152, right: 234, left: 454, nose: 1, eyeR: 33, eyeL: 263, cheekR: 50, cheekL: 280, forehead: 151 };

/**
 * Owal na ekranie aparatu (ułamki okienka podglądu). Twarz (czoło – broda) powinna zajmować ok. FACE_FILL wysokości owalu:
 * reszta to włosy nad czołem i trochę miejsca na boki.
 */
export const OVAL = { cx: 0.5, cy: 0.47, ry: 0.36, aspect: 0.78 };
export const FACE_FILL = { min: 0.5, ideal: 0.68, max: 0.9 };
/** Granice „patrzy prosto”: nos między policzkami, nos między oczami a brodą, przechył linii oczu (stopnie). */
export const POSE = { yaw: 0.14, pitchMin: 0.22, pitchMax: 0.62, roll: 12 };
/** Średnia jasność twarzy (0–255), poniżej której prosimy o światło. */
export const DARK = 55;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, v) => { const q = clamp((v - a) / (b - a), 0, 1); return q * q * (3 - 2 * q); };

/**
 * Podpowiedź przed zdjęciem. faces – punkty twarzy w układzie okienka podglądu (0…1, już po odbiciu lustrzanym
 * i przycięciu obrazu do okienka), aspect – szerokość / wysokość okienka, light – średnia jasność twarzy albo null.
 * @param {{ x: number, y: number }[][]} faces
 * @param {number} [aspect]
 * @param {number | null} [light]
 * @returns {{ hint: 'noFace' | 'many' | 'closer' | 'farther' | 'center' | 'straight' | 'level' | 'dark' | 'ok', box?: { cx: number, cy: number, h: number } }}
 */
export function assess(faces, aspect = 4 / 3, light = null) {
  if (!faces?.length) return { hint: 'noFace' };
  if (faces.length > 1) return { hint: 'many' };
  const p = faces[0], at = (i) => p[i];
  const top = at(LM.top), chin = at(LM.chin), r = at(LM.right), l = at(LM.left), nose = at(LM.nose);
  // wysokość twarzy liczona w jednostkach wysokości okienka (x mnożymy przez proporcje okienka)
  const fh = Math.hypot((chin.x - top.x) * aspect, chin.y - top.y);
  const box = { cx: (top.x + chin.x) / 2, cy: (top.y + chin.y) / 2, h: fh };
  const fill = fh / (2 * OVAL.ry);
  if (fill < FACE_FILL.min) return { hint: 'closer', box };
  if (fill > FACE_FILL.max) return { hint: 'farther', box };
  const rx = (OVAL.ry * OVAL.aspect) / aspect;
  if (Math.abs(box.cx - OVAL.cx) > rx * 0.35 || Math.abs(box.cy - (OVAL.cy + OVAL.ry * 0.12)) > OVAL.ry * 0.3) return { hint: 'center', box };
  // obrót w bok: nos w połowie drogi między policzkami; w górę / w dół: nos w ok. 40% drogi od oczu do brody
  const yaw = (nose.x - r.x) / ((l.x - r.x) || 1e-6);
  const eyeY = (at(LM.eyeR).y + at(LM.eyeL).y) / 2;
  const pitch = (nose.y - eyeY) / ((chin.y - eyeY) || 1e-6);
  if (Math.abs(yaw - 0.5) > POSE.yaw || pitch < POSE.pitchMin || pitch > POSE.pitchMax) return { hint: 'straight', box };
  const eR = at(LM.eyeR), eL = at(LM.eyeL);
  let roll = (Math.atan2((eL.y - eR.y), (eL.x - eR.x) * aspect) * 180) / Math.PI;
  if (roll > 90) roll -= 180; else if (roll < -90) roll += 180;   // obraz w lustrze: lewe oko po prawej stronie
  if (Math.abs(roll) > POSE.roll) return { hint: 'level', box };
  if (light != null && light < DARK) return { hint: 'dark', box };
  return { hint: 'ok', box };
}

/**
 * Układ twarzy w pikselach obrazka w×h: środek między policzkami, oś u wzdłuż linii policzków (od prawego do lewego),
 * oś v w dół twarzy. Dzięki temu przechylona głowa jest wycinana tak samo jak prosta.
 */
export function faceFrame(lm, w, h) {
  const P = (i) => ({ x: lm[i].x * w, y: lm[i].y * h });
  const r = P(LM.right), l = P(LM.left), top = P(LM.top), chin = P(LM.chin);
  const c = { x: (r.x + l.x) / 2, y: (r.y + l.y) / 2 };
  const fw = Math.hypot(l.x - r.x, l.y - r.y) || 1;
  let ux = (l.x - r.x) / fw, uy = (l.y - r.y) / fw;
  let vx = -uy, vy = ux;
  if ((chin.x - c.x) * vx + (chin.y - c.y) * vy < 0) { vx = -vx; vy = -vy; }   // v zawsze w stronę brody
  const toUV = (x, y) => ({ u: (x - c.x) * ux + (y - c.y) * uy, v: (x - c.x) * vx + (y - c.y) * vy });
  const fh = Math.hypot(chin.x - top.x, chin.y - top.y) || 1;
  // żuchwa: punkty obrysu poniżej linii policzków, posortowane w poprzek twarzy
  const jaw = FACE_OVAL.map((i) => { const p = P(i); return toUV(p.x, p.y); }).filter((q) => q.v >= -0.02 * fh).sort((a, b) => a.u - b.u);
  return { c, ux, uy, vx, vy, fw, fh, jaw, toUV };
}

/**
 * Najniższa linia głowy (v) w danym miejscu w poprzek twarzy: pod żuchwą – żuchwa z małym zapasem na brodę,
 * z boku (uszy, włosy) – trochę poniżej policzków, ale nigdy niżej niż broda.
 */
export function chinLine(f, u) {
  const { jaw, fh } = f;
  const margin = 0.035 * fh;
  if (!jaw.length) return 0.5 * fh;
  const maxV = Math.max(...jaw.map((q) => q.v));
  if (u <= jaw[0].u || u >= jaw[jaw.length - 1].u) {
    const end = u <= jaw[0].u ? jaw[0] : jaw[jaw.length - 1];
    return Math.min(maxV, end.v + 0.28 * fh) + margin;
  }
  let i = 1;
  while (i < jaw.length - 1 && jaw[i].u < u) i++;
  const a = jaw[i - 1], b = jaw[i], q = (u - a.u) / ((b.u - a.u) || 1e-6);
  return a.v + (b.v - a.v) * q + margin;
}

/** Ramka, poza którą nic nie należy do głowy: na boki 1,05 szerokości twarzy od środka, w górę 1,45 jej wysokości. */
export const HEAD_BOX = { side: 1.05, up: 1.45 };

/**
 * Przezroczystość wyciętej głowy dla obrazka w×h.
 * @param {Float32Array} person pewność „człowiek” 0…1 w rozdzielczości maski mw×mh (może być inna niż obrazka)
 * @param {{ x: number, y: number }[]} lm punkty twarzy (0…1 obrazka)
 * @returns {Uint8ClampedArray} alfa 0–255, wiersz po wierszu
 */
export function headAlpha(person, mw, mh, lm, w, h) {
  const f = faceFrame(lm, w, h);
  const out = new Uint8ClampedArray(w * h);
  const feather = Math.max(1.5, 0.012 * f.fh);
  const sx = mw / w, sy = mh / h;
  // linia brody liczona raz dla siatki u (co piksel w poprzek twarzy)
  const uMax = HEAD_BOX.side * f.fw, steps = Math.ceil(2 * uMax) + 1, chin = new Float32Array(steps);
  for (let k = 0; k < steps; k++) chin[k] = chinLine(f, k - uMax);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const { u, v } = f.toUV(x + 0.5, y + 0.5);
      if (Math.abs(u) > uMax || v < -HEAD_BOX.up * f.fh) continue;
      const cv = chin[clamp(Math.round(u + uMax), 0, steps - 1)];
      const cut = 1 - smooth(cv - feather, cv + feather, v);
      if (cut <= 0) continue;
      const side = 1 - smooth(uMax - 2 * feather, uMax, Math.abs(u));
      const p = sample(person, mw, mh, (x + 0.5) * sx - 0.5, (y + 0.5) * sy - 0.5);
      out[y * w + x] = Math.round(255 * smooth(0.35, 0.75, p) * cut * side);
    }
  }
  keepAround(out, w, h, Math.round(f.c.x), Math.round(f.c.y));
  return out;
}

/** Maska w punkcie (x, y) z interpolacją dwuliniową. */
function sample(m, w, h, x, y) {
  x = clamp(x, 0, w - 1); y = clamp(y, 0, h - 1);
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
  const qx = x - x0, qy = y - y0;
  const a = m[y0 * w + x0] + (m[y0 * w + x1] - m[y0 * w + x0]) * qx;
  const b = m[y1 * w + x0] + (m[y1 * w + x1] - m[y1 * w + x0]) * qx;
  return a + (b - a) * qy;
}

/** Zostawia tylko spójny kawałek (alfa > 50%) zawierający punkt (sx, sy) i jego miękką krawędź; resztę zeruje. */
export function keepAround(alpha, w, h, sx, sy) {
  const THR = 128;
  sx = clamp(sx, 0, w - 1); sy = clamp(sy, 0, h - 1);
  if (alpha[sy * w + sx] <= THR) return;                // środek twarzy poza maską – zostawiamy jak jest
  const seen = new Uint8Array(w * h), stack = [sy * w + sx];
  seen[stack[0]] = 1;
  while (stack.length) {
    const i = stack.pop(), x = i % w, y = (i - x) / w;
    const n = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
    for (const j of n) if (j >= 0 && !seen[j] && alpha[j] > THR) { seen[j] = 1; stack.push(j); }
  }
  // krawędź (alfa ≤ 50%) zostaje tylko przy zachowanym kawałku – sąsiedztwo do 3 pikseli
  const near = new Uint8Array(seen);
  for (let pass = 0; pass < 3; pass++) {
    const prev = near.slice();
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (prev[i] || !alpha[i]) continue;
        if ((x > 0 && prev[i - 1]) || (x < w - 1 && prev[i + 1]) || (y > 0 && prev[i - w]) || (y < h - 1 && prev[i + w])) near[i] = 1;
      }
    }
  }
  for (let i = 0; i < alpha.length; i++) if (!near[i]) alpha[i] = 0;
}

/**
 * Kolor skóry: mediana jasności z trzech plam (policzki i czoło), każda 5×5 pikseli.
 * @param {Uint8ClampedArray} rgba piksele obrazka w×h
 * @returns {string} '#rrggbb'
 */
export function skinColor(rgba, w, h, lm) {
  const spots = [LM.cheekR, LM.cheekL, LM.forehead].map((i) => {
    const cx = Math.round(lm[i].x * w), cy = Math.round(lm[i].y * h);
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = cy - 2; y <= cy + 2; y++) {
      for (let x = cx - 2; x <= cx + 2; x++) {
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const k = (y * w + x) * 4;
        r += rgba[k]; g += rgba[k + 1]; b += rgba[k + 2]; n++;
      }
    }
    return n ? [r / n, g / n, b / n] : [242, 193, 156];
  }).sort((a, b) => (a[0] + a[1] + a[2]) - (b[0] + b[1] + b[2]));
  const [r, g, b] = spots[1];
  return `#${[r, g, b].map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('')}`;
}

/** Średnia jasność (0–255) w prostokącie (ułamki obrazka) – do podpowiedzi „za ciemno”. */
export function meanLight(rgba, w, h, x0, y0, x1, y1) {
  const ax = clamp(Math.floor(x0 * w), 0, w - 1), bx = clamp(Math.ceil(x1 * w), ax + 1, w);
  const ay = clamp(Math.floor(y0 * h), 0, h - 1), by = clamp(Math.ceil(y1 * h), ay + 1, h);
  let s = 0, n = 0;
  for (let y = ay; y < by; y++) {
    for (let x = ax; x < bx; x++) { const k = (y * w + x) * 4; s += 0.299 * rgba[k] + 0.587 * rgba[k + 1] + 0.114 * rgba[k + 2]; n++; }
  }
  return n ? s / n : 0;
}
