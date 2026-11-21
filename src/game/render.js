// Rysowanie: świat, HUD i ekrany. Funkcje tylko czytają stan gry (g) – niczego w nim nie zmieniają.
import {
  BLOCK, COMBO_TIME, FIELD, GAP, H, HURRY_EVERY, ITEM_LIFT, ITEM_R, LEFT, MAX_HURRIES, NARROW_BY, PLAT_H, RIGHT, SLOW_TIME, W, WALL, floorAt, narrowLevel,
} from '../sim';
import { sfx } from './audio.js';
import { CHARS, drawHero } from './characters.js';
import {
  FONT, MEDALS, NEON, PEN, PENCILS, STYLES, brickPattern, burst, canvas, ctx, cycle, ditherPattern, hatchPattern, lowCanvas, lowCtx, mainCtx,
  rr, setCtx, stonePattern, style, text, themeOf, ui, wobblyRect,
} from './gfx.js';
import { haptics } from './haptics.js';
import { LANG_NAMES, lang, t } from './i18n.js';
import { isTouch, tilt } from './input.js';
import { PERIODS, SETTINGS, UIBOX, slotX } from './layout.js';
import { clamp, easeOutBack, hash, mod, rand, reduceMotion } from './util.js';

export function render(g) {
  const mw = canvas.width, mh = canvas.height;
  if (style.pixel) {                                  // świat w niskiej rozdzielczości, powiększany bez wygładzania
    const lw = W / style.pixel, lh = H / style.pixel;
    if (lowCanvas.width !== lw) { lowCanvas.width = lw; lowCanvas.height = lh; }
    setCtx(lowCtx);
    ctx.setTransform(1 / style.pixel, 0, 0, 1 / style.pixel, 0, 0);
    ctx.clearRect(0, 0, W, H);
    drawWorld(g);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = ditherPattern; ctx.fillRect(0, 0, lw, lh);
    setCtx(mainCtx);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(lowCanvas, 0, 0, mw, mh);
    ctx.imageSmoothingEnabled = true;
    ctx.setTransform(mw / W, 0, 0, mh / H, 0, 0);
  } else {
    setCtx(mainCtx);
    ctx.setTransform(mw / W, 0, 0, mh / H, 0, 0);
    ctx.clearRect(0, 0, W, H);
    drawWorld(g);
  }
  drawHud(g);
  if (g.state === 'title') drawTitle(g);
  else if (g.state === 'pause') drawPause(g);
  else if (g.state === 'over') drawOver(g);
  else if (g.state === 'board') drawBoard(g);
  else if (g.state === 'settings') drawSettings(g);
  else if (g.state === 'replay') drawReplay(g);
  else if (g.state === 'recap') drawRecap(g);
  drawMessages(g);
  style.post?.(g);
}

function drawWorld(g) {
  const c = ctx, camY = g.sim.camY;
  c.save();
  if (g.shake > 0 && !reduceMotion) c.translate(rand(-1, 1) * g.shake * 6, rand(-1, 1) * g.shake * 6);

  c.save();
  c.beginPath(); c.rect(LEFT, 0, FIELD, H); c.clip();
  drawBackdrop(g);
  c.translate(0, -camY);
  for (let n = g.sim.lowN; n < g.sim.genN; n++) drawPlatform(g, floorAt(g.sim.seed, n));
  drawItems(g);
  for (const p of g.parts) {
    c.globalAlpha = clamp(p.life / p.max, 0, 1);
    if (p.spark) {                                     // iskra: krótka smuga wzdłuż prędkości
      c.strokeStyle = p.color; c.lineWidth = p.size; c.lineCap = 'round';
      c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x - p.vx * 0.045, p.y - p.vy * 0.045); c.stroke();
      continue;
    }
    c.fillStyle = p.color;
    if (p.star) { burst(p.x, p.y, p.size * 0.45, p.size, 4, p.rot); c.fill(); }
    else { c.beginPath(); c.arc(p.x, p.y, p.size, 0, 7); c.fill(); }
  }
  c.globalAlpha = 1;
  const h = g.sim.hero;
  if (style.world === 'neon') {                      // poświata, żeby postać nie ginęła w ciemności
    const glow = c.createRadialGradient(h.x, h.y - 26, 4, h.x, h.y - 26, 44);
    glow.addColorStop(0, 'rgba(255,255,255,.22)'); glow.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = glow; c.fillRect(h.x - 46, h.y - 72, 92, 92);
  }
  drawHero(h, g.fx, g.t, g.heroIdx);
  if (g.tier && ['play', 'pause', 'over', 'replay'].includes(g.state)) drawCrown(h.x, h.y - 70 + (reduceMotion ? 0 : Math.sin(g.t * 3) * 2), g.tier, g.t, 1, -h.vx / 4000);
  c.restore();

  drawWalls(g);
  const danger = c.createLinearGradient(0, H - 70, 0, H);   // strefa zagrożenia na dole
  danger.addColorStop(0, `rgba(${ui.dim},0)`); danger.addColorStop(1, `rgba(${ui.dim},.78)`);
  c.fillStyle = danger; c.fillRect(LEFT, H - 70, FIELD, 70);
  c.restore();
}

// ── nagrody najlepszej trójki ──
/** Korona (1 złota, 2 srebrna, 3 brązowa) o środku podstawy w (x, y). */
export function drawCrown(x, y, tier, time, k = 1, tiltA = 0) {
  const c = ctx, m = MEDALS[tier];
  c.save();
  c.translate(x, y); c.rotate(clamp(tiltA, -0.25, 0.25)); c.scale(k, k);
  const glow = c.createRadialGradient(0, -5, 2, 0, -5, 22);
  glow.addColorStop(0, `${m.hi}88`); glow.addColorStop(1, `${m.hi}00`);
  c.fillStyle = glow; c.fillRect(-24, -28, 48, 46);
  c.beginPath();
  c.moveTo(-12, 4); c.lineTo(-13, -9); c.lineTo(-6.5, -3); c.lineTo(0, -13); c.lineTo(6.5, -3); c.lineTo(13, -9); c.lineTo(12, 4); c.closePath();
  const grad = c.createLinearGradient(0, -13, 0, 4);
  grad.addColorStop(0, m.hi); grad.addColorStop(0.55, m.mid); grad.addColorStop(1, m.lo);
  c.fillStyle = grad; c.fill();
  c.strokeStyle = '#3a1c10'; c.lineWidth = 1.5; c.lineJoin = 'round'; c.stroke();
  c.fillStyle = m.lo; c.fillRect(-12, 0.5, 24, 1.5);               // obręcz
  for (const [px, py] of [[-13, -9], [0, -13], [13, -9]]) {         // kulki na szpicach
    c.fillStyle = m.hi; c.beginPath(); c.arc(px, py, 2, 0, 7); c.fill(); c.stroke();
  }
  for (const [gx, col] of [[-6.5, '#3fa9ff'], [0, '#ff4f6d'], [6.5, '#3fd17a']]) {   // kamienie
    c.fillStyle = col; c.beginPath(); c.arc(gx, -2.5, gx ? 1.7 : 2.2, 0, 7); c.fill();
    c.fillStyle = 'rgba(255,255,255,.8)'; c.fillRect(gx - 0.8, -3.6, 0.9, 0.9);
  }
  if (!reduceMotion) {                                               // błysk wędrujący po szpicach
    const ph = mod(time * 0.9, 1), tip = [[-13, -9], [0, -13], [13, -9]][mod(Math.floor(time * 0.9), 3)];
    const a = Math.sin(ph * Math.PI);
    c.globalAlpha = a; c.fillStyle = '#fff';
    burst(tip[0], tip[1], 0.8, 5.5 * a + 1, 4, time); c.fill();
    c.globalAlpha = 1;
  }
  c.restore();
}

