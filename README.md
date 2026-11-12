# Step Jumper

Zręcznościówka w jednym pliku HTML: wspinaczka po wieży, w której wysokość skoku zależy od rozpędu.

- **Cała gra to `index.html`** – bez builda i zależności (Canvas 2D, Web Audio, Pointer Events, Gamepad API).
- 5 postaci, 5 map (stylów graficznych).
- Sterowanie: klawiatura, gamepad, przyciski ekranowe albo **przechył telefonu + dotyk** (wymaga HTTPS).

## Uruchomienie

Lokalnie wystarczy otworzyć `index.html`. Tryb przechyłu działa tylko po HTTPS (albo z `localhost`), np.:

```
npx serve .
```

## Deploy

Statyczna strona – Vercel wykrywa `index.html` w katalogu głównym (preset „Other”, bez komendy builda).
Każdy push do `main` wdraża produkcję.

## PWA

`manifest.webmanifest`, `sw.js` i `icons/` pozwalają zainstalować grę jako aplikację (Android: menu Chrome → „Zainstaluj aplikację”).
Po instalacji startuje na pełnym ekranie, w poziomie, i działa offline. Service worker bierze stronę najpierw z sieci,
więc nowy deploy widać od razu.

## Strojenie

- fizyka: obiekt `P` na górze skryptu,
- czułość przechyłu: stała `TILT` (`dead`, `full`, `smooth`).
