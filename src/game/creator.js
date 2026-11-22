// KREATOR POSTACI: okienko HTML nad grą (jak formularz nicku), bo potrzebuje plików, pól tekstowych, suwaków i kolorów.
// Trzy widoki: lista własnych postaci, edycja jednej postaci (12 klatek albo sama głowa) i zasady tworzenia z poleceniem
// dla czatu AI. Postacie zapisuje skins.js (IndexedDB), format paczki opisuje skinpack.js i docs/POSTACIE.md.
import { sfx } from './audio.js';
import { drawHero } from './characters.js';
import { ctx, focusGame, setCtx } from './gfx.js';
import { t } from './i18n.js';
import {
  COLOR_KEYS, DEFAULT_COLORS, FRAMES, HEAD, MAX_CHARS, MAX_FILE, MAX_SIDE, MAX_ZIP, cleanAdjust, cleanName, zipName,
} from './skinpack.js';
import { bakeSkin, buildSkin, deleteChar, failure, listChars, newId, packZip, prepareImage, putChar, readPack, unpackZip } from './skins.js';

const $ = (id) => document.getElementById(id);
const root = $('creator');
const VIEWS = { list: 'crListView', edit: 'crEditView', rules: 'crRulesView' };

let game = null;
let view = 'list', rulesFrom = 'list';
let draft = null;                  // edytowana postać (rekord jak w bazie, jeszcze nie zapisany)
let sel = null;                    // wybrana klatka w edycji
let anim = 'auto';                 // co pokazuje podgląd: 'auto', 'idle', 'run', 'jump', 'fall', 'dead', 'cheer' albo 'frame' (wybrana klatka)
let skin = null, buildN = 0;       // podgląd edytowanej postaci (skins.js → buildSkin)
let raf = 0, delArm = null, frameFor = null;

export const creatorOpen = () => !!root && !root.hidden;

/** Otwiera KREATOR na liście postaci; g – gra (setCustom, customId). */
export function openCreator(g) {
  game = g;
  root.hidden = false;
  showList();
}
export function closeCreator() {
  if (!creatorOpen()) return;
  root.hidden = true;
  stopAnim(); draft = null; skin = null;
  focusGame();                                         // klawiatura i czytnik ekranu wracają do gry
}
/** Esc / B na padzie: z edycji i zasad – wstecz, z listy – zamknięcie. */
export function creatorBack() {
  sfx.pick();
  if (view === 'rules') show(rulesFrom);
  else if (view === 'edit') showList();
  else closeCreator();
}

// ───────────────────────── widoki ─────────────────────────
function show(name) {
  view = name;
  for (const [k, id] of Object.entries(VIEWS)) $(id).hidden = k !== name;
  if (name === 'edit') startAnim(); else stopAnim();
  root.querySelector('.card').scrollTop = 0;
  setTimeout(() => $(VIEWS[name]).querySelector('button, input')?.focus({ preventScroll: true }), 0);
}
function setMsg(el, text = '', err = false) { el.textContent = text; el.classList.toggle('err', !!err); }
const baseName = (n) => String(n).split(/[\\/]/).pop();
const fname = (role) => `${role}.png`;
const frameLabel = (role) => t(`cr.f.${role}`);

// ───────────────────────── lista ─────────────────────────
async function showList(msg = '', err = false) {
  draft = null; skin = null; sel = null;
  show('list');
  setMsg($('crMsg'), msg, err);
  const ul = $('crList');
  let recs;
  try { recs = await listChars(); } catch { recs = null; setMsg($('crMsg'), t('cr.err.store'), true); }
  ul.replaceChildren(...(recs ?? []).map(listItem));
  $('crEmpty').hidden = !!recs?.length;
}

