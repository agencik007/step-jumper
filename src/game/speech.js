// Czytniki ekranu. Gra rysuje wszystko na płótnie, którego czytnik nie widzi, więc opisuje ekran słowami
// w ukrytych regionach aria-live (#srPolite – zwykłe, #srAlert – pilne) w index.html.
//
// Opis ekranu to lista części [klucz, tekst] (np. ekran, wybrany wiersz, objaśnienie). Po zmianie ekranu czytamy
// wszystkie części, a potem tylko te, które się zmieniły – czytnik słyszy wybór w menu, nową wartość, wynik biegu,
// a nie powtarza ciągle tego samego. Komunikaty z gry (game.say) i stan biegu (klawisz I) idą osobno.
import { PERIODS } from './layout.js';
import { CHANGELOG } from './changelog.js';
import { rulesText } from './rules.js';
import { CHARS } from './characters.js';
import { STYLES } from './gfx.js';
import { fmt, fmtLeft, fmtWhen, periodEnd } from './format.js';
import { lang, t } from './i18n.js';
import { binds, ctrl, keyLabel } from './input.js';
import { netLine } from './render.js';
import { update } from './update.js';
import { MATCH_GRACE_MS, live, online } from '../net';
import { fmtClock } from './race.js';

let polite = null, alert = null, flip = false;
const pending = { polite: [], alert: [] };
let lastScreen = null, lastParts = new Map();

/** Podpina regiony aria-live (raz, przy starcie). */
export function initSpeech() {
  polite = document.getElementById('srPolite');
  alert = document.getElementById('srAlert');
}

/** Dodaje tekst do odczytania; wszystko z jednej klatki trafia do czytnika razem. */
export function announce(text, urgent = false) {
  if (text) pending[urgent ? 'alert' : 'polite'].push(String(text));
}

/** Wysyła zebrane teksty do regionów aria-live. Ten sam tekst drugi raz różni się niewidocznym znakiem – czytnik go przeczyta. */
function flush() {
  flip = !flip;
  for (const [kind, el] of [['polite', polite], ['alert', alert]]) {
    const list = pending[kind];
    if (!list.length) continue;
    if (el) el.textContent = joinSentences(list) + (flip ? '\u200b' : '');
    list.length = 0;
  }
}

/** Łączy zdania kropką, ale bez podwójnej, gdy zdanie już kończy się znakiem interpunkcyjnym. */
const joinSentences = (list) => list.filter(Boolean).map((x, i, a) => (i < a.length - 1 && !/[.!?…:]$/.test(x.trim()) ? `${x}.` : x)).join(' ');
const clean = (s) => String(s ?? '').replace(/[›◀▶]/g, '').replace(/\s+/g, ' ').trim();
const charLine = (g) => {
  const ch = CHARS[g.charIdx];
  return `${t('title.char')}: ${ch ? `${ch.name} – ${t(`char.${ch.id}`)}` : `${g.custom?.name ?? ''} – ${t('char.custom')}`}`;
};
const mapLine = (g) => { const id = STYLES[g.styleIdx].id; return `${t('title.map')}: ${t(`style.${id}.name`)} – ${t(`style.${id}.desc`)}`; };
const name = (e) => e.nick ?? t('board.player', { tag: e.tag });
/** Ekran tytułowy: kto z pokoju znajomych jest w grze – bez pięter, żeby czytnik nie mówił przy każdym piętrze. */
function liveLine(g) {
  const room = g.online.room;
  if (!g.online.enabled) return '';
  if (!room) return t('sr.roomOut');                   // J – dołącz, C – utwórz
  if (!live.connected) return `${t('room.boardTitle', { name: room.name })}. ${t('sr.roomLeave')}`;
  const others = live.players.filter((p) => !p.me);
  return others.length
    ? t('sr.live', { name: room.name, list: others.map((p) => t(p.s === 'play' ? 'sr.livePlay' : 'sr.liveMenu', { name: name(p) })).join(', ') })
    : t('sr.liveNone', { name: room.name });
}
/** Ekran tytułowy: pokój (kto gra) i klawisz wyjścia z niego, a w pokoju także WYŚCIG (V). */
const roomLine = (g) => {
  const l = liveLine(g);
  if (!g.online.room || !live.connected) return l;
  const race = g.raceOpen ? t('sr.raceOpen', { min: g.raceInvite.minutes, time: fmtClock(g.raceInvite.endsAt - online.serverNow()) }) : t('sr.raceNew');
  return `${l} ${race} ${t('sr.roomLeave')}`;
};
/** Tabela wyścigu słowami (najwyżej 5 pierwszych). */
const raceRows = (r) => r.table.slice(0, 5).map((e) => t('sr.raceRow', { place: e.place, name: name(e), score: fmt(e.score), runs: e.runs ?? 0 })).join('; ');

