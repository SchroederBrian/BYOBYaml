---
title: Exportieren
sidebar_label: Export
sidebar_position: 3
---

# Exportieren

Menü **Exportieren**:

![Menü Exportieren](/img/screens/menue-export.png)

| Eintrag | Ergebnis |
| --- | --- |
| **‹datei› als YAML…** | Speichert die aktuell geöffnete Datei. Gleich wie *Speichern* im YAML-Tab. |
| **Alle Dateien in Ordner…** | Ordner wählen; jede Datei des Projekts wird als eigene YAML-Datei geschrieben. Bestehende Dateien mit gleichem Namen werden überschrieben. |
| **Projekt als .byob…** | Das komplette Projekt (Blöcke, Variablen, Umgebungen) als [.byob-Datei](byob-format.md) |
| **Backup: alles als .byob…** | Alle Projekte aus der Datenbank plus alle eigenen Vorlagen in einer Datei |

## Umgebung beachten

YAML-Exporte setzen die Variablenwerte der **aktiven Umgebung** ein. Der Menüeintrag zeigt sie an, z. B. *Alle Dateien in Ordner… `prod`*.

Typischer Ablauf für zwei Umgebungen:

1. Oben rechts `dev` wählen → *Alle Dateien in Ordner…* → `deploy/dev/`
2. Oben rechts `prod` wählen → *Alle Dateien in Ordner…* → `deploy/prod/`

## Kopieren

Der Button **Kopieren** oben rechts im YAML-Tab legt das YAML der aktuellen Datei in die Zwischenablage. **Speichern** daneben schreibt es als Datei.

![YAML-Tab mit Kopieren und Speichern](/img/screens/umgebung-dev.png)

Praktisch z. B. für `oc apply -f -`:

```powershell
Get-Clipboard | oc apply -f -
```

## In der Web-Version

Ohne Electron, also bei `bun run dev`, gibt es keinen Ordner-Dialog. Dort startet *Alle Dateien in Ordner* einen Download pro Datei.
