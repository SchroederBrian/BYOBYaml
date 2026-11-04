---
title: Speicherung (SQLite)
sidebar_label: Speicherung
sidebar_position: 5
---

# Speicherung

BYOBYaml speichert **automatisch und lokal**, ohne Server und ohne Konto.

| Variante | Speicherort |
| --- | --- |
| Desktop-App (EXE) | SQLite-Datenbank `%APPDATA%\BYOBYaml\byobyaml.db` |
| Web-Version (`bun run dev`) | `localStorage` des Browsers |

## Wann wird gespeichert?

- Etwa 0,35 s nach jeder Änderung: Blöcke, Feldwerte, Dateinamen, Variablen, Projekttitel
- Sofort beim Wechsel in ein anderes Projekt
- Sofort mit <kbd>Strg</kbd>+<kbd>S</kbd>

Die Statusleiste zeigt *Speichert…*, *Gespeichert HH:MM* oder *Speichern fehlgeschlagen*:

![Statusleiste mit SQLite und Speicherzeit](/img/screens/statusleiste.png)

Die Projektverwaltung zeigt unten links den Pfad der Datenbank:

![Projektverwaltung mit Datenbankpfad](/img/screens/projekte.png)

## Datenbank

Die App nutzt das in Electron eingebaute `node:sqlite`. Dafür ist kein natives Zusatzmodul nötig. Der Journal-Modus ist WAL, deshalb liegen neben `byobyaml.db` die Dateien `byobyaml.db-wal` und `byobyaml.db-shm`.

```sql
CREATE TABLE projects (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  data        TEXT NOT NULL,          -- komplettes Projekt als JSON
  file_count  INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,       -- ms seit 1970
  updated_at  INTEGER NOT NULL
);

CREATE TABLE snippets (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  category    TEXT NOT NULL DEFAULT 'user',
  data        TEXT NOT NULL,          -- Blockly-JSON
  created_at  INTEGER NOT NULL
);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,             -- z. B. lastProjectId
  value TEXT NOT NULL                 -- JSON
);
```

Den Ordner öffnest du in der App über einen Klick auf **SQLite** in der Statusleiste.

## Sichern & Umziehen

- **Empfohlen:** *Exportieren → Backup: alles als .byob…* und auf dem neuen Rechner wieder importieren
- **Alternativ:** App schließen und den Ordner `%APPDATA%\BYOBYaml\` komplett kopieren

:::warning Nicht im laufenden Betrieb kopieren
Bei offener App können Änderungen noch in `byobyaml.db-wal` stehen. Kopiere die Datenbank nur bei geschlossener App, oder nimm das `.byob`-Backup.
:::

## Zurücksetzen

App schließen und `%APPDATA%\BYOBYaml\byobyaml.db*` löschen. Beim nächsten Start legt BYOBYaml die Beispielprojekte neu an.
