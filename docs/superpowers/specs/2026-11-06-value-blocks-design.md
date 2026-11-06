# Value blocks (Scratch-style reporters) — design

Date: 2026-11-06. Status: draft, awaiting approval. Size: project.

## Intent

Users want to drop small round "value blocks" into text and number slots, like Scratch reporters. The point is to automate exports: random names and passwords, timestamps, computed ports, and environment-dependent values. Aim for as many useful block types as we can think of, for maximum customisation.

## Goals

- Every `text` and `num` argument of every block accepts a dropped value block. Nesting works, e.g. `join(random-text, "-", date)`.
- Slot default stays today's look and behaviour: an inline text/number box (a Blockly shadow block).
- 25+ value blocks in a new toolbox category "Werte" (see catalogue). All UI strings in German.
- Random-based blocks produce a **new value on every export**. The live YAML preview uses a stable per-session seed so it does not flicker; each export action draws a fresh seed.
- Works in all three file kinds: Kubernetes/OpenShift, Compose, Dockerfile. Works in Helm export, the dependency graph, snippets, Marketplace and custom blocks (at least as "literal only", see Risks).
- Existing saved projects, snippets, examples and Marketplace items load unchanged.

## Non-goals

- Dropdown, checkbox and multi-line arguments do not take value blocks (phase 2 for multi-line).
- No user-defined value blocks, no loops/lists as data types. Values are strings or numbers.
- No async or network values (no HTTP, no clock sync). Generation stays synchronous.
- Not a secrets vault: a "random password" is regenerated each export, not stored.

## Anti-goals

- Existing projects must never export different YAML than before just because the format changed.
- Export must never silently emit a half-evaluated value: a failing value block shows a warning on that block and blocks the export like other errors.

## Approaches considered

- **A. Real value inputs (chosen).** Each text/num arg becomes `input_value` with a shadow text/number block. Scratch behaviour, nesting for free. Cost: migration and touching every place that reads fields.
- B. Field plus extra socket. Less migration, but every block shows both a field and a socket; confusing, poor nesting. Rejected.
- C. Placeholder chips in text (`${random:1-10}`). Nothing to migrate, nothing to drag. Rejected: not what was asked.

## Design

### Block model

- `argJson` in `src/blocks/register.ts` emits, for `text`/`num` args, `{type:'input_value', name: arg.name, check: 'Value'}` plus a shadow block: `byob_text` (field `VALUE`, `field_input`), `byob_num` (same, with number styling), or `byob_image` for args that use the image picker (keeps the existing `field_registry_image`).
- Value blocks are output blocks (`output: 'Value'`) with their own colour family so they are visibly distinct from stack blocks.
- Dropping a non-shadow block onto the slot replaces the shadow; removing it restores the shadow with its last literal.

### Accessors (single choke point)

New `src/blocks/value.ts`:

- `argValue(block, name)`: literal string of the slot if a shadow is present; otherwise evaluates the connected value block.
- `setArgValue(block, name, text)`: writes the shadow's `VALUE`; used by Helm token substitution and custom-block bindings.
- `evalValue(block, env)`: recursive pure evaluator. `env` = `{ vars, rng, now, projectName, fileName, envName, counters, warn }`.

All current direct users of `getFieldValue` / `setFieldValue` for text/num args switch to these: `readValues` (`register.ts`), `dockerfile.ts:83`, `helm.ts:101-110`, `registry/editor.ts`, `CustomBlockDesigner.tsx`, `custom-blocks/runtime.ts`. Callers that append blocks with `fields:{...}` (`BlockEditor.tsx`, `project.ts` `chainJson`, `importer.ts`) keep using legacy `fields`; the normalizer (below) upgrades them.

### Migration

