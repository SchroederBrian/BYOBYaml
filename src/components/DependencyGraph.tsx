import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import { buildDependencyGraph, type DependencyGraph as Graph, type DependencyNode } from '../dependencies';
import { resolveVariables, type Project } from '../project';
import { yamlForFile } from '../projectYaml';
import { Icon } from './Icons';
import '../styles/dependencies.css';

const EMPTY: Graph = { nodes: [], edges: [], issues: [] };
const WIDTH = 240, HEIGHT = 80, STEP_X = 330, STEP_Y = 112, PAD = 30;
const compare = (a: DependencyNode, b: DependencyNode) => `${a.filePath ?? ''}/${a.namespace ?? ''}/${a.kind}/${a.name}`.localeCompare(`${b.filePath ?? ''}/${b.namespace ?? ''}/${b.kind}/${b.name}`, 'de', { numeric: true });

export default function DependencyGraph({ project, activeFileId, onOpen, graphInput, variant = 'project' }: { project: Project; activeFileId: string; onOpen: (fileId: string) => void; graphInput?: Graph; variant?: 'project' | 'helm' }) {
  const [graph, setGraph] = useState<Graph>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState('project');
  const [showFiles, setShowFiles] = useState(true);
  const [showExternal, setShowExternal] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(0.85);
  const viewport = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const marker = useId().replace(/:/g, '');

  useEffect(() => {
    if (graphInput) { setGraph(graphInput); setLoading(false); return; }
    setLoading(true);
    const timer = window.setTimeout(() => {
      // Deliberately resolve ordinary variables only. The graph never accesses a vault.
      setGraph(buildDependencyGraph(project.files, (file) => yamlForFile(file, resolveVariables(project, file))));
      setLoading(false);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [project.files, project.variables, project.activeEnv, graphInput]);

  const selected = graph.nodes.find((node) => node.id === selectedId);
  const relations = useMemo(() => selected ? graph.edges.filter((edge) => edge.type !== 'contains' && (edge.source === selected.id || edge.target === selected.id)) : [], [graph, selected]);
  const neighbours = new Set(selected ? [selected.id, ...graph.edges.filter((edge) => edge.source === selected.id || edge.target === selected.id).flatMap((edge) => [edge.source, edge.target])] : []);
  const view = useMemo(() => {
    const allowed = new Set(graph.nodes.filter((node) => {
      if (!showFiles && node.category === 'file') return false;
      if (!showExternal && node.external) return false;
      return true;
    }).map((node) => node.id));
    let seeds = graph.nodes.filter((node) => allowed.has(node.id));
    if (scope === 'file') seeds = seeds.filter((node) => node.fileId === activeFileId);
    const term = query.trim().toLocaleLowerCase('de');
    if (term) seeds = seeds.filter((node) => `${node.name} ${node.kind} ${node.filePath ?? ''} ${node.namespace ?? ''}`.toLocaleLowerCase('de').includes(term));
    let ids = new Set(seeds.map((node) => node.id));
    if (scope === 'file' || term) {
      // Retain immediate neighbours so filtered results keep their relationship context.
      for (const edge of graph.edges) if (edge.type !== 'contains' && (ids.has(edge.source) || ids.has(edge.target))) {
        if (allowed.has(edge.source) && seeds.some((node) => node.id === edge.target) || allowed.has(edge.target) && seeds.some((node) => node.id === edge.source)) {
          if (allowed.has(edge.source)) ids.add(edge.source);
          if (allowed.has(edge.target)) ids.add(edge.target);
        }
      }
    }
    const matching = graph.nodes.filter((node) => ids.has(node.id)).sort(compare);
    const visible = matching.slice(0, 350);
    ids = new Set(visible.map((node) => node.id));
    const columnTitles = variant === 'helm' ? ['Chart', 'Values & Variablen', 'Templates / CRDs', 'Ressourcen', 'Extern / erforderlich'] : ['Dateien', 'Services & Workloads', 'Ressourcen', 'Extern / nicht aufgelöst'];
    const columns: DependencyNode[][] = columnTitles.map(() => []);
    for (const node of visible) {
      const column = variant === 'helm' ? node.external ? 4 : node.category === 'chart' ? 0 : node.category === 'value' ? 1 : node.category === 'file' ? 2 : 3 : node.external ? 3 : node.category === 'file' ? 0 : node.category === 'service' || node.category === 'workload' ? 1 : 2;
      columns[column].push(node);
    }
    const used = columns.map((nodes, index) => ({ nodes, index })).filter((column) => column.nodes.length);
    const placed = used.flatMap((column, index) => column.nodes.map((node, row) => ({ ...node, x: PAD + index * STEP_X, y: PAD + 28 + row * STEP_Y })));
    return {
      nodes: placed,
      columns: used.map((column, index) => ({ x: PAD + index * STEP_X, title: columnTitles[column.index] })),
      edges: graph.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)),
      total: matching.length,
      width: Math.max(360, PAD * 2 + (used.length - 1) * STEP_X + WIDTH),
      height: Math.max(280, PAD * 2 + 28 + Math.max(0, ...used.map((column) => column.nodes.length)) * STEP_Y),
    };
  }, [graph, query, scope, showFiles, showExternal, activeFileId, variant]);
  const placed = new Map(view.nodes.map((node) => [node.id, node]));
  const externalCount = graph.nodes.filter((node) => node.external).length;
  const cycleCount = graph.nodes.filter((node) => node.cycle).length;
  const fit = () => {
    if (!viewport.current) return;
    setZoom(Math.max(0.25, Math.min(1.25, (viewport.current.clientWidth - 24) / view.width, (viewport.current.clientHeight - 24) / view.height)));
    viewport.current.scrollTo({ left: 0, top: 0 });
  };
  const startPan = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'mouse' || event.button !== 0 || (event.target as Element).closest('button')) return;
    const element = viewport.current!;
    drag.current = { x: event.clientX, y: event.clientY, left: element.scrollLeft, top: element.scrollTop };
    element.setPointerCapture(event.pointerId);
  };

  return (
    <section className="dependency-graph" aria-label={variant === 'helm' ? 'Helm-Graph' : 'Abhängigkeitsgraph'} aria-busy={loading}>
      <div className="dep-toolbar">
        <label className="dep-search"><Icon name="search" size={14} /><input className="input" aria-label="Graph durchsuchen" placeholder="Name, Typ oder Datei suchen" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <select className="input dep-scope" aria-label="Graph-Bereich" value={scope} onChange={(event) => setScope(event.target.value)}><option value="project">{variant === 'helm' ? 'Ganzes Chart' : 'Ganzes Projekt'}</option><option value="file">Aktuelle Datei + Verweise</option></select>
        <label className="dep-toggle"><input type="checkbox" checked={showFiles} onChange={(event) => setShowFiles(event.target.checked)} /> Dateien</label>
        <label className="dep-toggle"><input type="checkbox" checked={showExternal} onChange={(event) => setShowExternal(event.target.checked)} /> Externe</label>
        <div className="dep-zoom"><button className="icon-btn" aria-label="Graph verkleinern" disabled={zoom <= 0.25} onClick={() => setZoom((value) => Math.max(0.25, value - 0.15))}><Icon name="minus" size={14} /></button><span aria-live="polite">{Math.round(zoom * 100)} %</span><button className="icon-btn" aria-label="Graph vergrößern" disabled={zoom >= 1.75} onClick={() => setZoom((value) => Math.min(1.75, value + 0.15))}><Icon name="plus" size={14} /></button><button className="btn ghost sm" onClick={fit}><Icon name="fit" size={13} /> Einpassen</button></div>
      </div>
      <div className="dep-status" role="status">
        {loading ? 'Graph wird aktualisiert …' : `${graph.nodes.length} Knoten · ${graph.edges.filter((edge) => edge.type !== 'contains').length} Verknüpfungen · Umgebung ${project.activeEnv}`}
        {externalCount > 0 && <span>{externalCount} extern / nicht aufgelöst</span>}
        {cycleCount > 0 && <span className="dep-cycle-text">Zyklische Abhängigkeit: {cycleCount} Knoten</span>}
      </div>
      {graph.issues.length > 0 && <details className="dep-issues"><summary>{graph.issues.length} {graph.issues.length === 1 ? 'Hinweis' : 'Hinweise'} zur Auswertung</summary><ul>{graph.issues.map((issue, index) => <li key={index}><button onClick={() => onOpen(issue.fileId)}>{project.files.find((file) => file.id === issue.fileId)?.name}</button>: {issue.message}</li>)}</ul></details>}
      <div className="dep-viewport" ref={viewport} tabIndex={0} aria-label="Graphfläche – scrollen oder mit der Maus auf freier Fläche ziehen" onPointerDown={startPan} onPointerMove={(event) => {
        if (!drag.current || !viewport.current) return;
        viewport.current.scrollLeft = drag.current.left - (event.clientX - drag.current.x);
        viewport.current.scrollTop = drag.current.top - (event.clientY - drag.current.y);
      }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
        {!loading && !view.nodes.length ? <div className="dep-empty"><Icon name="graph" size={26} /><p>{query || scope === 'file' ? 'Keine passenden Knoten.' : 'Noch keine Services oder Ressourcen vorhanden.'}</p><span>{query ? 'Suche ändern oder den Bereich erweitern.' : 'Füge Blöcke oder YAML-Dateien hinzu; der Graph aktualisiert sich automatisch.'}</span></div> : (
          <div className="dep-size" style={{ width: view.width * zoom, height: view.height * zoom }}>
            <div className="dep-board" style={{ width: view.width, height: view.height, transform: `scale(${zoom})` }}>
              {view.columns.map((column) => <span key={column.title} className="dep-column-label" style={{ left: column.x }}>{column.title}</span>)}
              <svg className="dep-lines" width={view.width} height={view.height} aria-hidden="true">
                <defs><marker id={marker} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" /></marker></defs>
                {view.edges.map((edge) => {
                  const source = placed.get(edge.source)!, target = placed.get(edge.target)!;
                  const same = source.x === target.x;
                  const direction = source.x < target.x ? 1 : -1;
                  const sx = same ? source.x + WIDTH : source.x + (direction > 0 ? WIDTH : 0), sy = source.y + HEIGHT / 2;
                  const tx = same ? target.x + WIDTH : target.x + (direction > 0 ? 0 : WIDTH), ty = target.y + HEIGHT / 2;
                  const offset = same ? Math.min(80, 46 + Math.abs(ty - sy) * 0.12) : Math.max(48, Math.abs(tx - sx) / 2);
                  // Route links that skip a column above the nodes. Otherwise a
                  // workload-to-external link can cut through a resource label.
                  const long = Math.abs(source.x - target.x) > STEP_X * 1.5;
                  const exit = sx + direction * 38, entry = tx - direction * 38, corridor = PAD + 17;
                  const path = source.id === target.id ? `M ${sx} ${sy - 12} C ${sx + 85} ${sy - 70}, ${sx + 85} ${sy + 70}, ${sx} ${sy + 12}` : long
                    ? `M ${sx} ${sy} C ${exit} ${sy}, ${exit} ${corridor}, ${exit + direction * 12} ${corridor} L ${entry - direction * 12} ${corridor} C ${entry} ${corridor}, ${entry} ${ty}, ${tx} ${ty}`
                    : `M ${sx} ${sy} C ${sx + (same ? offset : direction * offset)} ${sy}, ${tx + (same ? offset : -direction * offset)} ${ty}, ${tx} ${ty}`;
                  const focused = selectedId === edge.source || selectedId === edge.target;
                  return <path key={edge.id} d={path} markerEnd={`url(#${marker})`} className={`dep-edge ${edge.type} ${edge.cycle ? 'cycle' : ''} ${focused ? 'focused' : ''} ${selectedId && !focused ? 'dim' : ''}`}><title>{`${source.name} → ${target.name}: ${edge.label}`}</title></path>;
                })}
              </svg>
              {view.nodes.map((node) => <button key={node.id} className={`dep-node ${node.category} ${node.external ? 'external' : ''} ${node.cycle ? 'cycle' : ''} ${selectedId === node.id ? 'selected' : ''} ${selectedId && !neighbours.has(node.id) ? 'dim' : ''}`} style={{ left: node.x, top: node.y, width: WIDTH, height: HEIGHT }} aria-pressed={selectedId === node.id} aria-label={`${node.kind}: ${node.name}${node.namespace ? `, Namespace ${node.namespace}` : ''}${node.external ? ', extern oder nicht aufgelöst' : ''}`} onClick={() => setSelectedId(node.id)} onDoubleClick={() => node.fileId && onOpen(node.fileId)}>
                <span className="dep-node-kind"><Icon name={node.category === 'file' ? 'file' : node.category === 'service' ? 'whale' : node.category === 'workload' ? 'helm' : 'box'} size={13} />{node.kind}{node.cycle && <Icon name="alert" size={13} />}</span>
                <strong title={node.name}>{node.name}</strong><span className="dep-node-location" title={node.filePath}>{node.external ? 'Extern / nicht aufgelöst' : node.namespace ? `Namespace: ${node.namespace}` : node.category === 'file' ? 'Projektdatei' : node.filePath}</span>
              </button>)}
            </div>
          </div>
        )}
      </div>
      {view.total > 350 && <div className="dep-status">350 von {view.total} Knoten angezeigt. Mit Suche oder Dateibereich eingrenzen.</div>}
      {selected ? <div className="dep-detail">
        <div className="dep-detail-head"><div><strong>{selected.name}</strong><span>{selected.kind}{selected.namespace ? ` · ${selected.namespace}` : ''}{selected.filePath ? ` · ${selected.filePath}` : ''}</span></div>{selected.fileId && <button className="btn sm" onClick={() => onOpen(selected.fileId!)}><Icon name="file" size={13} /> Datei öffnen</button>}<button className="icon-btn" title="Auswahl aufheben" onClick={() => setSelectedId(null)}><Icon name="x" size={14} /></button></div>
        {selected.external && <p className="dep-explanation">Extern oder nicht im Projekt auflösbar. Das Ziel kann außerhalb dieses Projekts existieren; dies ist keine Cluster-Prüfung.</p>}
        {selected.cycle && <p className="dep-cycle-text">Dieser Knoten ist Teil eines Start- oder Vererbungszyklus.</p>}
        <ul className="dep-relations">{relations.length ? relations.map((edge) => {
          const outgoing = edge.source === selected.id;
          const other = graph.nodes.find((node) => node.id === (outgoing ? edge.target : edge.source))!;
          return <li key={edge.id}><span>{outgoing ? '→' : '←'} {edge.label}</span><button onClick={() => setSelectedId(other.id)}>{other.kind}: {other.name}</button></li>;
        }) : <li className="dep-explanation">Keine direkten Verweise. Gestrichelte Linien zeigen die Zugehörigkeit zur Datei.</li>}</ul>
      </div> : <p className="dep-help">Pfeil: Quelle verweist auf Ziel. Gestrichelt: Datei enthält Element. Knoten auswählen für Verweise und Quelldatei; Doppelklick öffnet die Datei.</p>}
    </section>
  );
}
