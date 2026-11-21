// Sterowanie dotykiem na emulowanym telefonie: każdy tryb z OPCJE → STEROWANIE, układ leworęczny i własny układ przycisków.
// Dotyk idzie przez CDP (Input.dispatchTouchEvent), więc przeglądarka sama tworzy zdarzenia pointer – jak na telefonie.
// Stan gry czytamy z window.__game (tylko w trybie DEV).
import { expect, test } from '@playwright/test';
import type { CDPSession, Page } from '@playwright/test';

type Hero = { x: number; y: number; vx: number; onFloor: number };
declare global {
  interface Window { __game: { state: string; nickLater: boolean; start(): void; sim: { hero: Hero } } }
}

/**
 * Gra z zapisanymi ustawieniami (prefs jak w localStorage gry), od razu w biegu. before – co zrobić na ekranie tytułowym
 * przed startem (np. dotknąć ekranu, żeby przeglądarka dała dostęp do czujnika ruchu).
 */
async function play(page: Page, prefs: Record<string, unknown>, before?: () => Promise<void>): Promise<CDPSession> {
  await page.goto('/');
  await page.evaluate((p) => localStorage.setItem('stepjumper.prefs.v1', JSON.stringify({ lang: 'pl', ...p })), prefs);
  await page.reload();
  await page.waitForFunction(() => !!window.__game);
  await before?.();
  await page.evaluate(() => { window.__game.nickLater = true; window.__game.start(); });   // bez okienka nicku
  await expect.poll(() => page.evaluate(() => window.__game.state)).toBe('play');
  return page.context().newCDPSession(page);
}