/** Ekrany WYŚCIGU (stan 'race'). Zegar nie jest czytany co sekundę – tylko po wejściu na ekran i klawiszem I. */
function describeRace(g) {
  const page = g.racePage, r = g.race;
  if (page === 'setup') {
    return [['screen', `${t('race.title')}. ${t('race.setupSub', { room: g.online.room?.name ?? '' })} ${t('race.setupKeys')}`],
      ['min', `${t('race.time')}: ${t('race.min', { n: g.raceMinutes })}`],
      ['scoring', `${t('race.scoring')}: ${t(`race.${g.raceScoring}`)}. ${t(`race.${g.raceScoring}.desc`)}`]];
  }
  if (!r) return [];
  const info = t('race.info', { min: r.info.minutes, scoring: t(`race.${r.info.scoring}`), name: name(r.info.by) });
  if (page === 'lobby') {
    const n = Math.ceil(r.toStart / 1000);
    return [['screen', `${t('race.title')}. ${info}. ${t('race.lobbyHint')}`],
      ['count', n > 0 ? (n <= 3 || n % 5 === 0 ? `${t('race.startsIn')} ${n}` : '') : t(r.noTicket ? 'race.noTicket' : 'race.loading')]];
  }
  if (page === 'wait') {
    const s = Math.max(0, Math.ceil((r.info.endsAt + MATCH_GRACE_MS - online.serverNow()) / 1000));
    return [['screen', `${t('race.timeUp')} ${t('race.wait')} ${t('race.waitSub', { s })}`], ['list', raceRows(r)]];
  }
  const win = r.table[0];
  return [['screen', `${t('race.results')}. ${!win ? t('race.noRuns') : win.me ? t('race.youWin') : t('race.winner', { name: name(win) })}`],
    ['list', raceRows(r)], ['keys', t('sr.raceResults')]];
}

/** Wiersz opcji słowami: nazwa, wartość, a dla przypisań – klawisze w polach. */
export function itemSpeech(g, it) {
  if (!it) return '';
  const st = g.settings;
  switch (it.type) {
    case 'mode': return `${it.label()}${it.k === ctrl.mode ? `, ${t('sr.selected')}` : ''}. ${it.desc()}`;
    case 'slider': return `${it.label()}: ${it.show()}`;
    case 'bind': {
      const list = binds[it.kind][it.action];
      const lab = (v) => (v == null ? t('sr.empty') : it.kind === 'key' ? keyLabel(v) : `#${v + 1}`);
      return `${it.label()}: ${list.map(lab).join(', ')}. ${t('sr.slot', { n: st.slot + 1 })}: ${lab(list[st.slot])}`;
    }
    case 'back': return it.label();
    default: {
      const v = it.value?.();
      return clean(v != null && clean(v) ? `${it.label()}: ${v}` : it.label());
    }
  }
}

