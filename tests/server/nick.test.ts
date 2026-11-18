import { describe, expect, test } from 'vitest';
import { checkNick } from '../../server/src/nick';

describe('nick gracza', () => {
  test('przyjmuje litery (także polskie), cyfry, podkreślnik, minus i pojedyncze spacje', () => {
    expect(checkNick('Łukasz_07')).toEqual({ ok: true, nick: 'Łukasz_07', key: 'łukasz_07' });
    expect(checkNick('Żaba-Skoczek')).toMatchObject({ ok: true, nick: 'Żaba-Skoczek' });
    expect(checkNick('Ala ma kota')).toMatchObject({ ok: true });
  });

  test('obcina spacje z brzegów', () => {
    expect(checkNick('  Kot  ')).toMatchObject({ ok: true, nick: 'Kot' });
  });

  test('klucz unikalności nie rozróżnia wielkości liter, także polskich', () => {
    const a = checkNick('ŻÓŁW'), b = checkNick('żółw');
    expect(a.ok && b.ok && a.key === b.key).toBe(true);
  });

  test('odrzuca zbyt krótkie i zbyt długie', () => {
    expect(checkNick('ab')).toEqual({ ok: false, reason: 'length' });
    expect(checkNick('a'.repeat(17))).toEqual({ ok: false, reason: 'length' });
    expect(checkNick('a'.repeat(16))).toMatchObject({ ok: true });
  });

  test('odrzuca inne znaki i podwójne spacje', () => {
    expect(checkNick('<b>hej</b>')).toEqual({ ok: false, reason: 'chars' });
    expect(checkNick('kot  pies')).toEqual({ ok: false, reason: 'chars' });
    expect(checkNick('emoji😀x')).toEqual({ ok: false, reason: 'chars' });
    expect(checkNick(42 as unknown as string)).toEqual({ ok: false, reason: 'chars' });
  });

  test('odrzuca wulgaryzmy, także rozbite spacjami i zapisane cyframi', () => {
    for (const bad of ['kurwa', 'Kurw4_Mać', 'k u r w a', 'CHUJ123', 'fuck_you']) expect(checkNick(bad)).toEqual({ ok: false, reason: 'blocked' });
  });

  test('odrzuca nazwy udające obsługę gry', () => {
    expect(checkNick('Admin')).toEqual({ ok: false, reason: 'blocked' });
    expect(checkNick('Step Jumper')).toEqual({ ok: false, reason: 'blocked' });
  });

  test('nie blokuje zwykłych słów', () => {
    for (const good of ['Skoczek', 'Huragan', 'Pikachu', 'Scunthorpe']) expect(checkNick(good)).toMatchObject({ ok: true });
  });
});
