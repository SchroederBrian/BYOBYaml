import { ReactNode, useEffect, useRef, useState } from 'react';
import { ProjectMeta } from '../project';
import { Icon } from './Icons';

export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={onClose}>
      <div className={`modal ${wide ? 'wide' : ''}`} onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="modal-head">
          <span>{title}</span>
          <button className="icon-btn" onClick={onClose} title="Schließen">
            <Icon name="x" />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function PromptDialog({ title, label, initial, confirm, onDone }: { title: string; label: string; initial: string; confirm: string; onDone: (v: string | null) => void }) {
  const [v, setV] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.select(), []);
  return (
    <Modal
      title={title}
      onClose={() => onDone(null)}
      footer={
        <>
          <button className="btn ghost" onClick={() => onDone(null)}>
            Abbrechen
          </button>
          <button className="btn primary" disabled={!v.trim()} onClick={() => onDone(v.trim())}>
            {confirm}
          </button>
        </>
      }
    >
      <label className="field">
        <span>{label}</span>
        <input ref={ref} className="input" value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && v.trim() && onDone(v.trim())} />
      </label>
    </Modal>
  );
}

export function PasteDialog({ onDone, format = 'yaml' }: { onDone: (r: { name: string; text: string } | null) => void; format?: 'yaml' | 'dockerfile' }) {
  const [name, setName] = useState(format === 'dockerfile' ? 'Dockerfile' : 'import.yaml');
  const [text, setText] = useState('');
  return (
    <Modal
      wide
      title={format === 'dockerfile' ? 'Dockerfile einfügen' : 'YAML einfügen'}
      onClose={() => onDone(null)}
      footer={
        <>
          <span className="foot-hint">{format === 'dockerfile' ? 'Nicht unterstützte Anweisungen werden gemeldet; es wird nichts stillschweigend entfernt.' : 'Mehrere Dokumente mit --- trennen. Compose und Kubernetes werden erkannt.'}</span>
          <button className="btn ghost" onClick={() => onDone(null)}>
            Abbrechen
          </button>
          <button className="btn primary" disabled={!text.trim()} onClick={() => onDone({ name, text })}>
            In Blöcke umwandeln
          </button>
        </>
      }
    >
      <label className="field">
        <span>Dateiname</span>
        <input className="input mono" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <textarea
        className="textarea mono"
        autoFocus
        spellCheck={false}
        aria-label={format === 'dockerfile' ? 'Dockerfile-Inhalt' : 'YAML-Inhalt'}
        placeholder={format === 'dockerfile' ? 'FROM alpine:3\nWORKDIR /app\nCOPY . /app/\nCMD ["sh"]' : 'apiVersion: apps/v1\nkind: Deployment\n…\n\noder Ausgabe von: oc get deploy,svc,route -o yaml'}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
    </Modal>
  );
}

export interface ReportEntry {
  name: string;
  ok: boolean;
  lines: string[];
}

export function ReportDialog({ entries, onClose }: { entries: ReportEntry[]; onClose: () => void }) {
  return (
    <Modal
      title="Import-Bericht"
      onClose={onClose}
      footer={
        <button className="btn primary" onClick={onClose}>
          OK
        </button>
      }
    >
      <ul className="report">
        {entries.map((e, i) => (
          <li key={i} className={e.ok ? 'ok' : 'err'}>
            <div className="report-name">
              <Icon name={e.ok ? 'check' : 'alert'} size={14} /> {e.name}
            </div>
            {e.lines.map((l, j) => (
              <div key={j} className="report-line">
                {l}
              </div>
            ))}
          </li>
        ))}
      </ul>
    </Modal>
  );
}

