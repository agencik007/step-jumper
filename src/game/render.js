// Rysowanie: świat, HUD i ekrany. Funkcje tylko czytają stan gry (g) – niczego w nim nie zmieniają.
import {
  BLOCK, COMBO_TIME, FIELD, FOOT, GAP, H, HURRY_EVERY, ITEM_LIFT, ITEM_R, LEFT, MAX_HURRIES, NARROW_BY, PLAT_H, RIGHT, SLOW_TIME, W, WALL, floorAt, narrowLevel,
} from '../sim';
import { access, fontSize } from './access.js';
import { sfx } from './audio.js';
import { CHARS, drawHero } from './characters.js';
import {
  FONT, MEDALS, NEON, PEN, PENCILS, STYLES, brickPattern, burst, canvas, ctx, cycle, ditherPattern, hatchPattern, lowCanvas, lowCtx, mainCtx,
  rr, setCtx, setMapFilter, stonePattern, style, text, themeOf, ui, wobblyRect,
} from './gfx.js';
import { BTN, glyphOf } from './gamepad.js';
import { t } from './i18n.js';
import { binds, ctrl, isTouch, keyLabel, opts, tilt } from './input.js';
import { ARROW_W, LIST, LIST_BACK, NOTE_FONT, PERIODS, SLIDER_STEPS, UIBOX, bindCell, noteLine, rowBox, sliderBar, slotX } from './layout.js';
import { VERSION, update } from './update.js';
import { clamp, easeOutBack, hash, mod, rand, reduceMotion } from './util.js';

export function render(g) {
  const mw = canvas.width, mh = canvas.height;
  // NOWOŚCI: sam tekst na jednolitym tle – bez mapy, filtrów i efektów pod spodem
  const plain = g.state === 'settings' && g.settings.page === 'news';
  setMapFilter(!plain);
  if (plain) {
    setCtx(mainCtx);
    ctx.setTransform(mw / W, 0, 0, mh / H, 0, 0);
    ctx.fillStyle = `rgb(${ui.dim})`; ctx.fillRect(0, 0, W, H);
    drawSettings(g);
    drawMessages(g);
    return;
  }
  if (style.pixel && access.fx) {                                  // świat w niskiej rozdzielczości, powiększany bez wygładzania
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
  if (access.fx) style.post?.(g);                     // ziarno, rysy, linie – wyłączane w OPCJE → DOSTĘPNOŚĆ
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
  if (access.assist) drawAssist(g, h);
  drawHero(h, g.fx, g.t, g.heroIdx);
  if (g.tier && ['play', 'pause', 'over', 'replay'].includes(g.state)) drawCrown(h.x, h.y - 70 + (reduceMotion ? 0 : Math.sin(g.t * 3) * 2), g.tier, g.t, 1, -h.vx / 4000);
  c.restore();

  drawWalls(g);
  const danger = c.createLinearGradient(0, H - 70, 0, H);   // strefa zagrożenia na dole
  danger.addColorStop(0, `rgba(${ui.dim},0)`); danger.addColorStop(1, `rgba(${ui.dim},.78)`);
  c.fillStyle = danger; c.fillRect(LEFT, H - 70, FIELD, 70);
  c.restore();
}

/**
 * Asysta wzroku: poświata wokół bohatera i – gdy spada – znacznik na piętrze pod nim (rzut w pionie,
 * czyli tam, gdzie wyląduje, jeśli nie skręci). Liczone z układu pięter, bez wpływu na symulację.
 */
function drawAssist(g, h) {
  const c = ctx, paper = style.world === 'sketch';
  const glow = c.createRadialGradient(h.x, h.y - 28, 6, h.x, h.y - 28, 50);
  glow.addColorStop(0, paper ? 'rgba(31,42,68,.28)' : 'rgba(255,255,255,.34)'); glow.addColorStop(1, paper ? 'rgba(31,42,68,0)' : 'rgba(255,255,255,0)');
  c.fillStyle = glow; c.fillRect(h.x - 52, h.y - 80, 104, 104);
  if (h.onFloor >= 0 || h.vy < 0 || g.sim.rising) return;
  const s = g.sim;
  for (let n = Math.floor(-h.y / GAP + 1e-6); n >= Math.max(s.lowN, 0); n--) {
    const p = floorAt(s.seed, n);
    if (h.x + FOOT < p.x || h.x - FOOT > p.x + p.w) continue;
    const y = p.y - 3;
    c.save();
    c.fillStyle = paper ? 'rgba(194,65,12,.85)' : 'rgba(255,224,102,.95)';
    c.strokeStyle = paper ? PEN : '#12173a'; c.lineWidth = 2;
    c.beginPath(); c.ellipse(h.x, y, 18, 5, 0, 0, 7); c.fill(); c.stroke();
    c.beginPath(); c.moveTo(h.x, y - 7); c.lineTo(h.x - 8, y - 18); c.lineTo(h.x + 8, y - 18); c.closePath(); c.fill(); c.stroke();   // strzałka w dół
    c.restore();
    return;
  }
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
  drawPlatformBody(g, p);
  if (access.contrast) {                                 // wysoki kontrast: gruba ciemna i jasna obwódka piętra
    const c = ctx, paper = style.world === 'sketch';
    c.lineJoin = 'round';
    rr(p.x - 3, p.y - 4, p.w + 6, PLAT_H + 5, 6);
    c.strokeStyle = paper ? '#fffdf6' : '#000000'; c.lineWidth = 5; c.stroke();
    c.strokeStyle = paper ? '#000000' : '#ffffff'; c.lineWidth = 2.2; c.stroke();
  }
}
function drawPlatformBody(g, p) {
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

  // skok przełącznikiem (włączony) albo automatyczny: bohater skacze sam przy każdym lądowaniu
  if ((g.state === 'play' || g.state === 'pause') && (opts.jump === 'auto' || (opts.jump === 'toggle' && g.latch))) {
    c.fillStyle = ui.panel; rr(cx - 38, 452, 76, 20, 10); c.fill();
    c.strokeStyle = ui.gold; c.lineWidth = 1.5; c.stroke();
    text(`▲ ${t('hud.autoJump')}`, cx, 462.5, { size: 10, color: ui.gold, sw: 0, maxW: 68 });
  }

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
    const a = clamp((m.dur - m.t) / 0.3, 0, 1), s = reduceMotion ? 1 : easeOutBack(clamp(m.t / 0.25, 0, 1));
    c.save();
    c.globalAlpha = reduceMotion ? a * clamp(m.t / 0.15, 0, 1) : a;   // bez ruchu: napis tylko się pojawia i znika
    c.translate(W / 2, 128 + i * 62 - (reduceMotion ? 0 : m.t * 10)); c.rotate(-0.05); c.scale(s, s);
    const size = Math.min(40, 400 / Math.max(6, m.title.length) * 1.25);
    text(m.title, 0, 0, { size, color: ui[m.color] || ui.gold, sw: 7, maxW: 420 });
    if (m.sub) text(m.sub, 0, 30, { size: 14, sw: 4 });
    c.restore();
  });
}

