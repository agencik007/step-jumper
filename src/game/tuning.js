// Panel strojenia fizyki lotu – tylko w trybie DEV (main.js ładuje go dynamicznie, więc nie trafia do buildu produkcyjnego): dwa suwaki, które zmieniają sterowność bohatera w powietrzu.
// Całość (znaczniki, style, zapis ustawień) siedzi w tym pliku, żeby po wybraniu wartości dało się go po prostu usunąć.
import { DEFAULT_TUNE, LEGACY_TUNE, P } from '../sim';
import { sfx } from './audio.js';
import { isTouch } from './input.js';
import { clamp, loadJSON, saveJSON } from './util.js';

const KEY = 'stepjumper.tune.v1';

// Suwaki pracują na liczbach całkowitych; `toSim` przelicza je na jednostki symulacji (px/s²).
const SLIDERS = [
  {
    key: 'airAccel', label: 'Sterowność w locie', min: 50, max: 300, step: 5,
    hint: 'siła, z jaką kierunek rozpędza i zawraca bohatera w powietrzu',
    toSim: (v) => P.accel * v / 100, fromSim: (v) => Math.round(v * 100 / P.accel), show: (v) => `${v}%`,
  },
  {
    key: 'airBrake', label: 'Hamowanie po puszczeniu', min: 0, max: 2000, step: 50,
    hint: 'jak szybko bohater wytraca prędkość w locie, gdy nic nie trzymasz',
    toSim: (v) => v, fromSim: (v) => Math.round(v), show: (v) => String(v),
  },
];

/** Suwak przyjmuje tylko wartości ze swojej podziałki – także wtedy, gdy liczba przyszła z localStorage. */
function snap(sl, v) {
  const n = Number.isFinite(v) ? v : sl.fromSim(DEFAULT_TUNE[sl.key]);
  return clamp(Math.round(n / sl.step) * sl.step, sl.min, sl.max);
}

const saved = loadJSON(KEY, { open: !isTouch });
const pos = {};                                    // położenia suwaków
for (const sl of SLIDERS) pos[sl.key] = snap(sl, typeof saved[sl.key] === 'number' ? saved[sl.key] : NaN);

/** Aktualne strojenie w jednostkach symulacji – przekazywane grze przez game.retune. */
const tune = { airAccel: 0, airBrake: 0 };
function apply() { for (const sl of SLIDERS) tune[sl.key] = sl.toSim(pos[sl.key]); }
apply();

const secs = (v) => (Number.isFinite(v) ? `${v.toFixed(2).replace('.', ',')} s` : 'nigdy');

const CSS = `
  .tune { position: fixed; z-index: 5; top: max(10px, env(safe-area-inset-top)); right: max(10px, env(safe-area-inset-right));
    display: flex; flex-direction: column; align-items: flex-end; gap: 6px; color: #e8ecff; font-size: 13px; }
  .tune button { font: inherit; color: inherit; cursor: pointer; border: 1px solid #2c3769; border-radius: 8px;
    background: rgba(20,26,54,.92); padding: 6px 10px; touch-action: manipulation; }
  .tune button:hover, .tune button[aria-pressed="true"] { border-color: #ffe066; }
  .tune-box { width: min(270px, calc(100vw - 20px)); padding: 12px; border: 1px solid #2c3769; border-radius: 10px;
    background: rgba(10,13,31,.94); box-shadow: 0 10px 30px rgba(0,0,0,.5); }
  .tune-box[hidden] { display: none; }
  .tune-box h2 { margin: 0 0 10px; font-size: 12px; letter-spacing: .08em; color: #8f9bd4; }
  .tune-row { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
  .tune-row output { font-weight: 700; color: #ffe066; font-variant-numeric: tabular-nums; }
  .tune-box input[type=range] { width: 100%; height: 28px; margin: 2px 0 0; accent-color: #ffe066; touch-action: none; }
  .tune-box small { display: block; margin: 0 0 10px; color: #8f9bd4; font-size: 11px; line-height: 1.35; }
  .tune-box p { margin: 0 0 10px; font-size: 11px; line-height: 1.5; font-variant-numeric: tabular-nums; }
  .tune-presets { display: flex; gap: 6px; }
  .tune-presets button { flex: 1; padding: 6px 4px; }
`;

