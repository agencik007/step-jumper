// Strony opcji jako listy wierszy. Ten sam opis służy do rysowania (render.js), dotyku i wyboru strzałkami / padem (game.js).
//
// Wiersz: { k, type, label(), … }, gdzie type to:
//   head   – nagłówek grupy (nie da się go wybrać),
//   info   – linijka objaśnienia (nie da się jej wybrać),
//   mode   – tryb sterowania (przełącznik radiowy),
//   row    – zwykły wiersz: value() po prawej; arrows – wartość zmienia się ◀ ▶; act() – dotknięcie / Enter / A,
//   slider – suwak 0…8: get(), set(v), show() – napis wartości, low/high – podpisy końców,
//   bind   – przypisanie akcji do klawiszy (kind 'key') albo przycisków pada (kind 'pad'),
//   note   – punkt listy zmian (strona NOWOŚCI): lines – tekst już połamany na linijki,
//   back   – „Wróć” pod listą.
// off() → klucz tekstu, gdy wiersz nie dotyczy obecnego trybu (jest przygaszony, ale da się go ustawić na zapas).
import { ACCESS_DEFAULT, MOTION_MODES, TEXT_SIZES, access, applyAccess, systemReducesMotion } from './access.js';
import { VOL_STEPS, sfx } from './audio.js';
import { HAPTIC_LEVELS, haptics } from './haptics.js';
import { LANG_NAMES, lang, t } from './i18n.js';
import {
  BIND_ACTS, CONTROLS, DEAD_STEPS, JUMP_MODES, KEY_SLOTS, OPTS_DEFAULT, PAD_MODES, PAD_SLOTS, SENS_MAX, TILT_ZERO_MAX, calibrateTilt, ctrl, opts,
  padDeadValue, resetBinds, stickDeadValue, tilt,
} from './input.js';
import { CHANGELOG, wrap } from './changelog.js';
import { LIST, listLayout } from './layout.js';
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
    { k: 'access', type: 'row', gold: true, label: () => t('set.access'), value: () => '›', act: () => g.openPage('access') },
    { k: 'hand', type: 'row', arrows: true, label: () => t('set.hand'), value: () => t(g.lefty ? 'set.handLeft' : 'set.handRight'),
      act: () => { g.setLefty(!g.lefty, true); save(); } },
    { k: 'sound', type: 'row', gold: true, label: () => t('set.sound'), value: () => `${onOff(!sfx.muted)}  ›`, act: () => g.openPage('sound') },
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

  // dostępność: każda zmiana działa od razu (applyAccess) i zapisuje się w prefs; tip – objaśnienie pod listą
  const setAcc = (k, v) => { access[k] = v; applyAccess(); save(); };
  const accRow = (k, extra) => ({ k, type: 'row', label: () => t(`acc.${k}`), tip: `acc.${k}.tip`, ...extra });
  const toggle = (k) => accRow(k, { value: () => onOff(access[k]), act: () => setAcc(k, !access[k]) });
  const accessPage = [
    accRow('text', { arrows: true, value: () => t(`acc.text.${TEXT_SIZES[access.text]}`),
      act: () => setAcc('text', mod(access.text + 1, TEXT_SIZES.length)), side: (d) => setAcc('text', clamp(access.text + d, 0, TEXT_SIZES.length - 1)) }),
    toggle('contrast'),
    toggle('fx'),
    accRow('motion', { arrows: true,
      value: () => (access.motion === 'auto' ? t('acc.motion.auto', { state: onOff(systemReducesMotion()) }) : onOff(access.motion === 'on')),
      act: () => setAcc('motion', cycleIn(MOTION_MODES, access.motion, 1)), side: (d) => setAcc('motion', cycleIn(MOTION_MODES, access.motion, d)) }),
    toggle('assist'),
    { k: 'accReset', type: 'row', warn: true, ck: 'acc', label: () => t(g.confirming('acc') ? 'acc.resetConfirm' : 'acc.reset'),
      act: confirm('acc', () => { Object.assign(access, ACCESS_DEFAULT); applyAccess(); g.settings.note = 'acc.resetDone'; save(); }) },
    back,
  ];

  // dźwięk: wyciszenie całości (klawisz M), osobne głośności efektów i muzyki, wizualne ostrzeżenie zamiast samego tykania
  const muted = () => (sfx.muted ? 'snd.offMuted' : null);
  const vol = (k, label) => slider(k, () => sfx[k], (v) => { sfx[k] = v; sfx.applyVolume(); }, () => (sfx[k] ? pct(sfx[k] / VOL_STEPS) : onOff(false)),
    { label: () => t(label), tip: `${label}.tip`, off: muted, max: VOL_STEPS });
  const soundPage = [
    { k: 'mute', type: 'row', label: () => t('set.sound'), tip: 'snd.mute.tip', value: () => onOff(!sfx.muted), act: () => { sfx.muted = !sfx.muted; save(); } },
    vol('fxVol', 'snd.fx'),
    vol('musicVol', 'snd.music'),
    accRow('warn', { label: () => t('snd.warn'), tip: 'snd.warn.tip', value: () => onOff(access.warn), act: () => setAcc('warn', !access.warn) }),
    back,
  ];

  const pages = { main, controls, access: accessPage, sound: soundPage, keys: bindPage('key'), pad: bindPage('pad') };
  for (const items of Object.values(pages)) items.contentH = listLayout(items);
  return pages;
}

/**
 * Strona NOWOŚCI: wersje od najnowszej, pod każdą jej punkty w bieżącym języku. Budowana przy każdym otwarciu,
 * bo łamanie linijek zależy od języka; measure(tekst) → szerokość w px czcionką punktów.
 */
export function buildNews(g, measure) {
  const code = lang(), width = LIST.w - 40;
  const date = (d) => new Date(`${d}T12:00:00`).toLocaleDateString(code, { day: 'numeric', month: 'long', year: 'numeric' });
  const items = [];
  for (const e of CHANGELOG) {
    items.push({ k: `v.${e.v}`, type: 'head', gold: true, label: () => `${e.v}   ·   ${date(e.date)}` });
    (e[code] ?? e.en).forEach((line, i) => items.push({ k: `v.${e.v}.${i}`, type: 'note', lines: wrap(line, width, measure) }));
  }
  items.push({ k: 'back', type: 'back', label: () => t(g.hint === 'keys' ? 'set.backKey' : 'set.back'), act: () => g.settingsBack() });
  items.contentH = listLayout(items);
  return items;
}

/** Wiersze, które da się wybrać (strzałkami, padem): bez nagłówków, objaśnień i punktów listy zmian. */
export const selectable = (items) => items.filter((it) => it.type !== 'head' && it.type !== 'info' && it.type !== 'note');
