// Anonimowe konta urządzeń. Token ma postać „<id gracza>.<sekret>”; serwer zna tylko skrót SHA-256 sekretu.

function base64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** SHA-256 (hex) tekstu albo bajtów. */
export async function sha256hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Nowy sekret: 32 losowe bajty. */
export function newSecret(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SECRET = /^[A-Za-z0-9_-]{43}$/;

/** Rozbiera nagłówek „Authorization: Bearer <id>.<sekret>”; null, jeśli ma zły kształt. */
export function parseBearer(header: string | undefined): { id: string; secret: string } | null {
  const m = /^Bearer (.+)$/.exec(header ?? '');
  if (!m) return null;
  const [id, secret, ...rest] = m[1].split('.');
  if (rest.length || !UUID.test(id ?? '') || !SECRET.test(secret ?? '')) return null;
  return { id, secret };
}

/** Porównanie skrótów w stałym czasie (długości są zawsze równe – 64 znaki hex). */
export function sameHash(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ───────────────────────── hasła pokoi ─────────────────────────

/** Hasło pokoju: 4–32 znaki, bez znaków sterujących. Nie obcinamy spacji – hasło jest takie, jak je wpisano. */
export const PASS_MIN = 4, PASS_MAX = 32;
// Przy darmowym planie Workers (10 ms procesora na zapytanie) więcej iteracji nie zmieści się z resztą zapytania;
// przed zgadywaniem chroni głównie limit błędnych prób na pokój (app.ts).
const PBKDF2_ITERATIONS = 10_000;

export function checkPassword(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const p = raw.normalize('NFC'), len = [...p].length;
  return len >= PASS_MIN && len <= PASS_MAX && !/\p{Cc}/u.test(p) ? p : null;
}

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
const unhex = (s: string) => Uint8Array.from(s.match(/../g) ?? [], (h) => parseInt(h, 16));

/** Skrót hasła PBKDF2-SHA256 (hex) z daną solą (hex). */
export async function passwordHash(password: string, saltHex: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: unhex(saltHex) as Uint8Array<ArrayBuffer>, iterations: PBKDF2_ITERATIONS }, key, 256,
  );
  return hex(new Uint8Array(bits));
}

/** Nowa sól: 16 losowych bajtów (hex). */
export const newSalt = (): string => hex(crypto.getRandomValues(new Uint8Array(16)));