/** Buduje panel i podpina go do gry. Wywoływane raz, przy starcie. */
export function initTuning(game) {
  const el = (tag, props = {}, kids = []) => {
    const n = Object.assign(document.createElement(tag), props);
    n.append(...kids);
    return n;
  };
  document.head.append(el('style', { textContent: CSS }));

  const toggle = el('button', { type: 'button', textContent: '⚙ Fizyka lotu', title: 'Pokaż / ukryj suwaki (klawisz F)' });
  const box = el('div', { className: 'tune-box' }, [el('h2', { textContent: 'FIZYKA LOTU · TEST' })]);
  const rows = SLIDERS.map((sl) => {
    const out = el('output');
    const range = el('input', { type: 'range', min: sl.min, max: sl.max, step: sl.step, tabIndex: -1 });
    range.setAttribute('aria-label', sl.label);
    const was = sl.show(sl.fromSim(LEGACY_TUNE[sl.key]));
    box.append(
      el('div', { className: 'tune-row' }, [el('span', { textContent: sl.label }), out]),
      range,
      el('small', { textContent: `${sl.hint} (do tej pory: ${was})` }),
    );
    range.addEventListener('input', () => { pos[sl.key] = snap(sl, range.valueAsNumber); changed(); });
    range.addEventListener('change', () => range.blur());   // bez fokusu: strzałki mają sterować bohaterem, a nie suwakiem
    return { sl, range, out };
  });
  const facts = el('p');
  const presets = [['Proponowane', DEFAULT_TUNE], ['Jak do tej pory', LEGACY_TUNE]].map(([label, preset]) => {
    const btn = el('button', { type: 'button', textContent: label });
    btn.addEventListener('click', () => {
      for (const sl of SLIDERS) pos[sl.key] = snap(sl, sl.fromSim(preset[sl.key]));
      sfx.pick();
      btn.blur();
      changed();
    });
    return { btn, preset };
  });
  box.append(facts, el('div', { className: 'tune-presets' }, presets.map((p) => p.btn)));
  const root = el('div', { className: 'tune' }, [toggle, box]);
  document.body.append(root);

  function draw() {
    for (const { sl, range, out } of rows) { range.value = pos[sl.key]; out.textContent = sl.show(pos[sl.key]); }
    for (const { btn, preset } of presets) btn.setAttribute('aria-pressed', String(SLIDERS.every((sl) => tune[sl.key] === preset[sl.key])));
    facts.textContent = `Z pełnej prędkości do zera: kontrą ${secs(P.maxVx / (tune.airAccel * P.turn))}, `
      + `po puszczeniu ${secs(tune.airBrake > 0 ? P.maxVx / tune.airBrake : Infinity)}.`;
  }
  function changed() {
    apply();
    saveJSON(KEY, { ...pos, open: !box.hidden });
    game.retune(tune);
    draw();
  }
  function setOpen(open) {
    box.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    saveJSON(KEY, { ...pos, open });
  }

  toggle.addEventListener('click', () => { toggle.blur(); setOpen(box.hidden); });
  addEventListener('keydown', (e) => { if (e.code === 'KeyF' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) setOpen(box.hidden); });
  // Dotknięcie panelu nie może być skokiem (tryb przechyłu), a sięgnięcie po suwak w trakcie biegu wstrzymuje grę.
  root.addEventListener('pointerdown', (e) => { e.stopPropagation(); game.pause(); });
  // Klawisze gry nigdy nie obsługują panelu: strzałka nie przesuwa suwaka, a spacja nie wciska przycisku.
  root.addEventListener('keydown', (e) => { if (e.code.startsWith('Arrow') || e.code === 'Space') { e.preventDefault(); e.target.blur?.(); } });

  setOpen(!!saved.open);
  game.retune(tune);                               // zapamiętane położenia suwaków działają od pierwszego biegu
  draw();
}
