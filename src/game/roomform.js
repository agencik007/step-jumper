// Okienko pokoju znajomych (RANKING → POKÓJ): założenie albo dołączenie nazwą i hasłem, a w pokoju – lista graczy
// i wyjście. Zwykły formularz HTML nad grą, jak okienko nicku (nickform.js): na canvasie nie da się wygodnie pisać.
import { live } from '../net';
import { fmt } from './format.js';
import { focusGame } from './gfx.js';
import { t } from './i18n.js';

const KNOWN = ['room_length', 'room_chars', 'room_blocked', 'room_taken', 'room_pass', 'room_not_found', 'room_password',
  'room_full', 'room_locked', 'banned', 'offline'];
const $ = (id) => document.getElementById(id);
const form = $('room'), joinView = $('roomJoin'), inView = $('roomIn'), err = $('roomErr');
const nameField = $('roomName'), passField = $('roomPass'), leaveBtn = $('roomLeave');

/** @type {{ online: any, onChange: () => void } | null} */
let ctx = null;
let busy = false, leaveArmed = false;
/** Gracze pokoju z ostatniego roomInfo – lista w okienku dokleja do nich stan na żywo. */
let members = [];

export const roomOpen = () => !form.hidden;

/** Otwiera okienko. onChange() – po wejściu do pokoju albo wyjściu z niego (gra odświeża ranking). */
export function openRoom(online, onChange) {
  ctx = { online, onChange };
  err.textContent = '';
  form.hidden = false;
  if (online.room) showIn(online.room.name); else showJoin();
}

/** Widok okienka: 'join' – nazwa i hasło, 'in' – pokój, w którym jestem. */
function view(v) {
  joinView.hidden = $('roomJoinRow').hidden = v !== 'join';
  inView.hidden = $('roomInRow').hidden = v !== 'in';
}

function showJoin(name = '') {
  view('join');
  nameField.value = name; passField.value = ''; passField.type = 'password'; $('roomShow').checked = false;
  setTimeout(() => { nameField.focus(); nameField.select(); }, 0);
}

async function showIn(name) {
  view('in');
  leaveArmed = false; leaveBtn.textContent = t('room.leave');
  $('roomTitle').textContent = name;
  const count = $('roomCount');
  members = []; renderMembers();
  count.textContent = t('board.loading');
  setTimeout(() => $('roomClose').focus(), 0);
  const info = await ctx?.online.roomInfo();
  if (!ctx || inView.hidden) return;
  if (!info) { count.textContent = ctx.online.room ? t('room.noConn') : ''; if (!ctx.online.room) { ctx.onChange(); showJoin(); } return; }
  $('roomTitle').textContent = info.name;
  count.textContent = t('room.count', { n: info.members.length });
  members = info.members;
  renderMembers();
}

/** Lista graczy pokoju: kto jest teraz w grze (w menu / w biegu z piętrem i wynikiem), a kto poza nią. */
function renderMembers() {
  const ul = $('roomMembers');
  ul.replaceChildren(...members.map((m) => {
    const p = m.me ? null : live.find(m), li = document.createElement('li'), name = document.createElement('span'), st = document.createElement('span');
    name.textContent = (m.nick ?? t('board.player', { tag: m.tag })) + (m.me ? ` (${t('room.you')})` : '');
    st.className = 'st';
    st.textContent = m.me ? '' : !p ? t('live.off') : p.s === 'play' ? t('live.play', { floor: fmt(p.floor ?? 0), score: fmt(p.score ?? 0) }) : t('live.menu');
    li.className = p ? (p.s === 'play' ? 'on play' : 'on') : '';
    li.append(name, st);
    return li;
  }));
}

/** Zmiana na liście obecnych (live.ts): odśwież okienko, jeśli jest otwarte. */
export function refreshRoomLive() { if (!form.hidden && !inView.hidden) renderMembers(); }

function close() {
  if (form.hidden) return;
  form.hidden = true;
  nameField.blur(); passField.blur();
  focusGame();                                         // klawiatura i czytnik ekranu wracają do gry
  ctx = null;
}

async function send(kind) {
  if (!ctx || busy) return;
  busy = true; err.textContent = t('room.working');
  const o = ctx.online;
  const r = kind === 'create' ? await o.createRoom(nameField.value, passField.value) : await o.joinRoom(nameField.value, passField.value);
  busy = false;
  if (!ctx) return;
  if (!r.ok) { err.textContent = t(`room.err.${KNOWN.includes(r.error) ? r.error : 'generic'}`); return; }
  err.textContent = '';
  ctx.onChange();
  close();
}

form.addEventListener('submit', (e) => { e.preventDefault(); send('join'); });   // Enter w polu = DOŁĄCZ
$('roomCreate').addEventListener('click', () => send('create'));
$('roomShow').addEventListener('change', (e) => { passField.type = e.target.checked ? 'text' : 'password'; });
$('roomOther').addEventListener('click', () => { err.textContent = ''; showJoin(); });
leaveBtn.addEventListener('click', async () => {
  if (!ctx || busy) return;
  if (!leaveArmed) { leaveArmed = true; leaveBtn.textContent = t('room.leaveSure'); return; }   // drugie dotknięcie wychodzi
  busy = true; err.textContent = t('room.working');
  const ok = await ctx.online.leaveRoom();
  busy = false;
  if (!ctx) return;
  if (!ok) { err.textContent = t('room.err.offline'); return; }
  err.textContent = '';
  ctx.onChange();
  close();
});
for (const id of ['roomCancel', 'roomClose']) $(id).addEventListener('click', () => close());
form.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } });
// dotknięcia formularza nie trafiają do gry (w trybie przechyłu każde dotknięcie to skok)
form.addEventListener('pointerdown', (e) => e.stopPropagation());

/** Zamknięcie bez zmian (przycisk B na padzie, Esc). */
export const closeRoom = close;
