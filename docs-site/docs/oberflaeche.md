---
title: Die Oberfläche
sidebar_label: Oberfläche
sidebar_position: 4
---

# Die Oberfläche

![Die Bereiche der Oberfläche, nummeriert](/img/screens/uebersicht.png)

| # | Bereich | Kurz |
| --- | --- | --- |
| 1 | Menüs | Datei, Importieren, Exportieren |
| 2 | Projekt | Ordner-Symbol = Projektverwaltung, Name direkt bearbeitbar |
| 3 | Umgebung | Aktive Umgebung für Variablen und Export |
| 4 | Dateien | Alle Dateien des Projekts |
| 5 | Palette | Block-Kategorien und Vorlagen |
| 6 | Block-Fläche | Hier baust du |
| 7 | Inspector-Tabs | YAML, Variablen, Probleme, Vorlagen |
| 8 | Live-YAML | Ergebnis der aktuellen Datei |
| 9 | Statusleiste | Umgebung, Zähler, Speicherstatus |

Eine ausführliche Tour mit allen Details steht im Handbuch unter [Arbeitsbereich](handbuch/arbeitsbereich.md).

## Titelleiste

| Datei | Importieren | Exportieren |
| --- | --- | --- |
| ![Menü Datei](/img/screens/menue-datei.png) | ![Menü Importieren](/img/screens/menue-import.png) | ![Menü Exportieren](/img/screens/menue-export.png) |

| Element | Funktion |
| --- | --- |
| **Datei** | Neues Projekt, Projekte öffnen, neue Compose- oder Kubernetes-Datei, Kurzreferenz |
| **Importieren** | YAML-Dateien, YAML einfügen, `.byob`-Datei |
| **Exportieren** | Aktuelle Datei, alle Dateien in einen Ordner, Projekt als `.byob`, Komplett-Backup |
| 📁 + Projektname | Das Ordner-Symbol öffnet die Projektverwaltung, den Namen kannst du direkt bearbeiten |
| **Umgebung** | Aktive Umgebung für [Variablen](funktionen/variablen.md) und Export |

## Dateien (links)

![Dateiliste](/img/screens/dateien.png)

Jedes Projekt besteht aus einer oder mehreren Dateien. Das Kürzel vorne zeigt den Typ:

- **DC**: Docker Compose. Die Palette zeigt Compose-, Service- und Extras-Blöcke.
- **K8**: Kubernetes/OpenShift. Die Palette zeigt alle Ressourcen-Kategorien.

Beim Überfahren einer Zeile erscheinen Umbenennen, Duplizieren und Löschen. Ein Doppelklick benennt ebenfalls um.

## Block-Fläche (Mitte)

![Palette mit aufgeklappter Kategorie Container](/img/screens/palette-container.png)

- **Palette:** Kategorien links in der Fläche. Ein Klick öffnet die Blöcke, die du auf die Fläche ziehst.
- **Anordnen:** Schiebt alle Stapel ordentlich untereinander.
- **Einpassen:** Zoomt so, dass alle Blöcke sichtbar sind.
- **Zoom:** Mausrad oder die Lupen unten rechts.
- **Löschen:** Block auf den Papierkorb oder zurück in die Palette ziehen, oder <kbd>Entf</kbd> drücken.
- **Rechtsklick:** Auf einen Block oder auf die leere Fläche, siehe unten.

| Rechtsklick auf einen Block | Rechtsklick auf die leere Fläche |
| --- | --- |
| ![Kontextmenü Block](/img/screens/kontextmenue.png) | ![Kontextmenü Fläche](/img/screens/kontextmenue-flaeche.png) |

Deaktivierte Blöcke (Rechtsklick → *Baustein deaktivieren*) werden grau und erzeugen kein YAML. Damit schaltest du etwas vorübergehend ab, ohne es zu löschen.

## Inspector (rechts)

| Tab | Inhalt |
| --- | --- |
| **YAML** | Live-Ergebnis der aktuellen Datei, Kopieren und Speichern |
| **Variablen** | Umgebungen und Variablen-Tabelle, siehe [Variablen](funktionen/variablen.md) |
| **Probleme** | Alle Warnungen; ein Klick springt zum Block |
| **Vorlagen** | Eigene Vorlagen umbenennen oder löschen |

## Statusleiste

![Statusleiste](/img/screens/statusleiste.png)

Von links nach rechts: aktive Umgebung, Anzahl der Dokumente und Zeilen, Probleme. Rechts steht der Speicherort (*SQLite* in der App, *Browser-Speicher* in der Web-Version) und wann zuletzt gespeichert wurde. Ein Klick auf *SQLite* öffnet den Datenordner im Explorer.
