// Canvas selection for Blockly 13 (no official plugin for v13):
// - drag on empty canvas draws a selection frame (Shift = add to the selection)
// - Shift+click toggles a block
// - dragging a selected stack moves all selected stacks along
// - Entf/Backspace, Strg+C, Strg+X, Strg+D work on the whole selection
// Also: copying a single block (Strg+C, context menu) copies it *with all blocks below it*.
import * as Blockly from 'blockly/core';

export type CanvasMode = 'select' | 'pan';

const MULTI_PASTER = 'byob-multi';
const CLS = 'byob-multi-selected';

interface MultiCopyData extends Blockly.ICopyData {
  paster: typeof MULTI_PASTER;
  items: { state: any; x: number; y: number }[];
}

// ------------------------------------------------------------------ copy "from here down"
let patched = false;
/** Blockly copies a single block by default; BYOBYaml copies the block and everything stacked below it. */
export function patchChainCopy() {
  if (patched) return;
  patched = true;
  const proto = Blockly.BlockSvg.prototype as any;
  const orig = proto.toCopyData;
  proto.toCopyData = function (addNextBlocks = true) {
    return orig.call(this, addNextBlocks);
  };
  Blockly.clipboard.registry.register(MULTI_PASTER, new MultiPaster() as any);
}

const stripIds = (j: any) => {
  if (!j || typeof j !== 'object') return;
  if (Array.isArray(j)) return j.forEach(stripIds);
  delete j.id;
  for (const [k, v] of Object.entries(j)) if (k !== 'fields') stripIds(v);
};

class MultiPaster {
  paste(data: MultiCopyData, ws: Blockly.WorkspaceSvg, coordinate?: Blockly.utils.Coordinate): Blockly.BlockSvg | null {
    if (!data.items.length) return null;
    const sel = selections.get(ws);
    const n = (pasteCount.get(data) ?? 0) + 1;
    pasteCount.set(data, n);
    const first = data.items[0];
    const dx = coordinate ? coordinate.x - first.x : 24 * n;
    const dy = coordinate ? coordinate.y - first.y : 24 * n;
    const pasted: Blockly.BlockSvg[] = [];
    Blockly.Events.setGroup(true);
    const group = Blockly.Events.getGroup();
    try {
      for (const it of data.items) {
        const state = structuredClone(it.state);
        state.x = it.x + dx;
        state.y = it.y + dy;
        pasted.push(Blockly.serialization.blocks.append(state, ws, { recordUndo: true }) as Blockly.BlockSvg);
      }
    } finally {
      Blockly.Events.setGroup(false);
    }
    // Blockly nudges new blocks away from neighbours a moment later – make that part of the same undo step
    const ids = new Set(pasted.flatMap((b) => b.getDescendants(false).map((x) => x.id)));
    const adopt = (e: Blockly.Events.Abstract) => {
      if (e.type === Blockly.Events.BLOCK_MOVE && !e.group && ids.has((e as Blockly.Events.BlockMove).blockId!)) e.group = group;
    };
    ws.addChangeListener(adopt);
    setTimeout(() => ws.removeChangeListener(adopt), 1500);
    sel?.set(pasted.flatMap((b) => b.getDescendants(false) as Blockly.BlockSvg[]));
    return pasted[0] ?? null;
  }
}
const pasteCount = new WeakMap<object, number>();

// ------------------------------------------------------------------ selection
const selections = new WeakMap<Blockly.WorkspaceSvg, Selection>();

export interface Selection {
  readonly blocks: Blockly.BlockSvg[];
  set(blocks: Blockly.BlockSvg[]): void;
  clear(): void;
  setMode(m: CanvasMode): void;
  dispose(): void;
}

/** blocks in the selection that are not inside / below another selected block */
function roots(set: Set<Blockly.BlockSvg>): Blockly.BlockSvg[] {
  return [...set].filter((b) => {
    for (let p = b.getParent(); p; p = p.getParent()) if (set.has(p as Blockly.BlockSvg)) return false;
    return true;
  });
}

export function enableSelection(ws: Blockly.WorkspaceSvg, host: HTMLElement, onChange: (count: number) => void, initialMode: CanvasMode): Selection {
  const set = new Set<Blockly.BlockSvg>();
  /** positions of selected blocks when the pointer went down on one of them */
  let downAt: Map<Blockly.BlockSvg, Blockly.utils.Coordinate> | null = null;
  let mode = initialMode;
  let spaceDown = false;
  const svg = ws.getParentSvg();
  // Blockly 13: selection follows focus – focusing the workspace itself clears it
  // (also gives the workspace keyboard focus, so Blockly's own shortcuts like Strg+V / Strg+Z keep working)
  const deselect = () => {
    Blockly.getFocusManager().focusTree(ws);
  };

  const paint = () => {
    for (const b of ws.getAllBlocks(false) as Blockly.BlockSvg[]) {
      const on = set.has(b);
      const root = b.getSvgRoot();
      if (on) Blockly.utils.dom.addClass(root, CLS);
      else Blockly.utils.dom.removeClass(root, CLS);
    }
    onChange(set.size);
  };
  const setBlocks = (list: Blockly.BlockSvg[]) => {
    set.clear();
    for (const b of list) if (!b.isDisposed() && !b.isInFlyout) set.add(b);
    if (set.size) deselect();
    paint();
  };
  const clear = () => {
    if (!set.size) return;
    set.clear();
    paint();
  };
  const blockOf = (el: EventTarget | null): Blockly.BlockSvg | null => {
    const g = (el as Element | null)?.closest?.('.blocklyDraggable[data-id]');
    const id = g?.getAttribute('data-id');
    const b = id ? (ws.getBlockById(id) as Blockly.BlockSvg | null) : null;
    return b && !b.isInFlyout ? b : null;
  };

  // ---------- frame selection ----------
  const frame = document.createElement('div');
  frame.className = 'byob-marquee';
  host.appendChild(frame);

  const onPointerDown = (e: PointerEvent) => {
    const target = e.target as Element;
    // Shift+click on a block: toggle it
    if (e.button === 0 && e.shiftKey) {
      const b = blockOf(target);
      if (b) {
        e.stopPropagation();
        e.preventDefault();
        if (set.has(b)) set.delete(b);
        else set.add(b);
        deselect();
        paint();
        return;
      }
    }
    // pointer on a block that is not selected → normal single selection
    const hit = blockOf(target);
    if (hit) {
      if (!set.has(hit)) clear();
      else downAt = new Map([...set].map((b) => [b, b.getRelativeToSurfaceXY()]));
      return;
    }
    const onBackground = target.classList?.contains('blocklyMainBackground');
    if (!onBackground) return;
    if (e.button !== 0 || e.pointerType !== 'mouse' || mode === 'pan' || spaceDown) {
      if (e.button === 0) clear();
      return;
    }
    // own the gesture: Blockly would start panning
    e.stopPropagation();
    e.preventDefault();
    ws.hideChaff();
    const box = host.getBoundingClientRect();
    const x0 = e.clientX;
    const y0 = e.clientY;
    const add = e.shiftKey;
    const before = add ? new Set(set) : new Set<Blockly.BlockSvg>();
    let moved = false;
    // no text selection on the page while drawing the frame
    const prevSelect = document.body.style.userSelect;
    document.body.style.userSelect = 'none';
    window.getSelection()?.removeAllRanges();
    const move = (ev: PointerEvent) => {
      const x1 = Math.min(x0, ev.clientX);
      const y1 = Math.min(y0, ev.clientY);
      const w = Math.abs(ev.clientX - x0);
      const h = Math.abs(ev.clientY - y0);
      if (w + h > 4) moved = true;
      if (!moved) return;
      Object.assign(frame.style, { display: 'block', left: `${x1 - box.left}px`, top: `${y1 - box.top}px`, width: `${w}px`, height: `${h}px` });
      const r = { left: x1, top: y1, right: x1 + w, bottom: y1 + h };
      const hits = new Set(before);
      for (const b of ws.getAllBlocks(false) as Blockly.BlockSvg[]) {
        const path = (b as any).pathObject?.svgPath as SVGElement | undefined;
        const br = (path ?? b.getSvgRoot()).getBoundingClientRect();
        if (br.right >= r.left && br.left <= r.right && br.bottom >= r.top && br.top <= r.bottom) hits.add(b);
      }
      set.clear();
      hits.forEach((b) => set.add(b));
      paint();
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      frame.style.display = 'none';
      document.body.style.userSelect = prevSelect;
      window.getSelection()?.removeAllRanges();
      if (!moved && !add) {
        clear();
        deselect();
      } else if (set.size) deselect();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  svg.addEventListener('pointerdown', onPointerDown, true);

  // ---------- keyboard (capture phase: before Blockly's own shortcuts) ----------
  const inEditor = () => {
    const a = document.activeElement;
    if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || (a as HTMLElement).isContentEditable)) return false;
    return host.isConnected && host.offsetParent !== null && !document.querySelector('.modal-bg, .mk-overlay');
  };
  const copyData = (): MultiCopyData | null => {
    const rs = roots(set);
    if (!rs.length) return null;
    const items = rs.map((b) => {
      const state = Blockly.serialization.blocks.save(b, { addCoordinates: false, addNextBlocks: true, saveIds: true }) as any;
      // keep only the selected part of the chain below a root
      let cur = state;
      while (cur?.next?.block) {
        const nb = ws.getBlockById(cur.next.block.id) as Blockly.BlockSvg | null;
        if (!nb || !set.has(nb)) {
          delete cur.next;
          break;
        }
        cur = cur.next.block;
      }
      stripIds(state);
      const xy = b.getRelativeToSurfaceXY();
      return { state, x: xy.x, y: xy.y };
    });
    return { paster: MULTI_PASTER, items };
  };
  const deleteSelection = () => {
    // deepest first, heal stacks so unselected blocks below stay attached
    const list = [...set].sort((a, b) => depth(b) - depth(a));
    Blockly.Events.setGroup(true);
    try {
      for (const b of list) if (!b.isDisposed() && b.isDeletable()) b.dispose(true, true);
    } finally {
      Blockly.Events.setGroup(false);
    }
    set.clear();
    paint();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === ' ' && !e.repeat && inEditor()) {
      spaceDown = true;
      svg.style.cursor = 'grab';
    }
    if (!inEditor()) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (set.size === 0) {
      // single block: cut = copy whole chain + delete whole chain (Blockly would only delete one block)
      if (mod && k === 'x') {
        const b = Blockly.getSelected();
        if (b instanceof Blockly.BlockSvg && !b.isInFlyout && b.isDeletable() && b.isMovable()) {
          e.preventDefault();
          e.stopImmediatePropagation();
          Blockly.clipboard.copy(b);
          Blockly.Events.setGroup(true);
          b.dispose(false, true);
          Blockly.Events.setGroup(false);
        }
      }
      return;
    }
    if (e.key === 'Escape') return clear();
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      e.stopImmediatePropagation();
      return deleteSelection();
    }
    if (mod && (k === 'c' || k === 'x' || k === 'd')) {
      e.preventDefault();
      e.stopImmediatePropagation();
      const data = copyData();
      if (!data) return;
      if (k === 'd') return void new MultiPaster().paste(data, ws);
      Blockly.clipboard.setLastCopiedData(data);
      Blockly.clipboard.setLastCopiedWorkspace(ws);
      if (k === 'x') deleteSelection();
    }
    if (mod && k === 'a') {
      e.preventDefault();
      e.stopImmediatePropagation();
      setBlocks(ws.getAllBlocks(false) as Blockly.BlockSvg[]);
    }
  };
  const onKeyUp = (e: KeyboardEvent) => {
    if (e.key === ' ') {
      spaceDown = false;
      svg.style.cursor = '';
    }
  };
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('keyup', onKeyUp, true);

  // ---------- move selected stacks together ----------
  let drag: { block: Blockly.BlockSvg; start: Blockly.utils.Coordinate; others: { b: Blockly.BlockSvg; xy: Blockly.utils.Coordinate }[]; raf: number } | null = null;
  const follow = () => {
    if (!drag) return;
    const cur = drag.block.getRelativeToSurfaceXY();
    const dx = cur.x - drag.start.x;
    const dy = cur.y - drag.start.y;
    for (const o of drag.others) o.b.translate(o.xy.x + dx, o.xy.y + dy);
    drag.raf = requestAnimationFrame(follow);
  };
  const listener = (e: Blockly.Events.Abstract) => {
    if (e.type === Blockly.Events.BLOCK_DRAG) {
      const ev = e as Blockly.Events.BlockDrag;
      const b = ws.getBlockById(ev.blockId!) as Blockly.BlockSvg | null;
      if (ev.isStart) {
        if (!b || !set.has(b)) {
          clear();
          return;
        }
        const at = (x: Blockly.BlockSvg) => downAt?.get(x) ?? x.getRelativeToSurfaceXY();
        const others = roots(set)
          .filter((x) => x !== b && !x.getParent() && x.isMovable())
          .map((x) => ({ b: x, xy: at(x) }));
        drag = { block: b, start: at(b), others, raf: 0 };
        downAt = null;
        if (others.length) drag.raf = requestAnimationFrame(follow);
      } else if (drag) {
        cancelAnimationFrame(drag.raf);
        const end = drag.block.getRelativeToSurfaceXY();
        const dx = end.x - drag.start.x;
        const dy = end.y - drag.start.y;
        const d = drag;
        drag = null;
        if (!d.others.length) return;
        Blockly.Events.setGroup(ev.group || true);
        try {
          for (const o of d.others) {
            o.b.translate(o.xy.x, o.xy.y);
            if (!o.b.isDisposed()) o.b.moveBy(dx, dy);
          }
        } finally {
          Blockly.Events.setGroup(false);
        }
        paint();
      }
    }
    if (e.type === Blockly.Events.BLOCK_DELETE && set.size) {
      for (const b of [...set]) if (b.isDisposed()) set.delete(b);
      paint();
    }
    if (e.type === Blockly.Events.SELECTED && set.size) {
      const id = (e as Blockly.Events.Selected).newElementId;
      if (id && !set.has(ws.getBlockById(id) as Blockly.BlockSvg)) clear();
    }
  };
  ws.addChangeListener(listener);

  const sel: Selection = {
    get blocks() {
      return [...set];
    },
    set: setBlocks,
    clear,
    setMode(m) {
      mode = m;
      host.dataset.canvasMode = m;
    },
    dispose() {
      svg.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKeyUp, true);
      ws.removeChangeListener(listener);
      frame.remove();
      selections.delete(ws);
    },
  };
  sel.setMode(mode);
  selections.set(ws, sel);
  return sel;
}

function depth(b: Blockly.Block) {
  let n = 0;
  for (let p = b.getParent(); p; p = p.getParent()) n++;
  return n;
}