function listItem(rec) {
  const li = document.createElement('li'), active = game?.customId === rec.id;
  li.classList.toggle('on', active);
  const cv = document.createElement('canvas');
  buildSkin(rec).then((sk) => drawThumb(cv, sk)).catch(() => {});
  const who = document.createElement('div'); who.className = 'who';
  const b = document.createElement('b'); b.textContent = rec.name;
  const n = FRAMES.filter((f) => rec.files?.[f]).length;
  const s = document.createElement('span');
  s.textContent = (rec.type === 'head' ? t('cr.kind.head') : t('cr.kind.frames', { n })) + (rec.source ? ` · ${t('cr.from', { nick: rec.author || 'TOP3' })}` : '')
    + (rec.share ? ` · ${t('cr.shared')}` : '');
  who.append(b, s);
  const acts = document.createElement('div'); acts.className = 'acts';
  const use = btn(active ? t('cr.inUse') : t('cr.use'), () => useChar(rec));
  if (!active) use.classList.remove('alt');           // „Graj nią” wyróżniony, „W grze” – zwykły
  const del = btn(t('cr.del'), () => {
    if (delArm !== rec.id) {                            // drugie dotknięcie usuwa – pierwsze tylko pyta
      delArm = rec.id; del.textContent = t('cr.delSure');
      setTimeout(() => { if (delArm === rec.id) { delArm = null; del.textContent = t('cr.del'); } }, 3000);
      return;
    }
    delArm = null;
    deleteChar(rec.id).then(() => {
      if (game?.customId === rec.id) game.setCustom(null);
      sfx.pick(); showList();
    }, () => setMsg($('crMsg'), t('cr.err.store'), true));
  });
  acts.append(use, btn(t('cr.edit'), () => { sfx.pick(); editChar(rec); }), btn(t('cr.export'), () => exportChar(rec)), del);
  li.append(cv, who, acts);
  return li;
}
function btn(label, onClick, cls = 'small') {
  const b = document.createElement('button');
  b.type = 'button'; b.className = `alt ${cls}`.trim(); b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

async function useChar(rec) {
  const sk = await buildSkin(rec).catch(() => null);
  if (!sk) { setMsg($('crMsg'), t('cr.err.read'), true); return; }
  game.setCustom(bakeSkin(sk));
  sfx.pick();
  closeCreator();
}

async function roomForNew() {
  const n = (await listChars().catch(() => [])).length;
  if (n >= MAX_CHARS) throw failure('cr.err.limit', { max: MAX_CHARS });
}

async function newChar() {
  try { await roomForNew(); } catch (e) { setMsg($('crMsg'), t(e.key, e.vars), true); return; }
  sfx.pick();
  showEdit({ id: newId(), name: t('cr.defName'), type: 'frames', files: {}, adjust: {}, colors: { ...DEFAULT_COLORS }, headK: 1, created: Date.now(), share: false });
}
function editChar(rec) {
  showEdit({
    ...rec, files: { ...rec.files }, adjust: Object.fromEntries(Object.entries(rec.adjust ?? {}).map(([k, a]) => [k, cleanAdjust(a)])),
    colors: { ...DEFAULT_COLORS, ...rec.colors }, headK: rec.headK ?? 1,
  });
}

// ───────────────────────── wczytywanie plików ─────────────────────────
/** ZIP po nazwie, typie albo pierwszych bajtach („PK\\3\\4”) – telefony potrafią podać plik bez rozszerzenia. */
async function isZip(f) {
  if (/\.zip$/i.test(f.name) || /zip/.test(f.type)) return true;
  const head = new Uint8Array(await f.slice(0, 4).arrayBuffer());
  return head[0] === 0x50 && head[1] === 0x4b && head[2] === 3 && head[3] === 4;
}

/**
 * Pliki od gracza (ZIP albo obrazki) → klatki postaci przypisane po nazwach (skinpack.js → assignFiles).
 * into: dopisz do edytowanej postaci (upuszczenie w edycji) zamiast tworzyć nową.
 */
async function importFiles(list, into = null) {
  const files = [...list];
  const msgEl = into ? $('crEditMsg') : $('crMsg');
  if (!files.length) return;
  setMsg(msgEl, '…');
  try {
    if (!into) await roomForNew();
    const entries = [];
    let zipBase = '';
    for (const f of files) {
      if (await isZip(f)) {
        if (f.size > MAX_ZIP) throw failure('cr.err.big');
        entries.push(...(await unpackZip(new Uint8Array(await f.arrayBuffer()))));
        zipBase ||= f.name.replace(/\.zip$/i, '').replace(/^postac-/i, '');
      } else entries.push({ name: f.name, blob: f });
    }
    const a = await readPack(entries), cfg = a.cfg, out = a.files;
    const msgs = [];
    if (a.type === 'head') msgs.push(t('cr.loadedHead'));
    else {
      msgs.push(a.byOrder ? t('cr.loadedOrder') : t('cr.loaded', { n: Object.keys(out).length }));
      const missing = FRAMES.filter((f) => !out[f] && !into?.files[f]);
      if (missing.length) msgs.push(t('cr.missing', { list: missing.map(frameLabel).join(', ') }));
    }
    const skipped = a.extra;
    if (skipped.length) msgs.push(t('cr.skipped', { list: skipped.slice(0, 6).join(', ') + (skipped.length > 6 ? '…' : '') }));
    if (into) {
      into.type = a.type;
      Object.assign(into.files, out);
      for (const k of Object.keys(out)) delete into.adjust[k];
      if (cfg) { Object.assign(into.adjust, cfg.adjust); if (a.type === 'head') { into.colors = cfg.colors; into.headK = cfg.headK; } }
      renderEdit(); rebuild();
      setMsg(msgEl, msgs.join('\n'));
      return;
    }
    showEdit({
      id: newId(), name: cleanName(cfg?.name || zipBase, t('cr.defName')), type: a.type, files: out,
      adjust: cfg?.adjust ?? {}, colors: cfg?.colors ?? { ...DEFAULT_COLORS }, headK: cfg?.headK ?? 1, created: Date.now(),
      share: false,                                      // zgoda na udostępnienie – tylko z pola w edycji, nigdy z pliku
    }, msgs.join('\n'));
    setMsg($('crMsg'));
  } catch (e) {
    setMsg(msgEl, t(e.key ?? 'cr.err.read', e.vars), true);
  }
}

/** Jeden obrazek do wybranej klatki (dotknięcie pustego pola, „Zmień obrazek”, upuszczenie na pole). */
async function setFrame(role, file) {
  if (!draft || !file) return;
  const msgEl = $('crEditMsg');
  try {
    if (file.size > MAX_FILE) throw failure('cr.err.big');
    try { draft.files[role] = await prepareImage(file); } catch { throw failure('cr.err.image', { file: baseName(file.name) }); }
    delete draft.adjust[role];
    setMsg(msgEl, '');
    selectCell(role);
    rebuild();
  } catch (e) { setMsg(msgEl, t(e.key ?? 'cr.err.read', e.vars), true); }
}
function pickFor(role) {
  frameFor = role;
  const inp = $('crFrameFile'); inp.value = ''; inp.click();
}

// ───────────────────────── edycja ─────────────────────────
function showEdit(rec, msg = '') {
  draft = rec; sel = null; anim = 'auto'; skin = null;
  $('crName').value = rec.name;
  $('crShare').checked = !!rec.share;
  renderEdit();
  show('edit');
  setMsg($('crEditMsg'), msg);
  rebuild();
}
function renderEdit() {
  for (const b of $('crType').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.type === draft.type));
  renderAnimButtons();
  renderCells();
  renderPanels();
}
const ANIMS = [['auto', 'cr.anim.auto'], ['idle', 'cr.f.idle'], ['run', 'cr.anim.run'], ['jump', 'cr.anim.jump'], ['fall', 'cr.f.fall'], ['dead', 'cr.f.dead'], ['cheer', 'cr.f.cheer']];
function renderAnimButtons() {
  const box = $('crAnim');
  box.replaceChildren(...ANIMS.map(([k, key]) => {
    const b = btn(t(key), () => { anim = k; renderAnimButtons(); });
    b.setAttribute('aria-pressed', String(anim === k));
    return b;
  }));
}

