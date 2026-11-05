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
2. **Für alle Dateien:** Hier legst du globale Variablen für das ganze Projekt an.
3. **Nur diese Datei:** Hier legst du lokale Variablen für die im Explorer ausgewählte Datei an. Der Dateiname steht direkt darüber. Eine gleichnamige lokale Variable ersetzt in dieser Datei den globalen Wert.
4. Mit *+ Variable* im gewünschten Bereich fügst du eine Zeile hinzu. Die Spalten sind Name und je ein Wert pro Umgebung.
5. Das Kopier-Symbol legt `${NAME}` in die Zwischenablage.

Die aktive Umgebung wählst du auch oben rechts in der Titelleiste. Das YAML aktualisiert sich sofort.

## Global oder lokal?

Wie in Scratch wählst du, ob eine Variable überall oder nur im aktuellen Bereich gilt. Hier ist dieser Bereich eine **Datei**:

| Bereich | Sichtbar in | Beispiel |
| --- | --- | --- |
| Für alle Dateien | Allen Dateien des Projekts | `REGISTRY` für gemeinsame Container-Images |
| Nur diese Datei | Der ausgewählten Datei | `APP` für den Namen dieses Deployments |

Wenn global `APP=shop` und in `worker.yaml` lokal `APP=worker` steht, wird `${APP}` dort zu `worker`. Alle anderen Dateien verwenden weiterhin `shop`, sofern sie keinen eigenen lokalen Wert haben. Löschst du die lokale Variable, gilt in dieser Datei wieder die globale Variable.

Beide Bereiche haben Werte für dieselben Projektumgebungen. Ein **leerer lokaler Wert** überschreibt den globalen Wert ebenfalls; er fällt nicht auf ihn zurück.

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
- **Export:** *Alle Dateien in Ordner* verwendet die aktive Umgebung und für jede Datei deren globale und lokale Werte. Für prod also vorher oben rechts auf `prod` umschalten.
- **Umgebung entfernen:** Entfernt ihre Werte aus globalen Variablen und den lokalen Variablen aller Dateien.
- **Datei duplizieren:** Kopiert ihre lokalen Variablen mit. Änderungen an der Kopie ändern die ursprüngliche Datei nicht.
- Globale und lokale Variablen werden mit dem Projekt gespeichert und wandern in `.byob`-Dateien mit.

## Verschlüsselter Secret-Tresor

Unter den Variablen findest du den **Secret-Tresor** für Passwörter und API-Schlüssel:

1. **Tresor anlegen:** Wähle ein eigenes Master-Passwort mit mindestens zwölf Zeichen und bestätige es. Bewahre dieses Passwort sicher auf: Es wird nicht gespeichert und lässt sich nicht zurücksetzen.
2. **+ Secret:** Name, Gültigkeitsbereich (alle Dateien oder eine bestimmte Datei) und Werte für die Projektumgebungen eintragen. **Verschlüsselt speichern** speichert den Eintrag.
3. Verwende das Secret wie eine Variable, beispielsweise `${API_KEY}` oder `postgres://app:${DB_PASSWORD}@db:5432/app`. Ein dateibezogener Eintrag ersetzt gleichnamige globale Werte.
4. **Sperren** entfernt die entschlüsselten Einträge aus der Sitzung. Auch nach Neuladen, Projektwechsel und 15 Minuten Inaktivität ist der Tresor gesperrt. Mit dem Master-Passwort kannst du ihn wieder entsperren.

Die Verschlüsselung erfolgt im Browser mit AES-256-GCM. Der Schlüssel wird mit PBKDF2-HMAC-SHA-256 (600.000 Durchläufe und zufälligem Salt) aus dem Master-Passwort abgeleitet. Jede Speicherung verwendet einen neuen zufälligen Initialisierungsvektor. Der nicht exportierbare Schlüssel und entschlüsselte Einträge bleiben nur in der laufenden Sitzung.

Die YAML-Vorschau zeigt Platzhalter statt Secret-Werten. **YAML kopieren und exportieren enthält nach dem Entsperren die tatsächlichen Werte.** Bei einem gesperrten Tresor ist der YAML-Export des Projekts gesperrt. Für neu angelegte Umgebungen musst du fehlende Secret-Werte im Tresor ergänzen.

Projektdateien (`.byob`), Backups und die Projektdatenbank enthalten nur den verschlüsselten Tresor. Beim Teilen im Marktplatz wird der Tresor ausgelassen. Normale Variablenwerte bleiben dagegen unverschlüsselt. Bereits in Blockfelder oder normale Variablen eingetragene Passwörter werden nicht automatisch in den Tresor verschoben.

:::caution Exportierte Geheimnisse
Exportiertes YAML und kopierte Werte sind Klartext. Behandle diese Dateien und die Zwischenablage entsprechend vertraulich. Für die Verwaltung im Cluster kannst du weiterhin Kubernetes Secrets, Sealed Secrets oder External Secrets verwenden.
:::
