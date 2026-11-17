// Postacie: rysowane w całości kodem (Canvas 2D), bez plików graficznych. Różnią się tylko wyglądem.
import { P } from '../sim';
import { ctx, rr } from './gfx.js';
import { clamp } from './util.js';

const INK = '#3a1c10';

function legs(c, p, { color, w = 8.5, len = 9, gap = 4, r = 3, foot = null }) {
  const swing = Math.sin(p.ph) * 7 * p.run;
  const L = p.air
    ? (p.rise > 0 ? [[-gap - 1, len * 0.66, -0.5], [gap, len * 0.66, 0.5]] : [[-gap - 1, len * 1.1, 0.2], [gap + 1, len * 1.1, -0.2]])
    : [[-gap - swing, len - Math.max(0, Math.cos(p.ph)) * 3 * p.run, 0], [gap + swing, len - Math.max(0, -Math.cos(p.ph)) * 3 * p.run, 0]];
  for (const [lx, ll, rot] of L) {
    c.save(); c.translate(lx, -ll); c.rotate(rot);
    c.fillStyle = color; rr(-w / 2 + 0.75, 0, w, ll, r); c.fill(); c.stroke();
    if (foot) { c.fillStyle = foot.color; rr(-w / 2 + 0.75, ll - foot.h, w + foot.ext, foot.h, foot.h / 2); c.fill(); c.stroke(); }
    c.restore();
  }
}
function arm(c, p, { x = 1, y = -24, len = 8, color, w = 4 }) {
  const a = p.air ? (p.rise > 0 ? -1.3 : 0.5) : 1.1 + Math.sin(p.ph) * 0.9 * p.run;
  const ex = x + Math.cos(a) * len, ey = y + Math.sin(a) * len;
  c.save();
  c.strokeStyle = INK; c.lineWidth = w + 2.6; c.beginPath(); c.moveTo(x, y); c.lineTo(ex, ey); c.stroke();
  c.strokeStyle = color; c.lineWidth = w; c.beginPath(); c.moveTo(x, y); c.lineTo(ex, ey); c.stroke();
  c.restore();
}
function eye(c, p, x, y, { rx = 3.3, ry = 4.2, white = '#fff', slit = false } = {}) {
  if (!p.air && (p.t % 3.4) < 0.11) { c.beginPath(); c.moveTo(x - rx, y); c.lineTo(x + rx, y); c.stroke(); return; }
  const big = p.air ? 1.15 : 1;
  c.fillStyle = white; c.beginPath(); c.ellipse(x, y, rx * big, ry * big, 0, 0, 7); c.fill(); c.stroke();
  c.fillStyle = INK; c.beginPath();
  if (slit) c.ellipse(x + 0.8, y - p.rise, 1.1, ry * 0.75, 0, 0, 7); else c.arc(x + 1.2, y - p.rise * 1.2, 1.9, 0, 7);
  c.fill();
}
function ears(c, list, fill, inner) {
  for (const [ax, ay, bx, by, cx, cy] of list) {
    c.beginPath(); c.moveTo(ax, ay); c.lineTo(bx, by); c.lineTo(cx, cy); c.closePath();
    c.fillStyle = fill; c.fill(); c.stroke();
    c.fillStyle = inner; c.beginPath();
    c.moveTo(bx, by); c.lineTo(bx + (ax - bx) * 0.45, by + (ay - by) * 0.45); c.lineTo(bx + (cx - bx) * 0.45, by + (cy - by) * 0.45);
    c.closePath(); c.fill();
  }
}

