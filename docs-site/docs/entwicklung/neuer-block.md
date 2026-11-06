---
title: Einen neuen Block hinzufügen
sidebar_label: Neuer Block
sidebar_position: 2
---

# Einen neuen Block hinzufügen

Beispiel: ein Container-Block für `stdin` und `tty`.

## 1. Block definieren

In `src/blocks/defs.ts` in der Liste `container` ergänzen:

```ts
{
  type: 'c_tty',
  cat: 'container',
  shape: 'stmt',
  msg: 'interaktiv stdin %1 tty %2',
  args: [C('STDIN', true), C('TTY', true)],
  scope: ['container'],
  where: 'in einen "Container"-Block',
  tip: 'Für Debug-Container, die eine Shell offen halten.',
  gen: (v, c) => {
    if (v.STDIN) c.container.stdin = true;
    if (v.TTY) c.container.tty = true;
  },
},
```

| Feld | Bedeutung |
| --- | --- |
| `type` | Eindeutige ID; wird in Projekten gespeichert, also nicht mehr ändern, sobald es Projekte damit gibt |
| `cat` | Kategorie, bestimmt Farbe und Paletten-Platz |
| `shape` | `hat` (Startblock), `stmt` (Stapel), `c` (Klammer mit `BODY`) |
| `msg` | Beschriftung; `%1`, `%2` … sind die Felder in `args` |
| `args` | `T(name, default)` Text · `N(name, default)` Zahl · `D(name, options)` Auswahl · `C(name, default)` Häkchen |
| `scope` | Wo der Block erlaubt ist; ohne Angabe überall |
| `where` | Hinweistext für die Warnung |
| `gen` | Schreibt in `c.target` / `c.doc` / `c.pod` / `c.container` |

Hilfsfunktionen aus `types.ts`: `at(obj, ...path)` legt verschachtelte Objekte an, `list(obj, key)` sorgt für eine Liste, `portVal()` macht aus `"8080"` die Zahl `8080`, `splitArgs()` teilt Shell-Argumente auf.

Der Block erscheint sofort in der Palette.

## 2. Startblock? Scope öffnen

Ein Startblock muss sein Dokument selbst anlegen und den Kindern einen Kontext geben:

```ts
gen: (v, ctx, run) => {
  const doc = newDoc(ctx, 'policy/v1', 'PodDisruptionBudget', v.NAME, { minAvailable: v.MIN });
  run(['k8s', 'PodDisruptionBudget'], { doc, target: doc });
},
```

## 3. Import unterstützen (optional, empfohlen)

Ohne diesen Schritt landen `stdin`/`tty` beim Import in *Feld*-Blöcken. Das funktioniert, ist aber weniger schön. In `src/importer.ts` → `importContainer()`:

```ts
const stdin = take(c, 'stdin');
const tty = take(c, 'tty');
if (stdin !== undefined || tty !== undefined) body.push(b('c_tty', { STDIN: !!stdin, TTY: !!tty }));
```

`take()` entfernt das Feld aus der Kopie, damit es nicht zusätzlich als Extra auftaucht.

## 4. Testen

```bash
bun run check
```

Leg eine Beispieldatei mit dem neuen Feld nach `scripts/samples/`. Der Round-Trip-Test zeigt dann jede inhaltliche Abweichung.

## 5. Doku aktualisieren

```bash
bun run docs:gen
```

Das erzeugt die [Block-Referenz](/docs/referenz) neu, inklusive Beispiel-YAML des neuen Blocks.

## Einen Wertblock hinzufügen

Wertblöcke (die runden Blöcke für Eingabefelder) sind keine Stapelblöcke und stehen nicht in `defs.ts`, sondern als Eintrag in `VALUE_SPECS` in `src/blocks/values.ts`:

```ts
{
  type: 'val_beispiel', msg: 'Beispiel %1', args: [T('TEXT', '')],
  tip: 'Was der Block macht.',
  eval: (v, env) => String(v.TEXT).toUpperCase(),
}
```

- `args` gibt die Eingaben an. Text- und Zahlenfelder werden zu Steckplätzen, in die sich weitere Wertblöcke stecken lassen. `eval` bekommt sie schon ausgewertet (Zahlen als `number`).
- Zufall immer über `env.rng()`, die Zeit über `env.session.now`. Nie `Math.random()` oder `Date.now()`, sonst sind Exporte nicht reproduzierbar testbar.
- Fehler als `throw new Error('Text auf Deutsch')`. Der Block zeigt dann die Warnung.
- Trag den Typ in `VALUE_GROUPS` ein (Abschnitt der Palette). Ein Test prüft, dass jeder Block in genau einer Gruppe steht.
- Teste mit einem Fall in `scripts/value-blocks.test.ts`, danach `bun run docs:gen`.
