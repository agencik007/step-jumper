// Piwo i wódka – wygląd boostera wyrzutu (sim.ts → boost) i śmieszne teksty po złapaniu. Czysto wizualne: symulacja
// liczy jeden i ten sam booster, więc VODKA_FROM nie zmienia rozgrywki ani zapisu biegu (dlatego nie siedzi w src/sim/).
import { t } from './i18n.js';

/** Od tego piętra (nad którym wisi booster) zamiast piwa jest wódka. */
export const VODKA_FROM = 200;
/** Ile tekstów ma każdy napój (klucze drink.<napój>.1…n w strings.js). */
export const DRINK_LINES = { beer: 4, vodka: 5 };

/** Napój boostera wiszącego nad piętrem n. */
export const drinkAt = (n) => (n >= VODKA_FROM ? 'vodka' : 'beer');

/**
 * Napis po złapaniu: { title, sub }. n – który to już ten napój w biegu (od 1): teksty po kolei coraz bardziej
 * zatroskane, a gdy się skończą – losowo któryś.
 */
export function drinkSay(kind, n) {
  const len = DRINK_LINES[kind];
  const i = n <= len ? n : 1 + Math.floor(Math.random() * len);
  return { title: t(`drink.${kind}`), sub: t(`drink.${kind}.${i}`) };
}
