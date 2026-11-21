// Lista zmian (ekran NOWOŚCI). Najnowsza wersja na górze; pierwszy wpis musi mieć wersję z package.json
// (pilnuje tego tests/changelog.test.ts). Zasady dopisywania – CLAUDE.md, sekcja „Wersje i lista zmian”.
//
// Wpis: { v: 'x.y.z', date: 'RRRR-MM-DD', pl: [...], en: [...], de: [...], fr: [...], es: [...] }
// Każdy język ma tyle samo punktów, w tej samej kolejności. Tylko to, co zauważy gracz – bez spraw deweloperskich.
export const CHANGELOG = [
  {
    v: '0.13.0', date: '2026-11-21',
    pl: [
      'Gra sama zauważa nową wersję – na ekranie tytułowym pojawia się przycisk PRZEŁADUJ.',
      'Przycisk NOWOŚCI: lista najważniejszych zmian w każdej wersji.',
      'Numer wersji gry w lewym dolnym rogu ekranu tytułowego.',
    ],
    en: [
      'The game notices when a new version is out – a RELOAD button appears on the title screen.',
      'WHAT’S NEW button: the most important changes in every version.',
      'The game’s version number in the bottom left corner of the title screen.',
    ],
    de: [
      'Das Spiel erkennt neue Versionen selbst – auf dem Titelbildschirm erscheint NEU LADEN.',
      'NEUIGKEITEN-Taste: die wichtigsten Änderungen jeder Version.',
      'Die Versionsnummer steht unten links auf dem Titelbildschirm.',
    ],
    fr: [
      'Le jeu repère tout seul une nouvelle version – un bouton RECHARGER apparaît sur l’écran titre.',
      'Bouton NOUVEAUTÉS : les changements les plus importants de chaque version.',
      'Le numéro de version du jeu en bas à gauche de l’écran titre.',
    ],
    es: [
      'El juego detecta solo una versión nueva: en la pantalla de título aparece el botón RECARGAR.',
      'Botón NOVEDADES: los cambios más importantes de cada versión.',
      'El número de versión del juego, abajo a la izquierda en la pantalla de título.',
    ],
  },
  {
    v: '0.12.0', date: '2026-11-21',
    pl: [
      'Pełna obsługa pada: menu, pauza, ranking, powtórki i opcje bez myszy i klawiatury; ikony przycisków Xbox, PlayStation i Nintendo.',
      'Własne przypisania klawiszy i przycisków pada dla biegu, skoku i pauzy.',
      'Przyciski ekranowe: rozmiar, widoczność i własny układ – każdy przycisk da się przeciągnąć.',
      'Nowe asysty: skok przełącznikiem albo automatyczny, tryb „jeden przycisk” i wibracje w 4 stopniach, także na padzie.',
    ],
    en: [
      'Full gamepad support: menus, pause, ranking, replays and options without mouse or keyboard; Xbox, PlayStation and Nintendo button icons.',
      'Custom key and gamepad bindings for run, jump and pause.',
      'On-screen buttons: size, visibility and your own layout – drag any button anywhere.',
      'New assists: toggle or automatic jump, “one button” mode and 4-step vibration, also on gamepads.',
    ],
    de: [
      'Volle Gamepad-Unterstützung: Menüs, Pause, Rangliste, Wiederholungen und Optionen ohne Maus und Tastatur; Tastensymbole für Xbox, PlayStation und Nintendo.',
      'Eigene Tasten- und Gamepad-Belegung für Laufen, Springen und Pause.',
      'Bildschirmtasten: Größe, Sichtbarkeit und eigenes Layout – jede Taste lässt sich verschieben.',
      'Neue Hilfen: Sprung als Schalter oder automatisch, Modus „eine Taste“ und Vibration in 4 Stufen, auch am Gamepad.',
    ],
    fr: [
      'Manette entièrement prise en charge : menus, pause, classement, rediffusions et options sans souris ni clavier ; icônes Xbox, PlayStation et Nintendo.',
      'Touches et boutons de manette personnalisables pour courir, sauter et mettre en pause.',
      'Boutons à l’écran : taille, visibilité et disposition libre – chaque bouton se déplace au doigt.',
      'Nouvelles aides : saut en bascule ou automatique, mode « un bouton » et vibrations sur 4 niveaux, aussi à la manette.',
    ],
    es: [
      'Soporte completo de mando: menús, pausa, ranking, repeticiones y opciones sin ratón ni teclado; iconos de Xbox, PlayStation y Nintendo.',
      'Teclas y botones del mando configurables para correr, saltar y pausar.',
      'Botones en pantalla: tamaño, visibilidad y disposición propia: arrastra cualquier botón.',
      'Nuevas ayudas: salto con interruptor o automático, modo «un botón» y vibración en 4 niveles, también en el mando.',
    ],
  },
  {
    v: '0.11.0', date: '2026-11-21',
    pl: [
      'Pięć trybów sterowania dotykiem: przyciski, połówki ekranu z przyciskiem skoku, połówki z machnięciem w górę, gałka i przechył.',
      'Przechył telefonu z suwakiem czułości (9 stopni).',
      'Tryb sterowania zmienisz w OPCJACH → STEROWANIE albo prosto z ekranu tytułowego.',
    ],
    en: [
      'Five touch control modes: buttons, screen halves with a jump button, screen halves with a swipe up, joystick and tilt.',
      'Phone tilt with a sensitivity slider (9 steps).',
      'Change the control mode in OPTIONS → CONTROLS or straight from the title screen.',
    ],
    de: [
      'Fünf Touch-Steuerungen: Tasten, Bildschirmhälften mit Sprungtaste, Bildschirmhälften mit Wischen nach oben, Stick und Neigen.',
      'Neigen des Handys mit Empfindlichkeitsregler (9 Stufen).',
      'Die Steuerung wechselst du unter OPTIONEN → STEUERUNG oder direkt auf dem Titelbildschirm.',
    ],
    fr: [
      'Cinq modes tactiles : boutons, moitiés d’écran avec bouton de saut, moitiés d’écran avec glissement vers le haut, joystick et inclinaison.',
      'Inclinaison du téléphone avec réglage de sensibilité (9 niveaux).',
      'Changez de mode dans OPTIONS → COMMANDES ou directement depuis l’écran titre.',
    ],
    es: [
      'Cinco modos táctiles: botones, mitades de pantalla con botón de salto, mitades con deslizar hacia arriba, joystick e inclinación.',
      'Inclinación del móvil con control de sensibilidad (9 niveles).',
      'Cambia el modo en OPCIONES → CONTROL o directamente desde la pantalla de título.',
    ],
  },
  {
    v: '0.10.1', date: '2026-11-21',
    pl: ['Nagrody najlepszej trójki są spokojniejsze: bez okrzyku „WOW” i fali uderzeniowej. Korony i iskry przy ścianach zostają.'],
    en: ['Calmer top-three rewards: no more “WOW” shout or shockwave. Crowns and wall sparks stay.'],
    de: ['Ruhigere Belohnungen für die Top 3: kein „WOW“-Ruf und keine Druckwelle mehr. Kronen und Funken an den Wänden bleiben.'],
    fr: ['Récompenses du top 3 plus discrètes : plus de cri « WOW » ni d’onde de choc. Les couronnes et les étincelles contre les murs restent.'],
    es: ['Premios del top 3 más tranquilos: sin el grito «WOW» ni la onda expansiva. Las coronas y las chispas en las paredes se quedan.'],
  },
  {
    v: '0.10.0', date: '2026-11-21',
    pl: [
      'Korony dla najlepszej trójki tygodnia – złota, srebrna i brązowa – noszone przez cały następny tydzień.',
      'Powtórki biegów najlepszej trójki: start, pauza, stop i tempo 1× / 2× / 4×.',
      'Ranking domyślnie tygodniowy i nowa zakładka ZESZŁY TYDZIEŃ.',
      'Raz w tygodniu podsumowanie: podium z powtórkami i twoje miejsce.',
    ],
    en: [
      'Crowns for the week’s top three – gold, silver and bronze – worn for the whole next week.',
      'Replays of the top three runs: play, pause, stop and 1× / 2× / 4× speed.',
      'The ranking opens on the weekly tab, plus a new LAST WEEK tab.',
      'A weekly recap: the podium with replays and your own place.',
    ],
    de: [
      'Kronen für die Top 3 der Woche – Gold, Silber und Bronze – die ganze nächste Woche lang.',
      'Wiederholungen der Top-3-Läufe: Start, Pause, Stopp und Tempo 1× / 2× / 4×.',
      'Die Rangliste öffnet mit der Woche, dazu der neue Reiter LETZTE WOCHE.',
      'Einmal pro Woche eine Zusammenfassung: Podium mit Wiederholungen und dein Platz.',
    ],
    fr: [
      'Des couronnes pour le top 3 de la semaine – or, argent et bronze – portées toute la semaine suivante.',
      'Rediffusions des parties du top 3 : lecture, pause, stop et vitesse 1× / 2× / 4×.',
      'Le classement s’ouvre sur la semaine, avec un nouvel onglet SEMAINE DERNIÈRE.',
      'Un bilan hebdomadaire : le podium avec rediffusions et votre place.',
    ],
    es: [
      'Coronas para el top 3 de la semana – oro, plata y bronce – durante toda la semana siguiente.',
      'Repeticiones de las partidas del top 3: reproducir, pausa, stop y velocidad 1× / 2× / 4×.',
      'El ranking se abre en la pestaña semanal y hay una nueva: SEMANA PASADA.',
      'Un resumen semanal: el podio con repeticiones y tu puesto.',
    ],
  },
  {
    v: '0.9.1', date: '2026-11-21',
    pl: ['Gdy serwer rankingu jest akurat aktualizowany, gra mówi o tym i sama wraca do rankingu – zamiast błędnie prosić o aktualizację gry.'],
    en: ['While the ranking server is being updated, the game says so and rejoins the ranking by itself – instead of wrongly asking you to update the game.'],
    de: ['Wird der Ranglisten-Server gerade aktualisiert, sagt das Spiel es und kehrt von selbst zur Rangliste zurück – statt fälschlich ein Spiel-Update zu verlangen.'],
    fr: ['Pendant la mise à jour du serveur de classement, le jeu le signale et revient seul au classement – au lieu de vous demander à tort de mettre le jeu à jour.'],
    es: ['Mientras se actualiza el servidor del ranking, el juego lo indica y vuelve solo al ranking, en lugar de pedirte por error que actualices el juego.'],
  },
  {
    v: '0.9.0', date: '2026-11-20',
    pl: ['Układ przycisków dla leworęcznych: skok pod lewym kciukiem, ◀ ▶ pod prawym (OPCJE).'],
    en: ['Left-handed button layout: jump under your left thumb, ◀ ▶ under your right (OPTIONS).'],
    de: ['Tastenlayout für Linkshänder: Sprung unter dem linken Daumen, ◀ ▶ unter dem rechten (OPTIONEN).'],
    fr: ['Disposition pour gauchers : saut sous le pouce gauche, ◀ ▶ sous le pouce droit (OPTIONS).'],
    es: ['Disposición para zurdos: salto bajo el pulgar izquierdo, ◀ ▶ bajo el derecho (OPCIONES).'],
  },
  {
    v: '0.8.0', date: '2026-11-20',
    pl: [
      'Piętra coraz węższe: co 100 pięter klocki się kurczą, aż do 800. piętra. Gra ostrzega napisem „WĘŻSZE PIĘTRA!”.',
      'Co 50. piętro nadal ma całą szerokość.',
    ],
    en: [
      'Floors keep getting narrower: every 100 floors the blocks shrink, up to floor 800. The game warns you with “NARROWER FLOORS!”.',
      'Every 50th floor still spans the full width.',
    ],
    de: [
      'Immer schmalere Etagen: alle 100 Etagen schrumpfen die Blöcke, bis Etage 800. Das Spiel warnt mit „SCHMALERE ETAGEN!“.',
      'Jede 50. Etage bleibt weiterhin über die ganze Breite.',
    ],
    fr: [
      'Des étages de plus en plus étroits : tous les 100 étages, les blocs rétrécissent, jusqu’à l’étage 800. Le jeu prévient par « ÉTAGES PLUS ÉTROITS ! ».',
      'Un étage sur 50 reste sur toute la largeur.',
    ],
    es: [
      'Pisos cada vez más estrechos: cada 100 pisos los bloques encogen, hasta el piso 800. El juego avisa con «¡PISOS MÁS ESTRECHOS!».',
      'Cada piso 50 sigue ocupando todo el ancho.',
    ],
  },
  {
    v: '0.7.0', date: '2026-11-20',
    pl: [
      'Booster wyrzutu: złapany w locie zalicza combo i wyrzuca ok. 30 pięter w górę.',
      'Od 400. piętra klepsydra – zwalnia wieżę o połowę na 5 sekund.',
      'Przed pierwszą grą w rankingu gra prosi o nick.',
      'Na Androidzie okienko „Zainstaluj grę”.',
    ],
    en: [
      'Launch booster: catch it mid-air to bank your combo and get thrown about 30 floors up.',
      'From floor 400 an hourglass appears – it slows the tower down by half for 5 seconds.',
      'Before your first ranked game, the game asks for a nickname.',
      'On Android, an “Install the game” prompt.',
    ],
    de: [
      'Start-Booster: in der Luft gefangen, zählt er die Combo und schleudert dich etwa 30 Etagen hoch.',
      'Ab Etage 400 eine Sanduhr – sie bremst den Turm 5 Sekunden lang auf die Hälfte.',
      'Vor dem ersten Ranglistenspiel fragt das Spiel nach einem Nickname.',
      'Auf Android ein Fenster „Spiel installieren“.',
    ],
    fr: [
      'Booster d’éjection : attrapé en vol, il valide votre combo et vous projette d’environ 30 étages.',
      'Dès l’étage 400, un sablier – il ralentit la tour de moitié pendant 5 secondes.',
      'Avant votre première partie classée, le jeu vous demande un pseudo.',
      'Sur Android, une fenêtre « Installer le jeu ».',
    ],
    es: [
      'Propulsor: atrápalo en el aire para sumar el combo y salir disparado unos 30 pisos hacia arriba.',
      'Desde el piso 400 aparece un reloj de arena: frena la torre a la mitad durante 5 segundos.',
      'Antes de tu primera partida en el ranking, el juego te pide un apodo.',
      'En Android, una ventana «Instalar el juego».',
    ],
  },
  {
    v: '0.6.0', date: '2026-11-20',
    pl: [
      'Pauza: przycisk ⏸ w rogu albo klawisz P; z pauzy można wrócić do menu.',
      'Muzyka, która przyspiesza razem z wieżą (osobny przełącznik w OPCJACH).',
      'Na iPhonie instrukcja „Do ekranu początkowego”, żeby grać na pełnym ekranie.',
    ],
    en: [
      'Pause: the ⏸ button in the corner or the P key; from pause you can go back to the menu.',
      'Music that speeds up with the tower (its own switch in OPTIONS).',
      'On iPhone, an “Add to Home Screen” guide for playing full screen.',
    ],
    de: [
      'Pause: die ⏸-Taste in der Ecke oder die Taste P; aus der Pause geht es zurück ins Menü.',
      'Musik, die mit dem Turm schneller wird (eigener Schalter in den OPTIONEN).',
      'Auf dem iPhone eine Anleitung „Zum Home-Bildschirm“ für Vollbild.',
    ],
    fr: [
      'Pause : le bouton ⏸ dans le coin ou la touche P ; depuis la pause, retour possible au menu.',
      'Une musique qui accélère avec la tour (interrupteur à part dans les OPTIONS).',
      'Sur iPhone, un guide « Sur l’écran d’accueil » pour jouer en plein écran.',
    ],
    es: [
      'Pausa: el botón ⏸ de la esquina o la tecla P; desde la pausa puedes volver al menú.',
      'Música que se acelera con la torre (interruptor propio en OPCIONES).',
      'En iPhone, una guía «Añadir a pantalla de inicio» para jugar a pantalla completa.',
    ],
  },
  {
    v: '0.5.0', date: '2026-11-20',
    pl: ['Pełny ekran: przycisk w prawym górnym rogu albo klawisz F; na telefonie ekran obraca się do poziomu.'],
    en: ['Full screen: the button in the top right corner or the F key; on phones the screen turns to landscape.'],
    de: ['Vollbild: die Taste oben rechts oder die Taste F; auf dem Handy dreht sich der Bildschirm ins Querformat.'],
    fr: ['Plein écran : le bouton en haut à droite ou la touche F ; sur téléphone, l’écran passe en paysage.'],
    es: ['Pantalla completa: el botón de arriba a la derecha o la tecla F; en el móvil la pantalla gira a horizontal.'],
  },
  {
    v: '0.4.0', date: '2026-11-19',
    pl: [
      'Rankingi online: dzienny, tygodniowy i ogólny, z własnym nickiem.',
      'Każdy bieg sprawdza serwer, więc ranking jest uczciwy.',
      'Gra w pięciu językach: polskim, angielskim, niemieckim, francuskim i hiszpańskim.',
      'Wibracje na telefonie.',
    ],
    en: [
      'Online rankings: daily, weekly and all-time, with your own nickname.',
      'The server checks every run, so the ranking is fair.',
      'The game in five languages: Polish, English, German, French and Spanish.',
      'Vibration on phones.',
    ],
    de: [
      'Online-Ranglisten: Tag, Woche und gesamt, mit eigenem Nickname.',
      'Der Server prüft jeden Lauf, darum ist die Rangliste fair.',
      'Das Spiel in fünf Sprachen: Polnisch, Englisch, Deutsch, Französisch und Spanisch.',
      'Vibration auf dem Handy.',
    ],
    fr: [
      'Classements en ligne : du jour, de la semaine et général, avec votre pseudo.',
      'Le serveur vérifie chaque partie, le classement est donc équitable.',
      'Le jeu en cinq langues : polonais, anglais, allemand, français et espagnol.',
      'Vibrations sur téléphone.',
    ],
    es: [
      'Rankings en línea: diario, semanal y total, con tu propio apodo.',
      'El servidor comprueba cada partida, así que el ranking es justo.',
      'El juego en cinco idiomas: polaco, inglés, alemán, francés y español.',
      'Vibración en el móvil.',
    ],
  },
  {
    v: '0.3.0', date: '2026-11-18',
    pl: ['Lepsze sterowanie w locie: mocniejszy skręt w powietrzu i szybsze hamowanie po puszczeniu kierunku.'],
    en: ['Better air control: stronger steering mid-air and quicker braking when you let go.'],
    de: ['Bessere Steuerung in der Luft: stärkeres Lenken und schnelleres Bremsen beim Loslassen.'],
    fr: ['Meilleur contrôle en l’air : direction plus forte en vol et freinage plus rapide quand vous relâchez.'],
    es: ['Mejor control en el aire: giro más fuerte en vuelo y frenada más rápida al soltar.'],
  },
  {
    v: '0.2.0', date: '2026-11-17',
    pl: ['Nowy silnik pod spodem: każdy bieg można dokładnie odtworzyć – przygotowanie do rankingów online.'],
    en: ['A new engine under the hood: every run can be replayed exactly – groundwork for online rankings.'],
    de: ['Neue Technik unter der Haube: jeder Lauf lässt sich exakt nachspielen – Grundlage für Online-Ranglisten.'],
    fr: ['Un nouveau moteur sous le capot : chaque partie peut être rejouée à l’identique – la base des classements en ligne.'],
    es: ['Un motor nuevo por dentro: cada partida se puede reproducir exactamente, la base de los rankings en línea.'],
  },
  {
    v: '0.1.0', date: '2026-11-12',
    pl: [
      'Pierwsza wersja: wspinaczka po wieży, w której wysokość skoku zależy od rozpędu, i combo za skoki o kilka pięter.',
      '5 postaci i 5 map w różnych stylach graficznych.',
      'Gra instaluje się jako aplikacja i działa bez internetu.',
    ],
    en: [
      'First version: climb a tower where jump height depends on your speed, with combos for multi-floor jumps.',
      '5 characters and 5 maps in different art styles.',
      'Installs as an app and works offline.',
    ],
    de: [
      'Erste Version: Klettern auf einem Turm, bei dem die Sprunghöhe vom Tempo abhängt, mit Combos für Sprünge über mehrere Etagen.',
      '5 Figuren und 5 Karten in verschiedenen Grafikstilen.',
      'Lässt sich als App installieren und läuft offline.',
    ],
    fr: [
      'Première version : grimpez une tour où la hauteur du saut dépend de votre vitesse, avec des combos pour les sauts de plusieurs étages.',
      '5 personnages et 5 cartes aux styles graphiques différents.',
      'S’installe comme une appli et fonctionne hors ligne.',
    ],
    es: [
      'Primera versión: escala una torre donde la altura del salto depende de la velocidad, con combos por saltos de varios pisos.',
      '5 personajes y 5 mapas con estilos gráficos distintos.',
      'Se instala como app y funciona sin conexión.',
    ],
  },
];

/** Punkt listy na ekranie NOWOŚCI: łamie tekst na linijki nie szersze niż width (słowo dłuższe niż linijka zostaje w całości). */
export function wrap(str, width, measure) {
  const lines = [];
  let cur = '';
  for (const word of str.split(/\s+/)) {
    const next = cur ? `${cur} ${word}` : word;
    if (cur && measure(next) > width) { lines.push(cur); cur = word; } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}
