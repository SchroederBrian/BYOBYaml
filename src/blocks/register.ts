// Turns BlockSpecs into real Blockly blocks, plus theme, toolbox and context menu.
import * as Blockly from 'blockly/core';
import { registerFieldMultilineInput } from '@blockly/field-multilineinput';
import { ALL_BLOCKS } from './defs';
import { ArgDef, BlockSpec, CATEGORIES, CatId } from './types';
import { BUILTIN_SNIPPETS, snippetState } from '../snippets';

function argJson(a: ArgDef): any {
  switch (a.kind) {
    case 'text':
      return { type: 'field_input', name: a.name, text: a.value, spellcheck: false };
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

function blockJson(spec: BlockSpec): any {
  const json: any = {
    type: spec.type,
    message0: spec.msg,
    args0: (spec.args ?? []).map(argJson),
    style: spec.shape === 'hat' ? `${spec.cat}_hat` : `${spec.cat}_blocks`,
    tooltip: spec.tip ?? (spec.where ? `Gehört ${spec.where}.` : ''),
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
  userSnippets: () => any[];
} = { userSnippets: () => [] };

let registered = false;
export function registerBlocks() {
  if (registered) return;
  registered = true;
  registerFieldMultilineInput();
  Blockly.common.defineBlocksWithJsonArray(ALL_BLOCKS.map(blockJson));
  if (typeof document !== 'undefined') {
    Blockly.registry.register(Blockly.registry.Type.TOOLBOX_ITEM, Blockly.ToolboxCategory.registrationName, DotCategory, true);
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
export function readValues(block: Blockly.Block, spec: BlockSpec, vars: Record<string, string> = {}, problems: string[] = [], passThroughUnknown = false): Record<string, any> {
  const subst = (s: string) =>
    s.replace(VAR_RE, (m, name) => {
      if (name in vars) return vars[name];
      if (passThroughUnknown) return m;
      problems.push(`Variable \${${name}} ist nicht definiert.`);
      return m;
    });
  const v: Record<string, any> = {};
  for (const a of spec.args ?? []) {
    const raw = block.getFieldValue(a.name);
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
};

export function buildToolbox(mode: 'compose' | 'k8s') {
  const cats: CatId[] = mode === 'compose' ? ['compose', 'service', 'extras'] : ['resources', 'metadata', 'pod', 'container', 'network', 'data', 'build', 'scaling', 'extras'];
  const snippetGroups = [...new Set(BUILTIN_SNIPPETS.filter((s) => s.kind === mode).map((s) => s.group))];
  return {
    kind: 'categoryToolbox',
    contents: [
      ...CATEGORIES.filter((c) => cats.includes(c.id)).map((c) => ({
        kind: 'category',
        name: c.name,
        categorystyle: c.id,
        contents: [{ kind: 'label', text: CAT_INFO[c.id] }, ...ALL_BLOCKS.filter((b) => b.cat === c.id).map((b) => ({ kind: 'block', type: b.type }))],
      })),
      { kind: 'sep', gap: 14 },
      {
        kind: 'category',
        name: 'Vorlagen',
        categorystyle: 'snippets',
        contents: snippetGroups.flatMap((g) => [
          { kind: 'label', text: g.toUpperCase(), 'web-class': 'byob-group-label' },
          ...BUILTIN_SNIPPETS.filter((s) => s.kind === mode && s.group === g).flatMap((s) => [
            { kind: 'label', text: `${s.name} — ${s.hint}` },
            { kind: 'block', ...snippetState(s) },
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
    return list.flatMap((s: any) => [{ kind: 'label', text: s.name }, { kind: 'block', ...s.block }]);
  });
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
