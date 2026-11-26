// KREATOR → „Głowa z aparatu” w prawdziwej przeglądarce: aparat z udawanej kamery Chromium (obraz testowy bez twarzy),
// wczytanie MediaPipe i podpowiedź, wyłączenie aparatu po wyjściu, a bez aparatu – komunikat i zdjęcie z galerii.
// Samo wycinanie głowy z prawdziwej twarzy sprawdzają testy jednostkowe (tests/facefit.test.ts) na sztucznej siatce twarzy.
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

async function openCam(page: Page) {
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('stepjumper.prefs.v1', JSON.stringify({ lang: 'pl' })));
  await page.reload();
  await page.waitForFunction(() => !!(window as unknown as { __game?: unknown }).__game);
  await page.evaluate(() => (window as unknown as { __game: { openCreator(): void } }).__game.openCreator());
  await page.click('#crCam');
  await expect(page.locator('#crCamView')).toBeVisible();
}

test.use({
  permissions: ['camera'],
  launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
});

test.describe('z aparatem', () => {
  test('podgląd z aparatu, podpowiedź bez twarzy i wyłączenie aparatu po Anuluj', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await openCam(page);
    await expect(page.locator('#camHint')).toHaveText('Pokaż twarz w owalu', { timeout: 25000 });   // modele wczytane, pętla działa
    expect(await page.evaluate(() => (document.getElementById('camVideo') as HTMLVideoElement).videoWidth)).toBeGreaterThan(0);
    await expect(page.locator('#camShot')).toBeDisabled();
    await page.click('#camCancel');
    await expect(page.locator('#crListView')).toBeVisible();
    expect(await page.evaluate(() => (document.getElementById('camVideo') as HTMLVideoElement).srcObject)).toBeNull();
    expect(errors).toEqual([]);
  });
});

test('bez aparatu: komunikat, a zdjęcie z galerii bez twarzy – czytelny błąd', async ({ page }) => {
  await page.addInitScript(() => {                       // urządzenie bez kamery
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('brak', 'NotFoundError'));
  });
  await openCam(page);
  await expect(page.locator('#camHint')).toContainText(/aparat/i, { timeout: 15000 });
  await expect(page.locator('#camShot')).toBeHidden();
  await page.evaluate(async () => {                       // jednolity obrazek – nie ma na nim twarzy
    const c = document.createElement('canvas'); c.width = 320; c.height = 240;
    const x = c.getContext('2d')!; x.fillStyle = '#4a7'; x.fillRect(0, 0, 320, 240);
    const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/png'));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], 'zdjecie.png', { type: 'image/png' }));
    const inp = document.getElementById('camFile') as HTMLInputElement;
    inp.files = dt.files;
    inp.dispatchEvent(new Event('change'));
  });
  await expect(page.locator('#camHint')).toHaveText('Nie widać twarzy. Spróbuj jeszcze raz albo wybierz inne zdjęcie.', { timeout: 25000 });
  await expect(page.locator('#camUse')).toBeHidden();
});
