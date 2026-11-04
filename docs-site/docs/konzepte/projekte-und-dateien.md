---
title: Projekte und Dateien
sidebar_position: 3
---

# Projekte und Dateien

Ein **Projekt** besteht aus Dateien, [Variablen](../funktionen/variablen.md) und Umgebungen. Das Beispielprojekt *OpenShift Demo-App* hat elf Kubernetes-Dateien, drei Variablen und die Umgebungen `dev` und `prod`:

![Ein Projekt mit mehreren Dateien](/img/screens/app.png)

## Projekte

Projekte liegen in der lokalen Datenbank, siehe [Speicherung](../funktionen/speicherung.md). Die **Projektverwaltung** öffnest du über das Ordner-Symbol neben dem Projektnamen oder über *Datei → Projekte öffnen…*:

![Projektverwaltung](/img/screens/projekte.png)

- Suche über alle Projekte
- Öffnen (Klick auf den Namen oder Doppelklick auf die Zeile)
- Duplizieren
- Löschen (nicht beim gerade geöffneten Projekt)
- Neues Projekt oder ein Beispielprojekt anlegen

Beim nächsten Start öffnet BYOBYaml automatisch das zuletzt benutzte Projekt.

## Dateien

![Dateiliste](/img/screens/dateien.png)

Jede Datei hat einen **Typ**, der festlegt, welche Blöcke die Palette zeigt:

| Docker Compose (**DC**) | Kubernetes / OpenShift (**K8**) |
| --- | --- |
| ![Palette einer Compose-Datei](/img/screens/toolbox-compose.png) | ![Palette einer Kubernetes-Datei](/img/screens/toolbox-k8s.png) |
| Compose, Service, Extras | Ressourcen, Metadaten, Pod, Container, Netzwerk, Config & Daten, Build, Skalierung, Extras |

Neue Dateien legst du über die Symbole oberhalb der Dateiliste an (Wal = Compose, Steuerrad = Kubernetes) oder über das Menü *Datei*. Der Dateiname ist frei wählbar und wird beim Export verwendet. Jede Datei hat eine eigene Block-Fläche.

:::info Typ ändern
Den Typ einer Datei kannst du nachträglich nicht ändern. Blöcke lassen sich aber per <kbd>Strg</kbd>+<kbd>C</kbd> / <kbd>Strg</kbd>+<kbd>V</kbd> in eine neue Datei des anderen Typs kopieren.
:::