const bitmaps = new WeakMap();
const bitmapOf = (blob) => { if (!bitmaps.has(blob)) bitmaps.set(blob, createImageBitmap(blob)); return bitmaps.get(blob); };

function renderCells() {
  const grid = $('crFrames'), roles = draft.type === 'head' ? [HEAD] : FRAMES;
  grid.classList.toggle('one', draft.type === 'head');
  grid.replaceChildren(...roles.map((role) => {
    const has = !!draft.files[role];
    const b = document.createElement('button');
    b.type = 'button'; b.className = `cr-cell${has ? '' : ' empty'}${sel === role ? ' sel' : ''}`;
    b.setAttribute('aria-pressed', String(sel === role));
    b.setAttribute('aria-label', `${frameLabel(role)} – ${fname(role)}${has ? '' : ` – ${t('cr.none')}`}`);
    const cv = document.createElement('canvas');
    const lab = document.createElement('span'); lab.textContent = has ? frameLabel(role) : `${frameLabel(role)} ${t('cr.add')}`;
    const small = document.createElement('small'); small.textContent = fname(role);
    b.append(cv, lab, small);
    if (has) bitmapOf(draft.files[role]).then((bmp) => drawFit(cv, bmp)).catch(() => {});
    b.addEventListener('click', () => { sfx.pick(); if (!draft.files[role]) pickFor(role); selectCell(role); });
    b.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); b.classList.add('drop'); });
    b.addEventListener('dragleave', () => b.classList.remove('drop'));
    b.addEventListener('drop', (e) => {
      e.preventDefault(); e.stopPropagation(); b.classList.remove('drop'); root.classList.remove('dropping');
      const f = [...(e.dataTransfer?.files ?? [])];
      if (f.length !== 1) { importFiles(f, draft); return; }
      isZip(f[0]).then((zip) => (zip ? importFiles(f, draft) : setFrame(role, f[0])));
    });
    return b;
  }));
}
function selectCell(role) {
  sel = role;
  if (draft.type === 'frames') anim = 'frame';
  renderAnimButtons();
  renderCells();
  renderPanels();
}

