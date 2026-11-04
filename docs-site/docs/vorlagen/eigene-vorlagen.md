---
title: Vorlagen benutzen & erstellen
sidebar_label: Eigene Vorlagen
sidebar_position: 1
---

# Vorlagen

Vorlagen sind **kleine, wiederverwendbare Block-Kombinationen**: keine kompletten Projekte, sondern Bausteine wie „PostgreSQL mit Healthcheck“ oder „Probes-Set für einen Container“.

## Mitgelieferte Vorlagen

| In Kubernetes-Dateien | In Compose-Dateien |
| --- | --- |
| ![Kubernetes-Vorlagen](/img/screens/palette-vorlagen.png) | ![Compose-Vorlagen](/img/screens/palette-vorlagen-compose.png) |

In der Palette unter **Vorlagen**. Welche Vorlagen erscheinen, hängt vom Dateityp ab: Compose-Vorlagen in Compose-Dateien, Kubernetes-Vorlagen in Kubernetes-Dateien. Sie sind nach Themen gruppiert, jede mit kurzer Beschreibung darüber.

Es gibt zwei Arten:

- **Mit Startblock**, z. B. *Web-Deployment* oder *Service HTTP*: einfach irgendwo auf die Fläche ziehen.
- **Ohne Startblock**, z. B. *Traefik Labels* oder *Probes-Set*: an die passende Stelle in einem bestehenden Stapel ziehen. Die Beschreibung sagt, wohin („in Container legen“).

Der vollständige Katalog mit erzeugtem YAML steht unter [Vorlagen-Katalog](katalog.mdx).

## Eigene Vorlagen speichern

![Rechtsklick: Ab hier als Vorlage speichern](/img/screens/kontextmenue.png)

![Name der Vorlage eingeben](/img/screens/vorlage-speichern.png)

1. Baue die Kombination auf der Fläche.
2. **Rechtsklick auf den obersten Block**, der dazugehören soll → **Ab hier als Vorlage speichern…**
3. Namen vergeben → *Speichern*.

Gespeichert werden der angeklickte Block, alles, was in ihm steckt, und **alle Blöcke darunter** im selben Stapel.

:::tip Nur einen Teil speichern
Willst du nur die mittleren drei Blöcke eines Stapels, zieh sie kurz heraus (der unterste kommt automatisch mit). Dann speicherst du sie als Vorlage und schiebst sie wieder zurück.
:::

## Eigene Vorlagen benutzen

![Meine Vorlagen in der Palette](/img/screens/meine-vorlagen.png)

Palette → **Meine Vorlagen**. Die Liste ist alphabetisch sortiert und in Compose- wie Kubernetes-Dateien verfügbar.

## Verwalten

Tab **Vorlagen** im Inspector: Umbenennen ✎ und Löschen 🗑. Vorlagen liegen in der Datenbank (Tabelle `snippets`) und sind über alle Projekte hinweg verfügbar.

## Teilen

*Exportieren → Backup: alles als .byob…* enthält alle eigenen Vorlagen. Importiert jemand diese Datei, bekommt er sie unter *Meine Vorlagen*. Siehe [.byob-Format](../funktionen/byob-format.md).
