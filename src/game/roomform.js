// Okienko pokoju znajomych (menu główne → DOŁĄCZ / UTWÓRZ): nazwa i hasło pokoju, jeden przycisk – dołącz albo utwórz.
// Zwykły formularz HTML nad grą, jak okienko nicku (nickform.js): na canvasie nie da się wygodnie pisać.
// Wyjście z pokoju jest na ekranie tytułowym (game.leaveRoom), bez okienka.
import { focusGame } from './gfx.js';
import { t } from './i18n.js';
import { openNick } from './nickform.js';

const KNOWN = ['nick_required', 'room_length', 'room_chars', 'room_blocked', 'room_taken', 'room_pass', 'room_not_found', 'room_password',
  'room_full', 'room_locked', 'banned', 'offline'];
const $ = (id) => document.getElementById(id);
const form = $('room'), err = $('roomErr'), nameField = $('roomName'), passField = $('roomPass');

/** @type {{ online: any, kind: 'join' | 'create', onChange: () => void } | null} */
let ctx = null;
let busy = false;

export const roomOpen = () => !form.hidden;

/** Otwiera okienko: kind 'join' – dołączenie, 'create' – nowy pokój. onChange() – po wejściu do pokoju. */
export function openRoom(online, kind, onChange) {
  ctx = { online, kind, onChange };
  $('roomHead').textContent = t(kind === 'join' ? 'room.joinHead' : 'room.createHead');
  $('roomInfo').textContent = t(kind === 'join' ? 'room.joinInfo' : 'room.createInfo');
  $('roomGo').textContent = t(kind === 'join' ? 'room.join' : 'room.create');
  err.textContent = '';
  nameField.value = ''; passField.value = ''; passField.type = 'password'; $('roomShow').checked = false;
  form.hidden = false;
  setTimeout(() => nameField.focus(), 0);
}

function close() {
  if (form.hidden) return;
  form.hidden = true;
  nameField.blur(); passField.blur();
  focusGame();                                         // klawiatura i czytnik ekranu wracają do gry
  ctx = null;
}

/**
 * Pokój tylko z nickiem (znajomi muszą wiedzieć, kto to): okienko pokoju chowa się na chwilę za okienkiem nicku,
 * a po zapisaniu nicku wraca z wpisaną nazwą i hasłem i od razu kończy to, co gracz zaczął.
 */
function nickFirst() {
  const keep = { name: nameField.value, pass: passField.value, show: passField.type };
  form.hidden = true;
  openNick('', (nick) => ctx.online.setNick(nick), (saved) => {
    if (!ctx) return;
    form.hidden = false;
    nameField.value = keep.name; passField.value = keep.pass; passField.type = keep.show;
    if (saved) send();
    else { err.textContent = t('room.err.nick_required'); nameField.focus(); }
  }, { label: 'nick.room' });
}

async function send() {
  if (!ctx || busy) return;
  if (!ctx.online.nick) { nickFirst(); return; }
  busy = true; err.textContent = t('room.working');
  const o = ctx.online;
  const r = ctx.kind === 'create' ? await o.createRoom(nameField.value, passField.value) : await o.joinRoom(nameField.value, passField.value);
  busy = false;
  if (!ctx) return;
  if (!r.ok) { err.textContent = t(`room.err.${KNOWN.includes(r.error) ? r.error : 'generic'}`); return; }
  err.textContent = '';
  ctx.onChange();
  close();
}

form.addEventListener('submit', (e) => { e.preventDefault(); send(); });   // Enter w polu = DOŁĄCZ / UTWÓRZ
$('roomShow').addEventListener('change', (e) => { passField.type = e.target.checked ? 'text' : 'password'; });
$('roomCancel').addEventListener('click', () => close());
form.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } });
// dotknięcia formularza nie trafiają do gry (w trybie przechyłu każde dotknięcie to skok)
form.addEventListener('pointerdown', (e) => e.stopPropagation());

/** Zamknięcie bez zmian (przycisk B na padzie, Esc). */
export const closeRoom = close;
