# Własne postacie – zasady tworzenia

KREATOR postaci (przycisk **KREATOR** na ekranie tytułowym, klawisz **K**, RT na padzie; `src/game/creator.js`)
pozwala grać własną postacią z obrazków. Postacie zapisują się tylko na urządzeniu gracza (IndexedDB). Przycisk
**ZIP** zapisuje postać do pliku, który można wczytać na innym urządzeniu.

Wygląd nie zmienia rozgrywki: bohater biega, skacze i zderza się tak samo jak wbudowane postacie. Symulacja
(`src/sim`) nic nie wie o obrazkach, a do rankingu idzie identyfikator `custom`.

Ten sam opis gracz widzi w grze: KREATOR → **Zasady tworzenia** (we wszystkich pięciu językach, z przyciskiem
„Kopiuj” przy poleceniu dla czatu AI). Teksty są w `src/game/strings.js` (klucze `cr.rules.*`, `cr.ai.*`, `cr.pose.*`).

## Dwa rodzaje postaci

| Rodzaj | Pliki | Co robi gra |
|---|---|---|
| **12 klatek** | 12 obrazków PNG, każdy ruch osobno | podmienia obrazki zależnie od stanu bohatera |
| **Sama głowa** | jeden obrazek `head.png` | dorysowuje kodem ciało chibi (kolory koszuli, spodni, butów i dłoni wybiera się w kreatorze) i animuje je jak wbudowane postacie |

## Nazwy plików

Po nazwie pliku kreator wie, co jest czym, więc przy wczytaniu sam przypisze obrazki do ruchów. Wielkość liter nie
ma znaczenia, pliki mogą leżeć w podkatalogu ZIP-a.

| Plik | Ruch | Kiedy gra go pokazuje |
|---|---|---|
| `idle.png` | stoi | postój, ekran tytułowy |
| `run1.png` … `run4.png` | bieg (4 fazy pętli) | bieg; klatki zmieniają się z przebytą drogą, więc szybszy bieg = szybsze przebieranie nogami |
| `jump1.png` | wybicie (przysiad) | chwila wybicia do skoku |
| `jump2.png` | wznoszenie | lot w górę (też obrót przy mocnym skoku) |
| `jump3.png` | szczyt skoku | koniec wznoszenia i zwykłe opadanie |
| `land.png` | lądowanie | chwila po dotknięciu piętra |
| `fall.png` | spadanie | długi spadek (duża prędkość w dół) |
| `dead.png` | koniec gry | ekran KONIEC GRY |
| `cheer.png` | radość | KONIEC GRY z nowym rekordem |
| `head.png` | głowa | tylko rodzaj „sama głowa” |

Brakującą klatkę gra zastępuje podobną (np. `run3` → `run1`, `fall` → `jump3`, aż do `idle`). Wymagana jest tylko
`idle.png` (albo `head.png`). Kolejność zastępstw: `FALLBACK` w `src/game/skinpack.js`.

**Pliki o innych nazwach:** gdy żadna nazwa nie pasuje, a obrazków jest 12, kreator przypisze je po kolei według
numeru w nazwie (`Obrazek.png`, `Obrazek (1).png` … `Obrazek (11).png` – tak nazywają pliki generatory obrazków),
w kolejności z tabeli. Jeden obrazek o dowolnej nazwie to głowa.

## Obrazki

- **Przezroczyste tło** (PNG z kanałem alfa, może być też WebP). Bez cienia, podłogi, kurzu, ramek i napisów.
- Postać **zwrócona w prawo**, cała w kadrze.
- **Ta sama skala we wszystkich klatkach** – głowa zawsze tej samej wielkości. Stopy na dole obrazka.
- Najlepiej 200–600 px wysokości; większe niż 1024 px kreator zmniejszy. Puste brzegi kreator przytnie sam.
- Głowa (`head.png`): ucięta tuż pod brodą, bez szyi i ramion, twarzą w prawo.

Jak kreator ustawia klatki (`layoutFrames` w `skinpack.js`): w każdej klatce szuka największego koła mieszczącego się
w sylwetce – u postaci z dużą głową to głowa. Klatki o głowie podobnej do mediany (±20%) zostają w tej samej skali,
a wyraźnie inne są przeskalowane do mediany głów. Wyjątek: `idle.png` narysowane w innej skali niż reszta (np. 2×
większe) ma zwykle też inne proporcje (dłuższe nogi), więc przy równej głowie bieg wyglądałby na dużo mniejszy –
takie `idle` kreator dopasowuje wysokością: stojąca postać = 110% wysokości biegu (`IDLE_OVER_RUN`). Całość jest
dopasowana tak, żeby `idle` miało 60 jednostek wysokości (jak wbudowane postacie). Punkt zaczepienia: środek głowy
w poziomie, dół obrazka (stopy) w pionie. W kreatorze można każdą klatkę poprawić ręcznie: wielkość
i przesunięcie, z bladą klatką „stoi” pod spodem do porównania.

## Plik ZIP i `character.json`

Eksport z kreatora zapisuje `postac-<nazwa>.zip` z obrazkami pod nazwami z tabeli i plikiem `character.json`
z ustawieniami. Przy wczytaniu ten plik jest opcjonalny.

