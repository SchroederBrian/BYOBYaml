---
title: Blöcke und Stapel
sidebar_position: 1
---

# Blöcke und Stapel

## Drei Blockformen

![Startblock, Stapelblock und Klammerblock](/img/screens/blockformen.png)

| Form | Im Bild | Aussehen | Bedeutung |
| --- | --- | --- | --- |
| **Startblock** | *Service web …* (oben) | abgerundete Kappe, kein Anschluss nach oben | Beginnt ein YAML-Dokument: *Docker Compose*, *Deployment*, *Service*, *Route* … |
| **Stapelblock** | *Label tier = frontend* | Kerbe oben, Nase unten | Setzt ein oder mehrere Felder im aktuellen Objekt |
| **Klammerblock** | *Container web …* mit *Port* darin | hat einen „Mund“ für weitere Blöcke | Erzeugt ein Unterobjekt: *Service* in Compose, *Container* in einem Pod |

Das ⚠ am Service-Startblock im Bild ist kein Fehler im Bild, sondern eine echte Warnung: Ein Service ohne Port-Block ist unvollständig.

## Ein Stapel = ein Dokument

Alles, was unter einem Startblock hängt, gehört zu diesem Dokument. Blöcke, die lose auf der Fläche liegen, erzeugen **kein** YAML; so kannst du Blöcke zwischenparken. Im Bild oben ergeben *Label* und *Container* deshalb kein YAML, weil sie an keinem Startblock hängen.

![Ein vollständiger Stapel und sein YAML](/img/screens/stapel.png)

| Block | Art | Landet im YAML unter |
| --- | --- | --- |
| *Deployment web Replicas 2* | Startblock | `apiVersion`, `kind`, `metadata.name`, `spec.replicas`, Selector, Pod-Labels |
| *im Namespace shop* | Stapelblock | `metadata.namespace` |
| *Container web Image …* | Klammerblock | `spec.template.spec.containers[0]` |
| ↳ *Port 8080 Name http* | im Container | `containers[0].ports` |
| ↳ *Variable TZ = Europe/Berlin* | im Container | `containers[0].env` |
| *Image Pull Secret regcred* | Stapelblock | `spec.template.spec.imagePullSecrets` |

## Mehrere Dokumente pro Datei

Liegen mehrere Startblöcke auf der Fläche einer Datei, entstehen mehrere YAML-Dokumente, getrennt durch `---`. Die Reihenfolge richtet sich nach der Position auf der Fläche, von oben nach unten.

![Deployment und Service in einer Datei](/img/screens/schritt-4.png)

:::tip Datei pro Ressource oder alles in einer Datei?
Beides geht. Für `oc apply -f ordner/` sind getrennte, nummerierte Dateien praktisch, etwa `01-namespace.yaml` oder `04-deployment.yaml`. Für einen schnellen Überblick passt alles in eine Datei.
:::

## Reihenfolge innerhalb eines Stapels

Die Reihenfolge der Blöcke bestimmt die Reihenfolge der Listeneinträge, z. B. bei Ports, Env-Variablen und Volumes. Bei Feldern, die nur einmal vorkommen können (z. B. *Neustart*), gewinnt der **letzte** Block.

[Extras-Blöcke](../funktionen/extras.md) wirken auf das, was die Blöcke darüber erzeugt haben. Damit lassen sich generierte Werte gezielt überschreiben.

## Felder

![Auswahlfeld geöffnet](/img/screens/feld-auswahl.png)

- **Textfelder** (helle Kästchen): hineinklicken und tippen. Leere optionale Felder werden im YAML weggelassen.
- **Zahlenfelder:** nehmen auch Variablen an, z. B. `${REPLICAS}`; siehe [Variablen](../funktionen/variablen.md).
- **Auswahlfelder** (▾): Klick öffnet die Liste mit den erlaubten Werten, wie im Bild bei *Neustart*.
- **Häkchen:** an oder aus

Fahre mit der Maus über einen Block. Der Tooltip erklärt, was der Block tut und wo er hingehört.
