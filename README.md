# Freundesareale – Cozy Pokémon Pixel Game

Private Fan-App (nicht monetarisiert): Pokémon am Pokéball-Automaten ziehen → in Freundesarealen unterbringen → pflegen (Streicheln, Füttern) → Level & Zufriedenheit steigen → Glücksmünzen produzieren → neue Pokémon ziehen und Areale freischalten/vergrößern.

Technik: Web-App (Vite, reines JavaScript, Canvas-Pixelgrafik) + Supabase (Konten, Datenbank, Sicherungen). Läuft als PWA im Safari („Zum Home-Bildschirm“) und kann per Capacitor als iOS-App für TestFlight verpackt werden.

## Starten (Entwicklung)

```
npm install
npm run dev        # http://localhost:5190
```

Ohne `.env.local` läuft ein **Entwicklungsmodus**: Die Cloud wird im Browser simuliert (nur zum Testen, im fertigen Build nicht enthalten). Die Einstellungen zeigen dann einen ⚠-Hinweis.

## Supabase einrichten (einmalig)

1. Auf supabase.com ein kostenloses Projekt anlegen.
2. **SQL Editor** → Inhalt von `supabase/schema.sql` einfügen → Run.
3. Freigegebene Personen eintragen (nur diese können sich registrieren):
   ```sql
   insert into public.allowed_emails(email, note) values ('deine@mail.de', 'ich'), ('freundin@mail.de', 'Freundin');
   ```
4. **Authentication → URL Configuration**: „Site URL“ und „Redirect URLs“ auf die Adresse setzen, unter der die App läuft (z. B. `http://localhost:5190` und die spätere Web-Adresse). Dorthin führen die Links aus den Bestätigungs- und Passwort-Mails.
5. **Project Settings → API**: URL und `anon public` Key in `.env.local` eintragen (Vorlage: `.env.example`).
6. Optional, empfohlen: **Database → Extensions → pg_cron** aktivieren und den auskommentierten Block am Ende von `schema.sql` ausführen (tägliche Sicherung aller Spielstände).

### Speichern & Sicherheit
- Ein Spielstand pro Konto in der Tabelle `saves` (JSON). Row Level Security: jeder liest nur seinen eigenen; geschrieben wird nur über die Funktion `save_game`.
- Nach jeder Aktion wird automatisch gespeichert (gebündelt, wichtige Aktionen sofort). Statuspunkt oben rechts; schlägt Speichern fehl, erscheint ein roter Hinweis, die App versucht es automatisch erneut. Bis dahin liegt der Stand nur als Puffer lokal – die Cloud bleibt maßgeblich.
- Zwei Geräte gleichzeitig: Jede Speicherung trägt eine Versionsnummer. Hat ein anderes Gerät inzwischen gespeichert, wird der Cloud-Stand geladen statt überschrieben.
- Zeit kommt vom Server (`server_now`), die Geräteuhr kann die Produktion nicht verfälschen. Bei geschlossener App wird alles anhand der Zeitstempel nachgerechnet (bis 60 Tage).
- **Sicherungen**: automatisch höchstens stündlich (30 Tage), optional täglich (pg_cron, 180 Tage), manuell per Knopf. In der App unter ⚙ → Sicherungen → „Laden“ wiederherstellen (der aktuelle Stand wird vorher selbst gesichert).
- Zusätzliche Sicherung auf deinem PC: `SUPABASE_SERVICE_ROLE_KEY` in `.env.local` eintragen, dann `npm run backup:export` (schreibt `backups/*.json`; lässt sich per Windows-Aufgabenplanung täglich ausführen). Hinweis: Das kostenlose Supabase-Paket macht selbst keine automatischen Datenbank-Backups.
- Zugang wiederherstellen: „Passwort vergessen?“ auf dem Anmeldebildschirm schickt einen Link.

## Spielwerte anpassen

| Datei | Inhalt |
|---|---|
| `public/config/balance.json` | Startmünzen, Münz-Intervall (8 h), Level-Tempo, Hunger/Zufriedenheit/Zuneigung, Beeren (Effekt, Dauer, Preis), Automat (Kosten, 50 Bälle/Tag, Tageswechsel, Ball-Gewichte) |
| `public/config/areas.json` | Areale: Name, Bild, begehbare Ellipse, Sprite-Größe, Freischaltkosten, Kapazität je Stufe, Ausbaukosten |
| `public/config/bonuses.json` | Gruppenboni (Rudel, Herde, Pferdeherde + Artgenossen nach Sozialverhalten), Pärchen (♂+♀ paarweise lebender Arten + Extra-Paare wie Latias & Latios), Areal-Fähigkeiten aller 48 Legendären |
| `balance.json → berryProduction` | Welche Pokémon Beeren produzieren, welche Beeren (Gewichte), Intervall (24 h) |
| `public/data/rarity_overrides.json` | Seltenheit einzelner Pokémon überschreiben (danach `npm run assets:pokedex`) |

Seltenheit automatisch (PokeAPI-Daten): Grundstufen mit Entwicklung + Babys = gewöhnlich (Pokéball), 2. Stufe & Einzelpokémon = selten (Superball), 3. Stufe = sehr selten (Hyperball), Legendär/Mysteriös = legendär (Meisterball). Jeder Ball des Tages bekommt zuerst eine Ball-Art nach Gewicht (66/25/8,5/0,5) und dann ein zufälliges Pokémon dieser Seltenheit.

