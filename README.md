# Tennis-Clubliga – Daten

Turnierdaten für die Fantasy-Tennis Clubliga. Eine geplante Aufgabe trägt hier mehrmals täglich Auslosungen, Setzlisten, Ergebnisse und Matchstatistiken ein. Die App liest die Dateien direkt aus diesem Repository und berechnet daraus Preisgeld und Boni.

## Aufbau

Pro Turnier eine Datei: `data/<Jahr>/<turnier>.json`

| Feld | Inhalt |
| --- | --- |
| `updated_at` | Zeitpunkt der letzten Aktualisierung (UTC) |
| `source` | Woher die Daten stammen |
| `tournament` | `id`, `name`, Kategorie (`atp_250`, `atp_500`, `masters_1000`, `grand_slam`, `atp_finals`), `country`, `start`, `end`, `best_of`, `draw_size` (Feldgröße des Hauptfelds) |
| `players` | Alle Spieler des Hauptfelds mit `name`, `country`, `seed` (`null` = ungesetzt) und `form_wins_last10` |
| `matches` | Runde, Startzeit, Status (`scheduled`, `live`, `finished`), Sieger, `walkover`, `retired`, Satzergebnisse und Statistik pro Spieler |

Statistik pro Spieler und Match: `aces`, `double_faults`, `breakpoints_won`, `breakpoints_total`, `service_games_won`, `tiebreaks_won`.

Daraus ergeben sich die Boni: "kein Aufschlagspiel abgegeben" heißt, der Gegner hat `breakpoints_won = 0`; ein Satz zu 0 und ein Comeback lassen sich aus `sets` ablesen.

Jede Aktualisierung schreibt die ganze Datei neu. Fehlt ein Lauf, holt der nächste alles nach.

## Regeln für die Felder

- **IDs:** Spieler `atp:<ATP-Kürzel>` wie `atp:pl56`. Matches `atp:<Jahr>-<Turnier-ID>:<Runde>:<Kürzel>-<Kürzel>`, die Kürzel alphabetisch. Einmal vergebene IDs bleiben gleich, denn die Kader in der App hängen daran.
- **Runden:** `round_of_128`, `round_of_64`, `round_of_32`, `round_of_16`, `quarterfinal`, `semifinal`, `final`. Andere Namen bekommen in der App kein Preisgeld. Die einzige Ausnahme ist `round_robin` bei den ATP Finals, die noch nicht abgerechnet werden.
- **Feldgröße:** die Zahl der Spieler im Hauptfeld, also 56 beim Paris Masters, auch wenn die erste Runde `round_of_64` heißt. Solange die Qualifikanten noch nicht feststehen, steht `tournament.qualifiers_pending: true` in der Datei. Das Feld entfällt, sobald alle Namen da sind.
- **`form_wins_last10`:** Siege aus den letzten 10 gespielten Matches vor `tournament.start`, laut Match-Log auf tennis-db.com (ATP-Tour einschließlich Qualifikation). Walkover zählen nicht, Aufgaben schon. Der Wert wird einmal festgelegt und ändert sich während des Turniers nicht, damit die Marktwerte stabil bleiben. `null` heißt unbekannt, die App rechnet dann mit dem Faktor 1,0.
- **`walkover`:** Das Match fand nicht statt. Es gibt einen Sieger, aber weder `sets` noch `stats`.
- **`retired`:** Der Verlierer hat aufgegeben. Der letzte Satz darf offen sein, die Statistik des gespielten Teils zählt.
- **`start`:** der angesetzte Zeitpunkt in UTC. Steht `start_estimated: true` dabei, ist die Uhrzeit geschätzt, nur der Tag ist sicher.
- **`withdrawn`:** optional. Ein Spieler, der schon in der Datei stand und vor seinem ersten Match zurückzieht, bleibt mit `withdrawn: true` erhalten, damit bestehende Kader ihn weiter finden.

## Quellen

- **Auslosung, Setzlisten, Ergebnisse, Spielplan:** atptour.com
- **Matchstatistiken:** tennis.com, Stichproben mit dem Stats Centre von atptour.com abgeglichen
- **Form:** tennis-db.com

## Prüfen

```bash
node scripts/validate.mjs
```

Das Skript prüft jede Datei vor dem Commit: Pflichtfelder, Rundennamen, vollständiges Feld, Satzstand und Sieger. Außerdem rechnet es nach, ob die Breaks zum Ergebnis passen. Das fängt vertauschte Statistikwerte ab.
