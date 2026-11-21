// Okienko wpisywania nicku. To zwykły formularz HTML nad grą, bo na canvasie nie da się wygodnie pisać
// (klawiatura ekranowa telefonu, wklejanie, polskie znaki).
import { focusGame } from './gfx.js';
import { t } from './i18n.js';

const KNOWN = ['nick_length', 'nick_chars', 'nick_blocked', 'nick_taken', 'offline'];
const form = document.getElementById('nick');
const field = document.getElementById('nickInput');
const err = document.getElementById('nickErr');
const save = document.getElementById('nickSave');
const label = document.getElementById('nickLabel');


let pending = null;

export const nickOpen = () => !form.hidden;

/**
 * Otwiera formularz. onSave(nick) → { ok: true } albo { ok: false, error }; onClose(saved) po zamknięciu.
 * required: nick jest potrzebny, zanim zacznie się gra – nagłówek o tym mówi. pad: gracz używa pada – podpowiedź „B = graj bez nicku”.
 */
export function openNick(current, onSave, onClose, { required = false, pad = false } = {}) {
  pending = { onSave, onClose };
  field.value = current ?? '';
  err.textContent = '';
  label.dataset.i18n = required ? 'nick.required' : 'nick.label';
  label.textContent = t(label.dataset.i18n);
  document.getElementById('nickPad').hidden = !pad;    // gra padem: jak zagrać bez pisania
  form.hidden = false;
  setTimeout(() => { field.focus(); field.select(); }, 0);
}

function close(saved = false) {
  form.hidden = true;
  field.blur();
  focusGame();                                         // klawiatura i czytnik ekranu wracają do gry
  const p = pending; pending = null;
  p?.onClose(saved);
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!pending || save.disabled) return;
  save.disabled = true; err.textContent = t('nick.saving');
  const r = await pending.onSave(field.value);
  save.disabled = false;
  if (r.ok) close(true);
  else err.textContent = t(`nick.err.${KNOWN.includes(r.error) ? r.error : 'generic'}`);
});
document.getElementById('nickCancel').addEventListener('click', () => close());
form.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } });
// dotknięcia formularza nie trafiają do gry (w trybie przechyłu każde dotknięcie to skok)
form.addEventListener('pointerdown', (e) => e.stopPropagation());
/** Zamknięcie bez zapisu (przycisk B na padzie). */
export function cancelNick() { if (!form.hidden) close(); }