## Bedienung

- Das Areal füllt den ganzen Bildschirm. **Wischen** links/rechts wechselt das Areal (am Computer auch Pfeiltasten).
- **Pokémon antippen**: sammelt seine fertigen Münzen/Beeren ein (Flug-Animation) und öffnet sein Porträt mit allen Werten.
- **☰** unten links: Areal-Menü (alles einsammeln, vergrößern, Boni, Bewohner, Pokémon einziehen lassen).
- **Automat**: Vollbild; Drehknopf mit dem Finger im Uhrzeigersinn drehen (oder kurz antippen). Haptik beim Drehen, Herausfallen und Öffnen. Ziehung 50 Münzen, Start 200, alle 2 Stunden eine Gratis-Ziehung (`balance.json → gacha`).
- **Drag & Drop**: Pokémon festhalten und an den linken/rechten Rand (Nachbar-Areal) oder nach unten (Beutel) ziehen.
- Im Entwicklungsmodus kann man mit `http://localhost:5190/?devcloud` ohne echte Datenbank testen.

## Startwerte & Arealpassung

- Neue Pokémon starten neutral (`balance.json → newPokemon`: Sättigung 80, Zufriedenheit 60, Zuneigung 10); Werte ändern sich langsam über Tage.
- Jedes Areal hat `likes`/`dislikes` (Pokémon-Typen) in `areas.json`. Passt das Areal, steigt die Zufriedenheit langsam (`needs.habitatPerHour`, ca. ±3,6 pro Tag), passt es schlecht, sinkt sie. Beim Zuweisen wird „♥ passt“ / „✕ unwohl“ angezeigt.

## Boni, Geschlechter, Beeren

- Boni gelten nur, solange die passenden Pokémon zusammen in einem Areal wohnen – sie schalten sich beim Ein-/Umziehen automatisch an und aus und werden bei der Offline-Berechnung berücksichtigt. Aktive Boni stehen im Areal-Panel und im Pflege-Fenster.
- Geschlecht wird beim Ziehen nach der echten Geschlechterverteilung der Art gewürfelt (geschlechtslose Arten haben keins). 58 Arten nutzen eigene weibliche Sprites.
- Antippen eines Pokémon mit fertigen Münzen/Beeren sammelt ein (Münzen fliegen zur Münzanzeige, Beeren zum Beutel), sonst öffnet sich die Pflege. Beeren im Beutel werden beim „Geben“ zuerst verbraucht, fehlt eine, kann man sie wie bisher mit Glücksmünzen kaufen.
- Eigene Beeren-/Item-Sprites: `assets-input/items/<name>.png` → `npm run assets:art` → in `balance.json` bei der Beere `"sprite": "<name>.png"` eintragen.

## Assets

- **Pokémon**: `npm run assets:pokedex` liest `D:\Pokemon Sprites\Pokemon_0001-0715_Portraits_Sprites` (PMD Collab: Idle/Walk/Sleep/Eat/Hop + Portraits) und deutsche Namen aus PokeWorlds `profiles.json` → `public/sprites/<nr>/`, `public/data/pokedex.json`. 699 von 715 haben vollständige Sprites; 16 ohne Lauf-Animation fehlen im Pool (Liste in der Ausgabe).
- **Areale**: Eigene Bilder in `assets-input/areale/<areal-id>.png` legen → `npm run assets:art`. Ein eigenes Bild ersetzt den PMD-Platzhalter mit gleicher ID. Danach in `areas.json` ggf. `walk` und `spriteScale` anpassen. Neue Areale: Bild ablegen + Eintrag in `areas.json`.
- **Automat**: `assets-input/automat/automat.webp` (deine Vorlage). Kugel und Schacht werden automatisch geleert, die Bälle des Tages zeichnet das Spiel selbst.
- Lizenz der Sprites: PMD Collab, CC BY-NC 4.0 (Credits in den Quellordnern) – passt zur privaten, nicht kommerziellen Nutzung.

## iOS / TestFlight

TestFlight braucht einen Mac mit Xcode und einen Apple-Developer-Account (99 €/Jahr):
```
npm run build
npx cap add ios      # einmalig, auf dem Mac
npm run ios:sync
npx cap open ios     # in Xcode signieren, Archive → TestFlight
```
Ohne Mac: App auf einen Webspace laden (Inhalt von `dist/`, z. B. Netlify/Vercel/GitHub Pages) und in Safari „Zum Home-Bildschirm“ – dann ist sie eine PWA, Spielstände liegen genauso in Supabase.

## Code-Überblick

- `src/game/` – Regeln: `state.js` (Spielstand), `sim.js` (Zeitsimulation), `actions.js` (alle Aktionen), `gacha.js` (Tagesfüllung)
- `src/backend/` – `supabase.js` (Cloud), `dev.js` (nur Entwicklung)
- `src/save.js` – automatisches Speichern, Fehler-Wiederholung, Konflikte
- `src/ui/` – Bildschirme (Areale, Sammlung, Automat, Pflege-Fenster, Einstellungen, Anmeldung)
- `src/gfx/` – Sprite-Animationen, Pixel-Icons, Pokébälle
- Testhaken im Entwicklungsmodus: `__fa` (App), `__fa.A` (Aktionen), `__fa.backend.failNextSaves = 2` (Speicherfehler simulieren)