/** Przyciemnienie pod menu; przy wysokim kontraście prawie nieprzezroczyste. */
function dim(a) { ctx.fillStyle = `rgba(${ui.dim},${access.contrast ? Math.max(a, 0.93) : a})`; ctx.fillRect(0, 0, W, H); }
function panel(x, y, w, h) {
  ctx.fillStyle = ui.panel; rr(x, y, w, h, 14); ctx.fill();
  ctx.strokeStyle = access.contrast ? ui.text : ui.line; ctx.lineWidth = access.contrast ? 2 : 1.5; ctx.stroke();
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

/** Przycisk-prostokąt z napisem; on = podświetlony (wybrany); glyph – ikonka przycisku pada przed napisem. */
function button(b, label, { on = false, accent = false, size = 12, glyph = null } = {}) {
  const c = ctx;
  c.fillStyle = accent ? ui.btn : ui.panel; rr(b.x, b.y, b.w, b.h, 9); c.fill();
  c.strokeStyle = on ? ui.gold : accent ? ui.frame : ui.line; c.lineWidth = on ? 2.5 : 1.5; c.stroke();
  const gw = glyph != null ? padGlyph(glyph, b.x + 6, b.y + b.h / 2, 16) + 4 : 0;
  text(label, b.x + b.w / 2 + gw / 2, b.y + b.h / 2 + 1, { size, color: accent ? ui.btnText : ui.hint, sw: 0, maxW: b.w - 14 - gw });
}

// ───────────────────────── przyciski pada ─────────────────────────

/**
 * Ikonka przycisku pada: i – numer przycisku albo 'dpad' (krzyżak). x – lewa krawędź, y – środek, s – wysokość.
 * Wygląd zależy od rozpoznanego pada (gamepad.js): Xbox A B X Y w kolorach, PlayStation ✕ ○ □ △, Nintendo B A Y X.
 * draw = false tylko mierzy. Zwraca szerokość.
 */
function padGlyph(i, x, y, s = 16, draw = true) {
  const c = ctx, gl = i === 'dpad' ? { dpad: 'all' } : glyphOf(i);
  if (!gl) return 0;
  if (gl.pill) {
    c.font = `800 ${Math.round(s * 0.52)}px ${FONT}`;
    const w = Math.max(s, c.measureText(gl.pill).width + s * 0.7);
    if (!draw) return w;
    c.save();
    c.fillStyle = '#1b2140'; rr(x, y - s / 2, w, s, s / 2); c.fill();
    c.strokeStyle = '#cfd6e6'; c.lineWidth = 1.2; c.stroke();
    c.fillStyle = '#ffffff'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(gl.pill, x + w / 2, y + 0.5);
    c.restore();
    return w;
  }
  if (!draw) return s;
  c.save();
  if (gl.dpad) {
    const u = s / 3, x0 = x, y0 = y - s / 2;
    c.beginPath();
    c.moveTo(x0 + u, y0); c.lineTo(x0 + 2 * u, y0); c.lineTo(x0 + 2 * u, y0 + u); c.lineTo(x0 + 3 * u, y0 + u); c.lineTo(x0 + 3 * u, y0 + 2 * u);
    c.lineTo(x0 + 2 * u, y0 + 2 * u); c.lineTo(x0 + 2 * u, y0 + 3 * u); c.lineTo(x0 + u, y0 + 3 * u); c.lineTo(x0 + u, y0 + 2 * u);
    c.lineTo(x0, y0 + 2 * u); c.lineTo(x0, y0 + u); c.lineTo(x0 + u, y0 + u); c.closePath();
    c.fillStyle = '#1b2140'; c.fill(); c.strokeStyle = '#cfd6e6'; c.lineWidth = 1.2; c.stroke();
    const arm = { up: [1, 0], down: [1, 2], left: [0, 1], right: [2, 1] }[gl.dpad];
    if (arm) { c.fillStyle = '#ffe066'; c.fillRect(x0 + arm[0] * u + 1, y0 + arm[1] * u + 1, u - 2, u - 2); }
  } else {
    const r = s / 2, cx = x + r, k = r * 0.44;
    c.beginPath(); c.arc(cx, y, r, 0, 7); c.fillStyle = '#1b2140'; c.fill();
    c.strokeStyle = gl.color; c.lineWidth = 1.5; c.stroke();
    c.strokeStyle = gl.color; c.fillStyle = gl.color; c.lineWidth = 1.8; c.lineCap = 'round'; c.lineJoin = 'round';
    if (gl.face === 'cross') { c.beginPath(); c.moveTo(cx - k, y - k); c.lineTo(cx + k, y + k); c.moveTo(cx + k, y - k); c.lineTo(cx - k, y + k); c.stroke(); }
    else if (gl.face === 'circle') { c.beginPath(); c.arc(cx, y, k * 1.05, 0, 7); c.stroke(); }
    else if (gl.face === 'square') c.strokeRect(cx - k, y - k, 2 * k, 2 * k);
    else if (gl.face === 'triangle') { c.beginPath(); c.moveTo(cx, y - k * 1.15); c.lineTo(cx + k * 1.1, y + k * 0.8); c.lineTo(cx - k * 1.1, y + k * 0.8); c.closePath(); c.stroke(); }
    else { c.font = `800 ${Math.round(s * 0.62)}px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(gl.face, cx, y + 0.5); }
  }
  c.restore();
  return s;
}

/** Wiersz podpowiedzi dla pada: [[przycisk albo lista przycisków, klucz tekstu], …], wyśrodkowany na y. */
function padHints(items, y, { size = 11, color = ui.hint } = {}) {
  const c = ctx, s = 16, gap = 5, sep = 16;
  c.font = `700 ${fontSize(size)}px ${FONT}`;
  const parts = items.map(([b, k]) => {
    const bs = Array.isArray(b) ? b : [b], label = t(k);
    return { bs, label, gw: bs.reduce((a, x) => a + padGlyph(x, 0, 0, s, false) + 3, -3), tw: c.measureText(label).width };
  });
  const total = parts.reduce((a, p) => a + p.gw + gap + p.tw, 0) + sep * (parts.length - 1);
  const k = Math.min(1, 600 / total);
  c.save();
  c.translate(W / 2, y); c.scale(k, k);
  let x = -total / 2;
  for (const p of parts) {
    for (const b of p.bs) x += padGlyph(b, x, 0, s) + 3;
    x += gap - 3;
    text(p.label, x, 0.5, { size, color, sw: 3, align: 'left', weight: 700 });
    x += p.tw + sep;
  }
  c.restore();
}

/** Klawisze z przypisań do podpowiedzi „bieg ← → / A D · skok …”. */
function keysHint() {
  const lab = (a) => binds.key[a].filter(Boolean).map(keyLabel);
  const L = lab('left'), R = lab('right');
  const run = Array.from({ length: Math.max(L.length, R.length) }, (_, i) => `${L[i] ?? ''} ${R[i] ?? ''}`.trim()).join(' / ');
  return { run: run || '—', jump: lab('jump').join(' / ') || '—', pause: lab('pause').join(' / ') || '—' };
}

function drawTitle(g) {
  const c = ctx, time = g.t;
  dim(0.5);
  const hm = g.hint;
  button(UIBOX.opts, hm === 'keys' ? `${t('title.opts')} · O` : t('title.opts'), { size: 11, glyph: hm === 'pad' ? BTN.X : null });
  button(UIBOX.rank, hm === 'keys' ? `${t('title.rank')} · R` : t('title.rank'), { size: 11, glyph: hm === 'pad' ? BTN.Y : null });
  button(UIBOX.news, hm === 'keys' ? `${t('title.news')} · N` : t('title.news'), { size: 11, glyph: hm === 'pad' ? BTN.LB : null });
  text(`v${VERSION}`, 10, H - 12, { size: 10, color: ui.label, sw: 3, weight: 700, align: 'left' });   // wersja gry w lewym dolnym rogu
  if (update.available) drawUpdateButton(time, hm);
  const wob = reduceMotion ? 1 : 1 + Math.sin(time * 2) * 0.02;
  c.save(); c.translate(W / 2, 54); c.rotate(-0.03); c.scale(wob, wob);
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
    const hop = on && !reduceMotion ? Math.abs(Math.sin(time * 4)) * 4 : 0;
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
  const b = UIBOX.play, pulse = reduceMotion ? 1 : 1 + Math.sin(time * 5) * 0.025;
  c.save(); c.translate(b.x + b.w / 2, b.y + b.h / 2); c.scale(pulse, pulse);
  c.fillStyle = ui.btn; rr(-b.w / 2, -b.h / 2, b.w, b.h, 12); c.fill();
  c.strokeStyle = ui.frame; c.lineWidth = 2.5; c.stroke();
  if (hm === 'pad') padGlyph(BTN.A, -b.w / 2 + 12, 0, 20);
  text(t(hm === 'keys' ? 'title.playKey' : 'title.play'), hm === 'pad' ? 10 : 0, 1, { size: 18, color: ui.btnText, sw: 0, maxW: b.w - 24 - (hm === 'pad' ? 28 : 0) });
  c.restore();

  const hint = { size: 11, color: ui.note, sw: 3, weight: 700, maxW: 436 };
  if (isTouch || ctrl.mode !== 'buttons') {               // urządzenia dotykowe: tryb sterowania (dotknięcie = wybór w opcjach)
    const k = UIBOX.ctrl, waiting = ctrl.mode === 'tilt' && !tilt.active;
    c.fillStyle = ui.panel; rr(k.x, k.y, k.w, k.h, 13); c.fill();
    c.strokeStyle = ui.gold; c.lineWidth = 2; c.stroke();
    text(waiting ? t('title.ctrlTiltWant') : t('title.ctrl', { mode: t(`ctrl.${ctrl.mode}`) }), W / 2, k.y + k.h / 2 + 1,
      { size: 12, color: ui.gold, sw: 0, maxW: k.w - 24 });
    if (hm === 'pad') padHints(TITLE_PAD, 431);
    else text(t(`ctrl.${ctrl.mode}.desc`), W / 2, 429, { ...hint, color: ui.hint });
    text(t('title.tip'), W / 2, 444, hint);
  } else if (hm === 'pad') {
    padHints(TITLE_PAD, 402);
    text(t('title.tip'), W / 2, 420, hint);
    text(t('title.combo'), W / 2, 437, hint);
  } else {
    text(t('title.keys', keysHint()), W / 2, 402, { ...hint, color: ui.hint });
    text(t('title.tip'), W / 2, 420, hint);
    text(t('title.combo'), W / 2, 437, hint);
  }
  if (g.best.score > 0) text(t('title.best', { score: g.best.score, floor: g.best.floor, combo: g.best.combo }), W / 2, 460, { size: 12, color: ui.mint, sw: 3, maxW: 436 });
}

/** PRZEŁADUJ: pulsujący złoty przycisk pod RANKINGIEM, a pod nim wersja czekająca na serwerze. */
function drawUpdateButton(time, hm) {
  const c = ctx, b = UIBOX.update, glow = reduceMotion ? 0.6 : 0.5 + 0.5 * Math.sin(time * 4);
  c.save();
  c.shadowColor = ui.gold; c.shadowBlur = 6 + glow * 10;
  c.fillStyle = ui.btn; rr(b.x, b.y, b.w, b.h, 9); c.fill();
  c.restore();
  c.strokeStyle = ui.frame; c.lineWidth = 2; rr(b.x, b.y, b.w, b.h, 9); c.stroke();
  const gw = hm === 'pad' ? padGlyph(BTN.RB, b.x + 5, b.y + b.h / 2, 15) + 3 : 0, cx = b.x + b.w / 2 + gw / 2, maxW = b.w - 10 - gw;
  text(t('update.new'), cx, b.y + 11, { size: 9, color: ui.btnText, sw: 0, maxW });
  text(hm === 'keys' ? `${t('update.btn')} · U` : t('update.btn'), cx, b.y + 26, { size: 12, color: ui.btnText, sw: 0, maxW });
  text(`v${update.available}`, b.x + b.w / 2, b.y + b.h + 10, { size: 10, color: ui.gold, sw: 3, weight: 700 });
}

const TITLE_PAD = [['dpad', 'hint.pick'], [BTN.A, 'hint.play'], [BTN.Y, 'hint.rank'], [BTN.X, 'hint.opts']];

function drawPause(g) {
  dim(0.55);
  text(t('pause.title'), W / 2, 205, { size: 54, sw: 8, maxW: 430 });
  const hm = g.hint;
  if (hm === 'pad') padHints([[BTN.A, 'hint.resume'], [BTN.Y, 'hint.menu']], 262, { size: 14 });
  else text(t(hm === 'touch' ? 'pause.tap' : 'pause.resume', { key: keysHint().pause }), W / 2, 258, { size: 15, color: ui.hint, sw: 4, maxW: 430 });
  if (hm === 'keys') text(t('pause.menu'), W / 2, 284, { size: 13, color: ui.label, sw: 4, maxW: 430 });
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
    if (g.hint === 'pad') padHints([[BTN.A, 'hint.again'], [BTN.Y, 'hint.menu']], 354, { size: 14, color: ui.text });
    else if (reduceMotion || Math.sin(g.t * 5) > -0.3) text(t('over.again'), W / 2, 352, { size: 18, sw: 5, maxW: 430 });
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
        drawCrown(L.x + 22, y + 5, e.rank, g.t + e.rank * 0.4, 0.62);
        text(String(e.rank), L.x + 44, y, { size: 13, color: ui.text, sw: 3, align: 'right' });   // numer obok korony – nie tylko kolor
      } else if (mine) { c.fillStyle = ui.sel; rr(box.x, box.y, box.w, box.h, 6); c.fill(); }
      if (b.sel === i && g.hint !== 'touch') { c.strokeStyle = ui.gold; c.lineWidth = 2.5; rr(box.x - 1, box.y - 1, box.w + 2, box.h + 2, 7); c.stroke(); }
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
  button(UIBOX.nick, t(g.hint === 'keys' ? 'board.nickKey' : 'board.nick', { name: o.enabled ? name : '—' }), { size: 12 });
  button(UIBOX.back, t(g.hint === 'keys' ? 'board.backKey' : 'board.back'), { size: 12, glyph: g.hint === 'pad' ? BTN.B : null });
  if (g.hint === 'pad') padHints([['dpad', 'hint.pick'], [BTN.A, b.sel >= 0 ? 'hint.watch' : 'hint.back'], [BTN.B, 'hint.back']], 468, { size: 10 });
}

const PAGE_TITLES = { main: 'set.title', controls: 'ctrl.title', access: 'acc.title', keys: 'bind.keysTitle', pad: 'bind.padTitle', news: 'title.news' };
const KEY_HINTS = { main: 'set.keys', controls: 'ctrl.keys', access: 'set.keys', keys: 'bind.keysHint', pad: 'bind.keysHint', news: 'news.keys' };

/** Opcje: przewijana lista wierszy (options.js), „Wróć” pod nią, na dole objaśnienie i podpowiedzi. */
function drawSettings(g) {
  const c = ctx, st = g.settings, items = g.settingsItems, hm = g.hint, cur = g.selItem, sel = hm === 'touch' ? null : cur;
  dim(0.7);
  text(t(PAGE_TITLES[st.page]), W / 2, 27, { size: 26, color: ui.gold, sw: 6, maxW: 420 });
  const L = LIST, total = items.contentH, scroll = st.scroll;
  c.save(); c.beginPath(); c.rect(L.x - 6, L.y - 3, L.w + 12, L.h + 6); c.clip();
  for (const it of items) {
    if (it.type === 'back') continue;
    const r = rowBox(it, scroll);
    if (r.y + r.h < L.y - 3 || r.y > L.y + L.h + 3) continue;
    drawItem(g, it, r, it === sel);
  }
  c.restore();
  if (total > L.h) {                                   // pasek przewijania, strzałki „jest więcej”
    const x = L.x + L.w + 12, h = Math.max(24, L.h * L.h / total), y = L.y + (L.h - h) * (scroll / (total - L.h));
    c.fillStyle = ui.meterBg; rr(x - 2.5, L.y, 5, L.h, 2.5); c.fill();
    c.fillStyle = ui.gold; rr(x - 2.5, y, 5, h, 2.5); c.fill();
    const more = { size: 10, color: ui.gold, sw: 3 };
    if (scroll > 1) text('▲', x, L.y - 9, more);
    if (scroll < total - L.h - 1) text('▼', x, L.y + L.h + 9, more);
  }
  const back = items.find((it) => it.type === 'back');
  button(LIST_BACK, back.label(), { on: sel === back, size: 12, glyph: hm === 'pad' ? BTN.B : null });

  const confirming = g.confirming('delete') || g.confirming('reset') || g.confirming('acc') || g.confirming('bind.key') || g.confirming('bind.pad');
  const note = st.note ? t(st.note) : g.confirming('delete') ? t('set.deleteWarn') : g.confirming('reset') ? t('ctrl.resetWarn')
    : g.confirming('acc') ? t('acc.resetWarn') : cur?.off?.() ? t(cur.off()) : cur?.tip ? t(cur.tip) : '';
  if (note) text(note, W / 2, 432, { size: 12, color: confirming ? ui.warn : ui.mint, sw: 3, maxW: 470 });
  const hint = { size: 11, color: ui.note, sw: 3, weight: 700, maxW: 470 };
  if (st.page === 'main') text(t('set.privacy'), W / 2, 450, hint);
  else if (st.page === 'controls') text(t('ctrl.always'), W / 2, 450, hint);
  else if (st.page === 'news') text(t('news.foot', { v: VERSION }), W / 2, 450, hint);
  if (hm === 'pad' && st.page === 'news') padHints([['dpad', 'hint.scroll'], [BTN.B, 'hint.back']], 468, { size: 10 });
  else if (hm === 'pad') {
    const bind = st.page === 'keys' || st.page === 'pad';
    padHints([['dpad', 'hint.pick'], [BTN.A, bind ? 'hint.assign' : 'hint.ok'], ...(bind ? [[BTN.X, 'hint.clear']] : []), [BTN.B, 'hint.back']], 468, { size: 10 });
  } else if (hm === 'keys') text(t(KEY_HINTS[st.page]), W / 2, 468, { ...hint, color: ui.hint });
}

/** Jeden wiersz listy opcji w prostokącie r. */
function drawItem(g, it, r, isSel) {
  const c = ctx, st = g.settings, cy = r.y + r.h / 2 + 1;
  if (it.type === 'head') {
    text(it.label().toUpperCase(), r.x + 6, r.y + r.h / 2 + 3, { size: it.gold ? 13 : 11, color: it.gold ? ui.gold : ui.label, sw: 0, align: 'left', weight: 800, maxW: r.w - 12 });
    c.fillStyle = ui.line; c.fillRect(r.x + 4, r.y + r.h - 1, r.w - 8, 1);
    return;
  }
  if (it.type === 'note') {                              // punkt listy zmian: kropka i połamane linijki
    const lh = noteLine();
    text('•', r.x + 14, r.y + lh / 2 + 1, { size: 14, color: ui.gold, sw: 0 });
    it.lines.forEach((line, i) => text(line, r.x + 26, r.y + lh * (i + 0.5) + 1,
      { size: NOTE_FONT.size, weight: NOTE_FONT.weight, color: ui.text, sw: 0, align: 'left' }));
    return;
  }
  if (it.type === 'info') { text(it.label(), r.x + r.w / 2, cy, { size: 11, color: ui.hint, sw: 0, weight: 700, maxW: r.w - 10 }); return; }
  if (it.type === 'mode') { drawModeRow(it, r, isSel); return; }

  const off = it.off?.(), warnOn = it.ck && g.confirming(it.ck);
  panel(r.x, r.y, r.w, r.h);
  if (isSel || warnOn) { c.strokeStyle = it.warn ? ui.warn : ui.gold; c.lineWidth = 2.5; rr(r.x, r.y, r.w, r.h, 14); c.stroke(); }
  if (isSel) selMark(r);
  c.save();
  if (off) c.globalAlpha = 0.45;
  if (it.type === 'row') {
    const v = it.value?.(), col = it.warn ? ui.warn : ui.text;
    text(it.label(), v != null ? r.x + 18 : r.x + r.w / 2, cy, { size: 14, color: col, sw: 0, align: v != null ? 'left' : 'center', weight: 700, maxW: v != null ? r.w - ARROW_W - 26 : r.w - 40 });
    if (v != null) {
      const gold = it.arrows || it.gold || v === t('set.on');
      if (it.arrows) {
        const a = { size: 11, color: ui.gold, sw: 0 };
        text('◀', r.x + r.w - ARROW_W + 4, cy, a); text('▶', r.x + r.w - 18, cy, a);
        text(v, r.x + r.w - ARROW_W / 2 - 7, cy, { size: 14, color: ui.gold, sw: 0, maxW: ARROW_W - 46 });
      } else text(v, r.x + r.w - 20, cy, { size: 14, color: gold ? ui.gold : ui.label, sw: 0, align: 'right', maxW: ARROW_W });
    }
  } else if (it.type === 'slider') {
    text(it.label(), r.x + 18, r.y + 14, { size: 13, color: ui.text, sw: 0, align: 'left', weight: 800, maxW: 220 });
    text(it.show(), r.x + r.w - 18, r.y + 14, { size: 13, color: ui.gold, sw: 0, align: 'right', maxW: 80 });
    if (it.meter && tilt.active) {                     // podgląd: jak gra „czyta” telefon przy tej czułości
      const mx = r.x + r.w - 150, my = r.y + 14;
      c.fillStyle = ui.meterBg; rr(mx - 50, my - 4, 100, 8, 4); c.fill();
      c.fillStyle = ui.line; c.fillRect(mx - 0.75, my - 5, 1.5, 10);
      c.fillStyle = ui.gold; c.beginPath(); c.arc(mx + tilt.axis * 45, my, 5, 0, 7); c.fill();
    }
    const b = sliderBar(r, !!it.low), steps = it.max ?? SLIDER_STEPS, kx = b.x + b.w * it.get() / steps;
    if (it.low) {
      text(t(it.low), b.x - 14, b.y, { size: 10, color: ui.label, sw: 0, align: 'right', weight: 700, maxW: 70 });
      text(t(it.high), b.x + b.w + 14, b.y, { size: 10, color: ui.label, sw: 0, align: 'left', weight: 700, maxW: 70 });
    }
    c.fillStyle = ui.meterBg; rr(b.x, b.y - 3, b.w, 6, 3); c.fill();
    c.fillStyle = ui.gold; rr(b.x, b.y - 3, Math.max(6, kx - b.x), 6, 3); c.fill();
    for (let i = 0; i <= steps; i++) { c.fillStyle = ui.line; c.fillRect(b.x + b.w * i / steps - 0.5, b.y + 6, 1, 3); }
    c.beginPath(); c.arc(kx, b.y, 7.5, 0, 7); c.fillStyle = ui.text; c.fill();
    c.strokeStyle = ui.frame; c.lineWidth = 2; c.stroke();
  } else if (it.type === 'bind') {
    text(it.label(), r.x + 18, cy, { size: 14, color: ui.text, sw: 0, align: 'left', weight: 700, maxW: r.w - it.slots * 76 - 30 });
    const list = binds[it.kind][it.action], cap = st.capture;
    for (let j = 0; j < it.slots; j++) {
      const b = bindCell(r, j, it.slots), v = list[j];
      const waiting = cap && cap.kind === it.kind && cap.act === it.action && cap.slot === j;
      const picked = waiting || (isSel && st.slot === j);
      c.fillStyle = waiting ? ui.sel : 'rgba(0,0,0,.16)'; rr(b.x, b.y, b.w, b.h, 7); c.fill();
      c.strokeStyle = picked ? ui.gold : ui.line; c.lineWidth = picked ? 2 : 1; c.stroke();
      const mx = b.x + b.w / 2, my = b.y + b.h / 2;
      if (waiting) text(reduceMotion || Math.sin(g.t * 8) > 0 ? '…' : '', mx, my, { size: 14, color: ui.gold, sw: 0 });
      else if (v == null) text('—', mx, my + 0.5, { size: 12, color: ui.label, sw: 0 });
      else if (it.kind === 'key') text(keyLabel(v), mx, my + 0.5, { size: 12, color: ui.text, sw: 0, maxW: b.w - 8 });
      else { const w = padGlyph(v, 0, 0, 17, false); padGlyph(v, mx - w / 2, my, 17); }
    }
  }
  c.restore();
}

/** Znacznik wybranego wiersza (trójkąt przy lewej krawędzi) – zaznaczenie widać nie tylko po kolorze ramki. */
function selMark(r) {
  const c = ctx, y = r.y + r.h / 2;
  c.beginPath(); c.moveTo(r.x - 5, y - 6); c.lineTo(r.x + 3, y); c.lineTo(r.x - 5, y + 6); c.closePath();
  c.fillStyle = ui.gold; c.fill(); c.strokeStyle = ui.frame; c.lineWidth = 1.5; c.stroke();
}

/** Tryb sterowania: ikonka, nazwa, opis i przełącznik radiowy. */
function drawModeRow(it, r, isSel) {
  const c = ctx, m = it.k, on = m === ctrl.mode;
  c.fillStyle = on ? ui.sel : ui.panel; rr(r.x, r.y, r.w, r.h, 12); c.fill();
  c.strokeStyle = on || isSel ? ui.gold : access.contrast ? ui.text : ui.line; c.lineWidth = on || isSel ? 2.5 : access.contrast ? 2 : 1.5; c.stroke();
  if (isSel) selMark(r);
  ctrlIcon(m, r.x + 24, r.y + r.h / 2, on);
  text(it.label(), r.x + 48, r.y + 14, { size: 14, color: on ? ui.gold : ui.text, sw: 0, align: 'left', weight: 800, maxW: r.w - 90 });
  text(it.desc(), r.x + 48, r.y + 30, { size: 10, color: ui.hint, sw: 0, align: 'left', weight: 700, maxW: r.w - 90 });
  const cx = r.x + r.w - 22, cy = r.y + r.h / 2;
  c.beginPath(); c.arc(cx, cy, 9, 0, 7);
  if (on) {
    c.fillStyle = ui.gold; c.fill();
    c.strokeStyle = ui.frame; c.lineWidth = 2.2; c.lineCap = 'round'; c.lineJoin = 'round';
    c.beginPath(); c.moveTo(cx - 4.5, cy + 0.5); c.lineTo(cx - 1.2, cy + 3.8); c.lineTo(cx + 4.5, cy - 3.5); c.stroke();
  } else { c.strokeStyle = ui.line; c.lineWidth = 2; c.stroke(); }
}

/** Mała ikonka trybu sterowania (rysowana – gra nie ma plików graficznych). */
function ctrlIcon(m, x, y, on) {
  const c = ctx, col = on ? ui.gold : ui.hint;
  c.save();
  c.strokeStyle = col; c.fillStyle = col; c.lineWidth = 1.8; c.lineCap = 'round'; c.lineJoin = 'round';
  const tri = (tx, ty, dx, dy, s) => {                   // trójkąt-strzałka w kierunku (dx, dy)
    c.beginPath(); c.moveTo(tx + dx * s, ty + dy * s);
    c.lineTo(tx - dx * s * 0.6 - dy * s * 0.8, ty - dy * s * 0.6 + dx * s * 0.8);
    c.lineTo(tx - dx * s * 0.6 + dy * s * 0.8, ty - dy * s * 0.6 - dx * s * 0.8); c.closePath(); c.fill();
  };
  if (m === 'buttons') { tri(x - 7, y + 3, -1, 0, 5); tri(x + 1, y + 3, 1, 0, 5); tri(x + 9, y - 6, 0, -1, 4); }
  else if (m === 'halves' || m === 'swipe') {
    rr(x - 9, y - 11, 18, 22, 3); c.stroke();
    c.beginPath(); c.moveTo(x, y - 11); c.lineTo(x, y + 11); c.stroke();
    if (m === 'halves') { tri(x - 4.5, y + 4, -1, 0, 3); tri(x + 4.5, y + 4, 1, 0, 3); tri(x + 4.5, y - 5, 0, -1, 3); }
    else { c.beginPath(); c.moveTo(x + 4.5, y + 7); c.lineTo(x + 4.5, y - 5); c.stroke(); tri(x + 4.5, y - 6, 0, -1, 3); tri(x - 4.5, y + 2, -1, 0, 3); }
  } else if (m === 'joystick') {
    c.beginPath(); c.arc(x, y, 10, 0, 7); c.stroke();
    c.beginPath(); c.arc(x + 3, y - 1, 5, 0, 7); c.fill();
  } else if (m === 'one') {
    c.beginPath(); c.arc(x, y, 10, 0, 7); c.stroke();
    tri(x, y + 1, 0, -1, 5);
  } else if (m === 'tilt') {
    c.translate(x, y); c.rotate(-0.45);
    rr(-6, -10, 12, 20, 3); c.stroke();
    c.fillRect(-2, 6, 4, 1.6);
    c.rotate(0.45);
    c.beginPath(); c.arc(0, 0, 13, -0.5, 0.35); c.stroke();
  }
  c.restore();
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
    if (g.hint === 'pad') padHints([[BTN.A, 'hint.playPause'], [BTN.X, 'hint.stop'], ['dpad', 'hint.speed'], [BTN.B, 'hint.exit']], 418);
    else if (g.hint === 'keys') text(t('replay.keys'), W / 2, 418, { size: 11, color: ui.hint, sw: 3, weight: 700, maxW: 440 });
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
    if (e.replay) button(b, loading ? '…' : g.hint === 'keys' ? `${t('recap.watch')} · ${i + 1}` : t('recap.watch'), { accent: true, size: 10, on: g.hint === 'pad' && g.recapSel === i });
    else text(t('recap.noReplay'), x, b.y + b.h / 2, { size: 10, color: ui.label, sw: 0, maxW: 100 });
  }
  // moje miejsce
  const me = lw.me, mine = me?.entries.find((e) => e.me);
  const line = me?.rank && me.rank <= 3 ? t(`recap.crown${me.rank}`)
    : me?.rank ? t('recap.me', { rank: me.rank, score: mine?.score ?? '' }) : t('recap.none');
  text(line, W / 2, 392, { size: 14, color: me?.rank && me.rank <= 3 ? ui.gold : ui.mint, sw: 4, maxW: 460 });
  button(UIBOX.recapBoard, t('recap.board'), { size: 12 });
  button(UIBOX.recapNext, t('recap.next'), { accent: true, size: 13 });
  if (g.hint === 'pad') padHints([['dpad', 'hint.pick'], [BTN.A, 'hint.watch'], [BTN.Y, 'hint.rank'], [BTN.B, 'hint.next']], 466, { size: 10 });
  else if (g.hint === 'keys') text(t('recap.keys'), W / 2, 466, { size: 10, color: ui.note, sw: 3, weight: 700, maxW: 440 });
  else if (g.replay?.loading) text(t('replay.loading'), W / 2, 466, { size: 11, color: ui.hint, sw: 3 });
}
