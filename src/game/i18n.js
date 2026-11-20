// Języki gry. t('klucz', { zmienne }) zwraca tekst w bieżącym języku (z zapasem: polski, potem sam klucz).
import { LANG_NAMES, STRINGS } from './strings.js';

export const LANGS = Object.keys(LANG_NAMES);
export { LANG_NAMES };

let cur = 'pl';

export const lang = () => cur;

/** Pierwszy obsługiwany język z listy preferencji przeglądarki; nic pasującego → angielski. */
export function detectLang(prefs = (typeof navigator !== 'undefined' && navigator.languages) || []) {
  for (const p of prefs) {
    const code = String(p).toLowerCase().split('-')[0];
    if (LANGS.includes(code)) return code;
  }
  return 'en';
}

export function t(key, vars) {
  const s = STRINGS[cur][key] ?? STRINGS.pl[key] ?? key;
  return vars ? s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? '')) : s;
}

/** Ustawia język i tłumaczy elementy HTML oznaczone data-i18n (tekst) i data-i18n-aria (aria-label). */
export function setLang(code) {
  cur = LANGS.includes(code) ? code : 'pl';
  if (typeof document === 'undefined') return;
  document.documentElement.lang = cur;
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of document.querySelectorAll('[data-i18n-aria]')) {
    el.setAttribute('aria-label', t(el.dataset.i18nAria));
    if (el.hasAttribute('title')) el.title = t(el.dataset.i18nAria);
  }
}
