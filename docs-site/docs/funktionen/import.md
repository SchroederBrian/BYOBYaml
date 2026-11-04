---
title: YAML importieren
sidebar_label: Import
sidebar_position: 2
---

# YAML importieren

BYOBYaml wandelt vorhandenes YAML in Blöcke um, die du danach normal weiterbearbeitest.

## Drei Wege

| Weg | Wie |
| --- | --- |
| **Dateien** | *Importieren → YAML-Dateien…*, mehrere Dateien gleichzeitig möglich |
| **Einfügen** | *Importieren → YAML einfügen…* oder unten links *YAML einfügen*, dann Text einfügen und Dateinamen vergeben |
| **Drag & Drop** | `.yaml`/`.yml`/`.byob` aus dem Explorer ins Fenster ziehen |

| Menü Importieren | Dialog YAML einfügen |
| --- | --- |
| ![Menü Importieren](/img/screens/menue-import.png) | ![Dialog YAML einfügen](/img/screens/import-einfuegen.png) |

Jede importierte YAML-Datei wird zu einer **neuen Datei im aktuellen Projekt**. Gibt es den Namen schon, wird automatisch `-2`, `-3` … angehängt. Danach zeigt ein **Import-Bericht** pro Datei, was passiert ist:

![Import-Bericht](/img/screens/import-bericht.png)

Das Ergebnis sind ganz normale Blöcke:

![Importierte Blöcke mit YAML](/img/screens/import-ergebnis.png)

Eine Schritt-für-Schritt-Erklärung dieses Beispiels steht im Handbuch unter [Importieren](../handbuch/importieren.md).

## Was erkannt wird

- **Docker Compose:** Dokumente ohne `apiVersion`/`kind`, mit `services:` oder `version:`
- **Kubernetes/OpenShift:** alles mit `apiVersion` und `kind`
- **Mehrere Dokumente** (`---`) → mehrere Startblöcke, automatisch angeordnet
- **`kind: List`** mit `items:`, also die Ausgabe von `oc get … -o yaml` oder `kubectl get … -o yaml`, wird in einzelne Ressourcen zerlegt
- **YAML-Anker und Merge-Keys** (`&common`, `<<: *common`) werden aufgelöst

## Cluster-Felder werden entfernt

Exporte aus einem laufenden Cluster enthalten Felder, die du nicht wieder anwenden willst. BYOBYaml entfernt sie automatisch und listet sie im Bericht auf:

- `status`
- `metadata.uid`, `resourceVersion`, `creationTimestamp`, `generation`, `managedFields`, `selfLink`, `ownerReferences`
- Annotationen `kubectl.kubernetes.io/last-applied-configuration`, `deployment.kubernetes.io/revision`, `openshift.io/generated-by`

## Nichts geht verloren

Der Importer kennt für jeden Ressourcen-Typ die passenden Blöcke. Felder **ohne** eigenen Block werden zu [Extras-Blöcken](extras.md):

| Fall | Wird zu |
| --- | --- |
| Einzelnes unbekanntes Feld, z. B. `spec.revisionHistoryLimit: 10` | <span className="blk">Feld spec.revisionHistoryLimit = 10</span> |
| Listeneintrag mit unbekannter Form, z. B. ein Env mit `fieldRef` | <span className="blk">zu Liste env hinzufügen &#123;…&#125;</span> an derselben Stelle in der Reihenfolge |
| Schlüssel mit Punkt, z. B. `networks: {backend: {aliases: …}}` | <span className="blk">YAML einmischen &#123;…&#125;</span> |
| Unbekannte Ressource, z. B. `Certificate` | Startblock *Eigene Ressource* + Feld-Blöcke |
| Bekannter Typ, aber andere `apiVersion` (z. B. `extensions/v1beta1`) | ebenfalls *Eigene Ressource* |

Der Bericht nennt, wie viele Felder als Extras übernommen wurden.

## Was sich im Ergebnis unterscheiden kann

Das erzeugte YAML ist **inhaltlich gleich**, die Schreibweise kann sich aber unterscheiden:

| Original | Nach dem Import |
| --- | --- |
| `environment: [A=1, B]` (Liste) | `environment: {A: "1", B: null}` (Map) |
| `env_file: .env` | `env_file: [.env]` |
| `depends_on: [db]` | `depends_on: {db: {condition: service_started}}` |
| `protocol: TCP` (Standardwert) | weggelassen |
| `command: npm start` (String) | `command: [npm, start]` |
| Schlüsselreihenfolge | Reihenfolge der Blöcke |
| Kommentare `# …` | gehen verloren, weil YAML-Parser sie nicht als Daten sehen |

Fehlt im Original ein Wert, den ein Startblock immer setzt, ergänzt BYOBYaml den Standard. Beispiele: `replicas: 1` beim Deployment, `type: ClusterIP` beim Service, `backoffLimit: 6` beim Job.

## Qualitätssicherung

`bun run check` importiert alle Dateien in `scripts/samples/`, erzeugt daraus wieder YAML und vergleicht beides inhaltlich. Neue Problemfälle legst du einfach als Beispieldatei dort ab.
