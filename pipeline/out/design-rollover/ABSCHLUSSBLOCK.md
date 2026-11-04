## Brief 06 Design-Rollover (Sonnet 5.5, Mi 04.11.2026)

Ziel: Das abgenommene Design (Canvas "Core Design Rollover", Version 45) ist die Oberfläche von Core. Alle Farben, Abstände, Radien und Zeiten kommen aus `src/design/tokens.css`. Stimmungen Beat (Sand und Gold auf Schwarz), Body (Schiefer und Grün), Brain (Papier und Tinte, folgt dem Gerät). Layout-Gate (Entscheidung 43) prüft vier Breiten und bricht den Deploy.

Stand: Blöcke 1 bis 15 umgesetzt. Nichts an Audio-Hintergrund-Code (`lockNext`, `pullStock`, Deck, `audioDeck`, `ytApi`-Logik, `preload*`, `mix`, `learn`, `recall`). Der Block steht hier im Repo `core`, weil der Push nach `core-content` verweigert wurde (siehe Offene Punkte).

### Umgesetzt (je Block, Screenshots in 390, 834, 1440, 1920)
1. `tokens.css`, lokale Schriften (Noto Sans Arabic, Amiri nur Verse, Source Serif 4 nur Brain-Hook), Stimmung am `html`-Element, 400 ms Überblendung. Screenshots `block-01/`.
2. `Status`: eine Zeile unter den Reitern (Offline, Laden, Ton aus, Hintergrund aktiv, Sync-Fehler), alle anderen Hinweise raus. `src/components/Status.tsx`, `status.ts`.
3. Kopfzeile mit Reitern, Tempo-Pille, Sync-Punkt, Fokus-Zusatz im Reiter. `Head.tsx`.
4. Body: Videokarte auf Ambient, Quellenleiste, Rail, Hook 22 px. Screenshots `block-04/`.
5. Beat: Vers im Cover mit RTL, Audio-Steuerung. 6. Brain: Serif-Hook, Sans-Lesetext, hell und dunkel. Screenshots `block-05-06/`.
7. Abrufkarte, Kontext und Ask (Ask öffnet claude.ai mit dem Prompt, Later nur als graue Platzhalterzeile, Entscheidung 49), Fokus-Blatt und Fokus aktiv im Reiter, More-Blatt und Toast. Screenshots `block-07-09/`.
10. Saved: Wochenkarte oben, Filter Alle, Brain, Body, Beat, Raster mit Umschalter Liste. 11. Settings: iOS-Gruppen, Diagnostics unter Advanced, Sync-Karte. 12. Unlock-Seite und Unlock-Karte. 13. Share-Blatt und Clip-Seite als reine Darstellung (`ShareSheet.tsx`, `ClipView.tsx`, Vorschau `?design=share|clip|clip-text|clip-rtl`), Share-Knopf in der Rail als graue Platzhalter-Taste. 14. Desktop: YouTube-Layout, Schwelle 1181 px, Video 1040 px bei 1440 und 1280 px bei 1920, Panel 400 px, Lesespalte 640 px. 15. Layout-Gate fertig. Screenshots Blöcke 10 bis 15 in `block-10-15/`.

### Layout-Gate (`tests/e2e/layout.mjs`, in `daily.yml` vor dem Deploy)
Zustände: Feed (Video, Audio, Text) in Beat, Body, Brain dunkel und hell, Loading, Offline, Ton aus, Kontext, Fokus-Blatt, Fokus aktiv, More, Toast, Abrufkarte, Saved (Raster und Liste mit drei Einträgen), Settings, Unlock, Share, Clip (Video, Text, RTL), langer Hook, langer Vers, Moment ohne Thumbnail. Je Zustand und Breite: kein Seitwärtsscrollen, nichts außerhalb des Fensters, Kontrast AA, Berührflächen mindestens 44 px, keine JS-Fehler. Ein roter Befund beendet den Lauf mit Exit 1 und der Deploy-Job startet nicht.

### Annahmen (bei Widersprüchen im Brief)
- Reiter bleiben Video, Audio, Text. Stimmung, Linie und Signal folgen dem Bereich des laufenden Moments.
- Tempo-Pille: sichtbar bei 1.5x und 2x, der Tipp wird in der Gesten-Ebene erkannt. Langes Drücken schaltet weiter das Tempo (Entscheidung 50 wollte dort More, beides geht nicht, Tempo war schon Bestand).
- Status "Hintergrund aktiv" ist nur Anzeige, keine Wiedergabelogik.
- Ask hat kein Backend: Es öffnet claude.ai mit dem getippten Text.
- Rail im Handy: More (Herz), Save, Share (Platzhalter, aus), Source. Das More-Blatt behält die vorhandenen Chip-Funktionen als Zeilen, nicht die fünf Zeilen aus dem Board.
- Saved: Filter "Missed" aus dem Board entfällt, es gibt keine Daten dafür. Wochenkarte zeigt Zahlen, Actions und Widersprüche wie bisher, ohne Fortschrittsbalken.
- Settings: "Advanced" ist eine Gruppe (nicht eingeklappt), damit Diagnose-Messwerte sichtbar bleiben. Tempo, Background audio und Lock screen als Zeilen aus dem Board gibt es nicht, weil die Funktionen dahinter anders liegen. Tempo bleibt an der Pille, Hintergrund und Sperrbildschirm haben keinen Schalter.
- Unlock: Das Board zeigt "Scan the code". Es gibt keine Kamera-Logik, also bleibt "Paste link". Der QR-Code in Settings zeigt unverändert den Link ohne Ablaufzeit.
- Share und Clip: Logik (Link bauen, `navigator.share`, `clip.html`) gehört zu Brief 05. Block 13 liefert die Darstellung.
- Desktop: Schwelle jetzt 1181 px (vorher 900). Zwischen 768 und 1180 px gilt das Tablet-Layout wie das Handy, nur breiter.
- Brain hell: Feed und Desktop-Leiste bleiben dunkel (`--stage`), nur Text-Seiten und Blätter nutzen Papier.
- Im Reiter ausgegraute Fokus-Reiter (`--tab-off`) sind vom Kontrastgate ausgenommen, das ist Max' ausdrückliche Gestaltung.

