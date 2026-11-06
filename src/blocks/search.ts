import { ALL_BLOCKS } from './defs';
import { CATEGORIES } from './types';
import { BUILTIN_SNIPPETS, snippetState } from '../snippets';
import { normalizeState } from './value';
import { VALUE_SPECS } from './values';
import type { Snippet } from '../project';
import { customBlockCatalogue } from '../custom-blocks/runtime';
import { CUSTOM_BLOCK } from '../custom-blocks/model';

export const SEARCH_PAGE_SIZE = 40;
const normal = (value: string) => value.toLocaleLowerCase('de').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/ß/g, 'ss').replace(/[_%]+/g, ' ');

/** Search the complete catalogue, including categories hidden by the current file kind. */
export function searchBlocks(query: string, ownSnippets: Snippet[], limit = SEARCH_PAGE_SIZE): { total: number; shown: number; contents: any[] } {
  const terms = normal(query.trim()).split(/\s+/).filter(Boolean);
  if (!terms.length) return { total: 0, shown: 0, contents: [] };
  const matches = (text: string) => terms.every((term) => normal(text).includes(term));
  const results: { group: string; label?: string; block: any }[] = [];
  for (const definition of customBlockCatalogue()) if (matches(`${definition.name} ${definition.description} eigene Blöcke ${definition.kind}`)) results.push({ group: 'Eigene Blöcke', label: definition.name, block: { kind: 'block', type: CUSTOM_BLOCK, extraState: { definition } } });
  for (const category of CATEGORIES) {
    for (const block of ALL_BLOCKS.filter((definition) => definition.cat === category.id)) {
      const text = [block.msg.replace(/%\d+/g, ''), block.type, block.tip ?? '', block.where ?? '', category.name, ...((block.args ?? []).map((arg) => arg.name))].join(' ');
      if (matches(text)) results.push({ group: category.name, block: { kind: 'block', type: block.type } });
    }
  }
  for (const block of VALUE_SPECS) {
    const text = [block.msg.replace(/%\d+/g, ''), block.type, block.tip, block.keywords ?? '', 'Werte Wertblock rund'].join(' ');
    if (matches(text)) results.push({ group: 'Werte', block: { kind: 'block', type: block.type } });
  }
  for (const snippet of BUILTIN_SNIPPETS) if (matches(`${snippet.name} ${snippet.hint} ${snippet.group} ${snippet.kind}`)) {
    results.push({ group: `Vorlagen · ${snippet.kind === 'dockerfile' ? 'Dockerfile' : snippet.kind === 'compose' ? 'Compose' : 'Kubernetes/OpenShift'}`, label: `${snippet.name} — ${snippet.hint}`, block: { kind: 'block', ...normalizeState(snippetState(snippet)) } });
  }
  for (const snippet of ownSnippets) if (snippet.block && matches(`${snippet.name} ${snippet.category} eigene Vorlage`)) {
    results.push({ group: 'Meine Vorlagen', label: snippet.name, block: { kind: 'block', ...normalizeState(snippet.block) } });
  }
  const visible = results.slice(0, limit);
  const contents: any[] = [{ kind: 'label', text: results.length ? `${results.length} Treffer in allen Kategorien` : 'Keine passenden Blöcke oder Vorlagen.' }];
  let group = '';
  for (const result of visible) {
    if (group !== result.group) { group = result.group; contents.push({ kind: 'label', text: group, 'web-class': 'byob-group-label' }); }
    if (result.label) contents.push({ kind: 'label', text: result.label });
    contents.push(result.block);
  }
  if (!results.length) contents.push({ kind: 'label', text: 'Anderen Namen, Begriff oder eine Kategorie suchen.' });
  if (visible.length < results.length) contents.push({ kind: 'label', text: `${visible.length} von ${results.length} · Weitere Treffer über +40 neben der Suche` });
  return { total: results.length, shown: visible.length, contents };
}
