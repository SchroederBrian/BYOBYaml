// Turns BlockSpecs into real Blockly blocks, plus theme, toolbox and context menu.
import * as Blockly from 'blockly/core';
import { registerFieldMultilineInput } from '@blockly/field-multilineinput';
import { ALL_BLOCKS } from './defs';
import { ArgDef, BlockSpec, CATEGORIES, CatId } from './types';
import { BUILTIN_SNIPPETS, snippetState } from '../snippets';
import { searchBlocks, SEARCH_PAGE_SIZE } from './search';
import type { FileKind, Snippet } from '../project';
import { customBlockCatalogue, registerCustomBlockType } from '../custom-blocks/runtime';
import { CUSTOM_BLOCK } from '../custom-blocks/model';
import { imageFields, imageTarget, isNativeImageField, openImagePicker, registerImageField } from '../registry/editor';
import { argValue, isSlot, normalizeState, registerSlotExtension, shadowBlockJson, VALUE_CHECK, type EvalEnv } from './value';
import { VALUE_GROUPS, VALUE_SPECS, type ValueSpec } from './values';

function argJson(a: ArgDef, type: string): any {
  if (isSlot(type, a)) return { type: 'input_value', name: a.name, check: VALUE_CHECK };
  switch (a.kind) {
    case 'text':
      return { type: isNativeImageField(type,a.name)||type===CUSTOM_BLOCK ? 'field_registry_image' : 'field_input', name: a.name, text: a.value, spellcheck: false };
    case 'multi':
      return { type: 'field_multilinetext', name: a.name, text: a.value, spellcheck: false };
    case 'num':
      // text field so ${VARIABLES} work in numbers too
      return { type: 'field_input', name: a.name, text: String(a.value), spellcheck: false };
    case 'dd':
      return { type: 'field_dropdown', name: a.name, options: a.options.map(([l, v]) => [l, v === '' ? '__none__' : v]) };
    case 'chk':
      return { type: 'field_checkbox', name: a.name, checked: a.value };
  }
}

/** A value block: round, plugs into a slot, computes at export. */
function valueJson(spec: ValueSpec): any {
  return {
    type: spec.type,
    message0: spec.msg,
    args0: (spec.args ?? []).map((arg) => argJson(arg, spec.type)),
    output: VALUE_CHECK,
    style: 'values_blocks',
    tooltip: spec.tip,
    inputsInline: true,
    ...((spec.args ?? []).some((arg) => isSlot(spec.type, arg)) ? { extensions: ['byob_slots'] } : {}),
  };
}

function blockJson(spec: BlockSpec): any {
  const json: any = {
    type: spec.type,
    message0: spec.msg,
    args0: (spec.args ?? []).map((arg)=>argJson(arg,spec.type)),
    style: spec.shape === 'hat' ? `${spec.cat}_hat` : `${spec.cat}_blocks`,
    tooltip: spec.tip ?? (spec.where ? `Gehört ${spec.where}.` : ''),
    inputsInline: true,
    ...(spec.type !== CUSTOM_BLOCK && (spec.args ?? []).some((arg) => isSlot(spec.type, arg)) ? { extensions: ['byob_slots'] } : {}),
  };
  if (spec.shape === 'hat') {
    json.nextStatement = null;
  } else {
    json.previousStatement = null;
    json.nextStatement = null;
  }
  if (spec.shape === 'c') {
    json.message1 = '%1';
    json.args1 = [{ type: 'input_statement', name: 'BODY' }];
  }
  return json;
}

// ---------- hooks the React app plugs into ----------
export const editorHooks: {
  onSaveSnippet?: (state: any) => void;
  onShareSnippet?: (state: any) => void;
  onDesignCustomBlocks?: (definition?: import('../custom-blocks/model').CustomBlockDefinition) => void;
  userSnippets: () => any[];
} = { userSnippets: () => [] };