function renderPanels() {
  const frames = draft.type === 'frames';
  const adj = $('crAdjust'), head = $('crHeadOpts');
  adj.hidden = !(frames && sel && FRAMES.includes(sel));
  head.hidden = frames;
  if (!adj.hidden) {
    const has = !!draft.files[sel], a = cleanAdjust(draft.adjust[sel]);
    $('crAdjLabel').replaceChildren(document.createTextNode(`${t('cr.frameOf', { name: '' })}`), Object.assign(document.createElement('b'), { textContent: `${frameLabel(sel)} (${fname(sel)})` }));
    for (const el of adj.querySelectorAll('.cr-ranges, #crGhost, #crRemove')) el.hidden = !has;
    $('crReplace').textContent = t(has ? 'cr.replace' : 'cr.pickFile');
    $('crGhost').hidden = !has || sel === 'idle' || !draft.files.idle;
    setRange('crK', Math.round(a.k * 100), (v) => `${v}%`);
    setRange('crDx', a.dx, (v) => `${v}`);
    setRange('crDy', a.dy, (v) => `${v}`);
  }
  if (!head.hidden) {
    setRange('crHeadK', Math.round((draft.headK ?? 1) * 100), (v) => `${v}%`);
    const box = $('crColors');
    box.replaceChildren(...COLOR_KEYS.map((k) => {
      const l = document.createElement('label'), inp = document.createElement('input');
      inp.type = 'color'; inp.value = draft.colors[k] ?? DEFAULT_COLORS[k];
      inp.addEventListener('input', () => { draft.colors[k] = inp.value; rebuild(); });
      l.append(inp, document.createTextNode(t(`cr.c.${k}`)));
      return l;
    }));
  }
}
function setRange(id, v, fmt) {
  const inp = $(id); inp.value = String(v);
  $(`${id}Out`).value = fmt(Number(inp.value));
  inp.oninput = () => {
    $(`${id}Out`).value = fmt(Number(inp.value));
    onRange(id, Number(inp.value));
  };
}
function onRange(id, v) {
  if (id === 'crHeadK') { draft.headK = v / 100; rebuild(); return; }
  if (!sel) return;
  const a = cleanAdjust(draft.adjust[sel]);
  if (id === 'crK') a.k = v / 100; else if (id === 'crDx') a.dx = v; else a.dy = v;
  draft.adjust[sel] = a;
  rebuild();
}

