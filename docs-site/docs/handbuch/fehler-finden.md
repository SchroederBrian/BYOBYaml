---
title: 3 · Fehler finden
sidebar_label: 3 · Fehler finden
sidebar_position: 3
---

# Fehler finden

BYOBYaml lässt jeden Block überall einrasten, prüft aber bei jeder Änderung, ob er dort Sinn ergibt.

## Beispiel: Port an der falschen Stelle

Im Screenshot hängt **Port 8080** direkt unter dem Deployment statt im Container:

![Ein falsch platzierter Block mit Warnung](/img/screens/probleme.png)

Was passiert:

1. Der Block bekommt ein **⚠** vorne. Ein Klick darauf zeigt die Meldung als Sprechblase.
2. Der Tab **Probleme** zeigt eine Zahl und die Meldung *Dieser Block gehört in einen "Container"-Block.*
3. Der Block wird **nicht** ins YAML übernommen, der Rest schon.
4. Die Statusleiste zeigt *⚠ 1 Probleme*.

**Lösung:** Port-Block greifen und in den Mund des Container-Blocks ziehen, z. B. über **Variable TZ**. Das ⚠ verschwindet sofort.

:::tip Klick auf die Meldung
Ein Klick auf eine Meldung im Tab Probleme zentriert die Fläche auf den betroffenen Block und markiert ihn. Das ist hilfreich bei großen Dateien.
:::

## Häufige Meldungen und was zu tun ist

| Meldung | Lösung |
| --- | --- |
| *gehört in einen "Container"-Block* | In den Mund eines Container- oder Init-Container-Blocks ziehen |
| *gehört unter ein Deployment, StatefulSet, Job oder CronJob* | Pod-Block direkt unter einen Workload-Startblock hängen |
| *gehört in einen "Service"-Block* | Compose: in den Mund des Service-Blocks |
| *gehört unter einen Ressourcen-Startblock (gelb)* | Metadaten-Blöcke brauchen einen Startblock darüber |
| *"web" hat noch keinen Container-Block.* | **Pod → Container** einsetzen |
| *Variable `${X}` ist nicht definiert.* | Im Tab **Variablen** anlegen oder den Tippfehler korrigieren |
| *"abc" ist keine Zahl.* | Zahlenfeld prüfen; auch der Variablenwert muss eine Zahl sein |
| *YAML-Fehler: …* | Text im Block *YAML einmischen* korrigieren, z. B. `{a: 1}` statt `{a: 1` |

Die vollständige Liste steht unter [Gültige Plätze & Probleme](../konzepte/gueltige-plaetze.md).
