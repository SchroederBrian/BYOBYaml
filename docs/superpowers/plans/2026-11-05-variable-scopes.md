# Variable scopes implementation plan

**Goal:** Support variables shared by all files and variables private to one file, as approved in chat. Lists were only an analogy and are outside this change.

**Design:** Keep `Project.variables` global and add optional `ProjectFile.variables`. Resolve globals followed by the selected file's locals for the active environment. A local value, including an empty value, overrides a global of the same name. Existing projects remain compatible. Store local values with files so file copies, renames, and marketplace imports preserve ownership without ID remapping.

**Approaches:** File-owned variable arrays fit the existing model and file copying. A single project array with file IDs would require remapping ownership on every copy/import and is unnecessary here.

**Constraints:** Preserve unrelated workspace edits. Keep German UI copy, `${NAME}` syntax, environments, and project format version 2. Work in the current checkout because the requested editor and explorer changes depend on its existing uncommitted edits; do not commit those edits. No new product dependencies.

## Tasks

- [ ] Add failing Bun regression tests for normalization, scope resolution, YAML generation, and sharing.
- [ ] Add file variables and one shared resolver; preserve local arrays through normalization and `.byob` round trips.
- [ ] Use per-file resolution in editor preview, selected-file exports, full export, and marketplace previews. Preserve file variables during sharing/import, include them in secret scanning and value stripping.
- [ ] Add clearly labeled global and current-file sections to the Variables panel. Remove environment values in both scopes. Update the badge and help documentation.
- [ ] Run regression tests, type checking, build, sample round trips, and browser checks for switching files, changing environment, persistence, copying files, and export.

## Review focus

Local names must not leak into other files; overrides must be independent of variable order; blank local values must override; saves and downloads must preserve local ownership; changing files must regenerate with the newly selected file's variables; sharing without values must clear both scopes.

## Verification notes

Baseline `bun run build` fails before compilation because `node_modules/.bin` contains Windows executables. Restore Linux tool executables for verification without changing declared dependency versions. The existing `check` command also references missing `scripts/gen-examples.ts`; use the available round-trip script directly.
