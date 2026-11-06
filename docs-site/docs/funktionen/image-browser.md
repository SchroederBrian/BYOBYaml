---
title: Image-Browser
description: Öffentliche Docker-Hub- und GHCR-Images suchen und Tags direkt im Editor einsetzen.
---

Über **Images** in der oberen Leiste öffnest du den Image-Browser. Sein Aufbau entspricht dem Marktplatz: Quellen und Filter links, Image-Karten in der Mitte und eine Detailansicht für Tags. Docker Hub und GitHub Container Registry (GHCR) liefern echte öffentliche Such-, Tag- und Manifestdaten. Es werden keine Beispiel-Images als Suchergebnisse erfunden.

## Ein Image auswählen

1. **Docker Hub** oder **GHCR** wählen und einen Suchbegriff eingeben.
2. Bei Bedarf den **Herausgeber** eingrenzen. Für Docker Hub gibt es zusätzlich **Nur Docker Official Images**. Sortierung und weitere Ergebnisse sind über die Suchleiste erreichbar.
3. Eine Image-Karte öffnen und einen **Tag** auswählen. Die Tag-Liste lässt sich durchsuchen und nach Plattform eingrenzen.
4. Nach erfolgreicher Manifest-Prüfung **Image übernehmen** wählen. Oben unter **Einsetzen in** steht das Zielfeld. Alternativ kann ein neuer FROM-, Service- oder Container-Block angelegt werden.

Wenn du ein bestehendes Image-Feld bearbeitest, erscheint darunter **Image & Tag auswählen**. Auch das Rechtsklickmenü eines Image-Blocks bietet diesen Einstieg. Der Browser kennt dann das konkrete Zielfeld und dessen bisherigen Wert. Die Änderung wird normal mit dem Projekt gespeichert und kann im Editor rückgängig gemacht werden.

Unterstützt werden Image-Felder in Dockerfiles, Compose-Services und Kubernetes-Containern sowie geeignete OpenShift-Image-Felder. Sichtbare Image-Eingaben eigener Blocktypen können ebenfalls als Ziel verwendet werden. Freie Text- und Variablenfelder werden nicht ungefragt ersetzt.

## Bekannte Adresse direkt öffnen

Für ein bekanntes Repository kannst du eine Adresse eingeben und **Adresse öffnen** wählen, zum Beispiel:

```text
nginx:alpine
ghcr.io/home-assistant/home-assistant:stable
```

Die Tags kommen direkt aus Docker Hub beziehungsweise dem GHCR-Registry-Protokoll. GHCR liefert alphabetische Tag-Seiten; deshalb stehen bekannte Tags wie `stable` oder `latest` möglicherweise nicht auf der ersten Seite. **Tag direkt prüfen** lädt das Manifest eines konkreten Tags unabhängig von der gerade sichtbaren Seite. **Weitere Tags laden** setzt die Liste fort.

Die GHCR-Entdeckung verwendet GitHubs öffentliche Paketsuche. Wenn GitHub diese Suche begrenzt oder verändert, wird das erklärt; eine bekannte vollständige GHCR-Adresse kann weiterhin direkt geöffnet werden. Private Registries und private Pakete werden nicht mit Benutzer-Zugangsdaten abgefragt.

## Plattform und Digest

Für den ausgewählten Tag wird das Manifest aus der Registry geladen. Verfügbare Plattformen eines Multi-Plattform-Images werden angezeigt; ein nicht unterstützter Plattformfilter sperrt die Übernahme. Enthält ein einzelnes Manifest keine Plattformangaben, wird das ausdrücklich angezeigt. Eine Architektur wird nicht geraten.

Mit **Nach Digest fixieren** wird statt eines veränderlichen Tags der geprüfte Inhalt ausgewählt, etwa `nginx@sha256:…`. Bei einer konkreten Plattform wird deren Manifest-Digest verwendet, andernfalls der Digest des gesamten Image-Index. Ohne Fixierung bleibt es bei einer normalen Referenz wie `nginx:alpine`.

Die Manifest-Prüfung ist keine Sicherheitsanalyse oder Startgarantie. Die App lädt keine Image-Layer herunter und startet keine Container. Aktuelle Registry-Daten werden kurz zwischengespeichert; Rate-Limits und nicht verfügbare Tags werden als Fehler angezeigt.

## Merkliste

Der Stern an einem Repository speichert es unter **Gemerkt**. Diese Merkliste liegt auf dem aktuellen Gerät im Browser-Speicher. Die gewählte Image-Adresse wird dagegen als normaler Blockwert mit deinem Projekt gespeichert. Der öffentliche Browser funktioniert auch im Gastmodus; Gastprojekte müssen vor dem Verlassen exportiert werden.
