# BYOBYaml

**Build Your Own Blocks → YAML.** Block editor for Docker Compose files and
Kubernetes / OpenShift manifests. Drag blocks, get valid YAML live, import existing YAML back into blocks.

## Commands (bun)

```bash
bun install          # deps (postinstall fetches the Electron binary)
bun run app          # Electron window with hot reload
bun run dev          # browser-only version on http://localhost:5173 (uses localStorage)
bun run check        # typecheck + YAML import round-trip test (scripts/samples)
bun run dist         # Windows installer + portable exe in release/
```

### Documentation site (Docusaurus, `docs-site/`)

```bash
bun run docs:dev     # live docs on http://localhost:3000
bun run docs:build   # static site → docs-site/build/
bun run docs:gen     # regenerate block reference + snippet catalog from src/
```

> Windows: build from a short path. NSIS fails when `node_modules\app-builder-lib\...` exceeds 260 characters.

## Features

- **Blocks** for Compose services and K8s/OpenShift resources (Deployment, StatefulSet, Job, CronJob, Service, Route, Ingress, ConfigMap, Secret, PVC, HPA, ImageStream, BuildConfig, …). *Extras* blocks set any other field.
- **Import** `.yaml`/`.yml` (also `oc get … -o yaml` lists). Cluster fields (`status`, `uid`, `managedFields`, …) are stripped; fields without a dedicated block become Extras blocks, so nothing is lost.
- **Variables** `${NAME}` in any field, values per environment (dev/prod/…).
- **Vorlagen** (snippets): 40 built-in block combos + your own (right-click a block → *Ab hier als Vorlage speichern…*).
- **Storage**: automatic, SQLite at `%APPDATA%\BYOBYaml\byobyaml.db` (Node's built-in `node:sqlite`, no native module, no server).
- **.byob files**: JSON container for one project or a full backup (all projects + snippets). Import/export via menu or drag & drop.

## Structure

| Path | What |
|------|------|
| `electron/main.cjs`, `electron/db.cjs` | Main process, dialogs, SQLite storage |
| `src/storage.ts` | Renderer storage facade (SQLite via IPC, localStorage fallback) |
| `src/blocks/defs.ts` | Every block: look (`msg`, `args`) + what it writes into YAML (`gen`) |
| `src/blocks/generator.ts` | Block stacks → YAML, variable substitution, placement warnings |
| `src/importer.ts` | YAML → blocks |
| `src/snippets.ts` | Built-in snippets |
| `src/App.tsx`, `src/components/` | UI |

## Add a block

```ts
{ type: 'c_tty', cat: 'container', shape: 'stmt', msg: 'TTY %1', args: [C('ON', true)],
  scope: ['container'], where: 'in einen "Container"-Block',
  gen: (v, c) => { c.container.tty = v.ON; } },
```

Add it to the matching list in `src/blocks/defs.ts`; it appears in the toolbox automatically.
To make imports use it, consume the field in `src/importer.ts`.
