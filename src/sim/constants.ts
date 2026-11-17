// Stałe rozgrywki. Każda zmiana tutaj zmienia przebieg biegów, więc wymaga podbicia SIM_VERSION –
// serwer odtwarza zapis biegu tą samą wersją symulacji, którą grał gracz.
export const SIM_VERSION = 1;

export const W = 640, H = 480;
export const WALL = 96, LEFT = WALL, RIGHT = W - WALL, FIELD = RIGHT - LEFT;
export const GAP = 80;             // odstęp pięter
export const PLAT_H = 18;
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
  fricGround: 900, fricAir: 200,
  gravity: 1900, maxFall: 1150,
  jumpBase: 620, jumpBoost: 700,   // skok tym wyższy, im szybszy bieg (krzywa: jumpCurve)
  spinAt: 0.42,
} as const;

/** Ułamek dystansu do bohatera, który kamera nadrabia w jednym kroku: 1 − e^(−7·STEP). Wpisany jako stała, żeby nie zależeć od Math.exp. */
export const CAM_LERP = 0.05666455012650784;
