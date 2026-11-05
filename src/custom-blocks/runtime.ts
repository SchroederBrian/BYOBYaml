import * as Blockly from 'blockly/core';
import { SPEC_BY_TYPE } from '../blocks/defs';
import type { BlockSpec } from '../blocks/types';
import { CUSTOM_BLOCK, definitionSpec, normalizeDefinition, parameterField, type CustomBlockDefinition } from './model';

let allowed = false, library: CustomBlockDefinition[] = [];
let engine: typeof import('./validation') | null = null;
let enginePromise: Promise<typeof import('./validation')> | null = null;
export const setCustomBlockAccess = (value: boolean) => { allowed = value; if (!value) library = []; };
export const customBlockAccess = () => allowed;
export const setCustomBlockLibrary = (blocks: CustomBlockDefinition[]) => { library = allowed ? blocks.filter((block) => !block.archived).map(normalizeDefinition) : []; };
export const customBlockCatalogue = () => allowed ? library : [];
export const customValidation = () => engine;
export const ensureCustomValidation = () => enginePromise ??= import('./validation').then((loaded) => { engine = loaded; return loaded; });
export function getRuntimeSpec(block: Blockly.Block): BlockSpec | undefined {
  if (block.type !== CUSTOM_BLOCK) return SPEC_BY_TYPE[block.type];
  const definition = (block as any).byobDefinition as CustomBlockDefinition | undefined;
  return definition ? definitionSpec(definition) : undefined;
}
export function registerCustomBlockType(toJson: (spec: BlockSpec) => any) {
  if (Blockly.Blocks[CUSTOM_BLOCK]) return;
  Blockly.Blocks[CUSTOM_BLOCK] = {
    init() { this.appendDummyInput().appendField('Eigener Block'); this.setPreviousStatement(true); this.setNextStatement(true); this.setColour('#64748b'); },
    saveExtraState() { return this.byobDefinition ? { definition: structuredClone(this.byobDefinition) } : {}; },
    loadExtraState(state: any) {
      if (!allowed) { this.setWarningText('Eigene Blocktypen sind nur nach Anmeldung verfügbar.'); return; }
      let definition: CustomBlockDefinition;
      try { definition = normalizeDefinition(state?.definition); } catch (error) { this.setWarningText((error as Error).message); return; }
      for (const input of [...this.inputList]) this.removeInput(input.name);
      this.setPreviousStatement(false); this.setNextStatement(false);
      this.byobDefinition = definition;
      this.jsonInit(toJson(definitionSpec(definition)));
      this.setColour(definition.color);
      for (const p of definition.parameters) {
        const value = p.kind === 'boolean' ? p.value === true || p.value === 'TRUE' ? 'TRUE' : 'FALSE' : p.kind === 'select' && p.value === '' ? '__none__' : String(p.value);
        this.setFieldValue(value, parameterField(p.id));
      }
    },
  };
}