// ── tło ──
function drawBackdrop(g) {
  const c = ctx, time = g.t, bgY = g.sim.camY * 0.5;      // paralaksa
  const kLo = Math.max(0, Math.ceil((-260 - bgY - H - 120) / 440)), kHi = Math.floor((-260 - bgY + 140) / 440);

  if (style.world === 'neon') {
    const grad = c.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#0b0222'); grad.addColorStop(1, '#210744');
    c.fillStyle = grad; c.fillRect(LEFT, 0, FIELD, H);
    c.fillStyle = 'rgba(255,94,224,.16)';
    for (let x = LEFT + 32; x < RIGHT; x += 32) c.fillRect(x, 0, 1, H);
    for (let y = -mod(bgY, 32); y < H; y += 32) c.fillRect(LEFT, y, FIELD, 1);
    for (const s of g.snow) {
      c.fillStyle = s.ph > 3.5 ? 'rgba(94,245,255,.7)' : 'rgba(255,94,224,.7)';
      c.fillRect(s.x, H - s.y, s.r, s.r);
    }
    return;
  }

  if (style.world === 'sketch') {
    c.fillStyle = '#f7f2e4'; c.fillRect(LEFT, 0, FIELD, H);
    c.fillStyle = 'rgba(70,120,200,.2)';
    for (let x = LEFT + 16; x < RIGHT; x += 16) c.fillRect(x, 0, 1, H);
    for (let y = -mod(bgY, 16); y < H; y += 16) c.fillRect(LEFT, y, FIELD, 1);
    c.save();
    c.strokeStyle = 'rgba(31,42,68,.3)'; c.fillStyle = 'rgba(31,42,68,.38)'; c.lineWidth = 1.6; c.lineCap = 'round'; c.lineJoin = 'round';
    for (let k = kLo; k <= kHi; k++) {                   // bazgroły na marginesie zeszytu
      const x = k % 2 ? LEFT + 70 : RIGHT - 120, y = -260 - k * 440 - bgY;
      c.beginPath();
      if (k % 4 === 0) {
        c.moveTo(x, y + 44); c.lineTo(x + 2, y); c.moveTo(x - 9, y + 13); c.lineTo(x + 2, y); c.lineTo(x + 12, y + 12); c.stroke();
        c.save(); c.translate(x + 40, y + 26); c.rotate(-0.12);
        c.font = `700 14px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(t('deco.higher'), 0, 0);
        c.restore();
      } else if (k % 4 === 1) {
        burst(x + 20, y + 24, 8, 19, 5, -Math.PI / 2); c.stroke();
      } else if (k % 4 === 2) {
        c.arc(x, y + 24, 10, Math.PI, 0); c.arc(x + 17, y + 17, 13, Math.PI * 1.1, -0.1); c.arc(x + 34, y + 24, 10, Math.PI, 0);
        c.closePath(); c.stroke();
      } else {
        for (let a = 0; a < 13; a += 0.3) c.lineTo(x + 20 + Math.cos(a) * a * 1.7, y + 24 + Math.sin(a) * a * 1.7);
        c.stroke();
      }
    }
    c.restore();
    return;
  }

  // „Zamieć” (także pod filtrami: Stare kino, Retro LCD)
  c.save(); c.translate(0, -mod(bgY, 32)); c.fillStyle = brickPattern; c.fillRect(LEFT - 64, -32, FIELD + 128, H + 96); c.restore();
  for (let k = kLo; k <= kHi; k++) drawWindow(k % 2 ? LEFT + 70 : RIGHT - 122, -260 - k * 440 - bgY, k);
  const shade = c.createLinearGradient(LEFT, 0, RIGHT, 0);
  shade.addColorStop(0, 'rgba(5,8,25,.55)'); shade.addColorStop(0.18, 'rgba(5,8,25,0)');
  shade.addColorStop(0.82, 'rgba(5,8,25,0)'); shade.addColorStop(1, 'rgba(5,8,25,.55)');
  c.fillStyle = shade; c.fillRect(LEFT, 0, FIELD, H);
  c.fillStyle = 'rgba(255,255,255,.55)';
  for (const s of g.snow) { c.beginPath(); c.arc(s.x, s.y, s.r, 0, 7); c.fill(); }
}

function drawWindow(x, y, k) {
  const c = ctx;
  const glow = c.createRadialGradient(x + 26, y + 50, 5, x + 26, y + 50, 120);
  glow.addColorStop(0, 'rgba(140,200,255,.22)'); glow.addColorStop(1, 'rgba(140,200,255,0)');
  c.fillStyle = glow; c.fillRect(x - 100, y - 80, 252, 260);
  const arch = (ix) => { c.beginPath(); c.moveTo(x + ix, y + 84); c.lineTo(x + ix, y + 26); c.arc(x + 26, y + 26, 26 - ix, Math.PI, 0); c.lineTo(x + 52 - ix, y + 84); c.closePath(); };
  arch(0); c.fillStyle = '#0d1230'; c.fill();
  arch(5);
  const sky = c.createLinearGradient(0, y, 0, y + 84);
  sky.addColorStop(0, '#1d3f86'); sky.addColorStop(1, '#6fb4ee');
  c.fillStyle = sky; c.fill();
  c.save(); c.clip();
  c.fillStyle = '#fdf6d0'; c.beginPath(); c.arc(x + 18 + hash(k) * 18, y + 26 + hash(k, 2) * 12, 6, 0, 7); c.fill();
  c.fillStyle = 'rgba(255,255,255,.8)';
  for (let i = 0; i < 4; i++) c.fillRect(x + 8 + hash(k, i + 5) * 36, y + 8 + hash(k, i + 9) * 60, 1.4, 1.4);
  c.restore();
  c.fillStyle = '#0d1230'; c.fillRect(x + 24.5, y + 2, 3, 82); c.fillRect(x + 4, y + 46, 44, 3);
  c.fillStyle = '#3a4478'; rr(x - 6, y + 83, 64, 7, 2); c.fill();
  c.fillStyle = '#eaf6ff'; rr(x - 5, y + 81, 62, 4, 2); c.fill();
}

// ── platformy ──
function drawPlatform(g, p) {
  const c = ctx, y = p.y, cx = p.x + p.w / 2;
  const signed = p.n > 0 && p.n % 10 === 0;              // tabliczka z numerem co 10 pięter

  if (style.world === 'neon') {
    const col = cycle(NEON, p.n);
    c.save();
    c.shadowColor = col; c.shadowBlur = 14;
    c.fillStyle = '#14062e'; rr(p.x, y, p.w, PLAT_H - 4, 4); c.fill();
    c.strokeStyle = col; c.lineWidth = 2; c.stroke();
    c.restore();
    c.globalAlpha = 0.5; c.fillStyle = col; c.fillRect(p.x + 7, y + PLAT_H - 10, p.w - 14, 1.5); c.globalAlpha = 1;
    if (signed) text(String(p.n), cx, y + PLAT_H + 9, { size: 12, color: col, stroke: '#12002b', sw: 3 });
    return;
  }

  if (style.world === 'sketch') {
    const seed = p.n * 17 + (reduceMotion ? 0 : Math.floor(g.t * 5)), col = cycle(PENCILS, p.n);
    wobblyRect(p.x, y, p.w, PLAT_H - 3, seed);
    c.fillStyle = '#fffdf6'; c.fill();
    c.save(); c.clip();
    c.strokeStyle = col; c.globalAlpha = 0.8; c.lineWidth = 1.4; c.beginPath();
    for (let hx = p.x - 20; hx < p.x + p.w; hx += 7) { c.moveTo(hx, y + PLAT_H); c.lineTo(hx + 16, y - 2); }
    c.stroke();
    c.restore();
    c.strokeStyle = PEN; c.lineJoin = 'round'; c.lineWidth = 2;
    wobblyRect(p.x, y, p.w, PLAT_H - 3, seed); c.stroke();
    c.globalAlpha = 0.4; c.lineWidth = 1;
    wobblyRect(p.x - 1, y - 1, p.w + 2, PLAT_H - 1, seed + 7, 1.8); c.stroke();
    c.globalAlpha = 1;
    if (signed) text(String(p.n), cx, y + PLAT_H + 8, { size: 13, color: col, stroke: '#f7f2e4', sw: 4 });
    return;
  }

  const th = themeOf(p.n);
  c.fillStyle = 'rgba(0,0,0,.3)'; rr(p.x + 3, y + 5, p.w, PLAT_H, 6); c.fill();
  if (th.decor === 'drips') {
    c.fillStyle = th.drip;
    const cnt = Math.floor(p.w / 20);
    for (let i = 0; i < cnt; i++) {
      const hx = p.x + 10 + i * 20 + (hash(p.n, i) - 0.5) * 8, len = 4 + hash(p.n, i + 50) * 13;
      c.beginPath(); c.moveTo(hx - 4, y + PLAT_H - 2); c.lineTo(hx + 4, y + PLAT_H - 2); c.lineTo(hx, y + PLAT_H + len); c.closePath(); c.fill();
    }
  }
  c.fillStyle = th.body; rr(p.x, y, p.w, PLAT_H, 6); c.fill();
  c.fillStyle = th.dark; rr(p.x, y + PLAT_H - 6, p.w, 6, [0, 0, 6, 6]); c.fill();
  if (th.decor === 'seams') {
    c.fillStyle = th.dark; c.globalAlpha = 0.55;
    const block = BLOCK - NARROW_BY * narrowLevel(p.n);   // szczeliny między klockami, z których złożone jest piętro
    for (let sx = p.x + block; sx < p.x + p.w - 6; sx += block) c.fillRect(sx, y + 4, 1.5, PLAT_H - 4);
    c.globalAlpha = 1;
  } else if (th.decor === 'rivets') {
    c.fillStyle = th.top;
    for (let sx = p.x + 12; sx < p.x + p.w - 6; sx += 24) { c.beginPath(); c.arc(sx, y + 10, 1.8, 0, 7); c.fill(); }
  }
  c.fillStyle = th.top; rr(p.x - 2, y - 2, p.w + 4, 7, 3.5); c.fill();
  c.fillStyle = 'rgba(255,255,255,.55)'; c.fillRect(p.x + 6, y - 0.5, p.w - 12, 1.5);
  if (signed) {
    const k = style.pixel ? 1.5 : 1;                     // w grubych pikselach tabliczka musi być większa
    c.fillStyle = '#141a40'; rr(cx - 21 * k, y + PLAT_H - 2, 42 * k, 18 * k, 5); c.fill();
    c.strokeStyle = th.top; c.lineWidth = 1.5; c.stroke();
    text(String(p.n), cx, y + PLAT_H - 2 + 9.5 * k, { size: 11 * k, color: '#ffe680', sw: 0 });
  }
}

// ── przedmioty: booster wyrzutu i spowolnienie ──
function drawItems(g) {
  const s = g.sim, top = s.camY - 40, bottom = s.camY + H + 40;
  const visible = (n) => { const y = -n * GAP - ITEM_LIFT; return y > top && y < bottom; };
  if (!s.rising && visible(s.boost.n)) drawBooster(s.boost.x, -s.boost.n * GAP - ITEM_LIFT, g.t);
  if (s.slow.n >= 0 && visible(s.slow.n)) drawSlowItem(s.slow.x, -s.slow.n * GAP - ITEM_LIFT, g.t);
}

/** Kula z poświatą – wspólna podstawa obu przedmiotów. Lekkie kołysanie jest tylko wizualne (łapie się w stałym miejscu). */
function orb(x, y, t, inner, outer, glow) {
  const c = ctx, r = ITEM_R, pulse = reduceMotion ? 1 : 1 + Math.sin(t * 6) * 0.08;
  const halo = c.createRadialGradient(x, y, r * 0.4, x, y, r * 2.6 * pulse);
  halo.addColorStop(0, glow); halo.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = halo; c.beginPath(); c.arc(x, y, r * 2.6 * pulse, 0, 7); c.fill();
  const body = c.createRadialGradient(x - r * 0.35, y - r * 0.4, 1, x, y, r);
  body.addColorStop(0, inner); body.addColorStop(1, outer);
  c.fillStyle = body; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill();
  c.strokeStyle = 'rgba(255,255,255,.85)'; c.lineWidth = 2; c.stroke();
}

function drawBooster(x, y0, t) {
  const c = ctx, y = y0 + (reduceMotion ? 0 : Math.sin(t * 3) * 3);
  orb(x, y, t, '#fff3a0', '#ff6a2c', 'rgba(255,170,60,.55)');
  // dwie strzałki w górę
  c.strokeStyle = '#3a1300'; c.lineWidth = 2.6; c.lineCap = 'round'; c.lineJoin = 'round';
  for (const dy of [-3, 4]) { c.beginPath(); c.moveTo(x - 6, y + dy + 3); c.lineTo(x, y + dy - 3); c.lineTo(x + 6, y + dy + 3); c.stroke(); }
}

function drawSlowItem(x, y0, t) {
  const c = ctx, y = y0 + (reduceMotion ? 0 : Math.sin(t * 2.4 + 1) * 3);
  orb(x, y, t, '#e8f7ff', '#3b8fe0', 'rgba(110,190,255,.55)');
  // klepsydra
  c.fillStyle = '#0d2a52'; c.strokeStyle = '#0d2a52'; c.lineWidth = 2; c.lineJoin = 'round';
  c.beginPath(); c.moveTo(x - 5.5, y - 7); c.lineTo(x + 5.5, y - 7); c.lineTo(x, y); c.lineTo(x + 5.5, y + 7); c.lineTo(x - 5.5, y + 7); c.lineTo(x, y); c.closePath(); c.stroke();
  c.beginPath(); c.moveTo(x - 3.5, y + 6); c.lineTo(x + 3.5, y + 6); c.lineTo(x, y + 2); c.closePath(); c.fill();
}

// ── ściany ──
function drawWalls(g) {
  const c = ctx, camY = g.sim.camY;
  if (style.world === 'neon') {
    c.fillStyle = '#0d0326'; c.fillRect(0, 0, WALL, H); c.fillRect(RIGHT, 0, WALL, H);
    c.fillStyle = 'rgba(94,245,255,.15)';
    for (const x of [0, RIGHT]) {
      for (let y = -mod(camY, 24); y < H; y += 24) c.fillRect(x, y, WALL, 1);
      c.fillRect(x + 32, 0, 1, H); c.fillRect(x + 64, 0, 1, H);
    }
    c.save(); c.shadowColor = '#5ef5ff'; c.shadowBlur = 16; c.fillStyle = '#5ef5ff';
    c.fillRect(LEFT - 2.5, 0, 2.5, H); c.fillRect(RIGHT, 0, 2.5, H);
    c.restore();
    return;
  }
  if (style.world === 'sketch') {
    c.fillStyle = '#ece3cc'; c.fillRect(0, 0, WALL, H); c.fillRect(RIGHT, 0, WALL, H);
    for (const x of [0, RIGHT]) {
      c.save(); c.beginPath(); c.rect(x, 0, WALL, H); c.clip();
      c.translate(0, -mod(camY, 12)); c.fillStyle = hatchPattern; c.fillRect(x - 12, -12, WALL + 24, H + 36);
      c.restore();
    }
    c.fillStyle = PEN; c.fillRect(LEFT - 2, 0, 2, H); c.fillRect(RIGHT, 0, 2, H);
    c.fillStyle = 'rgba(200,30,30,.65)'; c.fillRect(LEFT + 3, 0, 1.5, H); c.fillRect(RIGHT - 4.5, 0, 1.5, H);
    return;
  }
  for (const x of [0, RIGHT]) {
    c.save(); c.beginPath(); c.rect(x, 0, WALL, H); c.clip();
    c.translate(0, -mod(camY, 48)); c.fillStyle = stonePattern; c.fillRect(x - 48, -48, WALL + 96, H + 144);
    c.restore();
  }
  c.fillStyle = '#12173a'; c.fillRect(LEFT - 5, 0, 5, H); c.fillRect(RIGHT, 0, 5, H);
  c.fillStyle = '#9fd8ff'; c.fillRect(LEFT - 1.5, 0, 1.5, H); c.fillRect(RIGHT, 0, 1.5, H);
}

// ── HUD ──
function drawHud(g) {
  const c = ctx, time = g.t;
  // zegar
  const cx = 48, cy = 50, ringing = g.msgs.some((m) => m.hurry);
  c.save();
  if (ringing && !reduceMotion) c.translate(Math.sin(time * 60) * 2, 0);
  c.fillStyle = ui.frame; c.beginPath(); c.arc(cx, cy, 33, 0, 7); c.fill();
  c.fillStyle = '#ffd24a'; c.beginPath(); c.arc(cx, cy, 30, 0, 7); c.fill();
  c.fillStyle = '#fff8e1'; c.beginPath(); c.arc(cx, cy, 25, 0, 7); c.fill();
  c.strokeStyle = '#12173a'; c.lineWidth = 2; c.lineCap = 'round';
  for (let i = 0; i < 12; i++) {
    const a = i * Math.PI / 6, r0 = i % 3 ? 21 : 18;
    c.beginPath(); c.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); c.lineTo(cx + Math.cos(a) * 23, cy + Math.sin(a) * 23); c.stroke();
  }
  const broken = g.sim.hurries >= MAX_HURRIES;
  const ha = -Math.PI / 2 + (broken ? 2.2 + Math.sin(time * 40) * 0.06 : (g.sim.clock / HURRY_EVERY) * Math.PI * 2);
  c.strokeStyle = '#e5482f'; c.lineWidth = 3.5;
  c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.cos(ha) * 19, cy + Math.sin(ha) * 19); c.stroke();
  c.fillStyle = '#12173a'; c.beginPath(); c.arc(cx, cy, 3.5, 0, 7); c.fill();
  c.restore();
  text(g.sim.scrolling ? t('hud.tempo', { n: g.sim.level }) : t('hud.tempoOff'), cx, 96, { size: 11, color: ui.hint, sw: 3, maxW: 88 });

  // miernik combo
  const mx = 38, my = 122, mw = 20, mh = 170, frac = clamp(g.sim.combo.timer / COMBO_TIME, 0, 1);
  text(t('hud.combo'), cx, 112, { size: 10, color: ui.hint, sw: 3, maxW: 88 });
  c.fillStyle = ui.frame; rr(mx - 3, my - 3, mw + 6, mh + 6, 8); c.fill();
  c.fillStyle = ui.meterBg; rr(mx, my, mw, mh, 6); c.fill();
  if (frac > 0) {
    const grad = c.createLinearGradient(0, my + mh, 0, my);
    grad.addColorStop(0, '#ff5a3c'); grad.addColorStop(0.5, '#ffb52e'); grad.addColorStop(1, '#fff07a');
    c.fillStyle = grad; rr(mx, my + mh * (1 - frac), mw, mh * frac, 6); c.fill();
  }
  c.fillStyle = 'rgba(255,255,255,.18)'; rr(mx + 3, my + 3, 4, mh - 6, 2); c.fill();
  const active = g.sim.combo.floors > 0;
  burst(cx, 332, 20, 31, 10, time * (active ? 1.6 : 0.2));
  c.fillStyle = active ? '#ffd24a' : ui.off; c.fill();
  c.strokeStyle = ui.frame; c.lineWidth = 2.5; c.lineJoin = 'round'; c.stroke();
  text(String(g.sim.combo.floors), cx, 333, { size: 18, color: active ? '#fff' : ui.offText, stroke: active ? '#12173a' : ui.off, sw: 4 });
  if (active) text(t('hud.floors'), cx, 372, { size: 10, color: ui.note, sw: 3, maxW: 88 });

  // spowolnienie wieży: ile jeszcze trwa
  if (g.sim.slow.t > 0) {
    const f = clamp(g.sim.slow.t / SLOW_TIME, 0, 1), by = 404;
    drawSlowItem(cx, by, time);
    c.fillStyle = ui.frame; rr(cx - 30, by + 20, 60, 9, 4.5); c.fill();
    c.fillStyle = '#7ec8ff'; rr(cx - 28, by + 22, 56 * f, 5, 2.5); c.fill();
    text(t('hud.slow'), cx, by + 42, { size: 10, color: ui.hint, sw: 3, maxW: 88 });
  }

  // wynik
  const rx = RIGHT + WALL / 2;
  c.fillStyle = ui.panel; rr(RIGHT + 9, 10, WALL - 18, 152, 10); c.fill();
  text(t('hud.score'), rx, 26, { size: 10, color: ui.label, sw: 0, maxW: 80 });
  text(String(g.score), rx, 46, { size: 20, color: ui.gold, sw: 3, maxW: 70 });
  text(t('hud.floor'), rx, 74, { size: 10, color: ui.label, sw: 0, maxW: 80 });
  text(String(g.sim.maxFloor), rx, 94, { size: 20, sw: 3, maxW: 70 });
  text(t('hud.best'), rx, 122, { size: 10, color: ui.label, sw: 0, maxW: 80 });
  text(String(Math.max(g.best.score, g.score)), rx, 141, { size: 15, color: ui.mint, sw: 3, maxW: 70 });
  if (sfx.muted) text('🔇', rx, 182, { size: 16, sw: 0 });

  // wskaźnik przechyłu: kropka pokazuje, jak mocno i w którą stronę gra „czyta” telefon
  if (tilt.active && g.state === 'play') {
    const bx = W / 2, by = H - 13;
    c.fillStyle = ui.panel; rr(bx - 64, by - 5, 128, 10, 5); c.fill();
    c.strokeStyle = ui.line; c.lineWidth = 1; c.stroke();
    c.fillStyle = ui.line; c.fillRect(bx - 0.75, by - 5, 1.5, 10);
    c.fillStyle = ui.gold; c.beginPath(); c.arc(bx + tilt.axis * 58, by, 6, 0, 7); c.fill();
    c.strokeStyle = ui.frame; c.lineWidth = 1.5; c.stroke();
  }
}

function drawMessages(g) {
  const c = ctx;
  g.msgs.forEach((m, i) => {
    const a = clamp((m.dur - m.t) / 0.3, 0, 1), s = easeOutBack(clamp(m.t / 0.25, 0, 1));
    c.save();
    c.globalAlpha = a;
    c.translate(W / 2, 128 + i * 62 - m.t * 10); c.rotate(-0.05); c.scale(s, s);
    const size = Math.min(40, 400 / Math.max(6, m.title.length) * 1.25);
    text(m.title, 0, 0, { size, color: ui[m.color] || ui.gold, sw: 7, maxW: 420 });
    if (m.sub) text(m.sub, 0, 30, { size: 14, sw: 4 });
    c.restore();
  });
}

function dim(a) { ctx.fillStyle = `rgba(${ui.dim},${a})`; ctx.fillRect(0, 0, W, H); }
function panel(x, y, w, h) {
  ctx.fillStyle = ui.panel; rr(x, y, w, h, 14); ctx.fill();
  ctx.strokeStyle = ui.line; ctx.lineWidth = 1.5; ctx.stroke();
}

// miniatura mapy na ekranie wyboru
function drawSwatch(i, x, y, w, h) {
  const c = ctx, id = STYLES[i].id;
  c.save(); rr(x, y, w, h, 7); c.clip();
  const plat = (fill, top) => { c.fillStyle = fill; rr(x + 12, y + 20, w - 24, 9, 3); c.fill(); if (top) { c.fillStyle = top; rr(x + 11, y + 19, w - 22, 4, 2); c.fill(); } };
  if (id === 'ice') {
    c.fillStyle = '#222a52'; c.fillRect(x, y, w, h);
    c.fillStyle = '#151a38'; for (let yy = y + 8; yy < y + h; yy += 8) c.fillRect(x, yy, w, 1);
    plat('#7cc7f2', '#f4fbff');
    c.fillStyle = '#c9ecff'; for (let k = 0; k < 4; k++) { const hx = x + 18 + k * 9; c.beginPath(); c.moveTo(hx - 2.5, y + 28); c.lineTo(hx + 2.5, y + 28); c.lineTo(hx, y + 34); c.fill(); }
  } else if (id === 'film') {
    c.fillStyle = '#4b463e'; c.fillRect(x, y, w, h);
    plat('#bdb5a4', '#f1ead9');
    c.fillStyle = 'rgba(255,255,255,.55)'; c.fillRect(x + 21, y, 1, h); c.fillRect(x + 47, y, 0.7, h);
    const v = c.createRadialGradient(x + w / 2, y + h / 2, 8, x + w / 2, y + h / 2, 40);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,.8)');
    c.fillStyle = v; c.fillRect(x, y, w, h);
  } else if (id === 'retro') {
    c.fillStyle = '#306b3b'; c.fillRect(x, y, w, h);
    c.fillStyle = '#0f291a';
    for (let yy = 0; yy < h; yy += 4) for (let xx = (yy / 4 % 2) * 4; xx < w; xx += 8) c.fillRect(x + xx, y + yy, 2, 2);
    c.fillStyle = '#0f291a'; c.fillRect(x + 10, y + 18, w - 20, 12);
    c.fillStyle = '#e0f0a0'; c.fillRect(x + 12, y + 18, w - 24, 4);
    c.fillStyle = '#85b547'; c.fillRect(x + 12, y + 22, w - 24, 6);
  } else if (id === 'neon') {
    c.fillStyle = '#12032e'; c.fillRect(x, y, w, h);
    c.fillStyle = 'rgba(255,94,224,.3)';
    for (let xx = x + 8; xx < x + w; xx += 8) c.fillRect(xx, y, 1, h);
    for (let yy = y + 8; yy < y + h; yy += 8) c.fillRect(x, yy, w, 1);
    c.save(); c.shadowColor = '#5ef5ff'; c.shadowBlur = 8; c.strokeStyle = '#5ef5ff'; c.lineWidth = 2;
    c.fillStyle = '#14062e'; rr(x + 12, y + 18, w - 24, 9, 3); c.fill(); c.stroke(); c.restore();
  } else {
    c.fillStyle = '#f7f2e4'; c.fillRect(x, y, w, h);
    c.fillStyle = 'rgba(70,120,200,.3)';
    for (let xx = x + 8; xx < x + w; xx += 8) c.fillRect(xx, y, 1, h);
    for (let yy = y + 8; yy < y + h; yy += 8) c.fillRect(x, yy, w, 1);
    wobblyRect(x + 12, y + 18, w - 24, 10, i + 3, 1); c.fillStyle = '#fffdf6'; c.fill();
    c.strokeStyle = '#3b6fd4'; c.lineWidth = 1.2; c.beginPath();
    for (let hx = x + 6; hx < x + w - 14; hx += 6) { c.moveTo(hx, y + 28); c.lineTo(hx + 8, y + 18); }
    c.save(); wobblyRect(x + 12, y + 18, w - 24, 10, i + 3, 1); c.clip(); c.stroke(); c.restore();
    wobblyRect(x + 12, y + 18, w - 24, 10, i + 3, 1); c.strokeStyle = PEN; c.lineWidth = 1.8; c.stroke();
  }
  c.restore();
}

/** Przycisk-prostokąt z napisem; on = podświetlony (wybrany). */
function button(b, label, { on = false, accent = false, size = 12 } = {}) {
  const c = ctx;
  c.fillStyle = accent ? ui.btn : ui.panel; rr(b.x, b.y, b.w, b.h, 9); c.fill();
  c.strokeStyle = on ? ui.gold : accent ? ui.frame : ui.line; c.lineWidth = on ? 2.5 : 1.5; c.stroke();
  text(label, b.x + b.w / 2, b.y + b.h / 2 + 1, { size, color: accent ? ui.btnText : ui.hint, sw: 0, maxW: b.w - 14 });
}

function drawTitle(g) {
  const c = ctx, time = g.t;
  dim(0.5);
  button(UIBOX.opts, isTouch ? t('title.opts') : `${t('title.opts')} · O`, { size: 11 });
  button(UIBOX.rank, isTouch ? t('title.rank') : `${t('title.rank')} · R`, { size: 11 });
  c.save(); c.translate(W / 2, 54); c.rotate(-0.03); c.scale(1 + Math.sin(time * 2) * 0.02, 1 + Math.sin(time * 2) * 0.02);
  text('STEP JUMPER', 0, 4, { size: 54, maxW: 430, color: ui.frame, sw: 14, stroke: ui.frame });
  const grad = c.createLinearGradient(0, -30, 0, 30);
  grad.addColorStop(0, ui.title[0]); grad.addColorStop(0.5, ui.title[1]); grad.addColorStop(1, ui.title[2]);
  text('STEP JUMPER', 0, 0, { size: 54, maxW: 430, color: grad, sw: 5, stroke: ui.titleStroke });
  c.restore();

  // postacie
  panel(120, 98, 400, 128);
  text(t('title.char'), 138, 112, { size: 11, color: ui.label, align: 'left', sw: 0 });
  text('←  →', 502, 112, { size: 11, color: ui.label, align: 'right', sw: 0 });
  CHARS.forEach((ch, i) => {
    const x = slotX(i), on = i === g.charIdx;
    rr(x - 32, UIBOX.chars.y, 64, UIBOX.chars.h, 10);
    c.fillStyle = on ? ui.sel : 'rgba(128,128,160,.10)'; c.fill();
    if (on) { c.strokeStyle = ui.gold; c.lineWidth = 2.5; c.stroke(); }
    const hop = on ? Math.abs(Math.sin(time * 4)) * 4 : 0;
    drawHero({ x: x - 2, y: UIBOX.chars.y + 68 - hop, vx: on ? 260 : 0, vy: 0, face: 1, onFloor: 0, spin: false }, { angle: 0, squash: 0, runPhase: on ? time * 22 : 0 }, time + i * 0.7, i);
    if (on && g.crown) drawCrown(x - 1, UIBOX.chars.y + 9 - hop * 0.6, g.crown, time, 0.62);   // nagroda: korona nad wybraną postacią
  });
  const ch = CHARS[g.charIdx];
  text(`${ch.name} – ${t(`char.${ch.id}`)}`, W / 2, 212, { size: 13, sw: 0, maxW: 370 });

  // mapy
  panel(120, 236, 400, 98);
  text(t('title.map'), 138, 250, { size: 11, color: ui.label, align: 'left', sw: 0 });
  text('↑  ↓', 502, 250, { size: 11, color: ui.label, align: 'right', sw: 0 });
  STYLES.forEach((st, i) => {
    const x = slotX(i), on = i === g.styleIdx;
    drawSwatch(i, x - 32, UIBOX.maps.y, 64, UIBOX.maps.h);
    rr(x - 32, UIBOX.maps.y, 64, UIBOX.maps.h, 7);
    c.strokeStyle = on ? ui.gold : ui.line; c.lineWidth = on ? 3 : 1; c.stroke();
  });
  text(`${t(`style.${style.id}.name`)} – ${t(`style.${style.id}.desc`)}`, W / 2, 319, { size: 13, sw: 0, maxW: 370 });

  // start
  const b = UIBOX.play, pulse = 1 + Math.sin(time * 5) * 0.025;
  c.save(); c.translate(b.x + b.w / 2, b.y + b.h / 2); c.scale(pulse, pulse);
  c.fillStyle = ui.btn; rr(-b.w / 2, -b.h / 2, b.w, b.h, 12); c.fill();
  c.strokeStyle = ui.frame; c.lineWidth = 2.5; c.stroke();
  text(t(isTouch ? 'title.play' : 'title.playKey'), 0, 1, { size: 18, color: ui.btnText, sw: 0, maxW: b.w - 24 });
  c.restore();

  const hint = { size: 11, color: ui.note, sw: 3, weight: 700, maxW: 436 };
  if (isTouch || tilt.active) {                          // urządzenia dotykowe: przełącznik sterowania
    const k = UIBOX.ctrl;
    c.fillStyle = ui.panel; rr(k.x, k.y, k.w, k.h, 13); c.fill();
    c.strokeStyle = tilt.active ? ui.gold : ui.line; c.lineWidth = tilt.active ? 2.5 : 1.5; c.stroke();
    text(t(tilt.active ? 'title.ctrlTilt' : tilt.want ? 'title.ctrlTiltWant' : 'title.ctrlButtons'), W / 2, k.y + k.h / 2 + 1,
      { size: 12, color: tilt.active ? ui.gold : ui.hint, sw: 0, maxW: k.w - 24 });
    text(t(tilt.active ? 'title.tiltHelp' : 'title.buttonsHelp'), W / 2, 429, { ...hint, color: ui.hint });
    text(t('title.tip'), W / 2, 444, hint);
  } else {
    text(t('title.keys'), W / 2, 402, { ...hint, color: ui.hint });
    text(t('title.tip'), W / 2, 420, hint);
    text(t('title.combo'), W / 2, 437, hint);
  }
  if (g.best.score > 0) text(t('title.best', { score: g.best.score, floor: g.best.floor, combo: g.best.combo }), W / 2, 460, { size: 12, color: ui.mint, sw: 3, maxW: 436 });
}

function drawPause(g) {
  dim(0.55);
  text(t('pause.title'), W / 2, 205, { size: 54, sw: 8, maxW: 430 });
  text(t(isTouch ? 'pause.tap' : 'pause.resume'), W / 2, 258, { size: 15, color: ui.hint, sw: 4, maxW: 430 });
  if (!isTouch) text(t('pause.menu'), W / 2, 284, { size: 13, color: ui.label, sw: 4, maxW: 430 });
  button(UIBOX.pmenu, t('pause.menuBtn'), { size: 13 });
}

function drawOver(g) {
  const c = ctx, k = clamp(g.overT / 0.35, 0, 1);
  dim(0.6 * k);
  c.save(); c.globalAlpha = k; c.translate(0, (1 - easeOutBack(k)) * -40);
  text(t('over.title'), W / 2, 100, { size: 50, color: ui.warn, sw: 8, maxW: 430 });
  panel(170, 142, 300, 170);
  const rows = [[t('over.score'), g.score, ui.gold], [t('over.floor'), g.sim.maxFloor, ui.text], [t('over.combo'), g.sim.bestCombo, ui.text], [t('over.best'), g.best.score, ui.mint]];
  rows.forEach(([l, v, col], i) => {
    text(l, 196, 172 + i * 36, { size: 15, color: ui.label, align: 'left', sw: 0, weight: 600, maxW: 180 });
    text(String(v), 444, 172 + i * 36, { size: i ? 20 : 26, color: col, align: 'right', sw: 0 });
  });
  if (g.newBest) {
    c.save(); c.translate(486, 146); c.rotate(0.22);
    burst(0, 0, 30, 40, 12, g.t); c.fillStyle = '#ffd24a'; c.fill(); c.strokeStyle = '#12173a'; c.lineWidth = 2.5; c.stroke();
    text(t('over.new1'), 0, -7, { size: 12, color: '#12173a', sw: 0, maxW: 58 }); text(t('over.new2'), 0, 8, { size: 12, color: '#12173a', sw: 0, maxW: 58 });
    c.restore();
  }
  const net = netLine(g.net);
  if (net) text(net[0], W / 2, 328, { size: 13, color: net[1], sw: 3, maxW: 440 });
  if (g.overT > 0.6) {
    if (Math.sin(g.t * 5) > -0.3) text(t('over.again'), W / 2, 352, { size: 18, sw: 5, maxW: 430 });
    const b = UIBOX.menu;
    c.fillStyle = ui.panel; rr(b.x, b.y, b.w, b.h, 10); c.fill(); c.strokeStyle = ui.line; c.lineWidth = 1.5; c.stroke();
    text(t('over.menu'), W / 2, b.y + b.h / 2 + 1, { size: 12, color: ui.hint, sw: 0, maxW: b.w - 20 });
  }
  c.restore();
}

// ───────────────────────── ranking online ─────────────────────────

/** Jedna linijka o losie wyniku na ekranie końca gry: [tekst, kolor]. */
function netLine(n) {
  if (!n) return null;
  switch (n.status) {
    case 'sending': return [t('net.sending'), ui.hint];
    case 'verified': return [t('net.verified', n.ranks), ui.mint];
    case 'queued': return [t('net.queued'), ui.hint];
    case 'rejected': return [t('net.rejected'), ui.warn];
    case 'unranked': return [t(`net.${n.reason}`), ui.label];
    default: return null;
  }
}

function drawBoard(g) {
  const c = ctx, b = g.board, kind = b.kind, d = b.data[kind], o = g.online;
  dim(0.66);
  text(t('board.title'), W / 2, 34, { size: 30, color: ui.gold, sw: 6, maxW: 420 });
  PERIODS.forEach((k, i) => button(UIBOX.tab(i), t(`period.${k}`), { accent: k === kind, size: 12 }));

  const L = UIBOX.list;
  panel(L.x, L.y, L.w, L.h);
  const msg = (s) => text(s, W / 2, L.y + L.h / 2, { size: 14, color: ui.hint, sw: 0, maxW: L.w - 30 });
  if (!o.enabled) msg(t('board.off'));
  else if (!d) msg(t('board.loading'));
  else if (!d.top) msg(t('board.noConn'));
  else if (!d.top.entries.length) msg(t(kind === 'day' ? 'board.emptyDay' : 'board.empty'));
  else {
    const head = { size: 10, color: ui.label, sw: 0 };
    text('#', L.x + 36, L.y + 16, { ...head, align: 'right' });
    text(t('board.colPlayer'), L.x + 52, L.y + 16, { ...head, align: 'left' });
    text(t('board.colFloor'), L.x + 318, L.y + 16, { ...head, align: 'right' });
    text(t('board.colScore'), L.x + L.w - 18, L.y + 16, { ...head, align: 'right' });
    const myRank = d.me?.rank;
    d.top.entries.forEach((e, i) => {
      const y = L.y + 40 + i * 23, mine = e.rank === myRank, medal = MEDALS[e.rank], box = UIBOX.boardRow(i);
      if (medal) {                                       // najlepsza trójka: pasek w kolorze medalu i korona zamiast numeru
        const bg = c.createLinearGradient(box.x, 0, box.x + box.w, 0);
        bg.addColorStop(0, `${medal.mid}66`); bg.addColorStop(0.6, `${medal.mid}22`); bg.addColorStop(1, `${medal.mid}08`);
        c.fillStyle = bg; rr(box.x, box.y, box.w, box.h, 6); c.fill();
        c.strokeStyle = `${medal.mid}aa`; c.lineWidth = mine ? 2 : 1; c.stroke();
        drawCrown(L.x + 27, y + 5, e.rank, g.t + e.rank * 0.4, 0.72);
      } else if (mine) { c.fillStyle = ui.sel; rr(box.x, box.y, box.w, box.h, 6); c.fill(); }
      const row = { size: 13, sw: 0 };
      if (!medal) text(String(e.rank), L.x + 36, y, { ...row, align: 'right', color: ui.label });
      const nameCol = mine ? ui.gold : medal && style.world !== 'sketch' ? medal.hi : ui.text;
      text(e.nick ?? t('board.player', { tag: e.tag }), L.x + 52, y, { ...row, align: 'left', color: nameCol, weight: 700, maxW: e.replay ? 170 : 200 });
      if (e.replay) {                                    // powtórka do obejrzenia
        const px = L.x + 232, loading = g.replay?.loading && g.replay.entry === e;
        c.fillStyle = loading ? ui.panel : ui.btn; rr(px, y - 8.5, 50, 17, 8.5); c.fill();
        c.strokeStyle = ui.frame; c.lineWidth = 1; c.stroke();
        text(loading ? '…' : isTouch ? '▶' : `▶ ${e.rank}`, px + 25, y + 0.5, { size: 10, color: loading ? ui.hint : ui.btnText, sw: 0, maxW: 44 });
      }
      text(String(e.floor), L.x + 318, y, { ...row, align: 'right', color: ui.label });
      text(String(e.score), L.x + L.w - 18, y, { ...row, size: 14, align: 'right', color: medal ? ui.gold : ui.text });
    });
  }

  if (o.enabled && d?.top) {
    const me = d.me?.entries.find((e) => e.me);
    const line = !d.me?.rank ? t('board.noScore')
      : d.me.rank > 10 ? t('board.placeScore', { rank: d.me.rank, score: me?.score ?? '' }) : t('board.place', { rank: d.me.rank });
    text(line, W / 2, 394, { size: 13, color: ui.mint, sw: 3, maxW: 420 });
  }
  if (o.pending) text(t('board.pending', { n: o.pending }), W / 2, 410, { size: 10, color: ui.label, sw: 0 });
  else if (g.replay?.loading) text(t('replay.loading'), W / 2, 410, { size: 11, color: ui.hint, sw: 0 });

  const name = o.nick ?? (o.tag ? t('board.player', { tag: o.tag }) : '—');
  button(UIBOX.nick, t(isTouch ? 'board.nick' : 'board.nickKey', { name: o.enabled ? name : '—' }), { size: 12 });
  button(UIBOX.back, t(isTouch ? 'board.back' : 'board.backKey'), { size: 12 });
}

function drawSettings(g) {
  const o = g.online, st = g.settings, confirming = g.t < st.confirmT;
  dim(0.66);
  text(t('set.title'), W / 2, 44, { size: 30, color: ui.gold, sw: 6, maxW: 420 });
  const onOff = (v) => t(v ? 'set.on' : 'set.off');
  const rows = {
    lang: [lang() === 'en' ? t('set.lang') : `${t('set.lang')} / Language`, `◀  ${LANG_NAMES[lang()]}  ▶`],
    sound: [t('set.sound'), onOff(!sfx.muted)],
    music: [t('set.music'), onOff(sfx.musicOn)],
    vibrate: [t('set.vibrate'), haptics.available ? onOff(haptics.on) : t('set.na')],
    hand: [t('set.hand'), `◀  ${t(g.lefty ? 'set.handLeft' : 'set.handRight')}  ▶`],
    online: [t('set.online'), onOff(o.enabled)],
    delete: [t(confirming ? 'set.deleteConfirm' : 'set.delete'), ''],
    back: [t(isTouch ? 'set.back' : 'set.backKey'), ''],
  };
  SETTINGS.forEach((k, i) => {
    const r = UIBOX.row(i), sel = i === st.sel && !isTouch, [label, value] = rows[k];
    panel(r.x, r.y, r.w, r.h);
    if (sel || (k === 'delete' && confirming)) { ctx.strokeStyle = k === 'delete' ? ui.warn : ui.gold; ctx.lineWidth = 2.5; rr(r.x, r.y, r.w, r.h, 14); ctx.stroke(); }
    const col = k === 'delete' ? ui.warn : ui.text;
    text(label, value ? r.x + 20 : r.x + r.w / 2, r.y + r.h / 2 + 1, { size: 14, color: col, sw: 0, align: value ? 'left' : 'center', weight: 700, maxW: value ? r.w - 170 : r.w - 40 });
    if (value) text(value, r.x + r.w - 20, r.y + r.h / 2 + 1, { size: 14, color: value === t('set.on') || k === 'lang' || k === 'hand' ? ui.gold : ui.label, sw: 0, align: 'right', maxW: 140 });
  });
  const note = st.note ? t(st.note) : confirming ? t('set.deleteWarn') : '';
  if (note) text(note, W / 2, 350, { size: 13, color: confirming ? ui.warn : ui.mint, sw: 3, maxW: 440 });
  const hint = { size: 11, color: ui.note, sw: 3, weight: 700, maxW: 440 };
  text(t('set.privacy'), W / 2, 410, hint);
  if (!isTouch) text(t('set.keys'), W / 2, 430, { ...hint, color: ui.hint });
}

// ───────────────────────── powtórka ─────────────────────────

function iconBtn(b, draw, { on = false } = {}) {
  const c = ctx;
  c.fillStyle = ui.panel; rr(b.x, b.y, b.w, b.h, 9); c.fill();
  c.strokeStyle = on ? ui.gold : ui.line; c.lineWidth = on ? 2.5 : 1.5; c.stroke();
  c.save(); c.translate(b.x + b.w / 2, b.y + b.h / 2); c.fillStyle = ui.hint; c.strokeStyle = ui.hint; draw(c); c.restore();
}
const playIcon = (c) => { c.beginPath(); c.moveTo(-5, -8); c.lineTo(8, 0); c.lineTo(-5, 8); c.closePath(); c.fill(); };
const pauseIcon = (c) => { c.fillRect(-6, -8, 4.5, 16); c.fillRect(1.5, -8, 4.5, 16); };
const stopIcon = (c) => { c.fillRect(-6.5, -6.5, 13, 13); };

function drawReplay(g) {
  const c = ctx, r = g.replay;
  if (!r?.data) return;
  const d = r.data;
  // nagłówek: kto i jaki wynik
  c.fillStyle = ui.panel; rr(LEFT + 10, 8, RIGHT - LEFT - 20, 30, 12); c.fill();
  c.strokeStyle = MEDALS[r.rank]?.mid ?? ui.line; c.lineWidth = 1.5; c.stroke();
  if (MEDALS[r.rank]) drawCrown(LEFT + 30, 29, r.rank, g.t, 0.7);
  text(`${t('replay.title')} · #${r.rank} ${r.name}`, LEFT + 46, 23, { size: 13, color: ui.gold, sw: 0, align: 'left', maxW: 290 });
  text(`${d.score}`, RIGHT - 22, 23, { size: 14, color: ui.text, sw: 0, align: 'right', maxW: 80 });

  if (r.ended) {
    dim(0.55);
    text(t('replay.end'), W / 2, 196, { size: 38, color: ui.gold, sw: 7, maxW: 420 });
    text(`${t('over.score')}: ${d.score}   ·   ${t('over.floor')}: ${d.floor}   ·   ${t('over.combo')}: ${d.combo}`, W / 2, 244, { size: 14, sw: 4, maxW: 430 });
    button(UIBOX.rAgain, t('replay.again'), { accent: true, size: 13 });
    button(UIBOX.rBack, t('replay.back'), { size: 13 });
    return;
  }
  if (!r.playing) {                                    // pauza albo stop: duży przycisk na środku
    c.fillStyle = `rgba(${ui.dim},.35)`; c.fillRect(LEFT, 40, RIGHT - LEFT, H - 40);
    c.fillStyle = ui.panel; c.beginPath(); c.arc(W / 2, 220, 34, 0, 7); c.fill();
    c.strokeStyle = ui.gold; c.lineWidth = 2.5; c.stroke();
    c.save(); c.translate(W / 2 + 3, 220); c.scale(2, 2); c.fillStyle = ui.gold; playIcon(c); c.restore();
    text(t(r.i === 0 ? 'replay.stopped' : 'replay.paused'), W / 2, 276, { size: 18, sw: 5, maxW: 300 });
    if (!isTouch) text(t('replay.keys'), W / 2, 418, { size: 11, color: ui.hint, sw: 3, weight: 700, maxW: 440 });
  }
  // pasek sterowania
  iconBtn(UIBOX.rPlay, r.playing ? pauseIcon : playIcon, { on: !r.playing });
  iconBtn(UIBOX.rStop, stopIcon);
  button(UIBOX.rSpeed, `${g.replaySpeedX}×`, { on: g.replaySpeedX > 1, size: 14 });
  const b = UIBOX.rBar, f = clamp(r.i / Math.max(1, d.ticks.length), 0, 1);
  c.fillStyle = ui.panel; rr(b.x - 3, b.y - 3, b.w + 6, b.h + 6, 9); c.fill();
  c.strokeStyle = ui.line; c.lineWidth = 1; c.stroke();
  c.fillStyle = ui.gold; rr(b.x, b.y, Math.max(b.h, b.w * f), b.h, b.h / 2); c.fill();
  const sec = (n) => { const s2 = Math.floor(n / 120); return `${Math.floor(s2 / 60)}:${String(s2 % 60).padStart(2, '0')}`; };
  text(`${sec(r.i)} / ${sec(d.ticks.length)}`, b.x + b.w / 2, b.y - 11, { size: 10, color: ui.hint, sw: 3, maxW: b.w });
  button(UIBOX.rExit, t('replay.back'), { size: 12 });
}

// ───────────────────────── podsumowanie tygodnia ─────────────────────────

function drawRecap(g) {
  const c = ctx, lw = g.recap, time = g.t;
  if (!lw) return;
  dim(0.8);
  const week = String(lw.top.period).split('-')[1] ?? '';
  text(t('recap.title', { n: Number(week) || week }), W / 2, 36, { size: 30, color: ui.gold, sw: 6, maxW: 440 });
  text(t('recap.sub'), W / 2, 66, { size: 12, color: ui.hint, sw: 3, weight: 700, maxW: 440 });

  // promienie za zwycięzcą
  if (!reduceMotion) {
    c.save(); c.translate(UIBOX.podX[0], UIBOX.podBase - UIBOX.podH[0] - 30); c.rotate(time * 0.25);
    c.fillStyle = 'rgba(255,224,102,.08)';
    for (let i = 0; i < 12; i++) { c.rotate(Math.PI / 6); c.beginPath(); c.moveTo(0, 0); c.lineTo(-14, -150); c.lineTo(14, -150); c.closePath(); c.fill(); }
    c.restore();
  }
  for (let i = 0; i < 3; i++) {
    const e = lw.top.entries[i], m = MEDALS[i + 1], x = UIBOX.podX[i], top = UIBOX.podBase - UIBOX.podH[i];
    // stopień podium
    const grad = c.createLinearGradient(0, top, 0, UIBOX.podBase);
    grad.addColorStop(0, m.mid); grad.addColorStop(1, m.lo);
    c.fillStyle = grad; rr(x - 46, top, 92, UIBOX.podH[i], [8, 8, 2, 2]); c.fill();
    c.strokeStyle = ui.frame; c.lineWidth = 2; c.stroke();
    c.fillStyle = 'rgba(255,255,255,.35)'; c.fillRect(x - 40, top + 4, 80, 3);
    text(String(i + 1), x, top + UIBOX.podH[i] / 2 + 3, { size: 26, color: '#fff', stroke: m.lo, sw: 5 });
    if (!e) { text('—', x, top - 24, { size: 20, color: ui.label, sw: 0 }); continue; }
    // zwycięzca na stopniu, z koroną
    const ci = Math.max(0, CHARS.findIndex((ch) => ch.id === e.char)), hop = reduceMotion ? 0 : Math.abs(Math.sin(time * 3 + i)) * (i ? 2 : 4);
    drawHero({ x, y: top - hop, vx: 0, vy: 0, face: i === 2 ? -1 : 1, onFloor: 0, spin: false }, { angle: 0, squash: 0, runPhase: 0 }, time + i, ci);
    drawCrown(x, top - 68 - hop, i + 1, time + i * 0.5, i ? 0.95 : 1.15);
    text(e.nick ?? t('board.player', { tag: e.tag }), x, UIBOX.podBase + 14, { size: 13, color: e.me ? ui.gold : ui.text, sw: 3, maxW: 104 });
    text(`${e.score}`, x, UIBOX.podBase + 31, { size: 12, color: ui.gold, sw: 3, maxW: 104 });
    const b = UIBOX.podWatch(i), loading = g.replay?.loading && g.replay.entry === e;
    if (e.replay) button(b, loading ? '…' : isTouch ? t('recap.watch') : `${t('recap.watch')} · ${i + 1}`, { accent: true, size: 10 });
    else text(t('recap.noReplay'), x, b.y + b.h / 2, { size: 10, color: ui.label, sw: 0, maxW: 100 });
  }
  // moje miejsce
  const me = lw.me, mine = me?.entries.find((e) => e.me);
  const line = me?.rank && me.rank <= 3 ? t(`recap.crown${me.rank}`)
    : me?.rank ? t('recap.me', { rank: me.rank, score: mine?.score ?? '' }) : t('recap.none');
  text(line, W / 2, 392, { size: 14, color: me?.rank && me.rank <= 3 ? ui.gold : ui.mint, sw: 4, maxW: 460 });
  button(UIBOX.recapBoard, t('recap.board'), { size: 12 });
  button(UIBOX.recapNext, t('recap.next'), { accent: true, size: 13 });
  if (!isTouch) text(t('recap.keys'), W / 2, 466, { size: 10, color: ui.note, sw: 3, weight: 700, maxW: 440 });
  else if (g.replay?.loading) text(t('replay.loading'), W / 2, 466, { size: 11, color: ui.hint, sw: 3 });
}