/** Podgląd od nowa (pomiary obrazków są zapamiętane, więc to szybkie). */
function rebuild() {
  if (!draft) return;
  const n = ++buildN;
  buildSkin(draft).then((sk) => { if (n === buildN) skin = sk; }, () => { if (n === buildN) skin = null; });
}

async function save() {
  draft.name = cleanName($('crName').value, t('cr.defName'));
  const msgEl = $('crEditMsg');
  if (draft.type === 'frames' && !draft.files.idle) { setMsg(msgEl, t('cr.err.idle'), true); return; }
  if (draft.type === 'head' && !draft.files.head) { setMsg(msgEl, t('cr.err.head'), true); return; }
  // zapisujemy tylko obrazki wybranego rodzaju
  const keep = draft.type === 'head' ? [HEAD] : FRAMES;
  const rec = { ...draft, files: Object.fromEntries(keep.filter((k) => draft.files[k]).map((k) => [k, draft.files[k]])), updated: Date.now() };
  try { await putChar(rec); } catch { setMsg(msgEl, t('cr.err.store'), true); return; }
  const sk = await buildSkin(rec).catch(() => null);
  if (sk) game.setCustom(bakeSkin(sk));
  sfx.pick();
  showList(t('cr.saved', { name: rec.name }));
}

// ───────────────────────── eksport ─────────────────────────
async function exportChar(rec) {
  const url = URL.createObjectURL(new Blob([await packZip(rec)], { type: 'application/zip' }));
  const a = document.createElement('a');
  a.href = url; a.download = zipName(rec.name);
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 20000);
  sfx.pick();
}

// ───────────────────────── zasady tworzenia ─────────────────────────
function showRules() {
  rulesFrom = view === 'rules' ? rulesFrom : view;
  const ol = $('crRulesList');
  const li = (text) => { const el = document.createElement('li'); const s = document.createElement('span'); s.textContent = text; el.append(s); return el; };
  const files = li(t('cr.rules.2'));
  const ul = document.createElement('ul'); ul.className = 'cr-files';
  for (const role of [...FRAMES, HEAD]) {
    const x = document.createElement('li'), code = document.createElement('code');
    code.textContent = fname(role);
    x.append(code, document.createTextNode(` – ${frameLabel(role)}`));
    ul.append(x);
  }
  files.querySelector('span').append(ul);
  ol.replaceChildren(li(t('cr.rules.1')), files, li(t('cr.rules.3')), li(t('cr.rules.4')), li(t('cr.rules.5', { max: MAX_SIDE })), li(t('cr.rules.6')), li(t('cr.rules.8')), li(t('cr.rules.7')));
  $('crAiFrames').value = aiPrompt();
  $('crAiHead').value = t('cr.ai.head');
  setMsg($('crRulesMsg'));
  show('rules');
}
/** Polecenie dla czatu AI z listą plików i póz – ten sam tekst co w docs/POSTACIE.md. */
export const aiPrompt = () => t('cr.ai.frames', { files: FRAMES.map((f) => `${fname(f)} – ${t(`cr.pose.${f}`)}`).join('\n') });

async function copyText(id) {
  const ta = $(id);
  try { await navigator.clipboard.writeText(ta.value); } catch {
    ta.focus(); ta.select();
    try { document.execCommand('copy'); } catch { /* zostaje zaznaczony tekst do skopiowania ręcznie */ }
  }
  setMsg($('crRulesMsg'), t('cr.copied'));
}

// ───────────────────────── rysowanie podglądów ─────────────────────────
function sizeCanvas(cv) {
  const r = cv.getBoundingClientRect(), d = Math.min(3, devicePixelRatio || 1);
  const w = Math.max(1, Math.round(r.width * d)), h = Math.max(1, Math.round(r.height * d));
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  return { w: r.width, h: r.height, d };
}
/** Rysuje postać przez drawHero (characters.js) na innym płótnie niż gra. */
function onCanvas(c, fn) {
  const prev = ctx;
  setCtx(c);
  try { fn(); } finally { setCtx(prev); }
}
const STILL = { x: 0, y: 0, vx: 0, vy: 0, face: 1, onFloor: 0, spin: false };
const FX0 = { angle: 0, squash: 0, runPhase: 0 };

