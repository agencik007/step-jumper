// Strony opcji jako listy wierszy. Ten sam opis służy do rysowania (render.js), dotyku i wyboru strzałkami / padem (game.js).
//
// Wiersz: { k, type, label(), … }, gdzie type to:
//   head   – nagłówek grupy (nie da się go wybrać),
//   info   – linijka objaśnienia (nie da się jej wybrać),
//   mode   – tryb sterowania (przełącznik radiowy),
//   row    – zwykły wiersz: value() po prawej; arrows – wartość zmienia się ◀ ▶; act() – dotknięcie / Enter / A,
//   slider – suwak 0…8: get(), set(v), show() – napis wartości, low/high – podpisy końców,
//   bind   – przypisanie akcji do klawiszy (kind 'key') albo przycisków pada (kind 'pad'),
//   back   – „Wróć” pod listą.
// off() → klucz tekstu, gdy wiersz nie dotyczy obecnego trybu (jest przygaszony, ale da się go ustawić na zapas).
import { sfx } from './audio.js';
import { HAPTIC_LEVELS, haptics } from './haptics.js';
import { LANG_NAMES, lang, t } from './i18n.js';
import {
  BIND_ACTS, CONTROLS, DEAD_STEPS, JUMP_MODES, KEY_SLOTS, OPTS_DEFAULT, PAD_MODES, PAD_SLOTS, SENS_MAX, TILT_ZERO_MAX, calibrateTilt, ctrl, opts,
  padDeadValue, resetBinds, stickDeadValue, tilt,
} from './input.js';
import { listLayout } from './layout.js';
import { PAD_STEPS, padAlpha, padScale, pads, applyPads, openPadEditor, resetPads } from './padlayout.js';
import { clamp, mod } from './util.js';

const pct = (v) => `${Math.round(v * 100)}%`;
const onOff = (v) => t(v ? 'set.on' : 'set.off');
const cycleIn = (list, cur, d) => list[mod(list.indexOf(cur) + d, list.length)];

