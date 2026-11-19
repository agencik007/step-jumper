// Nick gracza: 3–16 znaków, litery alfabetu łacińskiego (także z ogonkami), cyfry 0–9, „_”, „-” i pojedyncze spacje.
// Tylko alfabet łaciński, bo litery innych pism (np. cyrylickie „А”) wyglądają identycznie i pozwalałyby
// podszyć się pod cudzy nick albo obejść filtr wulgaryzmów.

export type NickCheck = { ok: true; nick: string; key: string } | { ok: false; reason: 'length' | 'chars' | 'blocked' };

const WORDS = /^[\p{Script=Latin}0-9_-]+( [\p{Script=Latin}0-9_-]+)*$/u;

// Rdzenie słów niedozwolonych w nicku, sprawdzane w tekście po normalizacji (bez spacji, cyfr-„liter” i ogonków).
// Lista jest celowo krótka: szukamy fragmentu w środku słowa, więc każdy krótki rdzeń blokowałby też zwykłe słowa.
const BLOCKED = [
  'kurw', 'chuj', 'pierdol', 'pizd', 'jeban', 'jebac', 'jebie', 'jebn', 'cwel', 'szmat', 'dziwk',
  'fuck', 'nigger', 'nigga', 'faggot', 'hitler',
  'admin', 'moderator', 'stepjumper',
];
const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's' };

function squash(s: string): string {
  return s.toLowerCase()
    .replace(/ł/g, 'l')
    .normalize('NFD').replace(/\p{M}/gu, '')
    .replace(/[0-9@$]/g, (c) => LEET[c] ?? '')
    .replace(/[^a-z]/g, '');
}

export function checkNick(raw: unknown): NickCheck {
  if (typeof raw !== 'string') return { ok: false, reason: 'chars' };
  const nick = raw.normalize('NFC').trim();
  const len = [...nick].length;
  if (len < 3 || len > 16) return { ok: false, reason: 'length' };
  if (!WORDS.test(nick)) return { ok: false, reason: 'chars' };
  const flat = squash(nick);
  if (BLOCKED.some((w) => flat.includes(w))) return { ok: false, reason: 'blocked' };
  return { ok: true, nick, key: nick.toLowerCase() };
}
