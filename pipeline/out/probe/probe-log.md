# Probe gegen die Live-App (Entscheidung 31)

Eine Zeile pro Lauf (täglich 04:00 UTC, .github/workflows/probe.yml). Erstes Bild in ms, gemessen vom Navigationsstart bis zum ersten spielenden Moment. Reiterwechsel ok heißt Audio, Text und Video zeigen den passenden Moment.

| Datum | Start (UTC) | Erstes Bild (ms) | Reiterwechsel | Fehler | Ergebnis | Quelle |
|---|---|---|---|---|---|---|
| 2026-11-03 | 11:46:56 | 1076 | ok | 3 | FEHLER errors 3: pageerror Cannot read properties of null (reading 'mute') | actions |
| 2026-11-04 | 11:48:57 | 253 | ok | 0 | ok | actions |
| 2026-11-05 | 11:49:16 | 329 | ok | 40 | FEHLER errors 40: console Error: <svg> attribute width: Expected length, "var(--rail-icon)". | actions |
