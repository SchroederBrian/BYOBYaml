// Read-only Blockly view of marketplace content.
import { useEffect, useRef } from 'react';
import * as Blockly from 'blockly/core';
import * as De from 'blockly/msg/de';
import { buildTheme, registerBlocks } from '../blocks/register';
import { loadState } from '../blocks/value';

export default function BlockPreview({ state, height = 320 }: { state: any; height?: number | string }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    registerBlocks();
    Blockly.setLocale(De as any);
    const ws = Blockly.inject(host.current!, {
      readOnly: true,
      renderer: 'thrasos',
      theme: buildTheme(),
      sounds: false,
      zoom: { controls: true, wheel: true, startScale: 0.8, maxScale: 1.6, minScale: 0.3, scaleSpeed: 1.12 },
      move: { scrollbars: true, drag: true, wheel: false },
    });
    try {
      Blockly.Events.disable();
      loadState(state, ws);
      ws.cleanUp();
    } catch (e) {
      console.warn('preview failed', e);
    } finally {
      Blockly.Events.enable();
    }
    // readable scale, content starts top-left (big files: drag / scroll to explore)
    const fit = () => {
      Blockly.svgResize(ws);
      const box = host.current?.getBoundingClientRect();
      const first = ws.getTopBlocks(true)[0];
      if (!box || !first) return;
      ws.setScale(box.width < 500 ? 0.65 : 0.8);
      const r = first.getSvgRoot().getBoundingClientRect();
      ws.scroll(ws.scrollX + box.left + 24 - r.left, ws.scrollY + box.top + 20 - r.top);
    };
    requestAnimationFrame(fit);
    const ro = new ResizeObserver(() => Blockly.svgResize(ws));
    ro.observe(host.current!);
    return () => {
      ro.disconnect();
      ws.dispose();
    };
  }, [state]);
  return <div className="mk-preview-blocks" ref={host} style={{ height }} />;
}
