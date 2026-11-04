---
title: 6 · Vorlagen nutzen und speichern
sidebar_label: 6 · Vorlagen
sidebar_position: 6
---

# Vorlagen nutzen und speichern

## Mitgelieferte Vorlagen

Palette → **Vorlagen**. Die Vorlagen sind nach Themen gruppiert, über jeder steht eine Kurzbeschreibung:

![Palette Vorlagen](/img/screens/palette-vorlagen.png)

**Benutzen:** Die Vorlage wie einen Block herausziehen.

- Vorlagen **mit Startblock** (z. B. *Web-Deployment*) auf eine freie Stelle der Fläche ziehen.
- Vorlagen **ohne Startblock** an die passende Stelle ziehen. Die Beschreibung sagt, wohin, z. B. *Probes-Set (in Container legen)*.

Danach sind es ganz normale Blöcke, die du anpasst wie alle anderen.

## Eigene Vorlage speichern

Beispiel: Ein Container mit Ressourcen-Grenzen und Sicherheitseinstellungen, den du in jedem Projekt brauchst.

**1. Rechtsklick** auf den obersten Block der Kombination, hier den Container:

![Rechtsklick auf den Container](/img/screens/kontextmenue.png)

**2. Ab hier als Vorlage speichern…** wählen und einen Namen vergeben:

![Vorlage benennen](/img/screens/vorlage-speichern.png)

Gespeichert werden der Container, **alles darin** und alle Blöcke **darunter**, nicht aber das Deployment darüber.

**3.** Ab sofort steht die Vorlage in jedem Projekt unter **Meine Vorlagen**:

![Meine Vorlagen in der Palette](/img/screens/meine-vorlagen.png)

## Verwalten und teilen

- **Umbenennen / Löschen:** Inspector-Tab **Vorlagen**
- **Teilen:** *Exportieren → Backup: alles als .byob…* enthält alle eigenen Vorlagen. Wer die Datei importiert, hat sie unter *Meine Vorlagen*.

Den kompletten Katalog der mitgelieferten Vorlagen mit erzeugtem YAML findest du unter [Vorlagen-Katalog](../vorlagen/katalog.mdx).
