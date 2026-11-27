// Stałe rozgrywki. Każda zmiana tutaj zmienia przebieg biegów, więc wymaga podbicia SIM_VERSION –
// serwer odtwarza zapis biegu tą samą wersją symulacji, którą grał gracz.
export const SIM_VERSION = 5;   // 2: mocniejsze sterowanie i hamowanie w locie (DEFAULT_TUNE); 3: booster wyrzutu i spowolnienie wieży; 4: piętra węższe co 100 pięter; 5: koniec czasu wyścigu (timeUp) zalicza combo

export const W = 640, H = 480;
export const WALL = 96, LEFT = WALL, RIGHT = W - WALL, FIELD = RIGHT - LEFT;
export const GAP = 80;             // odstęp pięter
export const PLAT_H = 18;
/**
 * Zwężanie pięter: piętro to 4–9 klocków; klocek ma BLOCK px i co NARROW_EVERY pięter traci NARROW_BY px,
 * aż do NARROW_MAX stopni (piętra 0–99: 128–288 px, od 800. piętra: 64–144 px). Co 50. piętro zostaje na całą szerokość.
 */
export const BLOCK = 32;
export const NARROW_EVERY = 100;
export const NARROW_BY = 2;
export const NARROW_MAX = 8;
export const TICK_RATE = 120;      // kroków fizyki na sekundę
export const STEP = 1 / TICK_RATE;
export const HW = 13;              // połowa szerokości bohatera (ściany)
export const FOOT = 9;             // połowa szerokości stóp (krawędzie platform)
export const HERO_H = 58;
export const FOLLOW = 170;         // kamera goni bohatera powyżej tej linii ekranu
export const START_FLOOR = 5;      // od tego piętra wieża zaczyna się przesuwać
export const HURRY_EVERY = 30;     // sekundy – pełny obrót zegara
export const MAX_HURRIES = 5;      // po piątym obrocie zegar staje, tempo już nie rośnie
export const COMBO_TIME = 3;       // sekundy na kolejny skok w combo
export const AXIS_MAX = 8;         // oś sterowania to liczba całkowita −8…8 (klawisze dają ±8, przechył także poziomy pośrednie)

export const P = {
  accel: 760, turn: 1.8, maxVx: 580,
  fricGround: 900,
  gravity: 1900, maxFall: 1150,
  jumpBase: 620, jumpBoost: 700,   // skok tym wyższy, im szybszy bieg (krzywa: jumpCurve)
  spinAt: 0.42,
} as const;

/**
 * Sterowność w locie. Te dwie liczby są częścią stanu symulacji (SimState.tune), a nie stałymi, bo w trybie DEV
 * stroi się je suwakami w trakcie gry. Zapis biegu odtwarza się poprawnie tylko z tym samym strojeniem.
 * Zmiana DEFAULT_TUNE zmienia rozgrywkę: wymaga podbicia SIM_VERSION i odświeżenia złotych biegów.
 */
export interface Tune {
  airAccel: number;   // px/s² – siła sterowania w powietrzu (na ziemi działa P.accel)
  airBrake: number;   // px/s² – wytracanie prędkości w powietrzu, gdy gracz nic nie trzyma (na ziemi P.fricGround)
}
/** Fizyka lotu z pierwszej wersji gry: w powietrzu ta sama siła co na ziemi i prawie żadnego hamowania. */
export const LEGACY_TUNE: Tune = { airAccel: 760, airBrake: 200 };
/** Strojenie gry (od SIM_VERSION 2): 140% siły sterowania i trzykrotnie mocniejsze hamowanie po puszczeniu. */
export const DEFAULT_TUNE: Tune = { airAccel: 1064, airBrake: 600 };

/** Ułamek dystansu do bohatera, który kamera nadrabia w jednym kroku: 1 − e^(−7·STEP). Wpisany jako stała, żeby nie zależeć od Math.exp. */
export const CAM_LERP = 0.05666455012650784;

// ── przedmioty do złapania w locie ──
// Oba wiszą w powietrzu w połowie odstępu między piętrami n i n+1; łapie się je tylko w locie (nie stojąc na piętrze).
export const ITEM_R = 13;            // promień przedmiotu (px)
export const ITEM_LIFT = 32;         // środek przedmiotu wisi tyle px nad piętrem n (wolne miejsce między piętrami to 62 px)

/** Booster wyrzutu: wyrzuca bohatera o BOOST_FLOORS pięter w górę; wylądować trzeba samemu. */
export const BOOST_FIRST = 30;       // pierwszy booster wisi nad piętrem 30…30+BOOST_FIRST_SPREAD−1
export const BOOST_FIRST_SPREAD = 11;
export const BOOST_GAP = 50;         // kolejne co BOOST_GAP…BOOST_GAP+BOOST_GAP_SPREAD−1 pięter
export const BOOST_GAP_SPREAD = 41;
export const BOOST_FLOORS = 30;
export const BOOST_SPEED = 1500;     // px/s – stała prędkość wznoszenia, grawitacja w tym czasie nie działa
export const BOOST_EXIT = 760;       // px/s – prędkość w chwili wyłączenia; dalej zwykła grawitacja: szczyt 760²/(2·1900) = 152 px wyżej
export const BOOST_COAST = 152;      // = BOOST_EXIT² / (2 · P.gravity), wpisane wprost (bez dzielenia w pętli)

/** Spowolnienie: od SLOW_FROM piętra co SLOW_EVERY s pojawia się przedmiot, który na SLOW_TIME s zwalnia wieżę o połowę. */
export const SLOW_FROM = 400;
export const SLOW_EVERY = 15;
export const SLOW_TIME = 5;
export const SLOW_FACTOR = 0.5;
/** Spowolnienie nie pojawia się bliżej niż tyle pięter od czekającego boostera (ekran mieści ~6 pięter). */
export const ITEM_SEPARATION = 15;
