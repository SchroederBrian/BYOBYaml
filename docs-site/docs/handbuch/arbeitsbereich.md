---
title: 1 · Der Arbeitsbereich
sidebar_label: 1 · Arbeitsbereich
sidebar_position: 1
---

# Der Arbeitsbereich

Dieses Kapitel führt durch das Fenster. Alle Screenshots stammen aus der App und zeigen das Beispielprojekt **OpenShift Demo-App**, das beim ersten Start automatisch angelegt wird.

![BYOBYaml mit nummerierten Bereichen](/img/screens/uebersicht.png)

<ol className="legend">
  <li><b>Menüs</b>: Datei, Importieren, Exportieren</li>
  <li><b>Projekt</b>: Das Ordner-Symbol öffnet die Projektverwaltung, der Name daneben lässt sich direkt bearbeiten</li>
  <li><b>Umgebung</b>: Welche Variablenwerte gerade gelten (dev, prod …)</li>
  <li><b>Dateien</b>: Alle YAML-Dateien des Projekts, darüber die Knöpfe für neue Compose- und Kubernetes-Dateien sowie Import</li>
  <li><b>Palette</b>: Block-Kategorien; ein Klick klappt die Blöcke der Kategorie auf</li>
  <li><b>Block-Fläche</b>: Hier baust du. Zoom, Zentrieren und Papierkorb unten rechts</li>
  <li><b>Inspector-Tabs</b>: YAML, Variablen, Probleme, Vorlagen</li>
  <li><b>Live-YAML</b>: Das Ergebnis der aktuellen Datei, aktualisiert bei jeder Änderung</li>
  <li><b>Statusleiste</b>: Umgebung, Dokumente/Zeilen, Probleme, Speicherort, letzter Speicherzeitpunkt</li>
</ol>

## Dateien

![Dateiliste](/img/screens/dateien.png)

- **K8** steht für Kubernetes/OpenShift, **DC** für Docker Compose. Der Typ bestimmt, welche Blöcke die Palette anbietet.
- Die drei Symbole oben: neue **Compose**-Datei (Wal), neue **Kubernetes**-Datei (Steuerrad), **YAML importieren** (Pfeil).
- Mit der Maus über eine Datei fahren: Es erscheinen ✎ Umbenennen, ⧉ Duplizieren und 🗑 Löschen. Doppelklick benennt ebenfalls um.
- Der Name ist gleichzeitig der Dateiname beim Export, also am besten mit Endung, z. B. `04-deployment.yaml`.

### Ordner

- **Neuer Ordner**: Ordner-Symbol mit Plus oben in der Dateiliste. Der Ordner entsteht im gerade gewählten Ordner, gleich danach tippst du den Namen.
- **Ordner wählen**: Ein Klick auf einen Ordner klappt ihn auf oder zu und macht ihn zum *aktuellen* Ordner. Neue Dateien und importierte YAML-Dateien landen dort. Ein Klick auf eine Datei macht ihren Ordner zum aktuellen.
- **Verschieben**: Dateien oder ganze Ordner per Drag & Drop auf einen Ordner ziehen. Ganz unten erscheint beim Ziehen *Hierher ziehen: oberste Ebene*. Ordner lassen sich auch ineinander schachteln.
- **Umbenennen**: Doppelklick auf den Ordner oder ✎.
- **Auflösen** (🗑 am Ordner): Der Ordner verschwindet, seine Dateien wandern eine Ebene nach oben. Dabei wird **keine Datei gelöscht**.
- Beim Export **Alle Dateien in Ordner…** legt die Desktop-App die Ordner als Unterordner an. Im Browser steht der Ordner im Dateinamen (`web_04-deployment.yaml`).

### Mehrere Dateien auf einmal

- <kbd>Strg</kbd>+Klick wählt einzelne Dateien dazu oder ab, <kbd>Shift</kbd>+Klick wählt einen Bereich, <kbd>Strg</kbd>+<kbd>A</kbd> in der Dateiliste wählt alle.
- <kbd>Strg</kbd>+Klick auf einen Ordner wählt alle Dateien darin.
- Auf dem Handy oder ohne Tastatur: das Häkchen-Symbol oben in der Dateiliste schaltet den Auswahlmodus ein, dann genügt Antippen.
- Über der Liste erscheint eine Leiste mit **Verschieben** (in einen Ordner, nach oben oder in einen neuen Ordner), **Duplizieren**, **Exportieren** (als YAML) und **Löschen** (<kbd>Entf</kbd>). Vor dem Löschen zeigt die App, welche Dateien betroffen sind.
- Ziehst du eine ausgewählte Datei, wandern alle ausgewählten mit. <kbd>Esc</kbd> hebt die Auswahl auf.

## Menüs

| Datei | Importieren | Exportieren |
| --- | --- | --- |
| ![Menü Datei](/img/screens/menue-datei.png) | ![Menü Importieren](/img/screens/menue-import.png) | ![Menü Exportieren](/img/screens/menue-export.png) |

## Palette

Ein Klick auf eine Kategorie klappt ihre Blöcke auf. Oben steht jeweils, wofür die Kategorie gedacht ist und wohin ihre Blöcke gehören.

![Palette: Kategorie Container](/img/screens/palette-container.png)

Die Palette schließt sich wieder, sobald du einen Block herausziehst oder auf die leere Fläche klickst.

## Inspector

- **YAML**: Ergebnis mit Zeilennummern. **Kopieren** legt es in die Zwischenablage, **Speichern** schreibt die Datei.
- **Variablen**: siehe [Variablen & Umgebungen](variablen-umgebungen.md)
- **Probleme**: siehe [Fehler finden](fehler-finden.md)
- **Vorlagen**: eigene Vorlagen verwalten, siehe [Vorlagen](vorlagen.md)

Weiter mit [Blöcke bauen](bloecke-bauen.md).
