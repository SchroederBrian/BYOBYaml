---
title: Erste Schritte
sidebar_position: 3
---

# Erste Schritte

In zehn Minuten baust du eine Compose-Datei und ein Kubernetes-Deployment, und du lernst die wichtigsten Handgriffe.

## 1. Neues Projekt anlegen

Beim ersten Start legt BYOBYaml zwei Beispielprojekte an und öffnet *OpenShift Demo-App*. Für ein eigenes Projekt:

1. **Datei → Neues Projekt**
2. Oben in der Mitte den Projektnamen anklicken und umbenennen, z. B. `Shop`

Jedes Projekt startet mit einer `docker-compose.yaml`, die nur den Startblock enthält, und mit den Umgebungen `dev` und `prod`:

![Neues Projekt: nur der Compose-Startblock](/img/screens/compose-start-1.png)

Das ⚠ am Startblock heißt nur: Es fehlt noch ein Service.

## 2. Eine Compose-Datei bauen

Links in der Palette siehst du die Kategorien. In einer Compose-Datei sind das **Compose**, **Service**, **Extras**, **Vorlagen** und **Meine Vorlagen**.

1. Auf der Fläche liegt schon der Startblock <span className="blk" style={{'--c':'#3f7fd8'}}>Docker Compose · Projekt</span>.
2. Kategorie **Compose** öffnen und <span className="blk" style={{'--c':'#3f7fd8'}}>Service web Image nginx:latest</span> **unter** den Startblock ziehen, bis er einrastet.
3. Kategorie **Service** öffnen und <span className="blk" style={{'--c':'#7a68d4'}}>Port Host 8080 → Container 80</span> **in** den Service-Block ziehen.
4. In die Felder klicken und Werte ändern. Rechts im Tab **YAML** steht sofort das Ergebnis:

![Compose-Datei mit einem Service und Port](/img/screens/compose-start-2.png)

Auswahlfelder (▾) öffnen beim Klick eine Liste mit den erlaubten Werten:

![Auswahlfeld Neustart](/img/screens/feld-auswahl.png)

:::tip Schneller mit Vorlagen
Unter **Vorlagen → Datenbanken → PostgreSQL** liegt ein fertiger Service mit Volume und Healthcheck. Zieh ihn einfach unter deinen Startblock.
:::

## 3. Eine Kubernetes-Datei bauen

1. In der Dateiliste links auf das Steuerrad-Symbol klicken (**Neue Kubernetes-Datei**).
2. Die Datei startet mit <span className="blk" style={{'--c':'#c08a1e'}}>Deployment my-app Replicas 1</span>.
3. Aus **Pod** einen <span className="blk" style={{'--c':'#c9702a'}}>Container … Image …</span> unter das Deployment ziehen.
4. Aus **Container** <span className="blk" style={{'--c':'#2b8fa8'}}>Port 8080</span> und <span className="blk" style={{'--c':'#2b8fa8'}}>mindestens (requests) CPU 100m RAM 128Mi</span> in den Container legen.
5. Für einen Service dazu: Aus **Ressourcen** den Startblock <span className="blk" style={{'--c':'#c08a1e'}}>Service … für App …</span> **neben** das Deployment auf die Fläche ziehen und darunter einen <span className="blk" style={{'--c':'#3a9558'}}>Port 80 → Ziel 8080</span> aus **Netzwerk** hängen.

| Nur der Startblock | Mit Container |
| --- | --- |
| ![Schritt 1](/img/screens/schritt-1.png) | ![Schritt 2](/img/screens/schritt-2.png) |
| **Port und Requests im Container** | **Zusätzlich Service als zweiter Startblock** |
| ![Schritt 3](/img/screens/schritt-3.png) | ![Schritt 4](/img/screens/schritt-4.png) |

Zwei Startblöcke in einer Datei werden zu zwei YAML-Dokumenten, getrennt durch `---`. Jeder Schritt ist ausführlich im Handbuch unter [Blöcke bauen](handbuch/bloecke-bauen.md) erklärt.

## 4. Fehler erkennen

Zieh testweise einen Container-Block wie *Port* direkt unter das Deployment statt in den Container. Der Block bekommt ein ⚠. Im Tab **Probleme** steht dann:

> Dieser Block gehört in einen "Container"-Block.

![Warnung am falsch platzierten Block](/img/screens/warnung-blase.png)

Ein Klick auf den Hinweis springt zum Block. Mehr dazu unter [Gültige Plätze](konzepte/gueltige-plaetze.md).

## 5. Exportieren

- **Exportieren → … als YAML** speichert die aktuelle Datei.
- **Exportieren → Alle Dateien in Ordner** schreibt jede Datei des Projekts als eigene `.yaml`, mit den Variablenwerten der aktiven Umgebung.

Gespeichert wird automatisch. Unten rechts in der Statusleiste steht, wann zuletzt gespeichert wurde.

## Wie geht es weiter?

- [Variablen & Umgebungen](funktionen/variablen.md): dev und prod aus denselben Blöcken
- [Import](funktionen/import.md): bestehende Manifeste in Blöcke umwandeln
- [OpenShift: Build → Deploy → Route](anleitungen/openshift-build-deploy.md): komplettes Beispiel