```json
{
  "format": 1,
  "game": "step-jumper",
  "name": "Marek",
  "type": "frames",
  "adjust": { "run1": { "k": 1.1, "dx": -2, "dy": 0 } }
}
```

- `type`: `"frames"` albo `"head"`.
- `adjust` (12 klatek): poprawki z kreatora – `k` wielkość (0,4–2,5), `dx` w prawo, `dy` w górę (−30…30 jednostek planszy).
- Dla głowy zamiast `adjust`: `"head": { "k": 1 }` (wielkość głowy) i `"colors": { "skin", "shirt", "pants", "shoes" }` (`#rrggbb`).

Limity: do 10 własnych postaci, obrazek do 8 MB przed obróbką, ZIP do 48 MB. Kreator przycina każdy obrazek
do sylwetki, zmniejsza do 1024 px i zapisuje od nowa jako PNG (bez metadanych).

## Polecenie dla czatu AI – 12 klatek

Skopiuj, wklej w czacie AI, który tworzy obrazki, w miejsce nawiasu wpisz opis postaci albo dołącz zdjęcie:

```text
Narysuj postać do zręcznościowej gry 2D „Step Jumper” (widok z boku). Postać: [OPISZ POSTAĆ ALBO DOŁĄCZ ZDJĘCIE]. Styl: kolorowa kreskówka chibi – duża głowa, małe ciało, gruby ciemny kontur.

Potrzebuję 12 OSOBNYCH obrazków PNG z przezroczystym tłem (bez tła, cienia, podłogi, kurzu, ramek i napisów). Na każdym ta sama postać: zwrócona w prawo, cała w kadrze, w tej samej skali (głowa zawsze tej samej wielkości), ok. 400 px wysokości, stopy przy dolnej krawędzi obrazka.

Pliki i pozy:
idle.png – stoi spokojnie, ręce wzdłuż ciała
run1.png – bieg, faza 1 z 4: lewa noga daleko z przodu, prawa z tyłu
run2.png – bieg, faza 2 z 4: nogi się mijają, prawe kolano w górze
run3.png – bieg, faza 3 z 4: prawa noga daleko z przodu, lewa z tyłu
run4.png – bieg, faza 4 z 4: nogi się mijają, lewe kolano w górze (4 fazy tworzą płynną pętlę)
jump1.png – przysiad tuż przed wybiciem do skoku
jump2.png – wznoszenie: wybija się w górę, nogi podkurczone, jedna ręka wyciągnięta w górę
jump3.png – szczyt skoku: zawieszony w powietrzu, nogi lekko ugięte
land.png – lądowanie: kolana mocno ugięte, ręce lekko z przodu
fall.png – długie spadanie: ręce i nogi rozrzucone, przestraszona mina
dead.png – koniec gry: leży płasko na brzuchu, oczy zamknięte
cheer.png – radość: podskok z obiema rękami w górze, szeroki uśmiech

Nazwij pliki dokładnie tak jak wyżej i spakuj wszystkie do jednego pliku ZIP.
```

Jeśli czat nie umie zrobić ZIP-a, pobierz obrazki, nazwij je jak wyżej i spakuj samodzielnie (albo w kreatorze
zaznacz wszystkie 12 plików PNG naraz w „Wczytaj ZIP / PNG”). Gdy obrazki wyjdą w różnej wielkości, popraw je
suwakiem „Wielkość” w kreatorze.

## Polecenie dla czatu AI – sama głowa

```text
Narysuj głowę postaci do zręcznościowej gry 2D „Step Jumper”. Postać: [OPISZ POSTAĆ ALBO DOŁĄCZ ZDJĘCIE]. Styl: kolorowa kreskówka, gruby ciemny kontur.

Potrzebuję jednego obrazka PNG o nazwie head.png: sama głowa (z uszami i fryzurą), ucięta tuż pod brodą, bez szyi i ramion, twarzą w prawo (trzy czwarte profilu). Przezroczyste tło, bez cienia i napisów, ok. 300 px szerokości.
```

## Dla programistów

| Plik | Co robi |
|---|---|
| `src/game/skinpack.js` | format paczki bez DOM: nazwy klatek, przypisanie plików, wybór klatki, wykrycie głowy, skala, `character.json` (testy: `tests/skinpack.test.ts`) |
| `src/game/zip.js` | najprostszy ZIP: zapis „store”, odczyt „store” i „deflate” przez `DecompressionStream` (testy: `tests/zip.test.ts`) |
| `src/game/skins.js` | IndexedDB (`stepjumper` / `chars`), obróbka obrazków, budowanie postaci do rysowania, zmniejszanie klatek do 3 px na jednostkę |
| `src/game/characters.js` | `drawHero(h, fx, t, kind, pose)` – `kind` to numer wbudowanej postaci albo własna postać; pozy `dead` i `cheer` także dla wbudowanych |
| `src/game/creator.js` | okienko KREATORA (`#creator` w `index.html`) |

W ustawieniach gry (`stepjumper.prefs.v1`) zapisany jest tylko identyfikator wybranej własnej postaci (`custom`),
a `char: 5` oznacza miejsce własnej postaci na ekranie tytułowym.
