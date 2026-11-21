// Przyciski ekranowe: rozmiar, widoczność i własny układ ustawiany przeciąganiem (OPCJE → STEROWANIE → Układ przycisków).
// Układ to środek każdego elementu jako ułamek szerokości i wysokości okna – działa na każdym ekranie.
// Element bez zapisanej pozycji stoi tam, gdzie stawia go CSS (układ prawo- albo leworęczny).
import { focusGame } from './gfx.js';
import { clamp } from './util.js';

export const PAD_STEPS = 8;
export const PAD_DEFAULT = { size: 4, alpha: 8 };
export const PAD_KEYS = ['left', 'right', 'jump', 'jump2', 'stick'];
/** size, alpha: 0…8; pos: { left|right|jump|jump2|stick: { x, y } }. */
export const pads = { ...PAD_DEFAULT, pos: {} };

export const padScale = () => 0.6 + pads.size * 0.1;     // 60% … 140%
export const padAlpha = () => 0.2 + pads.alpha * 0.1;    // 20% … 100%

const has = typeof document !== 'undefined';
const q = (s) => (has ? document.querySelector(s) : null);
function elements() {
  return { left: q('#padL [data-act=left]'), right: q('#padL [data-act=right]'), jump: q('#padR button'), jump2: q('#padJ button'), stick: q('#stick') };
}

/** Wczytuje zapisane ustawienia (z prefs gry). */
export function loadPads(p) {
  pads.size = clamp(Math.round(Number(p?.size ?? PAD_DEFAULT.size)) || 0, 0, PAD_STEPS);
  pads.alpha = clamp(Math.round(Number(p?.alpha ?? PAD_DEFAULT.alpha)) || 0, 0, PAD_STEPS);
  pads.pos = {};
  for (const k of PAD_KEYS) {
    const v = p?.pos?.[k];
    if (v && Number.isFinite(v.x) && Number.isFinite(v.y)) pads.pos[k] = { x: clamp(v.x, 0, 1), y: clamp(v.y, 0, 1) };
  }
  applyPads();
}
export const savedPads = () => ({ size: pads.size, alpha: pads.alpha, pos: pads.pos });

/** Rozmiar, widoczność i pozycje na stronie. */
export function applyPads() {
  if (!has) return;
  const root = document.documentElement.style;
  root.setProperty('--pad-scale', String(padScale()));
  root.setProperty('--pad-alpha', String(padAlpha()));
  const els = elements();
  for (const k of PAD_KEYS) place(els[k], pads.pos[k]);
}
function place(el, p) {
  if (!el) return;
  el.classList.toggle('placed', !!p);
  el.style.left = p ? `${Math.round(p.x * innerWidth)}px` : '';
  el.style.top = p ? `${Math.round(p.y * innerHeight)}px` : '';
}
/** Gałka po puszczeniu palca wraca na swoje miejsce (własne albo z CSS). */
export function restStick() { place(elements().stick, pads.pos.stick); }
/** Własne miejsce gałki: −1 lewa połowa ekranu, 1 prawa, null – brak (decyduje układ prawo-/leworęczny). */
export const stickHome = () => (pads.pos.stick ? (pads.pos.stick.x < 0.5 ? -1 : 1) : null);

/** Zmiana ręki przy własnym układzie: wszystko odbija się w poziomie, a ◀ i ▶ zamieniają się miejscami (◀ zostaje po lewej). */
export function mirrorPads() {
  for (const k of PAD_KEYS) if (pads.pos[k]) pads.pos[k].x = 1 - pads.pos[k].x;
  const { left, right } = pads.pos;
  delete pads.pos.left; delete pads.pos.right;
  if (right) pads.pos.left = right;
  if (left) pads.pos.right = left;
  applyPads();
}
export function resetPadLayout() { pads.pos = {}; applyPads(); }
export function resetPads() { Object.assign(pads, PAD_DEFAULT); resetPadLayout(); }

if (has) addEventListener('resize', applyPads);

// ───────────────────────── edytor układu ─────────────────────────
let editing = null;                     // { onClose }
export const padEditing = () => !!editing;
const box = q('#padEdit');

/** Otwiera edytor: przyciski bieżącego trybu można przeciągać, na górze suwaki i „Gotowe”. */
export function openPadEditor(onClose) {
  if (!has || editing) return;
  editing = { onClose };
  document.body.classList.add('pad-edit');
  if (box) {
    box.hidden = false;
    box.querySelector('#peSize').value = String(pads.size);
    box.querySelector('#peAlpha').value = String(pads.alpha);
  }
}
export function closePadEditor() {
  if (!editing) return;
  const { onClose } = editing;
  editing = null;
  document.body.classList.remove('pad-edit');
  if (box) box.hidden = true;
  focusGame();
  onClose?.();
}

/** Przeciąganie elementów i obsługa paska edytora – raz, przy starcie. */
export function initPadEditor(onChange) {
  if (!has) return;
  const els = elements();
  for (const k of PAD_KEYS) {
    const el = els[k];
    if (!el) continue;
    let drag = null;
    el.addEventListener('pointerdown', (e) => {
      if (!editing) return;
      e.preventDefault(); e.stopPropagation();
      const r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      drag = { id: e.pointerId, dx: e.clientX - cx, dy: e.clientY - cy, hw: r.width / 2, hh: r.height / 2 };
      try { el.setPointerCapture(e.pointerId); } catch {}
      el.classList.add('dragging');
    });
    el.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const x = clamp(e.clientX - drag.dx, drag.hw, innerWidth - drag.hw), y = clamp(e.clientY - drag.dy, drag.hh, innerHeight - drag.hh);
      pads.pos[k] = { x: x / innerWidth, y: y / innerHeight };
      place(el, pads.pos[k]);
    });
    const end = () => { if (drag) { drag = null; el.classList.remove('dragging'); onChange(); } };
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) el.addEventListener(ev, end);
  }
  if (!box) return;
  box.addEventListener('pointerdown', (e) => e.stopPropagation());
  const slider = (id, key) => {
    const r = box.querySelector(id);
    r.max = String(PAD_STEPS);
    r.addEventListener('input', () => { pads[key] = Number(r.value); applyPads(); });
    r.addEventListener('change', () => onChange());
  };
  slider('#peSize', 'size');
  slider('#peAlpha', 'alpha');
  box.querySelector('#peReset').addEventListener('click', () => { resetPadLayout(); onChange(); });
  box.querySelector('#peDone').addEventListener('click', () => closePadEditor());
}
