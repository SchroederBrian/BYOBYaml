---
title: Wertblöcke
sidebar_label: Wertblöcke
sidebar_position: 2
---

# Wertblöcke

Wertblöcke sind kleine **runde** Blöcke, die du in jedes Text- oder Zahlenfeld ziehst, ähnlich wie bei Scratch. Beim Export berechnet BYOBYaml den Wert und schreibt das Ergebnis ins YAML. So automatisierst du Zufallswerte, Zeitstempel, zusammengesetzte Namen und umgebungsabhängige Werte.

## Benutzen

1. Öffne in der Palette die Kategorie **Werte**.
2. Zieh einen Wertblock auf ein Feld eines Blocks, zum Beispiel *Zufallszahl von 1 bis 100* auf die Replicas eines Deployments.
3. Das Feld zeigt jetzt den Wertblock statt der Eingabe. Nimmst du den Block wieder heraus, steht im Feld wieder der Wert, den du vorher eingetragen hattest.

Wertblöcke lassen sich ineinander stecken: *Verbinde [Zufallstext Länge 6] und [Zeitstempel Datum] mit Trenner [-]* ergibt zum Beispiel `k3x9ab-2026-11-06`.

Variablen mit `${NAME}` in einem normalen Feld funktionieren weiter wie bisher. Der Wertblock *Variable* ist die Variante zum Hineinziehen.

## Wann wird gewürfelt?

- **Jeder Export würfelt neu:** Kopieren, Speichern, Ordner-Export und Helm-Export verwenden jeweils einen neuen Zufallswert und den Zeitpunkt des Exports.
- **Eine Vorschau bleibt ruhig:** Die YAML-Vorschau behält ihre Werte, während du Blöcke bearbeitest. Mit **Würfeln** über der Vorschau würfelst du die Vorschau neu.
- **Alle Dateien eines Exports teilen Zeitpunkt und Zähler.** Jede Datei würfelt aber eigene Zufallswerte. Soll derselbe Wert in mehreren Dateien stehen (etwa ein Passwort in Secret und Anwendung), setz den Block *Merke … als …* darum herum. Der erste Wert unter diesem Namen gilt im ganzen Export.

:::caution
Zufallswerte ändern sich bei jedem Export. Lege deshalb Passwörter, die du später noch brauchst, nicht nur als Wertblock an. Sonst wird bei jedem Export ein neues Passwort erzeugt und nirgends gespeichert. Für feste Werte eignen sich [Variablen](./variablen.md) oder der Secret-Tresor.
:::

## Fehler

Ein Wertblock mit ungültigen Eingaben (etwa `Minimum` größer als `Maximum`, Division durch 0 oder eine unbekannte Variable) zeigt ein Warnsymbol, erscheint im Tab **Probleme** und sperrt den Export, bis du ihn korrigierst.

## Grenzen

- Wertblöcke gibt es nur in Text- und Zahlenfeldern. Auswahllisten, Häkchen und mehrzeilige Felder nehmen keine Wertblöcke an.
- In **eigenen Blocktypen** bleiben Felder, die an einen Parameter gebunden sind, reine Eingabefelder.
- Im **Helm-Export** werden Wertblöcke beim Export berechnet und fest in die Vorlagen geschrieben. Ein Wertblock wird also nicht zu einem Wert in `values.yaml`.
- Jeder Block rechnet nur mit Text und Zahlen. Es gibt keine Listen und keine Abfragen aus dem Netz.

## Alle Wertblöcke

Die vollständige Liste mit Feldern und Standardwerten steht in der [Block-Referenz → Werte](/docs/referenz/werte).