// 1. Rudy – lis w szaliku
const FOX_TAIL = new Path2D('M0 -5 C-10 -20 -33 -15 -33 0 C-31 11 -10 10 0 4 Z');
function drawFox(c, p) {
  const FUR = '#f08a2e', FUR_D = '#d46f1c', CREAM = '#fff1dc', PAW = '#5a2d1a', SCARF = '#19b5a5', SCARF_D = '#0f8f83';
  c.save();
  c.translate(-7, -13);
  c.rotate(-0.55 + Math.sin(p.t * 6) * 0.12 + (p.air ? 0.7 * p.rise : Math.sin(p.ph) * 0.15 * p.run));
  c.fillStyle = FUR; c.fill(FOX_TAIL);
  c.save(); c.clip(FOX_TAIL); c.fillStyle = CREAM; c.beginPath(); c.arc(-31, 0, 12, 0, 7); c.fill(); c.restore();
  c.stroke(FOX_TAIL);
  c.restore();
  legs(c, p, { color: PAW });
  c.fillStyle = FUR; c.beginPath(); c.ellipse(0, -19, 10.5, 12.5, 0, 0, 7); c.fill(); c.stroke();
  c.fillStyle = CREAM; c.beginPath(); c.ellipse(3.5, -16, 5.5, 8, 0, 0, 7); c.fill();
  // ogon szalika zdradza prędkość
  const fx = -8 - clamp(p.vxl / P.maxVx, -1, 1) * 22, fy = p.rise * 16 + 5;
  const wave = Math.sin(p.t * 15) * 3 * (0.4 + Math.min(1, p.speed / 300 + Math.abs(p.vy) / 600));
  c.save(); c.strokeStyle = SCARF_D; c.lineWidth = 5.5;
  c.beginPath(); c.moveTo(-6, -28); c.quadraticCurveTo(-6 + fx * 0.5, -28 + fy * 0.5 + wave, -6 + fx, -28 + fy - wave); c.stroke();
  c.restore();
  ears(c, [[-8, -44, -7, -59, 1, -49], [3, -49, 10, -60, 13, -45]], FUR, PAW);
  c.fillStyle = FUR; c.beginPath(); c.arc(2, -39, 11.5, 0, 7); c.fill(); c.stroke();
  c.fillStyle = CREAM;
  c.beginPath(); c.ellipse(9.5, -35, 7.5, 5.5, 0, 0, 7); c.fill();
  c.beginPath(); c.ellipse(-3, -33, 5, 4, 0.5, 0, 7); c.fill();
  c.fillStyle = INK; c.beginPath(); c.arc(16, -37, 2.3, 0, 7); c.fill();
  eye(c, p, 6, -42.5);
  c.beginPath(); c.arc(9.5, -34, 4, 0.5, 1.9); c.stroke();
  c.fillStyle = SCARF; rr(-9.5, -31.5, 20, 6.5, 3); c.fill(); c.stroke();
  arm(c, p, { color: FUR_D });
}

// 2. Kra – pingwin w nausznikach
function drawPenguin(c, p) {
  const BLUE = '#4468b8', BLUE_L = '#5d82d6', ORANGE = '#ff9d2e', RED = '#e5482f';
  c.fillStyle = BLUE; c.beginPath(); c.moveTo(-9, -9); c.lineTo(-18, -3); c.lineTo(-7, -2); c.closePath(); c.fill(); c.stroke();
  legs(c, p, { color: ORANGE, w: 8, len: 5, gap: 4.5, r: 2.5, foot: { color: ORANGE, h: 4, ext: 4.5 } });
  c.fillStyle = BLUE; c.beginPath(); c.ellipse(0, -23, 13, 20, 0, 0, 7); c.fill(); c.stroke();
  c.fillStyle = '#fff';
  c.beginPath(); c.ellipse(3.5, -18, 8.5, 14, 0, 0, 7); c.fill();
  c.beginPath(); c.ellipse(6, -34, 6.5, 6, 0, 0, 7); c.fill();
  eye(c, p, 6, -35.5, { rx: 2.8, ry: 3.6 });
  c.fillStyle = ORANGE; c.beginPath(); c.moveTo(10, -32.5); c.lineTo(20.5, -29.5); c.lineTo(10, -27); c.closePath(); c.fill(); c.stroke();
  c.save();                                           // pałąk nauszników
  c.strokeStyle = INK; c.lineWidth = 5.2; c.beginPath(); c.moveTo(-4, -35); c.quadraticCurveTo(-4, -42, 0, -44); c.stroke();
  c.strokeStyle = RED; c.lineWidth = 2.8; c.stroke();
  c.restore();
  c.fillStyle = RED; c.beginPath(); c.arc(-4, -33.5, 5.2, 0, 7); c.fill(); c.stroke();
  arm(c, p, { x: -1, y: -25, len: 12, color: BLUE_L, w: 6 });
}