const hero = (page: Page) => page.evaluate(() => ({ ...window.__game.sim.hero }));
/** Środek elementu na ekranie. */
async function center(page: Page, sel: string) {
  const b = await page.locator(sel).first().boundingBox();
  if (!b) throw new Error(`brak elementu ${sel}`);
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/** Jeden palec na ekranie: down / move / up / tap (CDP kończy dotyk wszystkich palców naraz, więc testy używają jednego). */
function finger(cdp: CDPSession) {
  const send = (type: 'touchStart' | 'touchMove' | 'touchEnd', pts: { x: number; y: number }[]) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  return {
    down: (x: number, y: number) => send('touchStart', [{ x, y }]),
    move: (x: number, y: number) => send('touchMove', [{ x, y }]),
    up: () => send('touchEnd', []),
    tap: async (x: number, y: number) => { await send('touchStart', [{ x, y }]); await send('touchEnd', []); },
  };
}

/** Bieg w prawo: bohater przesuwa się wyraźnie od środka. */
const ranRight = async (page: Page, x0: number) => expect.poll(async () => (await hero(page)).x, { timeout: 3000 }).toBeGreaterThan(x0 + 30);
const ranLeft = async (page: Page, x0: number) => expect.poll(async () => (await hero(page)).x, { timeout: 3000 }).toBeLessThan(x0 - 30);
/** Skok: bohater oderwał się od piętra. */
const jumped = async (page: Page) => expect.poll(async () => (await hero(page)).onFloor, { timeout: 3000 }).toBe(-1);

test('przyciski ekranowe: ▶ – bieg w prawo, ▲ – skok', async ({ page }) => {
  const f = finger(await play(page, { control: 'buttons' }));
  const x0 = (await hero(page)).x;
  const right = await center(page, '#padL [data-act=right]');
  await f.down(right.x, right.y);
  await ranRight(page, x0);
  await f.up();
  const jump = await center(page, '#padR button');
  await f.tap(jump.x, jump.y);
  await jumped(page);
});

test('połówki ekranu: prawa połowa – bieg w prawo, ▲ w rogu – skok', async ({ page }) => {
  const f = finger(await play(page, { control: 'halves' }));
  const vp = page.viewportSize()!, x0 = (await hero(page)).x;
  await f.down(vp.width * 0.75, vp.height * 0.4);
  await ranRight(page, x0);
  await f.up();
  const jump = await center(page, '#padJ button');
  await f.tap(jump.x, jump.y);
  await jumped(page);
});

test('machnięcie: lewa połowa – bieg w lewo, palec w górę – skok', async ({ page }) => {
  const f = finger(await play(page, { control: 'swipe' }));
  const vp = page.viewportSize()!, x0 = (await hero(page)).x;
  const x = vp.width * 0.25, y = vp.height * 0.7;
  await f.down(x, y);
  await ranLeft(page, x0);
  for (let i = 1; i <= 5; i++) await f.move(x, y - i * 10);
  await jumped(page);
  await f.up();
});

test('gałka: przesunięcie w prawo – bieg, druga połowa – skok', async ({ page }) => {
  const f = finger(await play(page, { control: 'joystick' }));
  const vp = page.viewportSize()!, x0 = (await hero(page)).x;
  const x = vp.width * 0.2, y = vp.height * 0.7;
  await f.down(x, y);
  for (let i = 1; i <= 6; i++) await f.move(x + i * 10, y);
  await ranRight(page, x0);
  await f.up();
  await f.tap(vp.width * 0.8, vp.height * 0.4);
  await jumped(page);
});

test('przechył: wychylenie telefonu – bieg, dotknięcie – skok', async ({ page, context }) => {
  await context.grantPermissions(['accelerometer', 'gyroscope', 'magnetometer']);   // zgoda na czujnik ruchu
  // czujnik od startu strony (gra bez odczytu przez 1,5 s wraca do przycisków): co 30 ms telefon wychylony o 20°
  // – w pionie i w poziomie wychodzi tak samo „w prawo”
  await page.addInitScript(() => {
    setInterval(() => dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: 0, beta: 20, gamma: 20 })), 30);
  });
  // przeglądarka z DeviceOrientationEvent.requestPermission (jak iOS) pyta o czujnik dopiero po dotknięciu ekranu
  const cdp = await play(page, { control: 'tilt' }, async () => {
    const box = (await page.locator('#game').boundingBox())!;
    await page.touchscreen.tap(box.x + box.width / 2, box.y + 20);
    await expect.poll(() => page.evaluate(() => (window as unknown as { __tilt: { state: { active: boolean } } }).__tilt.state.active)).toBe(true);
  });
  const x0 = (await hero(page)).x;
  await ranRight(page, x0);
  const vp = page.viewportSize()!;
  await finger(cdp).tap(vp.width / 2, vp.height / 2);
  await jumped(page);
});

test('jeden przycisk: bohater biegnie sam, dotknięcie – skok', async ({ page }) => {
  const f = finger(await play(page, { control: 'one' }));
  const x0 = (await hero(page)).x;
  await expect.poll(async () => Math.abs((await hero(page)).x - x0), { timeout: 3000 }).toBeGreaterThan(30);
  const vp = page.viewportSize()!;
  await f.tap(vp.width / 2, vp.height / 2);
  await jumped(page);
});

test('układ leworęczny: skok po lewej, ◀ ▶ po prawej', async ({ page }) => {
  await play(page, { control: 'buttons', lefty: true });
  const jump = await center(page, '#padR button'), right = await center(page, '#padL [data-act=right]');
  const vp = page.viewportSize()!;
  expect(jump.x).toBeLessThan(vp.width / 2);
  expect(right.x).toBeGreaterThan(vp.width / 2);
});

test('własny układ i rozmiar przycisków z opcji', async ({ page }) => {
  await play(page, { control: 'buttons', pads: { size: 8, alpha: 4, pos: { jump: { x: 0.5, y: 0.5 } } } });
  const vp = page.viewportSize()!, jump = await center(page, '#padR button');
  expect(Math.abs(jump.x - vp.width / 2)).toBeLessThan(2);
  expect(Math.abs(jump.y - vp.height / 2)).toBeLessThan(2);
  const box = (await page.locator('#padR button').boundingBox())!;
  expect(box.width).toBeCloseTo(76 * 1.4, 0);           // rozmiar 140%
});
