import { describe, expect, test } from 'vitest';
import { dayKey, periodKeys, weekKey } from '../../server/src/periods';

const at = (iso: string) => Date.parse(iso);

describe('klucze okresów rankingu (UTC)', () => {
  test('dzień i tydzień ISO zwykłej środy', () => {
    expect(dayKey(at('2026-11-18T12:00:00Z'))).toBe('D:2026-11-18');
    expect(weekKey(at('2026-11-18T12:00:00Z'))).toBe('W:2026-47');
  });

  test('tydzień zaczyna się w poniedziałek o północy UTC', () => {
    expect(weekKey(at('2026-11-15T23:59:59Z'))).toBe('W:2026-46');   // niedziela
    expect(weekKey(at('2026-11-16T00:00:00Z'))).toBe('W:2026-47');   // poniedziałek
  });

  test('przełom roku: dni stycznia mogą należeć do 53. tygodnia poprzedniego roku', () => {
    expect(weekKey(at('2026-12-28T10:00:00Z'))).toBe('W:2026-53');
    expect(weekKey(at('2027-01-01T10:00:00Z'))).toBe('W:2026-53');
    expect(weekKey(at('2027-01-04T10:00:00Z'))).toBe('W:2027-01');
  });

  test('przełom roku: dni grudnia mogą należeć do 1. tygodnia następnego roku', () => {
    expect(weekKey(at('2024-12-30T10:00:00Z'))).toBe('W:2025-01');
  });

  test('bieg liczy się do rankingu ogólnego, tygodniowego i dziennego', () => {
    expect(periodKeys(at('2026-11-18T12:00:00Z'))).toEqual({ all: 'all', week: 'W:2026-47', day: 'D:2026-11-18' });
  });

  test('klucze sortują się jak daty, co wykorzystuje sprzątanie starych okresów', () => {
    const keys = ['2025-12-29', '2026-01-05', '2026-11-16', '2027-01-04'].map((d) => weekKey(at(d + 'T00:00:00Z')));
    expect([...keys].sort()).toEqual(keys);
  });
});
