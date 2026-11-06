import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import * as Blockly from 'blockly/core';
import * as De from 'blockly/msg/de';
import { buildTheme, buildToolbox, editorHooks, FIXED_FLYOUT, registerBlocks, registerDynamicCategories, START_SCALE } from '../blocks/register';
import { generate, GenResult } from '../blocks/generator';
import { appendState, argValue, loadState, type ValueSession } from '../blocks/value';
import { FileKind, Snippet } from '../project';
import { CanvasMode, enableSelection, patchChainCopy, Selection } from '../blocks/multiselect';
import { searchBlocks, SEARCH_PAGE_SIZE } from '../blocks/search';
import { Icon } from './Icons';
import type { CustomBlockDefinition } from '../custom-blocks/model';
import { imageFields, imageTarget, setImagePicker } from '../registry/editor';
import type { ImageTarget } from '../registry/types';
import '../styles/block-search.css';

export interface BlockEditorHandle {
  load(state: any, kind: FileKind, layout?: boolean): void;
  save(): any;
  select(blockId: string): void;
  cleanUp(): void;
  zoomToFit(): void;
  regenerate(): void;
  /** add a block chain (e.g. from the marketplace) near the visible top-left and select it */
  insert(blockState: any): void;
  setMode(m: CanvasMode): void;
  clearSelection(): void;
  imageTargets(): ImageTarget[];
  addImage(reference: string): void;
}

interface Props {
  fileKey: string;
  vars: Record<string, string>;
  /** seed and clock for value blocks in the live preview; change it to roll new values */
  session: ValueSession;
  userSnippets: Snippet[];
  onChange: (res: GenResult) => void;
  onSaveSnippet: (state: any) => void;
  onShareSnippet?: (state: any) => void;
  mode: CanvasMode;
  onSelectionChange?: (count: number) => void;
  onDesignCustomBlocks?: (definition?: CustomBlockDefinition) => void;
  customLibraryVersion?: string;
  onBrowseImage?: (target: ImageTarget) => void;
}

