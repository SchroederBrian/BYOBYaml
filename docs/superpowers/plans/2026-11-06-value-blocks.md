# Value Blocks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every text/number slot accepts dropped Scratch-style value blocks (random, time, text, math, logic, context) evaluated at export.

**Architecture:** Text/num args become Blockly `input_value` sockets with a shadow literal block (`byob_text` / `byob_num` / `byob_image`). One accessor module (`src/blocks/value.ts`) reads/writes slots and evaluates value blocks with a seeded session; a `normalizeState` converter upgrades legacy `fields[...]` JSON at every load site.

**Tech Stack:** TypeScript, Blockly 13, `yaml`, bun:test (tests live in `scripts/*.test.ts`, run with `bun test`), `bun scripts/roundtrip.ts`, `tsc --noEmit`.

**Spec:** `docs/superpowers/specs/2026-11-06-value-blocks-design.md`

## Global Constraints

- All UI strings German; code and comments English.
- Only `text`/`num` (and image-picker text) args get sockets; `multi`, `dd`, `chk` unchanged.
- Random value blocks: new value every export; preview uses a stable per-session seed re-rolled only by the "Würfeln" button.
- Generation stays synchronous (no WebCrypto, no network).
- Existing examples/snippets must export byte-identical YAML before and after migration.
- Save format is the new format; no old-format writing.
- Failing value block: warning on that block, export blocked.
- Do not commit unless the user asks; steps marked "Commit" are for when they do.

## Review Focus

- Empty slot / deleted value block: shadow restores, YAML unchanged from literal.
- `${VAR}` inside a literal still substitutes, including in `num` slots and Compose pass-through mode.
- Value block inside a disabled block or loose (unattached) stack: no evaluation side effects, no counter increment.
- Same random block twice in one export gives different values; one seed gives reproducible output.
- Number slot receiving non-numeric value-block output warns like a bad literal today.

---

### Task 1: Slot model, migration, accessors

**Files:**
- Create: `src/blocks/value.ts`, `scripts/value-blocks.test.ts`
- Modify: `src/blocks/register.ts` (`argJson`, `readValues`, `registerBlocks`)
- Test: `scripts/value-blocks.test.ts`

**Interfaces:**
- Produces: `normalizeState(state: any, typeSpecs?: Record<string, BlockSpec>): any` (idempotent; maps legacy `fields[NAME]` for text/num args to `inputs[NAME].shadow`), `loadState(state: any, ws: Blockly.Workspace): void`, `appendState(state: any, ws: Blockly.Workspace, opts?): Blockly.Block`, `argValue(block: Blockly.Block, name: string, env?: EvalEnv): string | number`, `setArgValue(block: Blockly.Block, name: string, text: string): void`, block types `byob_text`, `byob_num`, `byob_image` (output `'Value'`, field `VALUE`), `type EvalEnv`.

