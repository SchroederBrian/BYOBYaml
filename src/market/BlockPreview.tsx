// Read-only Blockly view of marketplace content.
import { useEffect, useRef } from 'react';
import * as Blockly from 'blockly/core';
import * as De from 'blockly/msg/de';
import { buildTheme, registerBlocks } from '../blocks/register';

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
      Blockly.serialization.workspaces.load(state, ws);
      ws.cleanUp();
    } catch (e) {
      console.warn('preview failed', e);
    } finally {
      Blockly.Events.enable();
    }
    const fit = () => {
      Blockly.svgResize(ws);
      const m = ws.getBlocksBoundingBox();
      const box = host.current?.getBoundingClientRect();
      // small content: keep a readable scale instead of blowing it up
      if (box && m.right - m.left < box.width * 0.9 && m.bottom - m.top < box.height * 0.9) {
        ws.setScale(0.8);
        ws.scroll(20 - m.left * 0.8, 20 - m.top * 0.8);
      } else ws.zoomToFit();
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