- `normalizeState(state)` walks serialized block JSON and rewrites legacy `fields[NAME]` for text/num args into `inputs[NAME].shadow = {type:'byob_text', fields:{VALUE}}`. It is idempotent, never touches dd/chk/multi, and runs inside one `loadState()` wrapper used by every `Blockly.serialization.*.load/append` site (about 10 sites: `BlockEditor`, `helm`, `projectYaml`, `multiselect`, `CustomBlockDesigner`, `market/preview`, `market/BlockPreview`, `generator` custom-block expansion).
- Save always writes the new format. Old app versions cannot read new files; acceptable, called out in release notes.
- Tests: for every project in `src/examples.ts` and every built-in snippet, assert YAML before migration equals YAML after (golden comparison); property test that `normalizeState` is idempotent.

### Export seed and determinism

- `GenOptions` gains `session: { seed: number; now: Date; envName; projectName; fileName }`.
- Editor holds `previewSeed` (stable for the editing session; re-rolled by a "Würfeln" button). Export, download, and Helm export create a fresh seed at click time, so every export differs. All files in one multi-file export share one seed and one timestamp.
- Seeded PRNG (mulberry32-style); random blocks consume it in deterministic block order so one export is internally consistent. A "Zähler" block increments per use within one export.
- Random blocks with the same literal arguments in two places give two different values (each block draws separately).

### Value block catalogue (initial)

Zufall: Zufallszahl (min, max), Zufallstext (length, charset: a-z / A-Z / 0-9 / mix), Hex-Token (bytes), UUID v4, Passwort (length, symbols yes/no), Zufallsauswahl (comma list), Zufallsport (min, max), Zufallsfarbe (hex).
Zeit: Zeitstempel (ISO / Unix / compact / date / time), Datum +/− Tage.
Text: Verbinden (a, b, separator), Groß, Klein, Slug, Ersetzen, Teilstring, Wiederholen, Länge, Base64, SHA-256 (sync implementation, no WebCrypto), URL-kodieren.
Mathe: Rechnen (+ − × ÷ %), Runden, Min/Max.
Logik: Vergleichen (=, ≠, <, >), wenn-dann-sonst.
Kontext: Variable (picker of project/file `${VARS}`), Umgebung (name of active env), Projektname, Dateiname, Zähler.

Final list may shrink if a block proves unreliable; core set is random, time, join, variable, env, if.

### Types and errors

- Slot value is coerced to string; `num` slots then run today's number check, so non-numeric results warn exactly like a bad number today. `Rechnen` etc. return numbers.
- Variable substitution `${X}` inside literals keeps working; the `Variable` block is the drag-in equivalent.
- Unknown variables, divide by zero, bad ranges: warning on the value block via the existing warning icon, export blocked.

### Docs

New docs-site page `funktionen/wertbloecke.md`, sidebar entry, and a note in `entwicklung/neuer-block.md` on how to add a value block (single spec table in `src/blocks/values.ts`).

## Risks and open points for the builder

1. **Custom blocks** bind parameters to fields by `blockId`+`field` (`custom-blocks/model.ts`, `recipe.ts`). Phase 1: bindings target the shadow literal only; a value block dropped into a bound slot inside the designer is rejected with a message. Full support is a follow-up.
2. **Helm export** rewrites field text into tokens. With value blocks the evaluated result gets tokenised, so random values inside Helm templates are baked in at export time; Helm `values.yaml` does not get random generators. Document this.
3. **Dependency graph** (`dependencies.ts`) reads `block.fields` from project state; update to read shadow values and evaluate literal-only parts (value blocks count as unresolved).
4. **Marketplace**: shared snippets (`market/shared.ts`) validate `j.fields`; the validator must accept the new input form and must not execute value blocks at preview.
5. **Performance**: preview regenerates on each change; evaluator is pure and cheap, no concern expected.
6. Dockerfile generator has its own pass; it must use `argValue`.

## Left to the builder

Exact colours and shapes, German labels, charset presets, toolbox ordering, test file layout, and exact PRNG choice.

## Rollout order

1. `value.ts` accessors + `normalizeState` + shadow-based `argJson` + golden tests. No new blocks yet; YAML output unchanged.
2. Evaluator + core blocks (random, time, join, variable, env, if) + seed plumbing + "Würfeln" button.
3. Remaining catalogue + Helm/graph/custom-block/market fixes + docs.