let registered = false;
export function registerBlocks() {
  if (registered) return;
  registered = true;
  registerFieldMultilineInput();
  registerImageField();
  registerSlotExtension();
  Blockly.common.defineBlocksWithJsonArray([...shadowBlockJson(), ...VALUE_SPECS.map(valueJson), ...ALL_BLOCKS.map(blockJson)]);
  registerCustomBlockType(blockJson);
  if (typeof document !== 'undefined') {
    Blockly.ContextMenuRegistry.registry.register({id:'byob_browse_image',scopeType:Blockly.ContextMenuRegistry.ScopeType.BLOCK,weight:-12,displayText:'Image & Tag auswählen…',preconditionFn:(scope)=>scope.block&&!scope.block.isInFlyout&&openImagePicker&&imageFields(scope.block).length?'enabled':'hidden',callback:(scope)=>{if(scope.block){const field=imageFields(scope.block)[0];if(field)openImagePicker?.(imageTarget(scope.block,field));}}});
    Blockly.ContextMenuRegistry.registry.register({
      id: 'byob_edit_custom', scopeType: Blockly.ContextMenuRegistry.ScopeType.BLOCK, weight: -11,
      displayText: 'Blocktyp im Designer öffnen…',
      preconditionFn: (scope) => scope.block?.type === CUSTOM_BLOCK && !scope.block.isInFlyout && editorHooks.onDesignCustomBlocks ? 'enabled' : 'hidden',
      callback: (scope) => editorHooks.onDesignCustomBlocks?.((scope.block as any)?.byobDefinition),
    });
    Blockly.registry.register(Blockly.registry.Type.TOOLBOX_ITEM, Blockly.ToolboxCategory.registrationName, DotCategory, true);
    Blockly.registry.register(Blockly.registry.Type.FLYOUTS_VERTICAL_TOOLBOX, FIXED_FLYOUT, FixedScaleFlyout, true);
    Blockly.ContextMenuRegistry.registry.register({
      id: 'byob_save_snippet',
      scopeType: Blockly.ContextMenuRegistry.ScopeType.BLOCK,
      weight: -10,
      displayText: 'Ab hier als Vorlage speichern…',
      preconditionFn: (scope) => (scope.block && !scope.block.isInFlyout ? 'enabled' : 'hidden'),
      callback: (scope) => {
        if (!scope.block) return;
        const state = Blockly.serialization.blocks.save(scope.block, { addCoordinates: false, addNextBlocks: true, saveIds: false });
        editorHooks.onSaveSnippet?.(state);
      },
    });
    Blockly.ContextMenuRegistry.registry.register({
      id: 'byob_share_snippet',
      scopeType: Blockly.ContextMenuRegistry.ScopeType.BLOCK,
      weight: -9,
      displayText: 'Ab hier im Marktplatz teilen…',
      preconditionFn: (scope) => (scope.block && !scope.block.isInFlyout && editorHooks.onShareSnippet ? 'enabled' : 'hidden'),
      callback: (scope) => {
        if (!scope.block) return;
        const state = Blockly.serialization.blocks.save(scope.block, { addCoordinates: false, addNextBlocks: true, saveIds: false });
        editorHooks.onShareSnippet?.(state);
      },
    });
  }
}

const VAR_RE = /\$\{([A-Za-z_][\w.-]*)\}/g;

