---
title: 5 · Bestehendes YAML importieren
sidebar_label: 5 · Importieren
sidebar_position: 5
---

# Bestehendes YAML importieren

Am Beispiel eines Exports aus einem OpenShift-Cluster: ein Deployment und ein Service als `kind: List`, inklusive Cluster-Feldern wie `uid` und `status`.

## Schritt 1 – YAML einfügen

Unten links in der Dateiliste auf **YAML einfügen** klicken (oder *Importieren → YAML einfügen…*). Den Text einfügen und einen Dateinamen vergeben:

![Dialog YAML einfügen](/img/screens/import-einfuegen.png)

Statt einzufügen geht auch: *Importieren → YAML-Dateien…* (mehrere Dateien auf einmal) oder Dateien aus dem Explorer direkt ins Fenster **ziehen**.

## Schritt 2 – Import-Bericht lesen

Nach **In Blöcke umwandeln** zeigt BYOBYaml, was passiert ist:

![Import-Bericht](/img/screens/import-bericht.png)

- **2 Dokumente** erkannt: Die `List` wurde in Deployment und Service zerlegt.
- **2 Felder ohne eigenen Block** wurden als Extras übernommen; welche das sind, siehst du gleich.
- **Cluster-Felder entfernt**: `status`, `uid`, `resourceVersion` und `creationTimestamp` würden beim erneuten `apply` stören oder ignoriert werden.

## Schritt 3 – Ergebnis prüfen

![Importierte Blöcke](/img/screens/import-ergebnis.png)

| Original-YAML | wurde zu |
| --- | --- |
| `kind: Deployment`, `name: shop`, `replicas: 3` | Startblock **Deployment shop Replicas 3** |
| `metadata.namespace: shop-prod` | **im Namespace shop-prod** |
| `containers[0]` mit Name/Image | **Container web Image …** |
| `ports: [{containerPort: 8080, name: http}]` | **Port 8080 Name http** |
| `env: [{name: TZ, value: …}]` | **Variable TZ = Europe/Berlin** |
| `env` mit `valueFrom.fieldRef` (kein eigener Block) | **zu Liste env hinzufügen** `{…}` an derselben Stelle |
| `spec.revisionHistoryLimit: 10` (kein eigener Block) | **Feld spec.revisionHistoryLimit = 10** |
| `kind: Service` mit Selector `app: shop` | **Service shop für App shop** + **Port 80 → Ziel 8080** |

Das erzeugte YAML rechts ist **inhaltlich identisch** mit dem Original, nur ohne Cluster-Felder.

## Danach

- Unnötige Extras löschen, z. B. ist `revisionHistoryLimit: 10` ohnehin der Standardwert.
- Feste Werte durch [Variablen](variablen-umgebungen.md) ersetzen, z. B. `shop-prod` → `${NAMESPACE}`.
- Ressourcen bei Bedarf auf mehrere Dateien verteilen: Startblock markieren, <kbd>Strg</kbd>+<kbd>X</kbd>, neue Datei, <kbd>Strg</kbd>+<kbd>V</kbd>.

Mehr Details: [Import](../funktionen/import.md) · [Bestehende Manifeste übernehmen](../anleitungen/bestehende-manifeste.md)
