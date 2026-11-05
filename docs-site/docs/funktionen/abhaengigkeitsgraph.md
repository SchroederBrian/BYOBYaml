---
title: Abhängigkeitsgraph
sidebar_label: Abhängigkeitsgraph
sidebar_position: 2
---

# Abhängigkeitsgraph

Über **Graph** neben **Blöcke** in der Kopfzeile des Editors öffnest du die Projektübersicht. Sie zeigt Dateien, Compose-Services, Kubernetes-/OpenShift-Workloads und weitere Ressourcen als verbundene Knoten.

## Lesen und navigieren

- Ein Pfeil führt von der verweisenden Quelle zum Ziel. Wähle einen Knoten, um Art und Richtung seiner Verknüpfungen zu sehen.
- Gestrichelte Zugehörigkeitslinien verbinden eine Datei mit den enthaltenen Services und Ressourcen. Dateiübergreifende Verweise verbinden zusätzlich die betroffenen Dateien.
- **Datei öffnen** oder ein Doppelklick auf einen Projektknoten führt zur zugehörigen Datei im Blockeditor.
- Mit der Suche filterst du nach Name, Ressourcentyp, Namespace oder Dateipfad. Direkte Nachbarn bleiben als Kontext erhalten.
- **Aktuelle Datei + Verweise** begrenzt die Ansicht auf die ausgewählte Datei und direkt verbundene Ziele oder Quellen. **Dateien** und **Externe** lassen sich separat ausblenden.
- Mit den Zoom-Tasten und **Einpassen** änderst du die Ansicht. Scrolle oder ziehe auf freier Fläche, um dich im Graphen zu bewegen. Auf Touch-Geräten kannst du normal scrollen. Die Knoten sind auch per Tastatur bedienbar.

## Erkannte Verknüpfungen

**Docker Compose:** `depends_on`, `links`, `volumes_from`, Service-Verweise in `network_mode`, `pid` und `ipc`, `extends`, `include`, benannte Volumes, Netzwerke einschließlich des impliziten Standardnetzwerks, Configs und Secrets. Explizite Datei-Verweise aus `env_file`, Configs, Secrets oder `build.dockerfile` erscheinen ebenfalls.

**Kubernetes/OpenShift:** Service-Selektoren zu Pod-Templates, Ingress- und Route-Backends, TLS-Secrets, Umgebungsvariablen aus ConfigMaps/Secrets, Volume-Verweise und projizierte Volumes, PVCs, ServiceAccounts, Image-Pull-Secrets, RBAC-Rollen und ServiceAccount-Subjects, HPA-Ziele sowie BuildConfig- und DeploymentConfig-Verweise auf ImageStreams und Build-Secrets. Ressourcen in `List` und OpenShift-`Template` werden mit ausgewertet.

Kubernetes-Ressourcen werden über Typ, Name und Namespace aufgelöst. Ohne angegebenen Namespace verwendet die Analyse `default`. Compose-Namen werden im Kontext ihrer Datei und expliziter `include`-/`extends`-Verweise aufgelöst; gleichnamige Services unabhängiger Compose-Dateien werden nicht automatisch verbunden.

## Hinweise und Grenzen

Der Graph ist eine **statische Analyse der geöffneten Projektdateien**, keine Abfrage laufender Container oder Cluster. Ein Ziel mit **Extern / nicht aufgelöst** kann außerhalb des Projekts existieren. Ein solcher Verweis bedeutet deshalb nicht automatisch einen Fehler. Externe Dateien werden nicht vom Rechner oder aus dem Netzwerk nachgeladen.

Zyklische Start- oder Vererbungsabhängigkeiten werden rot markiert. Normale Ressourcenbeziehungen, Selektoren und Dateizugehörigkeiten zählen nicht als Startzyklen. Doppelte Definitionen und nicht auswertbare Dateien erscheinen als Hinweise.

Die Analyse berücksichtigt die aktive Umgebung und normale globale/lokale Variablen. Sie entschlüsselt keine Tresor-Secrets und zeigt keine Secret-Werte. Nicht auflösbare dynamische Namen können deshalb als externe Verweise erscheinen.

Die Ansicht aktualisiert sich bei Projektänderungen. Bei mehr als 350 passenden Knoten wird die Darstellung begrenzt; Suche und Dateibereich helfen beim Eingrenzen. Die Analyse ersetzt keine vollständige Compose- oder Kubernetes-Validierung und interpretiert keine beliebigen Referenzfelder eigener Custom Resources.