// 3. Kumka – żaba w koronie
function drawFrog(c, p) {
  const G = '#5cbf4a', GD = '#3d8f33', GL = '#d2f5a8';
  legs(c, p, { color: GD, w: 9, len: p.air ? 13 : 8, gap: 6.5, r: 3.5, foot: { color: GD, h: 4, ext: 5 } });
  c.fillStyle = '#ffd24a';                             // korona
  c.beginPath(); c.moveTo(-3, -35); c.lineTo(-4.5, -45); c.lineTo(-0.5, -40.5); c.lineTo(2.5, -47); c.lineTo(5.5, -40.5); c.lineTo(9.5, -45); c.lineTo(8, -35);
  c.closePath(); c.fill(); c.stroke();
  c.fillStyle = G; c.beginPath(); c.ellipse(0, -17, 14, 13, 0, 0, 7); c.fill(); c.stroke();
  c.fillStyle = GL; c.beginPath(); c.ellipse(3, -12.5, 9, 7.5, 0, 0, 7); c.fill();
  for (const [ex, ey] of [[-5, -29.5], [8, -30.5]]) { c.fillStyle = G; c.beginPath(); c.arc(ex, ey, 6.8, 0, 7); c.fill(); c.stroke(); }
  c.fillStyle = G; c.beginPath(); c.ellipse(1.5, -24, 11.5, 5.5, 0, 0, 7); c.fill();
  eye(c, p, -4, -30, { rx: 3.7, ry: 4.1 });
  eye(c, p, 9, -31, { rx: 3.9, ry: 4.3 });
  c.beginPath(); c.moveTo(1, -19.5); c.quadraticCurveTo(8.5, -15, 14, -20.5); c.stroke();
  c.fillStyle = 'rgba(255,110,110,.55)'; c.beginPath(); c.arc(11, -23.5, 2.2, 0, 7); c.fill();
  arm(c, p, { x: 2, y: -16, len: 8, color: GD, w: 4 });
}

// 4. Zgrzyt – robot z odrzutem
function drawRobot(c, p) {
  const M = '#cdd6e6', MD = '#8090ab', DK = '#343d57', RED = '#ff5a4d', CY = '#7ef0e0';
  if (p.air && p.rise > 0.12) {                        // płomień dyszy
    const fl = 5 + p.rise * 9 + Math.sin(p.t * 50) * 2.5;
    c.fillStyle = '#ffb347'; c.beginPath(); c.moveTo(-5, -4); c.lineTo(0, fl); c.lineTo(5, -4); c.closePath(); c.fill();
    c.fillStyle = '#fff3a8'; c.beginPath(); c.moveTo(-2.5, -4); c.lineTo(0, fl * 0.5); c.lineTo(2.5, -4); c.closePath(); c.fill();
  }
  legs(c, p, { color: MD, w: 6, len: 9, gap: 4.5, r: 1.5, foot: { color: DK, h: 4, ext: 3 } });
  c.fillStyle = MD; rr(-14, -29, 7, 15, 2.5); c.fill(); c.stroke();
  c.fillStyle = M; rr(-10, -31, 20, 23, 5); c.fill(); c.stroke();
  c.fillStyle = DK; rr(0, -27, 8, 9, 2); c.fill();
  c.fillStyle = (p.t * 2) % 1 < 0.5 ? CY : RED; c.beginPath(); c.arc(4, -22.5, 2.1, 0, 7); c.fill();
  c.fillStyle = MD; c.fillRect(-3, -34.5, 7, 4.5); c.strokeRect(-3, -34.5, 7, 4.5);
  const tip = -3 - clamp(p.vxl / P.maxVx, -1, 1) * 4;   // antena ugina się od pędu
  c.beginPath(); c.moveTo(-1, -50); c.quadraticCurveTo(-1, -55, tip, -58); c.stroke();
  c.fillStyle = RED; c.beginPath(); c.arc(tip, -59, 2.9, 0, 7); c.fill(); c.stroke();
  c.fillStyle = M; rr(-10, -51, 23, 17.5, 5.5); c.fill(); c.stroke();
  c.fillStyle = DK; rr(0.5, -47, 12, 9, 3.5); c.fill();
  const blink = !p.air && (p.t % 3.4) < 0.11;
  c.fillStyle = CY; rr(5.5, -45 - p.rise + (blink ? 1.8 : 0), 5, blink ? 1.4 : 5, 1.4); c.fill();
  c.fillStyle = MD; c.beginPath(); c.arc(-5, -42, 3.1, 0, 7); c.fill(); c.stroke();
  arm(c, p, { x: 0, y: -25, len: 9, color: MD, w: 4.5 });
}

