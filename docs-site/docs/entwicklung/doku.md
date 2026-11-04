---
title: Doku bearbeiten
sidebar_position: 4
---

# Diese Dokumentation bearbeiten

Die Doku ist eine [Docusaurus 3](https://docusaurus.io)-Seite in `docs-site/`. Die Suche läuft offline über `@easyops-cn/docusaurus-search-local`, ohne externen Dienst.

## Befehle (im Projekt-Hauptordner)

```bash
bun run docs:gen     # Block-Referenz + Vorlagen-Katalog aus dem Code erzeugen
bun run docs:dev     # Devserver mit Live-Reload (http://localhost:3000)
bun run docs:build   # statische Seite nach docs-site/build/
bun run docs:serve   # gebaute Seite lokal ansehen
```

`docs:dev` und `docs:build` rufen `docs:gen` automatisch vorher auf.

### Screenshots neu aufnehmen

```bash
bun run docs:screens
```

Das Skript baut die App, startet sie mit einem **leeren, temporären Datenordner** (deine echte Datenbank bleibt unberührt) und steuert sie über `scripts/screenshots.cjs` fern. Dabei klickt es Menüs, lädt Blöcke, importiert `scripts/samples/handbuch-import.yaml` und speichert eine Vorlage. Jeder Zustand landet als PNG in `docs-site/static/img/screens/`. Nach UI-Änderungen einfach neu ausführen.

Der Automations-Hook in `electron/main.cjs` (`BYOB_AUTOMATION`, `BYOB_USER_DATA`) ist in der gepackten EXE abgeschaltet (`app.isPackaged`).

## Was ist generiert?

| Pfad | Quelle |
| --- | --- |
| `docs/referenz/*.mdx` | `src/blocks/defs.ts` über `scripts/gen-docs.ts` |
| `docs/vorlagen/katalog.mdx` | `src/snippets.ts` |
| `docs/handbuch/beispiele.mdx` | Beispielliste in `scripts/gen-docs.ts` |
| `static/img/screens/*.png` | `bun run docs:screens` (echte App) |

Diese Dateien **nicht von Hand bearbeiten**, beim nächsten Generieren werden sie überschrieben. Das YAML in den Beispielen erzeugt der echte Generator der App. Damit kann die Referenz nicht vom tatsächlichen Verhalten abweichen.

Alles andere unter `docs/` ist von Hand geschrieben (Markdown/MDX).

## Hilfsklassen

Block-Optik im Fließtext:

```mdx
<span className="blk" style={{'--c':'#2b8fa8'}}>Port 8080</span>
```

| Kategorie | Farbe |
| --- | --- |
| Compose | `#3f7fd8` |
| Service | `#7a68d4` |
| Ressourcen | `#c08a1e` |
| Metadaten | `#ad5aa1` |
| Pod | `#c9702a` |
| Container | `#2b8fa8` |
| Netzwerk | `#3a9558` |
| Config & Daten | `#b9613a` |
| Build | `#bf4c66` |
| Skalierung | `#24927a` |
| Extras | `#5f6b82` |

## Veröffentlichen

`docs-site/build/` ist rein statisch: GitHub Pages, GitLab Pages, ein nginx-Container oder ein OpenShift-`httpd`-Image reichen aus. Vorher `url` und `baseUrl` in `docusaurus.config.ts` anpassen.