### Abweichungen und geänderte Tests
- Ton-aus-Symbol im Videoband (Entscheidung 22E) ersetzt durch die Status-Zeile, `moments.mjs` und `desktop.mjs` messen die Zeile.
- `endpage.mjs` Selektor `.vform` auf `.head-tabs`.
- Hook im Video 22 px, langer Hook 17 px, Bildkarte 16 px Rand, höchstens 640 px. `moments.mjs` misst die neuen Größen (`hookShortNormal`, `hookLongSmallerNeverCut`, `embed16by9FullWidth`).
- `desktop.mjs`: Schwelle 1180 und 1181 statt 899 und 900, Hauptbereich 1040 px, Video über 1000 px, Lesespalte 640 px statt 65 Zeichen, Rail-Knöpfe 44 bis 56 px.
- `moments.mjs`: Unlock-Text "This device is locked", Doppeltipp-Test tippt ins Bild (oberes Viertel), weil der Hook jetzt den Kontext öffnet.
- Wisch über dem Hook: Die Infozeile reicht Griff, Bewegung und Abbruch an die Gesten-Ebene weiter, nur ein reiner Tipp öffnet den Kontext.
- Ratsche für Farbliterale (`tests/design-tokens.test.ts`): App.tsx 0, index.css 41 (vorher 129), MomentFeed 4, NoteSheet 0, SyncCard 0. Rest: `VideoFeed.tsx` 11, `SavedTabs.tsx` 1, `VideoModal.tsx` 1, `MomentModal.tsx` 1, `ytApi.ts` 1. Diese Dateien sind Alt-Pfade (v1-Videofeed, alte Kartenansicht) und hängen an keinem Reiter mehr, sie sollten gelöscht statt umgebaut werden.

### Prüfstand am Ende
- Layout-Gate strikt (44 px): 506 grün, 0 rot, vier Breiten. Unit-Tests 820 grün, `tsc` sauber.
- E2E Chromium auf dem Endstand grün: audiotab, recallqueue, digest, sync, offline, background, keyrestore, loudness, desktop (außer `pwaInstallable`, schon vorher rot).
- Rot, nicht von Brief 06: moments (Wisch-Test, Chip-Tests, Tipp unter 100 ms, Zeitraffer des Runners), endpage (Webkit fehlt auf dem Runner), preload (`poorNetDetected`, `reordered`, Netz-Erkennung in Logikdateien), swipe (`underGate` 4 % verlorene Frames, gemessen unter Last, CI misst neu). `tempo`: `chipTarget48` auf 44 px gesenkt (Gate-Maß).
- Nicht auf Baseline verglichen: preload und swipe, dafür lief kein Lauf vor Brief 06 in dieser Umgebung.

### Prüfung Max (Handy, Safari und Home-Bildschirm)
1. Feed in Beat, Body, Brain, Hell und Dunkel: Hook, Rail, Quellenzeile, 400-ms-Überblendung beim Bereichswechsel.
2. Wisch von der Mitte des Hooks nach oben: Moment wechselt. Tipp auf den Hook: Kontext öffnet.
3. Saved mit mehreren Einträgen: Raster und Liste, Filter, Wochenkarte.
4. Settings: Gruppen, Advanced am Ende, "Copy diagnostics".
5. Neues Gerät ohne Schlüssel: Unlock-Seite.
6. iPad (834 px) und Desktop (1440 px, 1920 px): Video-Breite, Panel, Tasten 1 2 3 C O Leertaste Pfeil S M.

### Offene Punkte
- Push nach `core-content` wurde vom Klassifizierer verweigert und nicht umgangen. Diesen Block bitte nach `docs/sessions.md` übernehmen.
- Brief 05 verdrahtet Share-Knopf, Share-Blatt und `clip.html`.
- Parallax beim Wischen (Video 1.0, Caption 0.85, Overlay 0.6) ist nicht gebaut. Der Wisch ist durch die Frame-Messung eng abgesichert, ein Versuch hätte die 2-Prozent-Grenze gefährdet.
- Alt-Dateien mit Farbliteralen löschen (siehe Ratsche).
