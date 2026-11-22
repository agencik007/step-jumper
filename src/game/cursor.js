// Kursor myszy w trakcie biegu znika (CSS: body[data-state="play"]:not(.mouse-on) w index.html). Ruch myszą
// pokazuje go na chwilę – żeby dało się kliknąć pauzę – po czym znów się chowa. Dotyk i pióro nie mają kursora.
const SHOW_MS = 2000;
let timer = 0;

export function initCursor() {
  if (typeof window === 'undefined') return;
  window.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    document.body.classList.add('mouse-on');
    clearTimeout(timer);
    timer = setTimeout(() => document.body.classList.remove('mouse-on'), SHOW_MS);
  }, { passive: true });
}