export function buildPages(g) {
  const save = () => { g.savePrefs(); sfx.pick(); };
  const confirm = (key, run) => () => {                 // dwa dotknięcia: pierwsze tylko pyta
    const st = g.settings;
    if (st.confirmK !== key || g.t > st.confirmT) { st.confirmK = key; st.confirmT = g.t + 4; st.note = ''; sfx.pick(); return; }
    st.confirmT = 0; st.confirmK = null; run();
  };
  const back = { k: 'back', type: 'back', label: () => t(g.hint === 'keys' ? 'set.backKey' : 'set.back'), act: () => g.settingsBack() };

  const main = [
    { k: 'lang', type: 'row', arrows: true, label: () => (lang() === 'en' ? t('set.lang') : `${t('set.lang')} / Language`), value: () => LANG_NAMES[lang()],
      act: () => g.cycleLang(1), side: (d) => g.cycleLang(d) },
    { k: 'controls', type: 'row', gold: true, label: () => t('set.controls'), value: () => `${t(`ctrl.${ctrl.mode}`)}  ›`, act: () => g.openPage('controls') },
    { k: 'hand', type: 'row', arrows: true, label: () => t('set.hand'), value: () => t(g.lefty ? 'set.handLeft' : 'set.handRight'),
      act: () => { g.setLefty(!g.lefty, true); save(); } },
    { k: 'sound', type: 'row', label: () => t('set.sound'), value: () => onOff(!sfx.muted), act: () => { sfx.muted = !sfx.muted; save(); } },
    { k: 'music', type: 'row', label: () => t('set.music'), value: () => onOff(sfx.musicOn), act: () => { sfx.musicOn = !sfx.musicOn; save(); } },
    { k: 'vibrate', type: 'row', arrows: true, label: () => t('set.vibrate'),
      value: () => (haptics.available ? t(`vib.${HAPTIC_LEVELS[haptics.level]}`) : t('set.na')),
      act: () => setVibe(1), side: (d) => setVibe(d) },
    { k: 'online', type: 'row', label: () => t('set.online'), value: () => onOff(g.online.enabled), act: () => g.toggleOnline() },
    { k: 'delete', type: 'row', warn: true, ck: 'delete', label: () => t(g.confirming('delete') ? 'set.deleteConfirm' : 'set.delete'),
      act: confirm('delete', () => g.deleteData()) },
    back,
  ];
  function setVibe(d) {
    if (!haptics.available) { g.settings.note = 'vib.none'; return; }
    haptics.level = mod(haptics.level + d, HAPTIC_LEVELS.length);   // Enter / dotknięcie przechodzi w kółko
    g.savePrefs(); haptics.buzz(60); sfx.pick();
  }

  const slider = (k, get, set, show, extra = {}) => ({
    k, type: 'slider', label: () => t(`ctrl.${k}`), get, show,
    set: (v) => { v = clamp(v, 0, extra.max ?? 8); if (v === get()) return; set(v); if (extra.after) extra.after(); save(); },
    ...extra,
  });
  const noPads = () => (PAD_MODES.includes(ctrl.mode) ? null : 'ctrl.offPads');
  const controls = [
    { k: 'h.mode', type: 'head', label: () => t('ctrl.hMode') },
    ...CONTROLS.map((m) => ({ k: m, type: 'mode', label: () => t(`ctrl.${m}.name`), desc: () => t(`ctrl.${m}.desc`), act: () => g.pickControl(m) })),
    { k: 'h.assist', type: 'head', label: () => t('ctrl.hAssist') },
    { k: 'jump', type: 'row', arrows: true, label: () => t('ctrl.jump'), value: () => t(`jump.${opts.jump}`),
      act: () => { opts.jump = cycleIn(JUMP_MODES, opts.jump, 1); save(); g.settings.note = `jump.${opts.jump}.note`; },
      side: (d) => { opts.jump = cycleIn(JUMP_MODES, opts.jump, d); save(); g.settings.note = `jump.${opts.jump}.note`; } },
    { k: 'h.touch', type: 'head', label: () => t('ctrl.hTouch') },
    slider('size', () => pads.size, (v) => { pads.size = v; }, () => pct(padScale()), { off: noPads, max: PAD_STEPS, after: applyPads }),
    slider('alpha', () => pads.alpha, (v) => { pads.alpha = v; }, () => pct(padAlpha()), { off: noPads, max: PAD_STEPS, after: applyPads }),
    { k: 'layout', type: 'row', gold: true, label: () => t('ctrl.layout'), value: () => t(Object.keys(pads.pos).length ? 'ctrl.layoutOwn' : 'ctrl.layoutStd'), off: noPads,
      act: () => {
        if (noPads()) { g.settings.note = 'ctrl.offPads'; sfx.pick(); return; }
        sfx.pick(); openPadEditor(() => g.savePrefs());
      } },
    slider('stickDead', () => opts.stickDead, (v) => { opts.stickDead = v; }, () => pct(stickDeadValue()),
      { off: () => (ctrl.mode === 'joystick' ? null : 'ctrl.offStick'), max: DEAD_STEPS }),
    slider('sens', () => tilt.sens, (v) => { tilt.sens = v; }, () => `${tilt.sens + 1}/${SENS_MAX + 1}`,
      { off: () => (ctrl.mode === 'tilt' ? null : 'ctrl.sensOnly'), max: SENS_MAX, low: 'ctrl.sensLow', high: 'ctrl.sensHigh', meter: true }),
    { k: 'zero', type: 'row', arrows: true, label: () => t('ctrl.zero'), value: () => `${tilt.zero > 0 ? '+' : ''}${tilt.zero}°`,
      off: () => (ctrl.mode === 'tilt' ? null : 'ctrl.sensOnly'),
      act: () => {
        sfx.pick();
        if (!tilt.active) { g.settings.note = 'ctrl.zeroNeed'; return; }
        calibrateTilt(); g.savePrefs(); g.settings.note = 'ctrl.zeroSet';
      },
      side: (d) => { tilt.zero = clamp(tilt.zero + d, -TILT_ZERO_MAX, TILT_ZERO_MAX); save(); } },
    { k: 'h.pad', type: 'head', label: () => t('ctrl.hKeys') },
    slider('padDead', () => opts.padDead, (v) => { opts.padDead = v; }, () => pct(padDeadValue()), { max: DEAD_STEPS }),
    { k: 'keys', type: 'row', gold: true, label: () => t('ctrl.keysPage'), value: () => '›', act: () => g.openPage('keys') },
    { k: 'pad', type: 'row', gold: true, label: () => t('ctrl.padPage'), value: () => '›', act: () => g.openPage('pad') },
    { k: 'reset', type: 'row', warn: true, ck: 'reset', label: () => t(g.confirming('reset') ? 'ctrl.resetConfirm' : 'ctrl.reset'),
      act: confirm('reset', () => {
        Object.assign(opts, OPTS_DEFAULT); tilt.sens = SENS_MAX / 2; tilt.zero = 0;
        resetPads(); resetBinds('key'); resetBinds('pad');
        g.settings.note = 'ctrl.resetDone'; save();
      }) },
    back,
  ];

  const bindPage = (kind) => [
    { k: 'info', type: 'info', label: () => (kind === 'pad' ? g.padInfo() : t('bind.keysInfo')) },
    ...BIND_ACTS.map((a) => ({ k: a, type: 'bind', kind, action: a, slots: kind === 'key' ? KEY_SLOTS : PAD_SLOTS, label: () => t(`bind.${a}`) })),
    { k: 'bindReset', type: 'row', warn: true, ck: `bind.${kind}`, label: () => t(g.confirming(`bind.${kind}`) ? 'bind.resetConfirm' : 'bind.reset'),
      act: confirm(`bind.${kind}`, () => { resetBinds(kind); g.settings.note = 'bind.resetDone'; save(); }) },
    back,
  ];

  const pages = { main, controls, keys: bindPage('key'), pad: bindPage('pad') };
  for (const items of Object.values(pages)) items.contentH = listLayout(items);
  return pages;
}

/** Wiersze, które da się wybrać (strzałkami, padem): bez nagłówków i objaśnień. */
export const selectable = (items) => items.filter((it) => it.type !== 'head' && it.type !== 'info');