- [ ] **Step 1: Write failing tests** in `scripts/value-blocks.test.ts`: (a) `normalizeState` converts `{type:'k8s_deployment', fields:{NAME:'a',REPLICAS:'2'}}` to inputs with shadow `byob_text` `VALUE:'a'`; dd/chk/multi fields stay in `fields`; calling twice equals once. (b) Golden: for `openshiftDemo()` and `composeDemo()` from `src/examples.ts` and every `BUILTIN_SNIPPETS` entry via `snippetState`, `generate()` output after `loadState` equals output of the pre-change generator (capture current YAML strings into `scripts/samples-golden/*.yaml` first, using git stash or the pre-change checkout). (c) `setArgValue` then `argValue` round-trips; dropping a `byob_text` block with literal `x` into the socket makes `argValue` return `x`.
- [ ] **Step 2: Generate golden YAMLs from the current (unchanged) code**, save them under `scripts/samples-golden/`, then run `bun test scripts/value-blocks.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement `src/blocks/value.ts` and register `byob_text`/`byob_num`/`byob_image`** in `registerBlocks`. `argJson` returns, for text/num args, an `input_value` (name = arg name, `check: 'Value'`); because `argJson` currently returns args0 entries, switch `blockJson` to emit `%n` message placeholders with `{type:'input_value', ...}` and attach default shadows via a `init`-time `setShadowState` (Blockly `Input.connection.setShadowState`). Image-picker args (`isNativeImageField`, `CUSTOM_BLOCK`) use `byob_image` (keeps `field_registry_image`).
- [ ] **Step 4: `readValues` calls `argValue`**; `${VAR}` substitution and number checks apply to the resolved text exactly as before.
- [ ] **Step 5: Run `bun test` and `bunx tsc --noEmit`.** Expected: all pass, golden YAMLs identical.
- [ ] **Step 6: Commit** `feat: value-input slots with shadow literals`.

### Task 2: Migrate every load site and reader

**Files:**
- Modify: `src/components/BlockEditor.tsx` (load at ~168, append at ~209/235-244, `getFieldValue('NAME')` at ~228), `src/helm.ts` (load ~93, field rewrite ~101-110), `src/projectYaml.ts:12`, `src/blocks/multiselect.ts:57`, `src/components/CustomBlockDesigner.tsx` (load/append/setFieldValue ~70, 84, 96, 107), `src/custom-blocks/runtime.ts:36`, `src/market/BlockPreview.tsx:22`, `src/market/preview.ts:20`, `src/blocks/generator.ts:72`, `src/dockerfile.ts:83`, `src/registry/editor.ts` (42-76), `src/dependencies.ts:108`, `src/market/shared.ts:240`.
- Test: `scripts/value-blocks.test.ts`

**Interfaces:**
- Consumes: `loadState`, `appendState`, `argValue`, `setArgValue`, `normalizeState` from Task 1.

- [ ] **Step 1: Failing tests:** (a) Helm export of the OpenShift demo still contains the same `BYOBHELMVAR` token substitution output as before (golden); (b) `generateDockerfile` output for a Dockerfile file equals golden; (c) `dependencies` graph for demo project equals golden node/edge set; (d) `checkData` in `market/shared.ts` accepts a snippet in new input form and rejects an unknown shadow type; (e) a custom block bound to `NAME` still instantiates with a literal, and the designer rejects a non-shadow block dropped into a bound slot (`'Dieser Platz ist an einen Parameter gebunden.'`).
- [ ] **Step 2: Run them; expect FAIL.**
- [ ] **Step 3: Replace each `Blockly.serialization.*.load/append` call with `loadState`/`appendState`; replace direct `getFieldValue`/`setFieldValue` for text/num args with `argValue`/`setArgValue`** (list above). `dependencies.ts` and `market/shared.ts` read shadow literals; value blocks count as unresolved/opaque and are never executed there. Custom-block bindings write through `setArgValue`.
- [ ] **Step 4: Run `bun test`, `bunx tsc --noEmit`, `bun scripts/roundtrip.ts`.** Expected: all pass, roundtrip diff count unchanged from before this plan.
- [ ] **Step 5: Commit** `feat: load/read paths use value accessors`.

### Task 3: Evaluator, seed, core value blocks

**Files:**
- Create: `src/blocks/values.ts` (value block spec table + `evalValue`), `src/blocks/rng.ts` (`mulberry32(seed: number): () => number`)
- Modify: `src/blocks/value.ts` (`argValue` evaluates), `src/blocks/generator.ts` (`GenOptions.session`), `src/blocks/register.ts` (register value blocks, "Werte" category in `buildToolbox`/`CATEGORIES`/`CAT_INFO`)
- Test: `scripts/value-blocks.test.ts`

**Interfaces:**
- Produces: `interface ValueSession { seed: number; now: Date; envName: string; projectName: string; fileName: string }`; `GenOptions.session?: ValueSession`; `interface EvalEnv { vars: Record<string,string>; session: ValueSession; rng: () => number; counters: Map<string, number>; warn: (msg: string, block: Blockly.Block) => void }`; `evalValue(block: Blockly.Block, env: EvalEnv): string | number`; `interface ValueSpec { type: string; cat: 'values'; msg: string; args?: ArgDef[]; tip: string; eval: (v: Record<string, string | number>, env: EvalEnv, block: Blockly.Block) => string | number }`; `VALUE_SPECS: ValueSpec[]`.
- Core blocks (types prefixed `val_`): `val_random_int`, `val_random_text`, `val_uuid`, `val_timestamp`, `val_join`, `val_variable`, `val_env`, `val_if`, `val_compare`, `val_counter`.

- [ ] **Step 1: Failing tests:** same seed → same output of `val_random_int` (1..100) in two `generate()` runs; different seeds differ; two `val_random_text` blocks in one export differ; `val_uuid` matches `/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/`; `val_timestamp` with fixed `now` and format `iso` returns `now.toISOString()`; `val_join("a","b","-")` → `a-b`; `val_if(val_compare("dev","=","dev"),"x","y")` → `x`; `val_variable` unknown name warns and `generate()` returns `blocked: true`; a `num` slot fed `val_random_text` warns `"…" ist keine Zahl.`; a value block in a disabled parent does not advance the counter; a loose value block never evaluates.
- [ ] **Step 2: Run; expect FAIL.**
- [ ] **Step 3: Implement.** Evaluation order is depth-first, left-to-right over blocks reached from enabled, attached stacks, using one `rng` created from `session.seed` per `generate()` call. `val_counter` key = block id; increments once per evaluation. `generate()` defaults `session` to a stable preview session when absent (seed 1) so existing callers keep working.
- [ ] **Step 4: Run `bun test` and `bunx tsc --noEmit`.** Expected: pass.
- [ ] **Step 5: Commit** `feat: value block evaluator with seeded session`.

### Task 4: Export seed and "Würfeln" UI

**Files:**
- Modify: `src/App.tsx` (export/download/Helm export call sites, preview seed state, toolbar button), `src/components/BlockEditor.tsx` (pass `session` to `generate`), `src/styles/` (button style, reuse existing `icon-btn`), `src/helm.ts` (accept `session`)
- Test: `scripts/value-blocks.test.ts` (seed plumbing unit tests); manual check in the browser preview

**Interfaces:**
- Consumes: `ValueSession`, `GenOptions.session`.
- Produces: `newSession(project: Project, file: ProjectFile): ValueSession` in `src/blocks/value.ts`; App state `previewSeed: number`.

- [ ] **Step 1: Failing test:** `newSession` twice produces different seeds; multi-file export helper uses one `session` for all files (same `now`, same `seed`).
- [ ] **Step 2: Run; expect FAIL.**
- [ ] **Step 3: Implement.** Preview uses `previewSeed` (set on mount, changed only by the "Würfeln" button, label "Würfeln", tooltip "Zufallswerte neu würfeln"). Every export/download/copy/Helm export action calls `newSession` once and passes it to every generated file.
- [ ] **Step 4: Verify in the browser** (`mcp__Claude_Browser__preview_start` with the dev server): drop `Zufallszahl` into a Replicas slot, preview stays stable while typing, "Würfeln" changes it, Download produces a different value than the previous download.
- [ ] **Step 5: Run `bun test`, `bunx tsc --noEmit`.** Expected: pass. **Commit** `feat: per-export seeds and reroll button`.

### Task 5: Remaining catalogue

**Files:**
- Modify: `src/blocks/values.ts`
- Create: `src/blocks/sha256.ts` (`sha256Hex(input: string): string`, sync)
- Test: `scripts/value-blocks.test.ts`

**Interfaces:**
- Produces (all in `VALUE_SPECS`, types `val_*`): `random_hex`, `random_pick`, `random_port`, `random_password`, `random_color`, `date_offset`, `upper`, `lower`, `slug`, `replace`, `substring`, `repeat`, `length`, `base64`, `sha256`, `urlencode`, `math`, `round`, `minmax`, `project_name`, `file_name`.

- [ ] **Step 1: Failing tests, one per block, with exact values:** `sha256("abc")` = `ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad`; `base64("hello")` = `aGVsbG8=`; `slug("Mein App 1")` = `mein-app-1`; `math(7,"%",4)` = `3`; `math(1,"÷",0)` warns, export blocked; `random_port(8000,8010)` within range; `random_password(16,no symbols)` matches `/^[A-Za-z0-9]{16}$/`; `random_pick("a,b,c")` ∈ {a,b,c}; `date_offset(+1)` with fixed `now` = next day.
- [ ] **Step 2: Run; expect FAIL.**
- [ ] **Step 3: Implement each spec** (German labels in `msg`, tips in `tip`); `sha256Hex` pure TS.
- [ ] **Step 4: Run `bun test`, `bunx tsc --noEmit`.** Expected: pass. **Commit** `feat: full value block catalogue`.

### Task 6: Docs

**Files:**
- Create: `docs-site/docs/funktionen/wertbloecke.md`
- Modify: `docs-site/sidebars.ts`, `docs-site/docs/entwicklung/neuer-block.md`

- [ ] **Step 1: Write the German feature page** (what value blocks are, catalogue table generated by hand from `VALUE_SPECS`, seed/Würfeln behaviour, Helm and custom-block limits from the spec's Risks section); add sidebar entry; add "How to add a value block" section to `neuer-block.md` pointing to `VALUE_SPECS`.
- [ ] **Step 2: Run `bun run docs:build`** (from repo root `bun scripts/gen-docs.ts && cd docs-site && bun run build`). Expected: build succeeds, no broken links.
- [ ] **Step 3: Commit** `docs: value blocks`.

---

## Self-Review

- Spec coverage: slots/migration/accessors → T1–2; evaluator, seed, preview stability → T3–4; catalogue → T3+T5; Helm, graph, custom blocks, market, Dockerfile → T2; docs → T6.
- Non-goals respected: dd/chk/multi untouched; no async.
- Types consistent: `ValueSession`, `EvalEnv`, `loadState`/`appendState`/`argValue`/`setArgValue` named identically across tasks.
- Known judgment calls for the executor: how `blockJson` places `%n` placeholders for inputs while keeping existing messages (`msg` strings use `%1..%n` per args already); default shadow wiring method.
