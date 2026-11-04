---
title: Fehlerbehebung & FAQ
sidebar_label: Fehlerbehebung
sidebar_position: 20
---

# Fehlerbehebung & FAQ

## App

### Ein Block erzeugt kein YAML

![Block mit Warnung](/img/screens/warnung-blase.png)

- Hängt er an einem Startblock? Lose Blöcke werden ignoriert.
- Ist er deaktiviert (grau)? Rechtsklick → *Block aktivieren*.
- Hat er ein ⚠? Dann steckt er an einer ungültigen Stelle, siehe [Gültige Plätze](konzepte/gueltige-plaetze.md).

### Mein Feld wird im YAML nicht angezeigt

Leere optionale Felder werden weggelassen, ebenso leere Listen und Objekte. Ein leerer String bleibt nur in Extras-Blöcken erhalten, z. B. mit `Feld x = ""`.

### `${X}` steht wörtlich im YAML

Die Variable `X` existiert nicht, oder sie ist anders geschrieben; Groß- und Kleinschreibung zählt. Prüfe den Tab **Variablen**.

### Wo sind meine Daten?

![Statusleiste](/img/screens/statusleiste.png)

`%APPDATA%\BYOBYaml\byobyaml.db`. Ein Klick auf *SQLite* in der Statusleiste öffnet den Ordner. Siehe [Speicherung](funktionen/speicherung.md).

### Projekt versehentlich gelöscht

Gelöschte Projekte lassen sich nicht wiederherstellen. Lege regelmäßig Backups an: *Exportieren → Backup: alles als .byob…*

### Import meldet „Jedes YAML-Dokument muss ein Objekt (Map) sein“

Die Datei enthält ein Dokument, das nur eine Liste oder ein Wert ist. Häufige Ursache ist ein Helm-Template. Erst rendern (`helm template …`), dann importieren.

### Import meldet einen YAML-Fehler mit Zeilenangabe

Die Datei ist kein gültiges YAML, z. B. wegen gemischter Tabs und Leerzeichen oder einem fehlenden `:`. `yamllint datei.yaml` zeigt die genaue Stelle.

## Build

### `bun run dist` bricht ab: „could not open file … extractAppPackage.nsh“

Der Projektpfad ist zu lang (Windows-Limit 260 Zeichen). Verschiebe das Projekt in einen kurzen Pfad, z. B. `C:\dev\BYOBYaml`.

### `bun run app` startet kein Fenster / „electron.exe nicht gefunden“

Bun hat das Postinstall-Skript von Electron übersprungen. Abhilfe:

```bash
node node_modules/electron/install.js
```

### Nextcloud / OneDrive synchronisiert ewig

`node_modules/`, `release/`, `dist/` und `docs-site/build/` von der Synchronisierung ausschließen. Alles davon lässt sich neu erzeugen.

## Allgemein

### Ersetzt BYOBYaml Helm oder Kustomize?

Nein. BYOBYaml erzeugt einfaches, fertig aufgelöstes YAML. Für Template-Logik (Schleifen, Bedingungen) bleiben Helm und Kustomize die richtigen Werkzeuge. BYOBYaml eignet sich gut zum Erstellen, Verstehen und Pflegen der Basis-Manifeste.

### Kann ich Validierung gegen das Cluster-Schema machen?

Nicht direkt in der App. Exportierte Dateien kannst du so prüfen:

```bash
oc apply --dry-run=server -f deploy/dev/
kubeconform -strict deploy/dev/
docker compose -f docker-compose.yml config
```