// 5. Figa – kotka z dzwoneczkiem
function drawCat(c, p) {
  const B = '#b79cf0', BD = '#8f6fe0', BL = '#ece3ff', PINK = '#ff8fb0', RED = '#e5482f';
  const sway = Math.sin(p.t * 5) * 4 + (p.air ? -p.rise * 9 : 0) - clamp(p.vxl / P.maxVx, -1, 1) * 6;
  const tail = () => { c.beginPath(); c.moveTo(-7, -10); c.bezierCurveTo(-23, -7, -25, -22, -19 + sway * 0.5, -31); c.quadraticCurveTo(-16 + sway, -38, -22 + sway, -41); };
  c.save();
  c.lineWidth = 8; c.strokeStyle = INK; tail(); c.stroke();
  c.lineWidth = 5.2; c.strokeStyle = B; tail(); c.stroke();
  c.restore();
  legs(c, p, { color: B, w: 8, len: 9, gap: 4, r: 3, foot: { color: '#fff', h: 4, ext: 1.5 } });
  c.fillStyle = B; c.beginPath(); c.ellipse(0, -18, 10, 12, 0, 0, 7); c.fill(); c.stroke();
  c.fillStyle = BL; c.beginPath(); c.ellipse(4, -16.5, 4.5, 6.5, 0, 0, 7); c.fill();
  c.save(); c.strokeStyle = BD; c.lineWidth = 2;       // pręgi
  for (const sy of [-23, -18.5, -14]) { c.beginPath(); c.moveTo(-9.5, sy); c.lineTo(-5, sy + 1); c.stroke(); }
  c.restore();
  ears(c, [[-9, -43, -8.5, -58, 0, -48], [2, -48, 9.5, -59, 12.5, -44]], B, PINK);
  c.fillStyle = B; c.beginPath(); c.ellipse(2, -38, 12, 11, 0, 0, 7); c.fill(); c.stroke();
  c.save(); c.strokeStyle = BD; c.lineWidth = 2;
  for (const sx of [-3, 1]) { c.beginPath(); c.moveTo(sx, -48.3); c.lineTo(sx + 0.8, -44.5); c.stroke(); }
  c.restore();
  c.fillStyle = BL; c.beginPath(); c.ellipse(9.5, -34.5, 5.5, 4, 0, 0, 7); c.fill();
  c.fillStyle = PINK; c.beginPath(); c.moveTo(12.3, -36.8); c.lineTo(15.8, -36.8); c.lineTo(14, -34.4); c.closePath(); c.fill();
  c.save(); c.strokeStyle = 'rgba(255,255,255,.85)'; c.lineWidth = 0.9;
  for (const dy of [-1.2, 1]) { c.beginPath(); c.moveTo(11, -33.5 + dy); c.lineTo(22, -34 + dy * 2.4); c.stroke(); }
  c.restore();
  eye(c, p, 6, -41, { rx: 3.4, ry: 4.2, white: '#d8f24a', slit: true });
  c.fillStyle = RED; rr(-8, -30.5, 18, 5, 2.5); c.fill(); c.stroke();
  c.fillStyle = '#ffd24a'; c.beginPath(); c.arc(5, -25, 2.9, 0, 7); c.fill(); c.stroke();
  arm(c, p, { x: 1, y: -23, len: 8, color: BD, w: 4 });
}

export const CHARS = [
  { id: 'fox', name: 'Rudy', tag: 'lis w szaliku', draw: drawFox },
  { id: 'penguin', name: 'Kra', tag: 'pingwin w nausznikach', draw: drawPenguin },
  { id: 'frog', name: 'Kumka', tag: 'żaba w koronie', draw: drawFrog },
  { id: 'robot', name: 'Zgrzyt', tag: 'robot z odrzutem', draw: drawRobot },
  { id: 'cat', name: 'Figa', tag: 'kotka z dzwoneczkiem', draw: drawCat },
];

/**
 * @param h   bohater z symulacji (x, y, vx, vy, face, onFloor, spin)
 * @param fx  stan czysto wizualny: { angle, squash, runPhase }
 */
export function drawHero(h, fx, t, kind) {
  const c = ctx;
  const air = h.onFloor < 0;
  const run = air ? 0 : Math.min(1, Math.abs(h.vx) / 220);
  const sq = fx.squash + (air || run > 0.05 ? 0 : Math.sin(t * 3) * 0.035);
  c.save();
  c.translate(h.x, h.y);
  c.scale(h.face * (1 + 0.22 * sq), 1 - 0.25 * sq);
  if (h.spin) { c.translate(0, -24); c.rotate(fx.angle); c.translate(0, 24); }
  c.lineJoin = 'round'; c.lineCap = 'round'; c.strokeStyle = INK; c.lineWidth = 1.6;
  CHARS[kind].draw(c, { t, air, run, ph: fx.runPhase, rise: clamp(-h.vy / 1000, -1, 1), vxl: h.vx * h.face, speed: Math.abs(h.vx), vy: h.vy });
  c.restore();
}
