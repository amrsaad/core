# core

Persönlicher Feed statt Instagram Reels. **v4, Startscreen: Experten-Momente**, 60 bis 120 Sekunden lange Ausschnitte aus langen Fachvideos freigegebener Kanäle, per YouTube-Einbettung exakt von Start bis Ende. Danach optional ein Bildschirm "Für dich". Kein fremder Algorithmus, keine Empfehlungen, keine Kommentare.

Der Pool entsteht im privaten Repo `amrsaad/core-content` (Transkripte über den Browser auf Max' Mac, Qualitäts-Gate, Wochenlauf) und wird hier nur verschlüsselt veröffentlicht (`public/moments/pool.enc`, AES-GCM 256). Den Schlüssel bekommt das iPhone einmalig über den Freischalt-Link aus `core-content/ACCESS.md`.

v1 (Textkarten) und v2 (Shorts) sind nicht mehr in der Navigation, ihr Code bleibt im Repo.

- **Beat**: Koran, Spiritualität
- **Body**: Training, Ernährung, Recovery
- **Brain**: Augenheilkunde, KI, Business, Varia

App: **https://amrsaad.github.io/core/**

Kein Login, kein Server, keine Analytics, laufende Kosten 0, kein API-Key.

## Auf dem iPhone installieren

1. Die URL oben in **Safari** öffnen (nicht in Chrome).
2. Unten auf **Teilen** tippen (Quadrat mit Pfeil).
3. **Zum Home-Bildschirm** wählen, dann **Hinzufügen**.
4. Core vom Home-Bildschirm starten. Die App läuft im Vollbild ohne Safari-Leiste und nach dem ersten Laden auch offline.

Wichtig: Nur die Homescreen-App ist von Safaris 7-Tage-Löschung ausgenommen. Zusätzlich unter Einstellungen ab und zu **Export als JSON** sichern (z.B. in iCloud Drive).

## Bedienung Video-Feed

| Geste | Wirkung |
|---|---|
| Wischen nach oben / unten | nächstes / vorheriges Video |
| Erster Tipp | Ton an (bleibt für die Sitzung an) |
| Tipp | Pause / weiter (bei Pause erscheint die Tab-Leiste) |
| Doppeltipp | speichern |
| Langes Drücken | Mehr davon / Weniger / Kanal stummschalten |

Videos kommen in Blöcken à 3 gleichen Bereichs (Brain 55, Body 25, Beat 20), der erste Block des Tages ist Beat. Gesehene Videos kommen nicht wieder. Nach 30 Minuten am Tag kommt einmal der Hinweis "30 Minuten heute".

Endscreen-Schutz: Bei Ende (`ENDED`) und zusätzlich per Polling ab 0,4 s vor Schluss springt der Feed weiter. Solange ein Video nicht läuft (Laden, Pause, Ende), liegt das Vorschaubild über dem Player, YouTube-Oberfläche ist dann nie sichtbar.

Falls iOS beim Wischen den Ton wieder ausschaltet: Einstellungen, **Ein-Player-Modus** einschalten (ein Player, das nächste Video wird direkt in der Wischgeste geladen).

## Bedienung Karten-Feed (v1)

| Geste | Wirkung |
|---|---|
| Wischen nach oben | nächste Karte |
| Doppeltipp | speichern, kommt später als Abruf-Karte zurück (FSRS) |
| Tipp auf die Quellzeile | Quelle im neuen Tab |
| Langes Drücken | Mehr davon / Weniger / Quelle prüfen |
| Tipp | Tab-Leiste ein- und ausblenden |

Eine Runde hat 12 Karten in 4 Blöcken à 3 Karten gleichen Themas. Position 4, 8 und 12 sind Abruf-Karten, wenn gespeicherte Karten fällig sind. Danach kommen ein Abschluss-Screen mit 3 Fragen und ein Tageslimit (Default 5 Runden).

## Wie Videos in den Pool kommen

```
GitHub Actions, täglich 03:00 UTC, vor der Karten-Pipeline
  pipeline/video/run.ts
    1. channelId auflösen (Kanalseite oder Kanalsuche, verifizierte Kanäle bevorzugt), Ergebnis in content/channels.json
    2. Shorts-Feed (UUSH-Playlist), sonst Kanal-Feed; beim ersten Lauf zusätzlich der öffentliche Shorts-Tab
    3. jede ID per /shorts/<id> (redirect manual) bestätigt: 200 = Short
    4. public/videos/pool.json wächst nur (nie löschen), Duplikate über id
    5. Kanal ohne neues Short seit 60 Tagen: status inactive (alte Videos bleiben)
```

Nur Einbettung über youtube-nocookie.com, kein Download, kein Re-Hosting. Kanal hinzufügen: Eintrag in `content/channels.json` mit `"channelId": null`, der nächste Lauf löst ihn auf.

Test gegen echtes YouTube (Playwright, iPhone 15, WebKit und Chromium): Commit mit `[e2e]` in der Nachricht. Ergebnis und Screenshots landen in `pipeline/out/e2e/`.

## Wie Karten entstehen

```
GitHub Actions, täglich 03:00 UTC (.github/workflows/daily.yml)
  pipeline/fetch/*.ts    Europe PMC, arXiv, Quran.com, Wikipedia, Buch-Inbox -> pipeline/raw/<quelle>/<datum>.json
  pipeline/build.ts      regelbasierte Karten (ohne LLM) + Verifikations-Gate -> public/cards/<datum>.json
  pipeline/validate.ts   Gate: URL 200, Excerpt wörtlich, jede Zahl im Excerpt, Längen, Beat ohne Auslegung, keine Duplikate
GitHub Pages: statische PWA (Vite, React, TypeScript), rankt lokal, Fortschritt in IndexedDB
```

Abgelehnte Karten stehen mit Grund in `pipeline/out/rejected-<datum>.json`, Karten, die der Builder gar nicht erst bildet (z.B. Titel zu lang, nur Förderhinweis), unter `skippedByBuilder`.

Regel 1 (Quelle erreichbar): Die Karte verlinkt PubMed. PubMed und Verlagsseiten blocken Bots oft (403, 203, 429). Dann zählt nur, wenn die Europe-PMC-API genau diesen Datensatz (gleiche PMID) mit HTTP 200 liefert. Beide Status stehen in `urlChecks` der Rohdaten.

`content/blocklist.json`: Karten, die das Gate formal bestehen, aber inhaltlich leer sind (nur Ausblick, nur Protokoll). Mit Grund, der Builder überspringt sie.

`npm run verify` prüft den gesamten Bestand erneut durch das Gate, auch nach Enrichment. Läuft täglich mit. Der Lauf bricht ab, wenn weniger als 80 % der Kandidaten bestehen. Das deutet auf einen kaputten Fetcher hin.

Manuell starten: Actions, dann **daily**, dann **Run workflow** (mit `seed` für den Erstbestand). Per CLI: `gh workflow run daily.yml`. Alternativ ein Commit mit `[pipeline]` (oder `[seed]`) in der Nachricht.

## Buch-Highlights (Business)

Markdown-Dateien nach `content/inbox/books/` legen, Format in `content/inbox/books/README.md`:

```
> Wer zuerst eine Zahl nennt, setzt den Anker.

Quelle: Never Split the Difference, Chris Voss, Kapitel 7
Topic: verhandlung
```

Committen (auch direkt im GitHub-Webeditor). Der nächste tägliche Lauf macht daraus Karten. Solange die Inbox leer ist, gehen die Business-Blöcke an KI und Varia.

## Enrichment ("Für dich" und Abruf-Fragen)

Läuft nur in einer Claude-Code-Session über das bestehende Abo. Es gibt keinen API-Key, weder im Repo noch in Actions.

```bash
npm ci
npm run enrich            # schreibt pipeline/enrich/todo.json
# Claude schreibt pipeline/enrich/done-<datum>.json:
#   [{ "id": "...", "forYou": "...", "recall": { "q": "...", "a": "..." } }]   bzw. für Beat nur { "id", "reflection": "...?" }
npm run enrich -- apply   # übernimmt alles, prüft jede Karte erneut durch den Validator
```

Prompt für die Session: *"Lies pipeline/enrich/todo.json. Schreib für jede Karte nur aus dem excerpt ableitbar: forYou (1 Satz, plain, Deutsch, was sich in Praxis, Training oder Alltag ändert) und recall (Frage plus kurze Antwort). Beat: nur reflection, eine offene Frage, keine Auslegung. Keine Zahl, die nicht im excerpt steht, keine Gedankenstriche. Ergebnis nach pipeline/enrich/done-<datum>.json, dann npm run enrich -- apply."*

Felder, die den Validator nicht bestehen, werden verworfen (`pipeline/out/enrich-rejected.json`), die Karte selbst bleibt.

## Entwicklung

```bash
npm ci
npm run dev        # http://localhost:5173/core/
npm test           # Validator-, Builder- und Feed-Tests
npm run build      # PWA nach dist/
npm run pipeline   # Fetch + Build lokal (braucht Internet)
npm run sample     # 30 Zufallskarten zur Stichprobe
```

Test der FSRS-Fälligkeit: `?now=2026-12-31` an die URL hängen. Damit läuft die App-Zeit vorgestellt, und gespeicherte Karten erscheinen als Abruf-Karten.
