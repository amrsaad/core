# core

Persönlicher Wissens-Feed statt Instagram. Vertikal wischen, Vollbild-Karte, sofort die nächste. Jede Karte ist ein wörtlicher Auszug aus einer echten Quelle, mit Link.

- **Beat**: Koran, Vers für Vers ab 1:1, mit Tafsir (al-Muyassar, Ibn Kathir)
- **Body**: Training, Ernährung, Recovery, Schlaf (Reviews, Metaanalysen, Position Stands)
- **Brain**: Augenheilkunde, KI, Business (Buch-Highlights), Varia (Wikipedia)

App: **https://amrsaad.github.io/core/**

Kein Login, kein Server, keine Analytics, laufende Kosten 0.

## Auf dem iPhone installieren

1. Die URL oben in **Safari** öffnen (nicht in Chrome).
2. Unten auf **Teilen** tippen (Quadrat mit Pfeil).
3. **Zum Home-Bildschirm** wählen, dann **Hinzufügen**.
4. Core vom Home-Bildschirm starten. Die App läuft im Vollbild ohne Safari-Leiste und nach dem ersten Laden auch offline.

Wichtig: Nur die Homescreen-App ist von Safaris 7-Tage-Löschung ausgenommen. Zusätzlich unter Einstellungen ab und zu **Export als JSON** sichern (z.B. in iCloud Drive).

## Bedienung

| Geste | Wirkung |
|---|---|
| Wischen nach oben | nächste Karte |
| Doppeltipp | speichern, kommt später als Abruf-Karte zurück (FSRS) |
| Tipp auf die Quellzeile | Quelle im neuen Tab |
| Langes Drücken | Mehr davon / Weniger / Quelle prüfen |
| Tipp | Tab-Leiste ein- und ausblenden |

Eine Runde hat 12 Karten in 4 Blöcken à 3 Karten gleichen Themas. Position 4, 8 und 12 sind Abruf-Karten, wenn gespeicherte Karten fällig sind. Danach kommen ein Abschluss-Screen mit 3 Fragen und ein Tageslimit (Default 5 Runden).

## Wie Karten entstehen

```
GitHub Actions, täglich 03:00 UTC (.github/workflows/daily.yml)
  pipeline/fetch/*.ts    Europe PMC, arXiv, Quran.com, Wikipedia, Buch-Inbox -> pipeline/raw/<quelle>/<datum>.json
  pipeline/build.ts      regelbasierte Karten (ohne LLM) + Verifikations-Gate -> public/cards/<datum>.json
  pipeline/validate.ts   Gate: URL 200, Excerpt wörtlich, jede Zahl im Excerpt, Längen, Beat ohne Auslegung, keine Duplikate
GitHub Pages: statische PWA (Vite, React, TypeScript), rankt lokal, Fortschritt in IndexedDB
```

Abgelehnte Karten stehen mit Grund in `pipeline/out/rejected-<datum>.json`. Der Lauf bricht ab, wenn weniger als 80 % der Kandidaten bestehen. Das deutet auf einen kaputten Fetcher hin.

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