export function ProjectsDialog({
  projects,
  currentId,
  dbFile,
  onOpen,
  onNew,
  onExample,
  onDuplicate,
  onDelete,
  onClose,
}: {
  projects: ProjectMeta[];
  currentId: string;
  dbFile: string;
  onOpen: (id: string) => void;
  onNew: () => void;
  onExample: (which: 'openshift' | 'compose') => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const list = projects.filter((p) => p.title.toLowerCase().includes(q.toLowerCase()));
  const fmt = (t: number) => new Date(t).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
  return (
    <Modal
      wide
      title="Projekte"
      onClose={onClose}
      footer={
        <>
          <span className="foot-hint" title={dbFile}>
            <Icon name="db" size={13} /> {dbFile}
          </span>
          <button className="btn ghost" onClick={() => onExample('compose')}>
            Beispiel: Compose
          </button>
          <button className="btn ghost" onClick={() => onExample('openshift')}>
            Beispiel: OpenShift
          </button>
          <button className="btn primary" onClick={onNew}>
            <Icon name="plus" size={14} /> Neues Projekt
          </button>
        </>
      }
    >
      <div className="search">
        <Icon name="search" size={14} />
        <input autoFocus placeholder="Projekte durchsuchen" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <table className="proj-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Dateien</th>
            <th>Geändert</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {list.map((p) => (
            <tr key={p.id} className={p.id === currentId ? 'current' : ''} onDoubleClick={() => onOpen(p.id)}>
              <td>
                <button className="link" onClick={() => onOpen(p.id)}>
                  {p.title}
                </button>
                {p.id === currentId && <span className="tag">geöffnet</span>}
              </td>
              <td className="num">{p.fileCount}</td>
              <td className="muted">{fmt(p.updatedAt)}</td>
              <td className="row-actions">
                <button className="icon-btn" title="Duplizieren" onClick={() => onDuplicate(p.id)}>
                  <Icon name="dup" size={14} />
                </button>
                <button className="icon-btn danger" title="Löschen" disabled={p.id === currentId} onClick={() => onDelete(p.id)}>
                  <Icon name="trash" size={14} />
                </button>
              </td>
            </tr>
          ))}
          {list.length === 0 && (
            <tr>
              <td colSpan={4} className="muted center">
                Keine Projekte gefunden.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </Modal>
  );
}

export function HelpDialog({ onClose }: { onClose: () => void }) {
  const rows: [string, string][] = [
    ['Startblock', 'Jede Ressource beginnt mit einem Startblock (abgerundete Kappe). Mehrere Startblöcke in einer Datei werden mit --- getrennt.'],
    ['Verschachteln', 'Blöcke rasten unter dem Startblock ein. Container- und Service-Blöcke nehmen weitere Blöcke auf.'],
    ['Auswählen', 'Ziehen auf der leeren Fläche zieht einen Rahmen auf (Shift = dazu). Ausgewählte Stapel gemeinsam ziehen, Entf löscht, Strg+C/V kopiert. Leertaste + Ziehen verschiebt die Ansicht. Umschalten oben: Auswählen / Verschieben.'],
    ['Dateien & Ordner', 'Ordner-Symbol mit Plus legt einen Ordner an, Dateien per Drag & Drop verschieben. Strg/Shift + Klick wählt mehrere Dateien – dann verschieben, duplizieren, exportieren oder löschen.'],
    ['Variablen', '${NAME} funktioniert in jedem Feld, auch in Zahlenfeldern. Im Tab Variablen gelten „Für alle Dateien“ global und „Nur diese Datei“ lokal. Lokale Werte ersetzen gleichnamige globale Werte – auch wenn sie leer sind. Beide Bereiche verwenden die aktive Umgebung (dev/prod …).'],
    ['Extras', 'Feld, Liste und YAML-Einmischen setzen jedes beliebige Feld, auch wenn es keinen eigenen Block dafür gibt.'],
    ['Import', 'YAML-Dateien, eingefügtes YAML oder die Ausgabe von oc/kubectl get -o yaml. Cluster-Felder (status, uid, managedFields …) werden entfernt.'],
    ['Vorlagen', 'Unter Vorlagen gibt es fertige Block-Kombinationen. Eigene speicherst du per Rechtsklick → „Ab hier als Vorlage speichern…“.'],
    ['Marktplatz', 'Titelleiste → Marktplatz: Block-Kombinationen, Dateien und Projekte anderer kostenlos ansehen und übernehmen. Eigene teilen: Rechtsklick auf einen Block → „Ab hier im Marktplatz teilen…“ oder Datei → Im Marktplatz veröffentlichen.'],
    ['Speichern', 'Automatisch in SQLite unter %APPDATA%\\BYOBYaml. .byob-Dateien dienen zum Austausch und als Backup.'],
    ['Tastatur', 'Strg+S speichert sofort · Strg+Z / Strg+Y für Rückgängig / Wiederholen · Entf löscht den gewählten Block · Strg+C / Strg+V kopiert einen Block mit allen Blöcken darunter.'],
  ];
  return (
    <Modal title="Kurzreferenz" onClose={onClose} wide>
      <dl className="help-list">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </Modal>
  );
}
