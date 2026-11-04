---
title: Variablen & Umgebungen
sidebar_label: Variablen
sidebar_position: 1
---

# Variablen & Umgebungen

Variablen machen ein Projekt für mehrere Umgebungen nutzbar: dieselben Blöcke, aber andere Namespaces, Replicas, Hostnamen oder Image-Tags.

## Benutzen

Schreib `${NAME}` in **irgendein** Textfeld oder Zahlenfeld:

![Blöcke mit Variablen in Namen, Replicas, Namespace, Image und Hostname](/img/screens/devprod-dev.png)

Auch Teile eines Werts funktionieren: `postgres://app:${DB_PASSWORD}@db:5432/app`.

Variablennamen beginnen mit einem Buchstaben oder `_` und dürfen danach Buchstaben, Ziffern, `_`, `.` und `-` enthalten.

## Verwalten

Tab **Variablen** im Inspector:

![Tab Variablen](/img/screens/variablen.png)

1. **Umgebungen:** Chips oben. Ein Klick macht eine Umgebung aktiv, das × entfernt sie, und über das Eingabefeld legst du eine neue an (<kbd>Enter</kbd>).
2. **Variablen:** Mit *+ Variable* fügst du eine Zeile hinzu. Die Spalten sind Name und je ein Wert pro Umgebung.
3. Das Kopier-Symbol legt `${NAME}` in die Zwischenablage.

Die aktive Umgebung wählst du auch oben rechts in der Titelleiste. Das YAML aktualisiert sich sofort.

## Beispiel

Variablen des Beispielprojekts *OpenShift Demo-App*:

| Name | dev | prod |
| --- | --- | --- |
| `APP` | `demo-app` | `demo-app` |
| `NAMESPACE` | `demo-dev` | `demo-prod` |
| `REPLICAS` | `1` | `3` |

Dieselben Blöcke wie oben, nur die Umgebung oben rechts auf `prod` umgestellt: Namespace `demo-prod`, `replicas: 3`, und auch der zusammengesetzte Hostname der Route ändert sich.

![Gleiche Blöcke, Umgebung prod](/img/screens/devprod-prod.png)

## Regeln

- **Zahlenfelder:** Erst wird die Variable eingesetzt, dann wird der Wert als Zahl gelesen. `${REPLICAS}` mit Wert `3` ergibt `replicas: 3`.
- **Unbekannte Variablen** bleiben als Text `${X}` stehen, und der Block meldet ein Problem.
- **Leere Werte** sind erlaubt und ergeben einen leeren String.
- **Export:** *Alle Dateien in Ordner* verwendet die aktive Umgebung. Für prod also vorher oben rechts auf `prod` umschalten.
- Variablen sind **pro Projekt** gespeichert und wandern mit dem Projekt in `.byob`-Dateien.

:::caution Geheimnisse
Variablenwerte liegen im Klartext in der lokalen Datenbank und in exportierten `.byob`-Dateien. Für echte Passwörter besser Platzhalter wie `change-me` verwenden und die Werte im Cluster setzen, z. B. mit `oc create secret`, Sealed Secrets oder External Secrets.
:::