function drawThumb(cv, sk) {
  if (!sk) return;
  const { w, h, d } = sizeCanvas(cv), c = cv.getContext('2d');
  const k = (h - 6) / 64;
  c.setTransform(d, 0, 0, d, 0, 0); c.clearRect(0, 0, w, h);
  c.setTransform(d * k, 0, 0, d * k, d * w / 2, d * (h - 3));
  onCanvas(c, () => drawHero(STILL, FX0, 0, sk));
}
function drawFit(cv, bmp) {
  const { w, h, d } = sizeCanvas(cv), c = cv.getContext('2d');
  const k = Math.min((w - 4) / bmp.width, (h - 4) / bmp.height);
  c.setTransform(d, 0, 0, d, 0, 0); c.clearRect(0, 0, w, h);
  c.imageSmoothingQuality = 'high';
  c.drawImage(bmp, (w - bmp.width * k) / 2, h - 2 - bmp.height * k, bmp.width * k, bmp.height * k);
}

// podgląd animacji: kolejne stany jak w grze (sekundy każdego)
const SEQ = [['idle', 1.4], ['run', 1.8], ['jump', 1.4], ['fall', 1], ['dead', 1.4], ['cheer', 1.4]];
const SEQ_T = SEQ.reduce((s, [, d]) => s + d, 0);
const CAPTION = { idle: 'cr.f.idle', run: 'cr.anim.run', jump: 'cr.anim.jump', fall: 'cr.f.fall', dead: 'cr.f.dead', cheer: 'cr.f.cheer' };

/** Stan bohatera w chwili tau (s) danego fragmentu podglądu: { h, fx, pose, lift }. */
function stateAt(name, tau) {
  const h = { ...STILL }, fx = { ...FX0 };
  let pose = null, lift = 0;
  if (name === 'run') { h.vx = 260; fx.runPhase = tau * 22; }
  else if (name === 'jump') {
    const J = 0.95;
    if (tau < J) {
      const q = tau / J;
      h.onFloor = -1; h.vy = -950 + 1900 * q; lift = 4 * q * (1 - q) * 46; fx.squash = -0.6 * Math.exp(-12 * tau);
    } else fx.squash = 0.9 * Math.exp(-12 * (tau - J));
  } else if (name === 'fall') { h.onFloor = -1; h.vy = 1000; lift = 34 + Math.sin(tau * 9) * 2; }
  else if (name === 'dead') pose = 'dead';
  else if (name === 'cheer') { pose = 'cheer'; lift = Math.abs(Math.sin(tau * 5)) * 8; }
  return { h, fx, pose, lift };
}

function drawStage(time) {
  const cv = $('crPreview');
  if (!cv || cv.offsetParent === null) return;
  const { w, h, d } = sizeCanvas(cv), c = cv.getContext('2d');
  c.setTransform(d, 0, 0, d, 0, 0);
  c.fillStyle = '#141a36'; c.fillRect(0, 0, w, h);
  const ground = h - 16, k = (h - 58) / 64;
  c.fillStyle = '#2c3769'; c.fillRect(0, ground, w, h - ground);
  c.fillStyle = '#5d82d6'; c.fillRect(0, ground, w, 2);
  if (!skin) return;
  let name = anim, tau = time;
  if (anim === 'auto') {
    let x = time % SEQ_T;
    for (const [n, dur] of SEQ) { if (x < dur) { name = n; tau = x; break; } x -= dur; }
  } else if (anim !== 'frame') tau = time % (SEQ.find(([n]) => n === anim)?.[1] ?? 1.4);
  const draw = (st, alpha = 1) => {
    c.save(); c.globalAlpha = alpha;
    c.setTransform(d * k, 0, 0, d * k, d * w / 2, d * ground);
    onCanvas(c, () => drawHero({ ...st.h, y: -st.lift }, st.fx, time, skin, st.pose));
    c.restore();
  };
  if (anim === 'frame' && sel && skin.type === 'frames') {
    if (sel !== 'idle' && skin.frames.idle) draw({ ...stateAt('idle', 0), pose: 'idle' }, 0.28);   // blady obrys: porównanie wielkości głowy
    draw({ ...stateAt('idle', 0), pose: sel });
    caption(c, `${frameLabel(sel)} · ${fname(sel)}`);
    return;
  }
  draw(stateAt(name, tau));
  caption(c, t(CAPTION[name] ?? 'cr.f.idle'));
}
function caption(c, s) {
  c.save();
  c.font = '700 12px system-ui, sans-serif'; c.fillStyle = '#9fb4ee'; c.textAlign = 'left'; c.textBaseline = 'top';
  c.fillText(s, 8, 7);
  c.restore();
}
function startAnim() {
  if (raf) return;
  const tick = (now) => { raf = requestAnimationFrame(tick); drawStage(now / 1000); };
  raf = requestAnimationFrame(tick);
}
function stopAnim() { cancelAnimationFrame(raf); raf = 0; }

