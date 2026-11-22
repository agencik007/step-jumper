// Własne postacie z obrazków: przypisanie plików do klatek, wybór klatki w grze, skala i plik character.json.
import { describe, expect, test } from 'vitest';
import {
  FRAMES, TARGET_H, assignFiles, biggestCircle, cleanName, layoutFrames, packJson, parsePackJson, pickFrame, resolveFrame, zipName,
} from '../src/game/skinpack.js';

describe('przypisanie plików do klatek', () => {
  test('po nazwach: wielkość liter, podkatalog i śmieci z macOS bez znaczenia', () => {
    const names = ['moja/IDLE.png', 'moja/Run1.PNG', 'moja/run2.png', 'moja/jump3.webp', '__MACOSX/moja/._idle.png', 'moja/notatki.txt', 'moja/inne.png'];
    const a = assignFiles(names);
    expect(a.type).toBe('frames');
    expect(a.byOrder).toBe(false);
    expect(a.map).toEqual({ idle: 'moja/IDLE.png', run1: 'moja/Run1.PNG', run2: 'moja/run2.png', jump3: 'moja/jump3.webp' });
    expect(a.extra).toEqual(['moja/inne.png']);
  });

  test('wszystkie 12 nazw z zasad', () => {
    const a = assignFiles(FRAMES.map((f) => `${f}.png`));
    expect(Object.keys(a.map)).toEqual(FRAMES);
  });

  test('sama głowa: head.png albo jeden dowolny obrazek', () => {
    expect(assignFiles(['head.png', 'character.json'])).toMatchObject({ type: 'head', map: { head: 'head.png' }, byOrder: false });
    expect(assignFiles(['twarz.png'])).toMatchObject({ type: 'head', map: { head: 'twarz.png' }, byOrder: true });
  });

  test('12 obrazków o innych nazwach: po kolei według numeru w nazwie (pliki z generatora obrazków)', () => {
    const names = ['Code_Generated_Image.png', ...Array.from({ length: 11 }, (_, i) => `Code_Generated_Image (${11 - i}).png`)];
    const a = assignFiles(names);
    expect(a.type).toBe('frames');
    expect(a.byOrder).toBe(true);
    expect(a.map.idle).toBe('Code_Generated_Image.png');
    expect(a.map.run1).toBe('Code_Generated_Image (1).png');
    expect(a.map.jump1).toBe('Code_Generated_Image (5).png');
    expect(a.map.cheer).toBe('Code_Generated_Image (11).png');
  });

  test('kilka obrazków bez pasujących nazw – nic', () => {
    expect(assignFiles(['a.png', 'b.png', 'c.png']).type).toBeNull();
    expect(assignFiles(['opis.txt']).type).toBeNull();
  });
});

describe('klatka do narysowania', () => {
  test('stany bohatera', () => {
    expect(pickFrame({})).toBe('idle');
    expect(pickFrame({ run: 1, phase: 0 })).toBe('run1');
    expect(pickFrame({ run: 1, phase: Math.PI / 2 + 0.01 })).toBe('run2');
    expect(pickFrame({ run: 1, phase: Math.PI + 0.01 })).toBe('run3');
    expect(pickFrame({ run: 1, phase: 2 * Math.PI - 0.01 })).toBe('run4');
    expect(pickFrame({ run: 1, phase: 2 * Math.PI + 0.01 })).toBe('run1');
    expect(pickFrame({ squash: 0.9 })).toBe('land');
    expect(pickFrame({ air: true, squash: -0.6, vy: -900 })).toBe('jump1');
    expect(pickFrame({ air: true, vy: -900 })).toBe('jump2');
    expect(pickFrame({ air: true, vy: 100 })).toBe('jump3');
    expect(pickFrame({ air: true, vy: 1100 })).toBe('fall');
    expect(pickFrame({ pose: 'dead', air: true })).toBe('dead');
    expect(pickFrame({ pose: 'cheer' })).toBe('cheer');
  });

  test('brakująca klatka – podobna, a na końcu „stoi”', () => {
    const only = (...have: string[]) => (k: string) => have.includes(k);
    expect(resolveFrame('run3', only('idle', 'run1'))).toBe('run1');
    expect(resolveFrame('fall', only('idle', 'jump2'))).toBe('jump2');
    expect(resolveFrame('jump1', only('idle', 'land'))).toBe('land');
    expect(resolveFrame('cheer', only('idle'))).toBe('idle');
    expect(resolveFrame('jump2', only('idle'))).toBe('idle');      // jump2 ↔ jump3 bez żadnej z nich – nie zapętla się
    expect(resolveFrame('idle', only())).toBeNull();
  });
});

