// ZASADY GRY (przycisk pod NOWOŚCIAMI na ekranie tytułowym): dokładny opis mechaniki dla gracza.
// Teksty są w strings.js (klucze rules.<sekcja> i rules.<sekcja>.1…n), a liczby w nich – {zmienne} – biorą się
// wprost ze stałych symulacji, więc po zmianie src/sim/constants.ts opis sam się zgadza. Zmiana zasad w src/sim/
// (np. inne punktowanie combo) wymaga poprawienia tekstów we wszystkich pięciu językach.
import {
  BOOST_FIRST, BOOST_FIRST_SPREAD, BOOST_FLOORS, BOOST_GAP, BOOST_GAP_SPREAD, COMBO_TIME, GAP, HURRY_EVERY, MAX_HURRIES, NARROW_EVERY, NARROW_MAX,
  P, SLOW_EVERY, SLOW_FROM, SLOW_TIME, START_FLOOR, jumpCurve,
} from '../sim';
import { VODKA_FROM } from './drinks.js';
import { t } from './i18n.js';

/** @type {[string, number][]} ZASADY GRY: sekcja → liczba punktów (klucze 'rules.<sekcja>' i 'rules.<sekcja>.1…n' w strings.js). */
export const RULES = [['goal', 4], ['move', 5], ['floors', 3], ['score', 2], ['combo', 4], ['items', 4], ['rank', 2]];

/** Wysokość skoku w piętrach przy rozpędzie k (0…1): szczyt lotu v²/2g, pełne piętra. */
export const jumpFloors = (k) => Math.floor((P.jumpBase + P.jumpBoost * jumpCurve(k)) ** 2 / (2 * P.gravity) / GAP);

/** Liczby w zasadach brane wprost ze stałych symulacji – opis nie rozjedzie się z rozgrywką. */
export const RULE_VARS = {
  start: START_FLOOR, every: HURRY_EVERY, maxTempo: MAX_HURRIES + 1, jumpMin: jumpFloors(0), jumpMax: jumpFloors(1),
  narrowEvery: NARROW_EVERY, narrowEnd: NARROW_EVERY * NARROW_MAX, comboT: COMBO_TIME,
  boostA: BOOST_FIRST, boostB: BOOST_FIRST + BOOST_FIRST_SPREAD - 1, gapA: BOOST_GAP, gapB: BOOST_GAP + BOOST_GAP_SPREAD - 1,
  boostFloors: BOOST_FLOORS, slowFrom: SLOW_FROM, slowEvery: SLOW_EVERY, slowTime: SLOW_TIME,
  vodkaFrom: VODKA_FROM,                                // wyjątek spoza symulacji: piwo czy wódka to tylko wygląd (drinks.js)
};

/** Teksty zasad w bieżącym języku: [[nagłówek, [punkty…]], …]. */
export const rulesText = () => RULES.map(([k, n]) => [t(`rules.${k}`), Array.from({ length: n }, (_, i) => t(`rules.${k}.${i + 1}`, RULE_VARS))]);
