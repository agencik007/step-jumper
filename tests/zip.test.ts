// ZIP paczek postaci: zapis bez kompresji i odczyt plików „store” i „deflate” (tak pakują systemy).
import { describe, expect, test } from 'vitest';
import { crc32, unzip, zipFiles } from '../src/game/zip.js';

const enc = new TextEncoder();

/** ZIP z jednym plikiem spakowanym metodą deflate – jak z „Kompresuj” w systemie. */
async function deflatedZip(name: string, data: Uint8Array<ArrayBuffer>) {
  const n = enc.encode(name), crc = crc32(data);
  const comp = new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
  const out = new Uint8Array(30 + n.length + comp.length + 46 + n.length + 22), v = new DataView(out.buffer);
  let p = 0;
  v.setUint32(p, 0x04034b50, true); v.setUint16(p + 4, 20, true); v.setUint16(p + 8, 8, true); v.setUint32(p + 14, crc, true);
  v.setUint32(p + 18, comp.length, true); v.setUint32(p + 22, data.length, true); v.setUint16(p + 26, n.length, true);
  out.set(n, p + 30); out.set(comp, p + 30 + n.length);
  const cd = p = 30 + n.length + comp.length;
  v.setUint32(p, 0x02014b50, true); v.setUint16(p + 4, 20, true); v.setUint16(p + 6, 20, true); v.setUint16(p + 10, 8, true); v.setUint32(p + 16, crc, true);
  v.setUint32(p + 20, comp.length, true); v.setUint32(p + 24, data.length, true); v.setUint16(p + 28, n.length, true); v.setUint32(p + 42, 0, true);
  out.set(n, p + 46);
  p += 46 + n.length;
  v.setUint32(p, 0x06054b50, true); v.setUint16(p + 8, 1, true); v.setUint16(p + 10, 1, true);
  v.setUint32(p + 12, 46 + n.length, true); v.setUint32(p + 16, cd, true);
  return out;
}

describe('zip', () => {
  test('CRC-32', () => {
    expect(crc32(enc.encode('123456789'))).toBe(0xcbf43926);
  });

  test('zapis i odczyt: nazwy w UTF-8, katalogi pomijane, filtr plików', async () => {
    const files = [
      { name: 'character.json', data: enc.encode('{"name":"Żaba"}') },
      { name: 'idle.png', data: new Uint8Array([137, 80, 78, 71, 1, 2, 3]) },
      { name: 'zdjęcia/run1.png', data: new Uint8Array(1000).map((_, i) => i % 251) },
    ];
    const z = zipFiles(files);
    const all = await unzip(z);
    expect(all.map((f) => f.name)).toEqual(files.map((f) => f.name));
    for (let i = 0; i < files.length; i++) expect(all[i].data).toEqual(files[i].data);
    const png = await unzip(z, { wanted: (n) => n.endsWith('.png') });
    expect(png.map((f) => f.name)).toEqual(['idle.png', 'zdjęcia/run1.png']);
  });

  test('odczyt pliku spakowanego deflate', async () => {
    const data = enc.encode('postać '.repeat(500));
    const [f] = await unzip(await deflatedZip('opis.txt', data));
    expect(f.name).toBe('opis.txt');
    expect(f.data).toEqual(data);
  });

  test('zepsuty plik i limit rozmiaru', async () => {
    await expect(unzip(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow('zip');
    const z = zipFiles([{ name: 'a.png', data: new Uint8Array(5000) }]);
    await expect(unzip(z, { maxTotal: 1000 })).rejects.toThrow('big');
  });
});
