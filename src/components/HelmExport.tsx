import { useEffect, useMemo, useState } from 'react';
import { newSession } from '../blocks/value';
import { buildHelmChart, downloadHelmChart, helmChartName, type HelmChart } from '../helm';
import type { Project } from '../project';
import { Modal } from './Dialogs';
import { Icon } from './Icons';
import DependencyGraph from './DependencyGraph';
import '../styles/helm.css';

export default function HelmExport({ project, activeFileId, onClose, onOpen, flash }: { project: Project; activeFileId: string; onClose: () => void; onOpen: (id: string) => void; flash: (message: string) => void }) {
  const eligible = project.files.filter((file) => file.kind === 'k8s');
  const [name, setName] = useState(() => helmChartName(project.title));
  const [version, setVersion] = useState('0.1.0');
  const [description, setDescription] = useState(`Kubernetes-/OpenShift-Ressourcen aus ${project.title}`);
  const [selected, setSelected] = useState(() => eligible.map((file) => file.id));
  const [tab, setTab] = useState<'files' | 'preview' | 'graph'>('files');
  const [chart, setChart] = useState<HelmChart | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');
  const [previewPath, setPreviewPath] = useState('Chart.yaml');
  const source = useMemo(() => ({ ...project, files: project.files }), [project]);
  // one export = one seed: value blocks keep their values while this dialog is open
  const session = useMemo(() => newSession({ envName: project.activeEnv, projectName: project.title }), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setLoading(true); setError('');
    const timer = window.setTimeout(() => {
      try { setChart(buildHelmChart(source, { name, version, description, fileIds: selected, session })); }
      catch { setChart(null); setError('Chart konnte nicht erstellt werden. Bitte die ausgewählten Dateien und Block-Probleme prüfen.'); }
      setLoading(false);
    }, 200);
    return () => window.clearTimeout(timer);
  }, [source, name, version, description, selected]);
  const currentFile = chart?.files.find((file) => file.path === previewPath) ?? chart?.files[0];
  const download = async () => {
    if (!chart || loading || chart.errors.length) return;
    setDownloading(true); setError('');
    try { await downloadHelmChart(chart); flash(`Helm-Chart exportiert: ${chart.name}-${chart.version}.tgz`); }
    catch (e) { setError(e instanceof Error ? e.message : 'Helm-Chart konnte nicht heruntergeladen werden.'); }
    finally { setDownloading(false); }
  };
  return (
    <Modal wide title="Helm-Chart exportieren" onClose={onClose} footer={<><span className="foot-hint">{loading ? 'Chart wird aktualisiert …' : chart ? `${chart.resourceCount} Ressourcen · ${chart.bindings.length} Variablen · ${chart.files.length} Dateien` : 'Kein Chart verfügbar'}</span><button className="btn ghost" onClick={onClose}>Schließen</button><button className="btn primary" disabled={loading || downloading || !chart || !!chart.errors.length} onClick={() => void download()}><Icon name="download" size={14} /> {downloading ? 'Packt …' : '.tgz herunterladen'}</button></>}>
      <div className="helm-export">
        <p className="helm-intro">Aus vorhandenen Kubernetes-/OpenShift-Blöcken ein Helm-Chart erstellen. Variablen werden zu Values; globale und lokale Gültigkeit bleiben erhalten. Compose-Dateien werden nicht konvertiert.</p>
        <div className="helm-metadata"><label>Chart-Name<input className="input mono" value={name} onChange={(event) => setName(event.target.value)} autoComplete="off" spellCheck={false} /></label><label>Chart-Version<input className="input mono" value={version} onChange={(event) => setVersion(event.target.value)} autoComplete="off" spellCheck={false} /></label><label className="helm-description">Beschreibung<input className="input" value={description} onChange={(event) => setDescription(event.target.value)} /></label></div>
        <div className="helm-tabs" role="tablist" aria-label="Helm-Export-Ansicht">{([['files', 'Dateien & Hinweise'], ['preview', 'Dateivorschau'], ['graph', 'Helm-Graph']] as const).map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} className={`tab ${tab === id ? 'on' : ''}`} onClick={() => setTab(id)}>{id === 'graph' && <Icon name="graph" size={14} />}{label}</button>)}</div>
        {error && <p className="helm-error" role="alert">{error}</p>}
        {tab === 'files' && <div className="helm-file-panel">
          <div className="helm-file-head"><h3>Quelldateien</h3><button className="btn ghost sm" onClick={() => setSelected(eligible.map((file) => file.id))}>Alle auswählen</button><button className="btn ghost sm" onClick={() => setSelected(activeFileId && eligible.some((file) => file.id === activeFileId) ? [activeFileId] : [])}>Nur aktuelle Datei</button></div>
          {!eligible.length ? <p className="muted-box">Dieses Projekt enthält noch keine Kubernetes-/OpenShift-Dateien. Lege eine Ressource an oder importiere Kubernetes-YAML.</p> : <ul className="helm-source-list">{eligible.map((file) => <li key={file.id}><label><input type="checkbox" checked={selected.includes(file.id)} onChange={(event) => setSelected((ids) => event.target.checked ? [...ids, file.id] : ids.filter((id) => id !== file.id))} /><span>{file.folder ? `${file.folder}/` : ''}{file.name}</span></label></li>)}</ul>}
          {!!chart?.errors.length && <div className="helm-problems" role="alert"><h3>Vor dem Export beheben</h3><ul>{chart.errors.map((message) => <li key={message}>{message}</li>)}</ul></div>}
          {!!chart?.warnings.length && <div className="helm-warnings"><h3>Hinweise</h3><ul>{chart.warnings.map((message) => <li key={message}>{message}</li>)}</ul></div>}
          <p className="helm-intro">Das Archiv enthält <code>Chart.yaml</code>, <code>values.yaml</code>, Values-Dateien je Umgebung, <code>values.schema.json</code>, Ressourcen-Templates und eine Anleitung. Statische CRDs kommen nach <code>crds/</code>.</p>
          <p className="helm-intro">Tresor-Secrets und Verschlüsselungsschlüssel werden nicht exportiert. Fehlende Variablen sind erforderliche externe Werte. Normale Variablen und direkt eingetragene Werte bleiben im Archiv Klartext.</p>
        </div>}
        {tab === 'preview' && chart && <div className="helm-preview"><label>Chart-Datei<select className="input mono" aria-label="Chart-Datei" value={currentFile?.path ?? ''} onChange={(event) => setPreviewPath(event.target.value)}>{chart.files.map((file) => <option key={file.path} value={file.path}>{file.path}</option>)}</select></label><pre aria-label="Chart-Dateivorschau">{currentFile?.content}</pre></div>}
        {tab === 'graph' && chart && <div className="helm-graph"><DependencyGraph variant="helm" graphInput={chart.graph} project={project} activeFileId={activeFileId} onOpen={(id) => { onClose(); onOpen(id); }} /></div>}
      </div>
    </Modal>
  );
}