/** Read a block's field values into a plain object (typed), substituting ${VARS}. */
export function readValues(block: Blockly.Block, spec: BlockSpec, vars: Record<string, string> = {}, problems: string[] = [], passThroughUnknown = false, env?: EvalEnv): Record<string, any> {
  const subst = (s: string) =>
    s.replace(VAR_RE, (m, name) => {
      if (name in vars) return vars[name];
      if (passThroughUnknown) return m;
      problems.push(`Variable \${${name}} ist nicht definiert.`);
      return m;
    });
  const v: Record<string, any> = {};
  for (const a of spec.args ?? []) {
    const raw = a.kind === 'text' || a.kind === 'num' ? argValue(block, a.name, env) : block.getFieldValue(a.name);
    if (a.kind === 'chk') v[a.name] = raw === 'TRUE' || raw === true;
    else if (a.kind === 'dd') v[a.name] = raw === '__none__' ? '' : raw;
    else if (a.kind === 'num') {
      const s = subst(String(raw ?? '').trim());
      const n = Number(s);
      // unresolved ${X} / ${{X}} (Compose, OpenShift templates) stays as text
      const passVar = passThroughUnknown && s.includes('${');
      if ((s === '' || Number.isNaN(n)) && !passVar) problems.push(`"${s}" ist keine Zahl.`);
      v[a.name] = s === '' || Number.isNaN(n) ? s : n;
    } else {
      // keep multi-line values exactly (trailing newline matters for certs/config files)
      const str = String(raw ?? '');
      v[a.name] = subst(str.includes('\n') ? str : str.trim());
    }
  }
  return v;
}

// ---------- theme ----------
export function buildTheme() {
  const blockStyles: Record<string, any> = {};
  for (const c of CATEGORIES) {
    const base = { colourPrimary: c.colour, colourSecondary: c.secondary, colourTertiary: c.tertiary };
    blockStyles[`${c.id}_blocks`] = base;
    blockStyles[`${c.id}_hat`] = { ...base, hat: 'cap' };
  }
  const categoryStyles: Record<string, any> = { snippets: { colour: '#8b93a6' }, mine: { colour: '#d6dae3' } };
  for (const c of CATEGORIES) categoryStyles[c.id] = { colour: c.colour };
  return Blockly.Theme.defineTheme('byob-dark', {
    name: 'byob-dark',
    base: Blockly.Themes.Classic,
    blockStyles,
    categoryStyles,
    componentStyles: {
      workspaceBackgroundColour: '#13161c',
      toolboxBackgroundColour: '#0f1216',
      toolboxForegroundColour: '#c4cad6',
      flyoutBackgroundColour: '#191d25',
      flyoutForegroundColour: '#c4cad6',
      flyoutOpacity: 1,
      scrollbarColour: '#3a414e',
      scrollbarOpacity: 0.7,
      insertionMarkerColour: '#ffffff',
      insertionMarkerOpacity: 0.25,
      cursorColour: '#7aa2ff',
      selectedGlowColour: '#7aa2ff',
    },
    fontStyle: { family: '"IBM Plex Sans", "Segoe UI", sans-serif', weight: '500', size: 11 },
    startHats: true,
  });
}

// ---------- toolbox ----------
const CAT_INFO: Record<CatId, string> = {
  dockerImage: 'Dockerfile-Start, Basis-Image und Build-Phasen',
  dockerBuild: 'Dateien kopieren und Build-Befehle ausführen',
  dockerRuntime: 'Umgebung und Startverhalten des fertigen Images',
  compose: 'Docker Compose: Datei, Services, Volumes, Netze',
  service: 'Service-Optionen (in einen Service legen)',
  resources: 'Startblöcke: eine Ressource pro Block',
  metadata: 'Namespace, Labels, Annotationen',
  pod: 'Pod-Ebene (unter Workloads)',
  container: 'Container-Ebene (in einen Container legen)',
  network: 'Service-Ports, Route, Ingress',
  data: 'ConfigMap, Secret, PVC',
  build: 'OpenShift ImageStream & BuildConfig',
  scaling: 'HorizontalPodAutoscaler',
  extras: 'Beliebige Felder setzen – für alles ohne eigenen Block',
  values: 'Runde Blöcke für Eingabefelder: Zufall, Zeit, Text, Variablen. Werden beim Export berechnet.',
};

