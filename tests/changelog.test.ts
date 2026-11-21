// Lista zmian (ekran NOWOŚCI) musi nadążać za wersją gry – zasady w CLAUDE.md.
import { describe, expect, test } from 'vitest';
import { CHANGELOG, wrap } from '../src/game/changelog.js';
import { LANGS } from '../src/game/i18n.js';

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;
const parts = (v: string) => v.match(SEMVER)!.slice(1).map(Number);
const newer = (a: string, b: string) => {
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
};
type Entry = { v: string; date: string; [lang: string]: string | string[] };
const log = CHANGELOG as Entry[];
const points = (e: Entry, code: string) => e[code] as string[] | undefined;

describe('lista zmian', () => {
  test('najnowszy wpis ma wersję z package.json', () => {
    // __APP_VERSION__ wstawia vite.config.js z package.json – także w testach
    expect(__APP_VERSION__).toMatch(SEMVER);
    expect(log[0].v).toBe(__APP_VERSION__);
  });

  test('wersje w formacie x.y.z, bez powtórek, od najnowszej', () => {
    for (const e of log) expect(e.v, e.v).toMatch(SEMVER);
    for (let i = 1; i < log.length; i++) expect(newer(log[i - 1].v, log[i].v), `${log[i - 1].v} po ${log[i].v}`).toBe(true);
  });

  test('daty RRRR-MM-DD, nie rosną w dół listy', () => {
    for (const e of log) {
      expect(e.date, e.v).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(Date.parse(e.date)), e.v).toBe(false);
    }
    for (let i = 1; i < log.length; i++) expect(log[i - 1].date >= log[i].date, log[i].v).toBe(true);
  });

  test('każdy język ma tyle samo niepustych punktów', () => {
    for (const e of log) {
      const n = points(e, 'pl')!.length;
      expect(n, e.v).toBeGreaterThan(0);
      for (const code of LANGS) {
        expect(points(e, code)?.length, `${e.v} ${code}`).toBe(n);
        for (const line of points(e, code)!) expect(line.trim(), `${e.v} ${code}`).not.toBe('');
      }
    }
  });
});

describe('łamanie linijek', () => {
  const measure = (s: string) => s.length;            // 1 znak = 1 px
  test('nie przekracza szerokości i nie gubi słów', () => {
    const str = 'ala ma kota a kot ma ale';
    const lines = wrap(str, 10, measure);
    expect(lines).toEqual(['ala ma', 'kota a kot', 'ma ale']);
    expect(lines.join(' ')).toBe(str);
  });
  test('za długie słowo zostaje w całości', () => {
    expect(wrap('krótkie bardzodługiesłowo', 8, measure)).toEqual(['krótkie', 'bardzodługiesłowo']);
  });
});
