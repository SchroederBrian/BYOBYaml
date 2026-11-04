---
title: Installation
sidebar_position: 2
---

# Installation

## Fertige App (Windows)

Im Ordner `release/` des Projekts liegen nach dem Build zwei Varianten:

| Datei | Wofür |
| --- | --- |
| `BYOBYaml Setup 0.1.0.exe` | Installer mit Startmenü-Eintrag; der Zielordner ist wählbar |
| `BYOBYaml 0.1.0.exe` | Portable Version: starten, ohne zu installieren |

Nach dem ersten Start öffnet sich das Beispielprojekt *OpenShift Demo-App*:

![BYOBYaml nach dem ersten Start](/img/screens/app.png)

Beide Varianten speichern ihre Daten an derselben Stelle: `%APPDATA%\BYOBYaml\`. Siehe [Speicherung](funktionen/speicherung.md).

:::note Code-Signatur
Die EXE ist nicht signiert. Windows SmartScreen zeigt deshalb beim ersten Start eventuell „Der Computer wurde durch Windows geschützt“. Über **Weitere Informationen → Trotzdem ausführen** startest du die App.
:::

## Aus dem Quellcode

Voraussetzungen:

- [Bun](https://bun.sh) ab 1.1 als Paketmanager
- Windows 10/11 (für den EXE-Build); die App selbst läuft auch unter macOS/Linux

```bash
bun install
```

`postinstall` lädt die Electron-Binary automatisch. Danach:

```bash
bun run app
```

Das öffnet die App im Electron-Fenster mit Hot-Reload.

### Alle Befehle

| Befehl | Was passiert |
| --- | --- |
| `bun run app` | Electron + Vite-Devserver, Änderungen am Code sofort sichtbar |
| `bun run dev` | Nur die Web-Version im Browser (speichert in `localStorage` statt SQLite) |
| `bun run check` | TypeScript-Prüfung + Import-Round-Trip-Test |
| `bun run dist` | Baut Installer und portable EXE nach `release/` |
| `bun run dist:portable` | Nur die portable EXE |

:::warning Pfadlänge unter Windows
Der Installer-Bau (NSIS) bricht ab, wenn ein Pfad in `node_modules` länger als 260 Zeichen wird. Baue deshalb aus einem kurzen Ordner, z. B. `C:\dev\BYOBYaml` oder `D:\Nextcloud\BYOBYaml`.
:::

## Diese Dokumentation

Die Doku liegt in `docs-site/` und ist eine eigene [Docusaurus](https://docusaurus.io)-Seite. Siehe [Doku bearbeiten](entwicklung/doku.md).
