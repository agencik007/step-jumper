// KREATOR postaci w prawdziwej przeglądarce: wczytanie 12 obrazków PNG nazwanych jak w zasadach, zapis w IndexedDB,
// wybór postaci, eksport do ZIP i ponowny import, a po przeładowaniu – postać nadal wybrana i bieg bez błędów.
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

type G = { state: string; charIdx: number; customId: string | null; custom: { name: string } | null; nickLater: boolean; start(): void; openCreator(): void };
const game = (page: Page) => page.evaluate(() => {
  const g = (window as unknown as { __game: G }).__game;
  return { state: g.state, charIdx: g.charIdx, customId: g.customId, name: g.custom?.name ?? null };
});
const FRAMES = ['idle', 'run1', 'run2', 'run3', 'run4', 'jump1', 'jump2', 'jump3', 'land', 'fall', 'dead', 'cheer'];

/** Wybór 12 prostych obrazków PNG (głowa + tułów, różne kolory) w polu „Wczytaj ZIP / PNG” – rysowane w przeglądarce. */
async function choosePngs(page: Page) {
  await page.evaluate(async (frames) => {
    const dt = new DataTransfer();
    for (const [i, f] of frames.entries()) {
      const c = document.createElement('canvas'); c.width = 120; c.height = 220;
      const x = c.getContext('2d')!;
      x.fillStyle = `hsl(${i * 30} 70% 55%)`; x.fillRect(45, 90, 30, 120);
      x.beginPath(); x.arc(60, 55, 40, 0, 7); x.fill();
      const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/png'));
      dt.items.add(new File([blob], `${f}.png`, { type: 'image/png' }));
    }
    const inp = document.getElementById('crFile') as HTMLInputElement;
    inp.files = dt.files;
    inp.dispatchEvent(new Event('change'));
  }, FRAMES);
}

test('wczytanie 12 klatek, zapis, eksport ZIP, ponowny import i gra własną postacią', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('stepjumper.prefs.v1', JSON.stringify({ lang: 'pl' })));
  await page.reload();
  await page.waitForFunction(() => !!(window as unknown as { __game?: G }).__game);

  await page.evaluate(() => (window as unknown as { __game: G }).__game.openCreator());
  await expect(page.locator('#crListView')).toBeVisible();
  await choosePngs(page);
  await expect(page.locator('#crEditView')).toBeVisible({ timeout: 15000 });   // kodowanie PNG w Chromium bez ekranu trwa ok. 1 s
  await expect(page.locator('#crEditMsg')).toContainText('12 z 12');
  await expect(page.locator('#crFrames .cr-cell:not(.empty)')).toHaveCount(12);

  await page.fill('#crName', 'Testowy');
  await page.click('#crSave');
  await expect(page.locator('#crListView')).toBeVisible();
  await expect(page.locator('#crList li')).toHaveCount(1);
  expect(await game(page)).toMatchObject({ charIdx: 5, name: 'Testowy' });

  // eksport do ZIP i ponowny import: wszystkie 12 klatek na miejscu, nazwa wraca z character.json
  await page.evaluate(() => {                            // zapamiętujemy plik z eksportu, żeby wczytać go z powrotem
    const make = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (b: Blob | MediaSource) => { (window as unknown as { lastBlob: Blob }).lastBlob = b as Blob; return make(b); };
  });
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#crList li button', { hasText: 'ZIP' }).click()]);
  expect(download.suggestedFilename()).toBe('postac-testowy.zip');
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File([(window as unknown as { lastBlob: Blob }).lastBlob], 'postac-testowy.zip', { type: 'application/zip' }));
    const inp = document.getElementById('crFile') as HTMLInputElement;
    inp.files = dt.files;
    inp.dispatchEvent(new Event('change'));
  });
  await expect(page.locator('#crEditView')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#crName')).toHaveValue('Testowy');
  await expect(page.locator('#crFrames .cr-cell:not(.empty)')).toHaveCount(12);
  await expect(page.locator('#crEditMsg')).toContainText('12 z 12');
  await page.click('#crCancel');
  await page.click('#crClose');
  await expect(page.locator('#creator')).toBeHidden();

  // po przeładowaniu postać wraca z IndexedDB i da się nią grać
  await page.reload();
  await expect.poll(() => game(page).then((g) => g.name)).toBe('Testowy');
  expect((await game(page)).charIdx).toBe(5);
  await page.evaluate(() => { const g = (window as unknown as { __game: G }).__game; g.nickLater = true; g.start(); });
  await expect.poll(() => game(page).then((g) => g.state)).toBe('play');
  await page.waitForTimeout(500);
  expect(errors).toEqual([]);
});