// ───────────────────────── zdarzenia ─────────────────────────
if (root) {
  $('crClose').addEventListener('click', () => { sfx.pick(); closeCreator(); });
  $('crNew').addEventListener('click', newChar);
  $('crImport').addEventListener('click', () => { const i = $('crFile'); i.value = ''; i.click(); });
  $('crFile').addEventListener('change', (e) => importFiles(e.target.files));
  $('crFrameFile').addEventListener('change', (e) => { const f = e.target.files?.[0]; if (f && frameFor) setFrame(frameFor, f); });
  $('crRules').addEventListener('click', () => { sfx.pick(); showRules(); });
  $('crEditRules').addEventListener('click', () => { sfx.pick(); showRules(); });
  $('crRulesBack').addEventListener('click', creatorBack);
  for (const b of root.querySelectorAll('[data-copy]')) b.addEventListener('click', () => copyText(b.dataset.copy));
  $('crCancel').addEventListener('click', () => { sfx.pick(); showList(); });
  $('crSave').addEventListener('click', save);
  $('crEditZip').addEventListener('click', () => {
    if (!draft) return;
    draft.name = cleanName($('crName').value, t('cr.defName'));
    exportChar(draft);
  });
  $('crName').addEventListener('input', () => { if (draft) draft.name = $('crName').value; });
  // zgoda na udostępnienie: bez niej postać nigdy nie trafia na serwer, nawet w najlepszej trójce (skins.js → sharePack)
  $('crShare').addEventListener('change', () => { if (draft) draft.share = $('crShare').checked; });
  for (const b of $('crType').querySelectorAll('button')) {
    b.addEventListener('click', () => {
      if (!draft || draft.type === b.dataset.type) return;
      sfx.pick(); draft.type = b.dataset.type; sel = null; anim = 'auto';
      renderEdit(); rebuild();
    });
  }
  $('crRemove').addEventListener('click', () => {
    if (!draft || !sel) return;
    delete draft.files[sel]; delete draft.adjust[sel];
    sfx.pick(); renderCells(); renderPanels(); rebuild();
  });
  $('crReplace').addEventListener('click', () => { if (sel) pickFor(sel); });

  // upuszczenie plików: na liście – nowa postać, w edycji – dopisanie klatek (na pole – ta jedna klatka)
  root.addEventListener('dragover', (e) => { if (view === 'rules') return; e.preventDefault(); root.classList.add('dropping'); });
  root.addEventListener('dragleave', (e) => { if (e.target === root) root.classList.remove('dropping'); });
  root.addEventListener('drop', (e) => {
    e.preventDefault(); root.classList.remove('dropping');
    const f = e.dataTransfer?.files;
    if (!f?.length) return;
    if (view === 'list') importFiles(f); else if (view === 'edit') importFiles(f, draft);
  });
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault(); e.stopPropagation();
    creatorBack();
  });
  // dotknięcia okienka nie trafiają do gry (w trybie przechyłu każde dotknięcie to skok)
  root.addEventListener('pointerdown', (e) => e.stopPropagation());
}
