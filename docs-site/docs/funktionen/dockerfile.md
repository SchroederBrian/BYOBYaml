---
title: Dockerfile mit Blöcken
description: Eigene Container-Images mit Dockerfile-Blöcken vorbereiten.
---

Über **Datei → Neue Dockerfile** oder das Würfel-Symbol im Dateibereich legst du eine Dockerfile an. Sie wird wie Compose- und Kubernetes-Dateien im Projekt gespeichert. Gäste können den Editor ebenfalls verwenden; ihre Arbeit bleibt bis zum Export nur in der Sitzung.

Die Blockpalette hat drei Bereiche:

- **Image & Phasen:** Dockerfile-Start, Basis-Image (`FROM`), Build-Argumente (`ARG`) und Kommentare.
- **Build-Schritte:** Shell-Befehle (`RUN`), Programme mit Argumenten, `COPY`, `ADD`, Arbeitsverzeichnis und BuildKit-Mounts für Cache und Secrets.
- **Start & Laufzeit:** Umgebungsvariablen, Labels, Ports, Benutzer, Startprogramm, Volumes, Shell, Stoppsignal und Healthcheck.

Verbinde alle Anweisungen unter **einem Dockerfile-Startblock**. Die Reihenfolge auf der Fläche ist die Reihenfolge in der Dockerfile. Weitere `FROM`-Blöcke beginnen eine neue Build-Phase. Die rechte Vorschau aktualisiert sich beim Bearbeiten. Lose Blöcke werden mit einem Hinweis markiert und nicht ausgegeben.

## Einfach anfangen

Eine neue Dockerfile startet mit einem Alpine-Basis-Image, `/app` als Arbeitsordner und `sh` als Startprogramm. Unter **Vorlagen** findest du außerdem einen statischen nginx-Webserver und ein Beispiel mit mehreren Build-Phasen. Vollständige Vorlagen enthalten ihren eigenen Startblock; ersetze die vorhandene Struktur, statt zwei Startblöcke zu verbinden.

Bei Programm-Blöcken wie **CMD Startprogramm & Argumente** gibst du ein Argument je Zeile ein:

```text
node
server.js
--port
8080
```

Daraus wird die Exec-Form `CMD ["node", "server.js", "--port", "8080"]`. Für leere Argumente oder besondere Zeichen kannst du alternativ eine JSON-Liste eintragen. Shell-Befehle haben eigene Blöcke. Mehrzeilige RUN-Skripte werden mit einem Here-Document ausgegeben und bleiben ein einzelner Build-Schritt.

## Dateien und mehrere Phasen

Im COPY-Block steht eine Quelle je Zeile. Ziel, optionale Quellphase beziehungsweise Quell-Image, Besitzer und Dateirechte haben eigene Felder. Bei mehreren Quellen muss der Zielpfad mit `/` enden. COPY kann nur Dateien aus dem Build-Kontext oder einer angegebenen Phase beziehungsweise einem Image verwenden.

Für mehrere Phasen vergibst du im FROM-Block einen eindeutigen Namen, zum Beispiel `build`. Nach einem weiteren FROM-Block kannst du im COPY-Feld **aus Phase/Image** den Namen `build` eintragen. Der **Graph** zeigt Build-Phasen, Basis-Images und COPY-Verbindungen; Compose-Builds können auf die Dockerfile im Projekt verweisen.

## Prüfen und bauen

Die Vorschau prüft unter anderem die Position von FROM, Phasennamen, Argumentlisten, Portbereiche, Mounts, Dateirechte und Healthcheck-Werte. Fehler sperren Kopieren und Export. Doppelte Startbefehle und nicht verbundene Blöcke werden erklärt.

Die App führt keinen Docker-Build aus. Verfügbarkeit des Basis-Images, vorhandene Dateien und Benutzer im Image, Shell-Befehle, Berechtigungen und die Unterstützung deiner Docker-Version musst du in deiner Build-Umgebung prüfen.

Über **Speichern** oder **Exportieren** erhältst du die Datei ohne angehängte `.yaml`-Endung. Im Ordner mit deinen Quelldateien baust du anschließend zum Beispiel:

```sh
docker build -t mein-image -f Dockerfile .
docker run --rm -it mein-image
```

Der Punkt bezeichnet den Build-Kontext. Eine `.dockerignore` im Kontext schließt Dateien aus, die nicht in den Build gelangen sollen. EXPOSE dokumentiert Ports; für die Veröffentlichung ist zusätzlich etwa `docker run -p 8080:8080 mein-image` erforderlich.

## Variablen und Secrets

Globale und lokale Projektvariablen funktionieren auch in Dockerfile-Feldern: `${NAME}` wird eingesetzt, wenn eine gleichnamige Projektvariable vorhanden ist. Unbekannte Referenzen bleiben für Docker als native ARG-/ENV-Referenzen erhalten. Gleichnamige Projektvariablen haben daher Vorrang vor Docker-Variablen.

Passwörter gehören nicht in ARG, ENV oder normale Build-Befehle: Diese Werte können im Image oder dessen Build-Verlauf landen. Der **RUN mit Build-Secret**-Block speichert nur eine Secret-ID und den Mount-Pfad. Den Wert gibst du Docker beim Build:

```sh
docker build --secret id=build-token,src=/pfad/zum/token -t mein-image .
```

Ein Secret-Mount wird nur für den betreffenden Build-Schritt bereitgestellt. Der Befehl darf den Inhalt nicht selbst ins Image kopieren oder in Logs ausgeben.

## Vorhandene Dockerfiles

Unter **Importieren → Dockerfile öffnen** oder **Dockerfile einfügen** kannst du unterstützte Anweisungen in Blöcke umwandeln. Dateien namens `Dockerfile`, `Dockerfile.*`, `Dockerfile-*` und `*.dockerfile` werden auch beim Hineinziehen erkannt. Nicht unterstützte Varianten werden mit Zeilennummer gemeldet; Anweisungen werden nicht stillschweigend verworfen und die Originaldatei bleibt erhalten.

Dockerfiles bleiben in `.byob`-Projekten und Backups erhalten und können als Datei oder Vorlage im Marktplatz geteilt werden. Der Helm-Export überspringt sie, weil sie Build-Anleitungen und keine Kubernetes-Ressourcen sind.