export function buildToolbox(mode: FileKind, query = '', snippets: Snippet[] = [], limit = SEARCH_PAGE_SIZE) {
  if (query.trim()) return {
    kind: 'categoryToolbox',
    contents: [{ kind: 'category', name: 'Suchergebnisse', categorystyle: 'extras', contents: searchBlocks(query, snippets, limit).contents }],
  };
  const cats: CatId[] = mode === 'dockerfile' ? ['dockerImage','dockerBuild','dockerRuntime', 'values'] : mode === 'compose' ? ['compose', 'service', 'extras', 'values'] : ['resources', 'metadata', 'pod', 'container', 'network', 'data', 'build', 'scaling', 'extras', 'values'];
  const snippetGroups = [...new Set(BUILTIN_SNIPPETS.filter((s) => s.kind === mode).map((s) => s.group))];
  return {
    kind: 'categoryToolbox',
    contents: [
      ...CATEGORIES.filter((c) => cats.includes(c.id)).map((c) => ({
        kind: 'category',
        name: c.name,
        categorystyle: c.id,
        contents: [{ kind: 'label', text: CAT_INFO[c.id] }, ...(c.id === 'values'
          ? VALUE_GROUPS.flatMap((g) => [{ kind: 'label', text: g.title.toUpperCase(), 'web-class': 'byob-group-label' }, ...g.types.map((type) => ({ kind: 'block', type }))])
          : ALL_BLOCKS.filter((b) => b.cat === c.id).map((b) => ({ kind: 'block', type: b.type })))],
      })),
      ...(customBlockCatalogue().some((block) => block.kind === mode) ? [{ kind: 'category', name: 'Eigene Blöcke', categorystyle: 'mine', contents: customBlockCatalogue().filter((block) => block.kind === mode).flatMap((definition) => [{ kind: 'label', text: definition.name }, { kind: 'block', type: CUSTOM_BLOCK, extraState: { definition } }]) }] : []),
      { kind: 'sep', gap: 14 },
      {
        kind: 'category',
        name: 'Vorlagen',
        categorystyle: 'snippets',
        contents: snippetGroups.flatMap((g) => [
          { kind: 'label', text: g.toUpperCase(), 'web-class': 'byob-group-label' },
          ...BUILTIN_SNIPPETS.filter((s) => s.kind === mode && s.group === g).flatMap((s) => [
            { kind: 'label', text: `${s.name} — ${s.hint}` },
            { kind: 'block', ...normalizeState(snippetState(s)) },
          ]),
        ]),
      },
      { kind: 'category', name: 'Meine Vorlagen', categorystyle: 'mine', custom: 'MY_SNIPPETS' },
    ],
  };
}

export function registerDynamicCategories(ws: Blockly.WorkspaceSvg) {
  ws.registerToolboxCategoryCallback('MY_SNIPPETS', () => {
    const list = editorHooks.userSnippets();
    if (!list.length) return [{ kind: 'label', text: 'Noch leer. Rechtsklick auf einen Block → „Ab hier als Vorlage speichern…“' }];
    return list.flatMap((s: any) => [{ kind: 'label', text: s.name }, { kind: 'block', ...normalizeState(s.block) }]);
  });
}

// Palette (flyout) keeps its normal size: Blockly would scale it with the canvas zoom.
export const FIXED_FLYOUT = 'byobFixedFlyout';
export const START_SCALE = () => (typeof window !== 'undefined' && window.matchMedia('(max-width: 820px)').matches ? 0.7 : 0.9);
class FixedScaleFlyout extends Blockly.VerticalFlyout {
  override getFlyoutScale(): number {
    return START_SCALE();
  }
}

// Compact category row: small colour dot + label.
class DotCategory extends Blockly.ToolboxCategory {
  constructor(def: Blockly.utils.toolbox.CategoryInfo, toolbox: Blockly.IToolbox, parent?: Blockly.ICollapsibleToolboxItem) {
    super(def, toolbox, parent);
  }
  protected override addColourBorder_(): void {
    // no side stripe
  }
  protected override createIconDom_(): Element {
    const el = document.createElement('span');
    el.className = 'byob-cat-dot';
    el.style.background = this.colour_;
    return el;
  }
  override setSelected(isSelected: boolean): void {
    super.setSelected(isSelected);
    const row = this.rowDiv_ as HTMLElement | null;
    if (row) row.style.backgroundColor = '';
  }
}
