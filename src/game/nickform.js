// Okienko wpisywania nicku. To zwykły formularz HTML nad grą, bo na canvasie nie da się wygodnie pisać
// (klawiatura ekranowa telefonu, wklejanie, polskie znaki).
import { t } from './i18n.js';

const KNOWN = ['nick_length', 'nick_chars', 'nick_blocked', 'nick_taken', 'offline'];
const form = document.getElementById('nick');
const field = document.getElementById('nickInput');
const err = document.getElementById('nickErr');
const save = document.getElementById('nickSave');


let pending = null;

export const nickOpen = () => !form.hidden;

/** Otwiera formularz. onSave(nick) → { ok: true } albo { ok: false, error }; onClose() po zamknięciu. */
export function openNick(current, onSave, onClose) {
  pending = { onSave, onClose };
  field.value = current ?? '';
  err.textContent = '';
  form.hidden = false;
  setTimeout(() => { field.focus(); field.select(); }, 0);
}

function close() {
  form.hidden = true;
  field.blur();
  const p = pending; pending = null;
  p?.onClose();
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!pending || save.disabled) return;
  save.disabled = true; err.textContent = t('nick.saving');
  const r = await pending.onSave(field.value);
  save.disabled = false;
  if (r.ok) close();
  else err.textContent = t(`nick.err.${KNOWN.includes(r.error) ? r.error : 'generic'}`);
});
document.getElementById('nickCancel').addEventListener('click', close);
form.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } });
