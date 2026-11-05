import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import * as Blockly from 'blockly/core';
import * as De from 'blockly/msg/de';
import { buildTheme, buildToolbox, editorHooks, FIXED_FLYOUT, registerBlocks, registerDynamicCategories, START_SCALE } from '../blocks/register';
import { generate, GenResult } from '../blocks/generator';
import { FileKind, Snippet } from '../project';

export interface BlockEditorHandle {
  load(state: any, kind: FileKind, layout?: boolean): void;
  save(): any;
  select(blockId: string): void;
  cleanUp(): void;
  zoomToFit(): void;
  regenerate(): void;
  /** add a block chain (e.g. from the marketplace) near the visible top-left and select it */
  insert(blockState: any): void;
}

interface Props {
  vars: Record<string, string>;
  userSnippets: Snippet[];
  onChange: (res: GenResult) => void;
  onSaveSnippet: (state: any) => void;
  onShareSnippet?: (state: any) => void;
}

const BlockEditor = forwardRef<BlockEditorHandle, Props>(function BlockEditor({ vars, userSnippets, onChange, onSaveSnippet, onShareSnippet }, ref) {
  const host = useRef<HTMLDivElement>(null);
  const ws = useRef<Blockly.WorkspaceSvg | null>(null);
  const loading = useRef(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const varsRef = useRef(vars);
  const kindRef = useRef<FileKind>('compose');
  varsRef.current = vars;
  const snippetsRef = useRef(userSnippets);
  snippetsRef.current = userSnippets;
  editorHooks.onSaveSnippet = onSaveSnippet;
  editorHooks.onShareSnippet = onShareSnippet;
  editorHooks.userSnippets = () => snippetsRef.current;

  // never report (and thereby save) a workspace that has not been loaded with a file yet
  const loaded = useRef(false);
  const emit = () => {
    if (ws.current && loaded.current && !loading.current) onChangeRef.current(generate(ws.current, varsRef.current, { passThroughUnknownVars: kindRef.current === 'compose' }));
  };

  useEffect(() => {
    registerBlocks();
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
      w.dispose();
      ws.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // variables changed → regenerate
  useEffect(() => {
    emit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vars]);

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
      try {
        w.updateToolbox(buildToolbox(kind));
        Blockly.Events.disable();
        w.clear();
        if (state) Blockly.serialization.workspaces.load(state, w);
        if (layout) w.cleanUp();
      } finally {
        Blockly.Events.enable();
        loading.current = false;
        loaded.current = true;
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
      const block = Blockly.serialization.blocks.append({ ...rest, x: m.left + 60, y: m.top + 40 }, w) as Blockly.BlockSvg;
      Blockly.common.setSelected(block);
      w.scrollBoundsIntoView?.(block.getBoundingRectangle());
    },
  }));

  return <div className="block-host" ref={host} />;
});

export default BlockEditor;
