---
title: Helm-Chart-Export
sidebar_label: Helm-Export
sidebar_position: 3
---

# Helm-Chart-Export

Unter **Exportieren → Helm-Chart (.tgz)…** erstellst du ein Helm-Chart aus den Kubernetes-/OpenShift-Dateien des Projekts. Änderungen der gerade geöffneten Datei werden dabei berücksichtigt.

## Chart erstellen

1. Chart-Name, SemVer-Version (zum Beispiel `0.1.0`) und Beschreibung eintragen.
2. Quelldateien auswählen. Compose-Dateien werden nicht automatisch in Kubernetes-Ressourcen übersetzt.
3. Hinweise prüfen. Doppelte Ressourcennamen im selben Namespace, fehlerhafte Blöcke und ungültige Zahlenwerte müssen vor dem Export behoben werden.
4. Unter **Dateivorschau** die erzeugten Dateien prüfen. Der **Helm-Graph** verbindet Chart, Values, Templates und Ressourcen. Er zeigt außerdem, welche Variablen ein Template parametrisieren. Werte selbst erscheinen nicht im Graphen.
5. **.tgz herunterladen** erstellt ein Helm-Paket mit dem Chart als oberstem Ordner.

Das Archiv enthält `Chart.yaml`, `values.yaml`, `values-<umgebung>.yaml`, `values.schema.json`, `templates/`, `_helpers.tpl`, `.helmignore` und eine Anleitung. Statische CustomResourceDefinitions liegen unter `crds/`, da Helm diese Dateien nicht templatisiert. CRDs mit Variablen müssen separat als statische Ressource vorbereitet werden.

## Variablen und Umgebungen

Nur in ausgewählten Ressourcen verwendete Variablen werden übernommen. Globale Werte stehen unter `global`, dateibezogene Werte unter `files.<dateischlüssel>`. Eine lokale Variable ersetzt gleichnamige globale Werte ausschließlich in ihrer Datei. Die aktive Umgebung liefert die Standardwerte in `values.yaml`; jede Projektumgebung erhält zusätzlich eine eigene Values-Datei.

Werte bleiben in den Values-Dateien Strings. Die Templates quotieren Text und erzeugen Zahlen, boolesche Werte und Berechtigungsmodi im erforderlichen YAML-Typ. Zusammengesetzte Zeichenketten und mehrzeilige Werte werden dabei erhalten. Go-Template-Zeichen in Blockdaten werden als Daten behandelt, nicht über `tpl` ausgeführt.

OpenShift-Templates werden in ihre enthaltenen Ressourcen aufgelöst. Feste Parameterwerte werden als dateibezogene Values übernommen, sofern normale Projektvariablen sie nicht ersetzen. Parameter ohne festen Wert bleiben erforderlich; OpenShift-Zufallsgeneratoren werden nicht ausgeführt. Typisierte `${{NAME}}`-Parameter erwarten einen JSON-Wert als String.

## Secrets

Der verschlüsselte Tresor, sein Passwort und entschlüsselte Werte werden niemals in das Chart übernommen. Nicht definierte Variablen werden zu erforderlichen externen Values. Trage diese vor dem Rendern oder Installieren in einer eigenen Datei ein. Das funktioniert auch bei gesperrtem Tresor.

Normale Variablenwerte und direkt in Blöcken eingetragene Werte liegen dagegen im Klartext vor. Auch Base64-kodierte Kubernetes-Secret-Daten sind keine Verschlüsselung.

## Mit Helm verwenden

Nach dem Entpacken im Chart-Ordner:

```sh
helm lint .
helm template mein-release . -f values-dev.yaml
helm upgrade --install mein-release . -f values-prod.yaml
```

Erforderliche externe Werte lassen sich mit einer zusätzlichen Datei ergänzen:

```sh
helm template mein-release . -f values-prod.yaml -f meine-geheimen-werte.yaml
```

Ressourcennamen, Selektoren und explizite Namespaces bleiben erhalten. `--namespace` ersetzt keine im Manifest eingetragenen Namespaces. Unterstützte APIs und vorhandene Ressourcen hängen vom Zielcluster ab. Eine Cluster-Installation wird durch den Export nicht ausgelöst. Die vollständige Anleitung liegt auch im heruntergeladenen Chart.