const BlockEditor = forwardRef<BlockEditorHandle, Props>(function BlockEditor({ fileKey, vars, session, userSnippets, onChange, onSaveSnippet, onShareSnippet, mode, onSelectionChange, onDesignCustomBlocks, customLibraryVersion, onBrowseImage }, ref) {
  const host = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [searchLimit, setSearchLimit] = useState(SEARCH_PAGE_SIZE);
  const queryRef = useRef(query);
  const limitRef = useRef(searchLimit);
  queryRef.current = query;
  limitRef.current = searchLimit;
  const appliedSearch = useRef(false);
  const previousCategory = useRef<string | undefined>(undefined);
  const input = useRef<HTMLInputElement>(null);
  const results = useMemo(() => searchBlocks(query, userSnippets, searchLimit), [query, userSnippets, searchLimit, customLibraryVersion]);
  const ws = useRef<Blockly.WorkspaceSvg | null>(null);
  const loading = useRef(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const varsRef = useRef(vars);
  const kindRef = useRef<FileKind>('compose');
  varsRef.current = vars;
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const selection = useRef<Selection | null>(null);
  const selChange = useRef(onSelectionChange);
  selChange.current = onSelectionChange;
  const snippetsRef = useRef(userSnippets);
  snippetsRef.current = userSnippets;
  editorHooks.onSaveSnippet = onSaveSnippet;
  editorHooks.onShareSnippet = onShareSnippet;
  editorHooks.onDesignCustomBlocks = onDesignCustomBlocks;
  editorHooks.userSnippets = () => snippetsRef.current;
  setImagePicker(onBrowseImage);

  // never report (and thereby save) a workspace that has not been loaded with a file yet
  const loaded = useRef<string | null>(null);
  const fileKeyRef = useRef(fileKey);
  fileKeyRef.current = fileKey;
  const emit = () => {
    if (ws.current && loaded.current === fileKeyRef.current && !loading.current) onChangeRef.current(generate(ws.current, varsRef.current, { fileKind:kindRef.current, passThroughUnknownVars: kindRef.current === 'compose', session: sessionRef.current }));
  };
  const updatePalette = () => {
    const workspace = ws.current;
    if (!workspace) return;
    const searching = !!queryRef.current.trim();
    if (searching && !appliedSearch.current) previousCategory.current = (workspace.getToolbox()?.getSelectedItem() as Blockly.ToolboxCategory | null)?.getName?.();
    workspace.updateToolbox(buildToolbox(kindRef.current, queryRef.current, snippetsRef.current, limitRef.current));
    const toolbox = workspace.getToolbox();
    const items = toolbox?.getToolboxItems() ?? [];
    if (searching) toolbox?.setSelectedItem(items[0] ?? null);
    else if (appliedSearch.current) toolbox?.setSelectedItem(items.find((item) => (item as Blockly.ToolboxCategory).getName?.() === previousCategory.current) ?? null);
    appliedSearch.current = searching;
  };

  useEffect(() => {
    registerBlocks();
    patchChainCopy();
    Blockly.setLocale(De as any);
    const w = Blockly.inject(host.current!, {
      renderer: 'thrasos',
      theme: buildTheme(),
      toolbox: buildToolbox('compose'),
      trashcan: true,
      sounds: false,
      grid: { spacing: 24, length: 1, colour: '#232833', snap: true },
      zoom: { controls: true, wheel: true, startScale: START_SCALE(), maxScale: 2, minScale: 0.35, scaleSpeed: 1.12 },
      plugins: { flyoutsVerticalToolbox: FIXED_FLYOUT },
      move: { scrollbars: true, drag: true, wheel: false },
    });
    ws.current = w;
    registerDynamicCategories(w);
    selection.current = enableSelection(w, host.current!, (n) => selChange.current?.(n), mode);
    // handle for automation / debugging (docs screenshots)
    (window as any).__byob = { ws: w, Blockly };

    let timer: number | undefined;
    w.addChangeListener((e) => {
      if (e.isUiEvent || loading.current) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(emit, 60);
    });

    const ro = new ResizeObserver(() => Blockly.svgResize(w));
    ro.observe(host.current!);
    return () => {
      ro.disconnect();
      selection.current?.dispose();
      w.dispose();
      ws.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => selection.current?.setMode(mode), [mode]);
  useEffect(() => { updatePalette(); emit(); }, [customLibraryVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!query.trim() && !appliedSearch.current) return;
    const timer = window.setTimeout(updatePalette, 120);
    return () => window.clearTimeout(timer);
    // The palette uses refs for the current workspace, file kind and snippets.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, searchLimit, userSnippets]);

  // variables changed → regenerate
  useEffect(() => {
    emit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vars, session]);

  // user snippets changed → refresh an open "Meine Vorlagen" flyout
  useEffect(() => {
    const tb = ws.current?.getToolbox() as Blockly.Toolbox | null;
    const sel = tb?.getSelectedItem() as any;
    if (sel?.getName?.() === 'Meine Vorlagen') tb?.refreshSelection();
  }, [userSnippets]);

  useImperativeHandle(ref, () => ({
    load(state, kind, layout) {
      kindRef.current = kind;
      const w = ws.current;
      if (!w) return;
      loading.current = true;
      selection.current?.clear();
      try {
        updatePalette();
        Blockly.Events.disable();
        w.clear();
        if (state) loadState(state, w);
        if (layout) w.cleanUp();
      } finally {
        Blockly.Events.enable();
        loading.current = false;
        loaded.current = fileKeyRef.current;
      }
      emit();
      // place first stack top-left next to the toolbox
      requestAnimationFrame(() => {
        Blockly.svgResize(w);
        const first = w.getTopBlocks(true)[0];
        const hostRect = host.current?.getBoundingClientRect();
        const tb = host.current?.querySelector('.blocklyToolbox')?.getBoundingClientRect();
        if (!first || !hostRect) return;
        const r = first.getSvgRoot().getBoundingClientRect();
        w.scroll(w.scrollX + (tb ? tb.right : hostRect.left) + 40 - r.left, w.scrollY + hostRect.top + 32 - r.top);
      });
    },
    save() {
      return ws.current ? Blockly.serialization.workspaces.save(ws.current) : null;
    },
    select(id) {
      const w = ws.current;
      const block = w?.getBlockById(id);
      if (!w || !block) return;
      w.centerOnBlock(id);
      Blockly.common.setSelected(block as Blockly.BlockSvg);
    },
    cleanUp() {
      ws.current?.cleanUp();
    },
    zoomToFit() {
      ws.current?.zoomToFit();
    },
    regenerate: emit,
    insert(blockState) {
      const w = ws.current;
      if (!w) return;
      const m = w.getMetricsManager().getViewMetrics(true);
      const { x: _x, y: _y, ...rest } = blockState ?? {};
      const block = appendState({ ...rest, x: m.left + 60, y: m.top + 40 }, w) as Blockly.BlockSvg;
      Blockly.common.setSelected(block);
      w.scrollBoundsIntoView?.(block.getBoundingRectangle());
    },
    setMode(m) {
      selection.current?.setMode(m);
    },
    clearSelection() {
      selection.current?.clear();
    },
    imageTargets() {
      const workspace=ws.current;if(!workspace)return [];
      const selected=Blockly.common.getSelected();
      return workspace.getAllBlocks(false).sort((a,b)=>Number(b===selected)-Number(a===selected)).flatMap((block)=>imageFields(block).map((field)=>imageTarget(block,field)));
    },
    addImage(reference) {
      const workspace=ws.current;
      if(!workspace||loaded.current!==fileKeyRef.current)throw new Error('Bitte zuerst eine Datei öffnen.');
      const base=reference.split('@')[0].split('/').at(-1)!.split(':')[0].toLowerCase().replace(/[^a-z0-9-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,50)||'app';
      let name=base,index=2;const used=new Set(workspace.getAllBlocks(false).map((block)=>argValue(block,'NAME')));while(used.has(name))name=`${base}-${index++}`;
      const attach=(parent:Blockly.Block,child:Blockly.Block)=>{let last=parent;while(last.getNextBlock())last=last.getNextBlock()!;last.nextConnection!.connect(child.previousConnection!);};
      Blockly.Events.setGroup(true);
      try{
        let block:Blockly.BlockSvg;
        if(kindRef.current==='dockerfile'){
          let root:Blockly.Block|undefined=workspace.getTopBlocks(false).find((block)=>block.type==='df_file'&&block.isEnabled());
          if(!root)root=appendState({type:'df_file',x:55,y:55},workspace);
          block=appendState({type:'df_from',fields:{IMAGE:reference}},workspace) as Blockly.BlockSvg;attach(root,block);
        }else if(kindRef.current==='compose'){
          let root:Blockly.Block|undefined=workspace.getTopBlocks(false).find((block)=>block.type==='compose_file'&&block.isEnabled());
          if(!root)root=appendState({type:'compose_file',fields:{NAME:''},x:55,y:55},workspace);
          block=appendState({type:'compose_service',fields:{NAME:name,IMAGE:reference}},workspace) as Blockly.BlockSvg;attach(root,block);
        }else{
          let root:Blockly.Block|undefined=workspace.getTopBlocks(false).find((block)=>['k8s_deployment','k8s_deploymentconfig','k8s_statefulset','k8s_daemonset','k8s_job','k8s_cronjob'].includes(block.type)&&block.isEnabled());
          if(!root)root=appendState({type:'k8s_deployment',fields:{NAME:name,REPLICAS:'1'},x:55,y:55},workspace);
          block=appendState({type:'pod_container',fields:{NAME:name,IMAGE:reference}},workspace) as Blockly.BlockSvg;attach(root,block);
        }
        Blockly.common.setSelected(block);workspace.centerOnBlock(block.id);
      }finally{Blockly.Events.setGroup(false);}
      emit();
    },
  }));

  return <>
    <div className={`block-host block-host-searchable${onDesignCustomBlocks ? ' with-designer' : ''}`} ref={host} />
    <div className={`block-palette-search${onDesignCustomBlocks ? ' with-designer' : ''}`} role="search" aria-label="Blockkatalog durchsuchen">
      <div className="block-search-field"><Icon name="search" size={13} className="block-search-icon" /><input ref={input} type="search" aria-label="Blöcke suchen" placeholder="Blöcke suchen" autoComplete="off" spellCheck={false} value={query} onChange={(event) => { setQuery(event.target.value); setSearchLimit(SEARCH_PAGE_SIZE); }} onKeyDown={(event) => {
        if (!event.ctrlKey && !event.metaKey) event.stopPropagation();
        if (event.key === 'Escape') { event.preventDefault(); setQuery(''); setSearchLimit(SEARCH_PAGE_SIZE); }
      }} />{query && <button type="button" title="Blocksuche leeren" aria-label="Blocksuche leeren" onClick={() => { setQuery(''); setSearchLimit(SEARCH_PAGE_SIZE); input.current?.focus(); }}><Icon name="x" size={12} /></button>}</div>
      <div className="block-search-footer"><div className="block-search-status" role="status" aria-live="polite">{query.trim() ? `${results.shown < results.total ? `${results.shown}/${results.total}` : results.total} Treffer` : 'Alle Kategorien'}</div>{results.shown < results.total && <button className="block-search-more" type="button" aria-label="Weitere Treffer anzeigen" title="Weitere 40 Treffer anzeigen" onClick={() => setSearchLimit((limit) => limit + SEARCH_PAGE_SIZE)}><Icon name="plus" size={11} />40</button>}</div>
      {onDesignCustomBlocks && <button className="block-designer-button" onClick={() => onDesignCustomBlocks()}><Icon name="plus" size={12} /> Eigene Blocktypen</button>}
    </div>
  </>;
});

export default BlockEditor;
