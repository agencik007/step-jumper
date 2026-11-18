// Anonimowe konta urządzeń. Token ma postać „<id gracza>.<sekret>”; serwer zna tylko skrót SHA-256 sekretu.

function base64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sha256hex(text: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
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
