---
title: 4 · Variablen & Umgebungen
sidebar_label: 4 · Variablen
sidebar_position: 4
---

# Variablen & Umgebungen

Mit Variablen erzeugst du aus **denselben Blöcken** das YAML für dev, test und prod.

## Der Tab Variablen

![Tab Variablen mit Umgebungen dev und prod](/img/screens/variablen.png)

- **Umgebungen** (oben): Ein Klick auf einen Chip macht die Umgebung aktiv, ✕ entfernt sie. Im Feld *neue Umgebung* den Namen eintippen und <kbd>Enter</kbd> drücken.
- **Für alle Dateien**: Globale Variablen, die in jeder Datei des Projekts verfügbar sind.
- **Nur diese Datei**: Lokale Variablen für die im Explorer ausgewählte Datei. Der Dateiname über der Tabelle zeigt, welche Datei du bearbeitest.
- In beiden Tabellen steht pro Zeile ein Name und je ein Wert pro Umgebung. Die aktive Umgebung ist blau hervorgehoben.
- **⧉** kopiert `${NAME}` in die Zwischenablage, damit du es direkt in ein Blockfeld einfügen kannst.
- **+ Variable** legt im jeweiligen Bereich eine neue Zeile an.

## Gültigkeitsbereich wählen

Gemeinsame Werte wie `REGISTRY` gehören unter **Für alle Dateien**. Werte, die nur ein Deployment oder eine Compose-Datei braucht, legst du unter **Nur diese Datei** an.

Ein Name darf in beiden Bereichen vorkommen. Die lokale Variable hat dann in ihrer Datei Vorrang:

| Definition | dev | prod |
| --- | --- | --- |
| `APP` für alle Dateien | `shop-dev` | `shop` |
| `APP` nur in `worker.yaml` | `worker-dev` | `worker` |

`${APP}` ergibt in `worker.yaml` also `worker-dev` bzw. `worker`. In anderen Dateien ergibt es `shop-dev` bzw. `shop`. Beim Wechsel im Explorer zeigt die lokale Tabelle die Variablen der neu ausgewählten Datei.

Auch ein leerer lokaler Wert überschreibt den globalen Wert. Um wieder den globalen Wert zu verwenden, löschst du die lokale Zeile über das Papierkorb-Symbol.

Beim Duplizieren einer Datei werden ihre lokalen Variablen unabhängig mitkopiert. Beide Bereiche bleiben beim Speichern und in exportierten `.byob`-Projekten erhalten. Entfernst du eine Umgebung, werden ihre Werte auch aus den lokalen Variablen aller Dateien entfernt.

## In Blöcken benutzen

Tipp `${NAME}` in irgendein Feld. Im Beispielprojekt steht im Deployment-Startblock:

<span className="blk blk-hat" style={{'--c':'#c08a1e'}}>Deployment $&#123;APP&#125; Replicas $&#123;REPLICAS&#125;</span>

### Umgebung dev

![YAML mit Umgebung dev: replicas 1](/img/screens/umgebung-dev.png)

### Umgebung prod

Oben rechts **Umgebung** auf `prod` stellen. Die Blöcke bleiben gleich, das YAML ändert sich sofort:

![YAML mit Umgebung prod: replicas 3](/img/screens/umgebung-prod.png)

| Variable | dev | prod | Wirkung |
| --- | --- | --- | --- |
| `APP` | `demo-app` | `demo-app` | `metadata.name`, Labels, Selector |
| `NAMESPACE` | `demo-dev` | `demo-prod` | `metadata.name` des Namespace in `01-namespace.yaml` |
| `REPLICAS` | `1` | `3` | `spec.replicas` (als Zahl) |

## Gute Praxis

- **Großbuchstaben** für Variablennamen (`NAMESPACE`, `TAG`), damit sie in Feldern sofort auffallen.
- Werte, die überall gleich sind, als **feste Werte** stehen lassen. Variablen nur für echte Unterschiede.
- **Teilwerte** gehen auch: `registry.example.com/shop:${TAG}` oder `postgres://app:${DB_PASSWORD}@db/app`.
- Vor dem Export die **Umgebung prüfen**: *Alle Dateien in Ordner…* nimmt die aktive Umgebung und löst für jede Datei deren eigene lokalen Variablen auf. Das Menü zeigt die Umgebung an.

Ein Komplettbeispiel mit vier Umgebungen steht in der Anleitung [dev und prod](../anleitungen/dev-prod.md).