describe('skala klatek', () => {
  /** Maska: koło (głowa) o promieniu r na wąskim tułowiu. */
  function figure(r: number) {
    const w = r * 2 + 10, h = r * 5, m = new Uint8Array(w * h), cx = w / 2, cy = r + 2;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r || (y > cy && Math.abs(x - cx) < r * 0.4)) m[y * w + x] = 1;
      }
    }
    return { m, w, h, cx, cy };
  }

  test('największe koło w sylwetce to głowa', () => {
    const f = figure(20), c = biggestCircle(f.m, f.w, f.h);
    expect(c.r).toBeGreaterThan(18);
    expect(c.r).toBeLessThan(23);
    expect(Math.abs(c.x - f.cx)).toBeLessThanOrEqual(2);
    expect(Math.abs(c.y - f.cy)).toBeLessThanOrEqual(2);
  });

  test('„stoi” narysowane 2× większe niż reszta wyrównuje się do reszty, a „stoi” ma TARGET_H wysokości', () => {
    const m = {
      idle: { w: 240, h: 600, r: 104, hx: 120 },
      run1: { w: 140, h: 240, r: 52, hx: 82 },
      run2: { w: 150, h: 236, r: 53, hx: 90 },
      dead: { w: 306, h: 128, r: 56, hx: 236 },        // ±20% od mediany – ta sama skala co reszta
    };
    const l = layoutFrames(m);
    expect(l.idle.s * m.idle.h).toBeCloseTo(TARGET_H, 5);
    expect(l.run1.s).toBeCloseTo(l.run2.s, 9);
    expect(l.run1.s).toBeCloseTo(l.dead.s, 9);
    expect(l.idle.s * m.idle.r).toBeCloseTo(l.run1.s * 54.5, 5);   // głowa „stoi” = mediana głów pozostałych klatek (54,5 px)
    expect(l.run1.ax).toBe(82);                          // zaczepienie: środek głowy w poziomie, stopy (dół obrazka) w pionie
    expect(l.run1.ay).toBe(240);
  });

  test('poprawki z kreatora: wielkość i przesunięcie', () => {
    const m = { idle: { w: 100, h: 200, r: 30, hx: 50 } };
    const base = layoutFrames(m).idle, l = layoutFrames(m, { idle: { k: 1.5, dx: 3, dy: 6 } }).idle;
    expect(l.s).toBeCloseTo(base.s * 1.5, 9);
    expect((50 - l.ax) * l.s).toBeCloseTo(3, 9);          // obrazek 3 jednostki w prawo
    expect((l.ay - 200) * l.s).toBeCloseTo(6, 9);         // i 6 w górę
    expect(layoutFrames(m, { idle: { k: 99, dx: -999 } }).idle.s).toBeCloseTo(base.s * 2.5, 9);   // poza zakresem – przycięte
  });
});

describe('character.json i nazwy', () => {
  test('eksport → import zachowuje ustawienia, złe wartości odpadają', () => {
    const rec = { name: 'Marek', type: 'frames', adjust: { idle: { k: 1, dx: 0, dy: 0 }, run1: { k: 1.2, dx: -2, dy: 1 } } };
    const back = parsePackJson(JSON.stringify(packJson(rec)))!;
    expect(back.name).toBe('Marek');
    expect(back.type).toBe('frames');
    expect(back.adjust).toEqual({ run1: { k: 1.2, dx: -2, dy: 1 } });
    const head = parsePackJson(JSON.stringify({ type: 'head', name: '<b>x</b>', head: { k: 'duża' }, colors: { shirt: '#ABCDEF', pants: 'red' } }))!;
    expect(head.type).toBe('head');
    expect(head.name).toBe('bx/b');
    expect(head.headK).toBe(1);
    expect(head.colors.shirt).toBe('#abcdef');
    expect(head.colors.pants).toMatch(/^#[0-9a-f]{6}$/);
    expect(parsePackJson('nie json')).toBeNull();
  });

  test('nazwa postaci i pliku ZIP', () => {
    expect(cleanName('  Bardzo   długa nazwa postaci  ')).toBe('Bardzo długa naz');
    expect(cleanName('', 'Moja postać')).toBe('Moja postać');
    expect(zipName('Łukasz Żółć!')).toBe('postac-lukasz-zolc.zip');
    expect(zipName('???')).toBe('postac-moja.zip');
  });
});
