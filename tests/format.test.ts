// Liczby i czas zamknięcia rankingu w grze (src/game/format.js) – zamknięcie musi się zgadzać z okresami serwera.
import { afterEach, describe, expect, test } from 'vitest';
import { fmt, fmtLeft, periodEnd } from '../src/game/format.js';
import { setLang } from '../src/game/i18n.js';
import { dayKey, weekKey } from '../server/src/periods';

afterEach(() => setLang('pl'));

describe('zamknięcie rankingu', () => {
  // różne dni tygodnia, początek i koniec doby, przełom roku (tydzień ISO 1 i 53)
  const moments = ['2026-11-21T21:30:00Z', '2026-11-23T00:00:00Z', '2026-11-22T23:59:59Z', '2026-12-31T12:00:00Z', '2027-01-03T23:00:00Z', '2020-12-31T05:00:00Z'];
  for (const iso of moments) {
    const ms = Date.parse(iso);
    test(`tydzień i dzień: ${iso}`, () => {
      const w = periodEnd('week', ms)!, d = periodEnd('day', ms)!;
      expect(weekKey(w - 1)).toBe(weekKey(ms));           // do ostatniej milisekundy ten sam tydzień
      expect(weekKey(w)).not.toBe(weekKey(ms));            // od tej chwili już następny
      expect(dayKey(d - 1)).toBe(dayKey(ms));
      expect(dayKey(d)).not.toBe(dayKey(ms));
    });
  }
  test('ogółem i zeszły tydzień nie mają zamknięcia', () => {
    expect(periodEnd('all')).toBeNull();
    expect(periodEnd('lastweek')).toBeNull();
  });
  test('ile zostało: poniżej dwóch dni w godzinach', () => {
    const now = Date.parse('2026-11-21T22:00:00Z');
    expect(fmtLeft(now + 26 * 3_600_000, now)).toBe('za 26 godzin');
    expect(fmtLeft(now + 3 * 86_400_000 + 5, now)).toBe('za 3 dni');
    expect(fmtLeft(now + 90_000, now)).toBe('za 2 minuty');
  });
});

describe('liczby', () => {
  test('separator tysięcy wg języka', () => {
    expect(fmt(122456)).toBe('122 456');
    setLang('en');
    expect(fmt(122456)).toBe('122,456');
    setLang('de');
    expect(fmt(122456)).toBe('122.456');
  });
  test('nie-liczby bez zmian', () => {
    expect(fmt(undefined)).toBe('');
    expect(fmt('—' as unknown as number)).toBe('—');
  });
});