/** Opis bieżącego ekranu jako części [klucz, tekst]. */
function describe(g) {
  const s = g.state;
  if (s === 'title') {
    return [['screen', t('sr.title')], ['char', charLine(g)], ['map', mapLine(g)],
      ['update', update.available ? t('sr.update', { v: update.available }) : ''], ['live', roomLine(g)]];
  }
  if (s === 'play') return [['screen', t('sr.play')]];
  if (s === 'pause') return [['screen', `${t('pause.title')}. ${t('pause.resume', { key: binds.key.pause.filter(Boolean).map(keyLabel).join(' / ') || '—' })}. ${t('pause.menu')}`]];
  if (s === 'over' && g.race) {
    const sim = g.sim, r = g.race;
    return [
      ['screen', `${g.raceCut ? `${t('race.timeUp')} ${g.raceCutCombo ? t('race.timeUpCombo', { floors: g.raceCutCombo }) : ''}` : ''} ${t('sr.raceOver', { score: fmt(g.score), floor: fmt(sim.maxFloor), combo: sim.bestCombo })} ${r.over ? t('race.ended') : `${t('race.left', { time: fmtClock(r.left) })} ${t('sr.again')}`}`],
      ['net', netLine(g.net)?.[0] ?? ''],
    ];
  }
  if (s === 'over') {
    const sim = g.sim;
    return [
      ['screen', `${t('sr.over', { score: fmt(g.score), floor: fmt(sim.maxFloor), combo: sim.bestCombo, best: fmt(g.best.score) })}${g.newBest ? ` ${t('sr.newBest')}` : ''} ${t('sr.again')}`],
      ['net', netLine(g.net)?.[0] ?? ''],
      ['race', g.raceOpen ? t('sr.raceOpenOver', { min: g.raceInvite.minutes }) : ''],
    ];
  }
  if (s === 'race') return describeRace(g);
  if (s === 'board') {
    const b = g.board, d = g.boardData, room = g.boardScope === 'room';
    let list = t('board.loading');
    if (!g.online.enabled) list = t('board.off');
    else if (d && !d.top) list = t('board.noConn');
    else if (d?.top) {
      list = d.top.entries.length
        ? d.top.entries.slice(0, 5).map((e) => t('sr.boardRow', { rank: e.rank, name: name(e), score: fmt(e.score), floor: fmt(e.floor) })).join('; ')
        : t(b.kind === 'day' ? 'board.emptyDay' : 'board.empty');
      if (d.me?.rank) list += `. ${t('board.place', { rank: d.me.rank })}`;
    }
    const sel = b.sel >= 0 ? d?.top?.entries.find((e) => e.rank === b.sel + 1) : null;
    const end = periodEnd(b.kind), tab = t(`period.${PERIODS.includes(b.kind) ? b.kind : 'week'}`);
    const ends = end && g.online.enabled ? t(b.kind === 'day' ? 'board.endsDay' : 'board.endsWeek', { when: fmtWhen(end), left: fmtLeft(end) }) : '';
    const screen = room ? t('room.boardTitle', { name: g.online.room.name }) : t('board.title');
    return [['screen', g.online.room ? `${screen}. ${t('sr.boardScope')}` : screen], ['tab', ends ? `${tab}. ${ends}` : tab], ['list', list],
      ['sel', sel ? `${t('sr.boardSel', { rank: sel.rank, name: name(sel) })}${sel.skin ? ` ${t('sr.boardChar')}` : ''}` : '']];
  }
  if (s === 'settings') {
    const st = g.settings, titles = { main: 'set.title', controls: 'ctrl.title', access: 'acc.title', sound: 'snd.title', keys: 'bind.keysTitle', pad: 'bind.padTitle', news: 'title.news', rules: 'title.rules' };
    const parts = [['screen', t(titles[st.page] ?? 'set.title')]];
    if (st.page === 'news') {
      const e = CHANGELOG[0];
      parts.push(['news', `${e.v}: ${(e[lang()] ?? e.en).join(' ')}`]);
    } else if (st.page === 'rules') {
      parts.push(['news', rulesText().map(([head, notes]) => `${head}. ${notes.join(' ')}`).join(' ')]);
    }
    const it = g.selItem;
    parts.push(['row', itemSpeech(g, it)]);
    parts.push(['note', st.note ? t(st.note) : it?.tip ? t(it.tip) : '']);
    return parts;
  }
  if (s === 'replay') {
    const r = g.replay;
    if (!r?.data) return [['screen', t('replay.loading')]];
    return [['screen', t('sr.replay', { rank: r.rank, name: r.name, score: fmt(r.data.score) })],
      ['status', r.ended ? t('replay.end') : r.playing ? '' : t(r.i === 0 ? 'replay.stopped' : 'replay.paused')],
      ['speed', `${g.replaySpeedX}×`]];
  }
  if (s === 'recap') {
    const lw = g.recap;
    if (!lw) return [];
    const podium = lw.top.entries.slice(0, 3).map((e) => t('sr.boardRow', { rank: e.rank, name: name(e), score: fmt(e.score), floor: fmt(e.floor) })).join('; ');
    const sel = lw.top.entries[g.recapSel];
    return [['screen', `${t('recap.sub')}. ${podium}`], ['sel', sel ? t('sr.recapSel', { rank: sel.rank, name: name(sel) }) : '']];
  }
  return [];
}

/** Co klatkę (z Game.frame): czyta nowy ekran albo to, co się na nim zmieniło. */
export function speakFrame(g) {
  const screen = g.state === 'settings' ? `settings:${g.settings.page}` : g.state;
  const parts = describe(g);
  if (screen !== lastScreen) {
    lastScreen = screen;
    lastParts = new Map(parts);
    announce(joinSentences(parts.map(([, v]) => v)));
  } else {
    for (const [k, v] of parts) {
      if (lastParts.get(k) !== v) { lastParts.set(k, v); if (v) announce(v); }
    }
  }
  flush();
}

/** Klawisz I w trakcie biegu: wynik, piętro, combo i tempo – od razu, przed kolejką. */
export function speakStatus(g) {
  const s = g.sim, r = g.race;
  const race = r ? ` ${t('race.left', { time: fmtClock(r.left) })}. ${r.mine ? t('sr.raceMine', { score: fmt(r.mine.score), place: r.mine.place }) : ''}` : '';
  announce(t('sr.status', { score: fmt(g.score), floor: fmt(s.maxFloor), combo: s.combo.floors, tempo: s.scrolling ? s.level : '–' }) + race, true);
}
