import { afterEach, describe, expect, test } from 'vitest';
import { LANGS, detectLang, setLang, t } from '../src/game/i18n.js';
import { STRINGS } from '../src/game/strings.js';

const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const pl = STRINGS.pl as Record<string, string>;

afterEach(() => setLang('pl'));

describe('tłumaczenia', () => {
  test('pięć języków', () => {
    expect(LANGS).toEqual(['pl', 'en', 'de', 'fr', 'es']);
  });

  for (const code of ['en', 'de', 'fr', 'es'] as const) {
    test(`${code}: te same klucze co po polsku, żaden pusty`, () => {
      const dict = STRINGS[code] as Record<string, string>;
      expect(Object.keys(dict).sort()).toEqual(Object.keys(pl).sort());
      for (const [k, v] of Object.entries(dict)) expect(v.trim(), k).not.toBe('');
    });

    test(`${code}: te same {zmienne} co po polsku`, () => {
      const dict = STRINGS[code] as Record<string, string>;
      for (const k of Object.keys(pl)) expect(vars(dict[k]), k).toEqual(vars(pl[k]));
    });
  }

  test('każdy próg combo, postać i mapa ma tekst', () => {
    for (const n of [4, 7, 15, 25, 35, 50, 70, 100, 140, 200]) expect(pl[`tier.${n}`]).toBeTruthy();
    for (const c of ['fox', 'penguin', 'frog', 'robot', 'cat']) expect(pl[`char.${c}`]).toBeTruthy();
    for (const s of ['ice', 'film', 'retro', 'neon', 'sketch']) expect(pl[`style.${s}.name`] && pl[`style.${s}.desc`]).toBeTruthy();
  });
});

describe('t() i wybór języka', () => {
  test('podstawia zmienne', () => {
    setLang('en');
    expect(t('board.place', { rank: 7 })).toBe('Your rank: #7');
    setLang('de');
    expect(t('net.verified', { day: 1, week: 2, all: 3 })).toBe('RANGLISTE   heute #1   ·   Woche #2   ·   gesamt #3');
  });

  test('nieznany klucz zwraca sam klucz, nieznany język – polski', () => {
    expect(t('nie.ma.takiego')).toBe('nie.ma.takiego');
    setLang('xx');
    expect(t('set.lang')).toBe('Język');
  });

  test('język z przeglądarki: pierwszy obsługiwany, inaczej angielski', () => {
    expect(detectLang(['de-AT', 'en'])).toBe('de');
    expect(detectLang(['it-IT', 'fr-CA'])).toBe('fr');
    expect(detectLang(['pl'])).toBe('pl');
    expect(detectLang(['ja', 'it'])).toBe('en');
    expect(detectLang([])).toBe('en');
  });
});
