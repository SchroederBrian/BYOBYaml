---
title: Build & Release
sidebar_position: 3
---

# Build & Release

## EXE bauen

```bash
bun run dist
```

1. `vite build` → `dist/` (Renderer)
2. `electron-builder --win nsis portable` → `release/`

| Datei | Inhalt |
| --- | --- |
| `release/BYOBYaml Setup <version>.exe` | NSIS-Installer, Zielordner wählbar |
| `release/BYOBYaml <version>.exe` | Portable |
| `release/win-unpacked/` | Ungepackte App, praktisch zum schnellen Testen |

Die Version kommt aus `package.json` → `version`.

## Konfiguration

Abschnitt `build` in `package.json`:

```json
{
  "appId": "dev.byobyaml.app",
  "productName": "BYOBYaml",
  "files": ["dist/**", "electron/**", "package.json"],
  "directories": { "output": "release" },
  "win": { "target": ["nsis", "portable"] },
  "nsis": { "oneClick": false, "allowToChangeInstallationDirectory": true }
}
```

`productName` bestimmt auch den Datenordner `%APPDATA%\BYOBYaml`. Wenn du ihn änderst, findet die App die alten Daten nicht mehr.

## Icon (optional)

Leg eine `build/icon.ico` (256×256) an. electron-builder nimmt sie automatisch. Ohne Icon nutzt die App das Electron-Standard-Icon.

## Signieren (optional)

Für eine signierte EXE setzt du die Umgebungsvariablen `CSC_LINK` (Pfad zur `.pfx`) und `CSC_KEY_PASSWORD` vor `bun run dist`. Ohne Signatur warnt SmartScreen beim ersten Start.

## Checkliste vor einem Release

- [ ] `version` in `package.json` erhöht
- [ ] `bun run check` ohne neue Unterschiede
- [ ] `bun run docs:gen` ausgeführt und die Doku gebaut
- [ ] `release/win-unpacked/BYOBYaml.exe` gestartet: Projekt öffnen, Import, Export getestet
