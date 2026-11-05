import { useState } from 'react';
import { GenWarning } from '../blocks/generator';
import { Project, ProjectFile, Snippet, Variable } from '../project';
import { Icon } from './Icons';
import SecretVault from './SecretVault';
import type { VaultController } from '../useSecretVault';

// ---------------- Variables ----------------
export function VariablesPanel({ project, activeFile, onChange, flash, vault }: { project: Project; activeFile?: ProjectFile; onChange: (p: Partial<Project>) => void; flash: (m: string) => void; vault: VaultController }) {
  const [newEnv, setNewEnv] = useState('');
  const { variables, envs } = project;
  const setGlobals = (variables: Variable[]) => onChange({ variables });
  const setLocals = (variables: Variable[]) => {
    if (activeFile) onChange({ files: project.files.map((f) => f.id === activeFile.id ? { ...f, variables } : f) });
  };
  const addEnv = () => {
    const e = newEnv.trim();
    if (!e || envs.includes(e)) return;
    onChange({ envs: [...envs, e] });
    setNewEnv('');
  };
  const removeEnv = (e: string) => {
    if (envs.length <= 1) return flash('Mindestens eine Umgebung muss bleiben.');
    if (!window.confirm(`Umgebung "${e}" und ihre Werte entfernen?`)) return;
    const rest = envs.filter((x) => x !== e);
    const removeValues = (vars: Variable[]) => vars.map((v) => ({ ...v, values: Object.fromEntries(Object.entries(v.values).filter(([k]) => k !== e)) }));
    onChange({
      envs: rest,
      activeEnv: project.activeEnv === e ? rest[0] : project.activeEnv,
      variables: removeValues(variables),
      files: project.files.map((f) => f.variables ? { ...f, variables: removeValues(f.variables) } : f),
    });
  };

  return (
    <div className="panel-scroll">
      <div className="panel-intro">
        Schreib <code>{'${NAME}'}</code> in ein beliebiges Blockfeld. Der Wert kommt aus der aktiven Umgebung oben rechts.
        Globale Variablen gelten für alle Dateien. Lokale Variablen gelten nur für die ausgewählte Datei und ersetzen dort gleichnamige globale Werte.
      </div>

      <div className="section-head">Umgebungen</div>
      <div className="env-row">
        {envs.map((e) => (
          <span key={e} className={`chip ${e === project.activeEnv ? 'on' : ''}`}>
            <button className="chip-label" onClick={() => onChange({ activeEnv: e })}>{e}</button>
            <button className="chip-x" title={`${e} entfernen`} onClick={() => removeEnv(e)}><Icon name="x" size={11} /></button>
          </span>
        ))}
        <input className="input sm" placeholder="neue Umgebung" value={newEnv} onChange={(e) => setNewEnv(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addEnv()} />
      </div>

      <VariableTable label="Für alle Dateien" variables={variables} envs={envs} activeEnv={project.activeEnv} onChange={setGlobals} flash={flash} />
      {activeFile && (
        <>
          <div className="panel-intro" style={{ marginTop: 20, overflowWrap: 'anywhere' }}>
            Ausgewählte Datei: <code>{activeFile.folder ? `${activeFile.folder}/${activeFile.name}` : activeFile.name}</code>
          </div>
          <VariableTable label="Nur diese Datei" variables={activeFile.variables ?? []} envs={envs} activeEnv={project.activeEnv} onChange={setLocals} flash={flash} />
        </>
      )}
      <SecretVault key={`${project.id}:${vault.unlocked}`} project={project} activeFile={activeFile} vault={vault} flash={flash} />
    </div>
  );
}

function VariableTable({ label, variables, envs, activeEnv, onChange, flash }: {
  label: string; variables: Variable[]; envs: string[]; activeEnv: string; onChange: (variables: Variable[]) => void; flash: (m: string) => void;
}) {
  const addVar = () => {
    let name = 'VAR';
    let i = 1;
    while (variables.some((v) => v.name === name)) name = `VAR_${i++}`;
    onChange([...variables, { name, values: Object.fromEntries(envs.map((e) => [e, ''])) }]);
  };
  const rename = (index: number, raw: string) => {
    const name = raw.replace(/[^\w.-]/g, '_').replace(/^[^A-Za-z_]+/, '_');
    if (name && variables.some((v, i) => i !== index && v.name === name)) return flash('Dieser Name ist in diesem Bereich schon vergeben.');
    onChange(variables.map((v, i) => i === index ? { ...v, name } : v));
  };
  return (
    <>
      <div className="section-head">
        {label}
        <button className="btn ghost sm" onClick={addVar} aria-label={`Variable anlegen: ${label}`}><Icon name="plus" size={14} /> Variable</button>
      </div>
      {variables.length === 0 ? (
        <div className="muted-box">Noch keine Variablen in diesem Bereich. Mit <b>+ Variable</b> anlegen und als <code>{'${NAME}'}</code> verwenden.</div>
      ) : (
        <table className="var-table" aria-label={label}>
          <thead>
            <tr><th>Name</th>{envs.map((e) => <th key={e} className={e === activeEnv ? 'active' : ''}>{e}</th>)}<th /></tr>
          </thead>
          <tbody>
            {variables.map((v, i) => (
              <tr key={i}>
                <td><input className="input mono" aria-label={`Name (${label})`} value={v.name} onChange={(e) => rename(i, e.target.value)} /></td>
                {envs.map((e) => (
                  <td key={e}>
                    <input className="input mono" aria-label={`${v.name} (${e}, ${label})`} value={v.values[e] ?? ''}
                      onChange={(ev) => onChange(variables.map((x, j) => j === i ? { ...x, values: { ...x.values, [e]: ev.target.value } } : x))} />
                  </td>
                ))}
                <td className="row-actions">
                  <button className="icon-btn" title={`\${${v.name}} kopieren`} onClick={() => {
                    navigator.clipboard.writeText('${' + v.name + '}');
                    flash(`\${${v.name}} kopiert`);
                  }}><Icon name="copy" size={14} /></button>
                  <button className="icon-btn danger" title="Löschen" onClick={() => onChange(variables.filter((_, j) => j !== i))}><Icon name="trash" size={14} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

// ---------------- Problems ----------------
export function ProblemsPanel({ warnings, onSelect }: { warnings: GenWarning[]; onSelect: (id: string) => void }) {
  if (!warnings.length)
    return (
      <div className="empty">
        <span className="ok-mark">
          <Icon name="check" size={18} />
        </span>
        <p className="empty-title">Keine Probleme</p>
        <p>Alle Blöcke stecken an gültigen Stellen.</p>
      </div>
    );
  return (
    <ul className="problem-list">
      {warnings.map((w, i) => (
        <li key={i} onClick={() => onSelect(w.blockId)}>
          <Icon name="alert" size={14} className="warn-ico" />
          <span>{w.msg}</span>
        </li>
      ))}
    </ul>
  );
}

// ---------------- Snippets ----------------
export function SnippetsPanel({
  snippets,
  onRename,
  onDelete,
  onShare,
  onMarket,
}: {
  snippets: Snippet[];
  onRename: (s: Snippet) => void;
  onDelete: (s: Snippet) => void;
  onShare?: (s: Snippet) => void;
  onMarket?: () => void;
}) {
  return (
    <div className="panel-scroll">
      <div className="panel-intro">
        Eigene Vorlagen liegen in der Datenbank und erscheinen im Editor unter <b>Meine Vorlagen</b>. Neue anlegen: Rechtsklick auf einen Block → „Ab hier als Vorlage speichern…“.
      </div>
      {snippets.length === 0 ? (
        <div className="muted-box">Noch keine eigenen Vorlagen. 40 mitgelieferte findest du in der Palette unter <b>Vorlagen</b>.</div>
      ) : (
        <ul className="snippet-list">
          {snippets.map((s) => (
            <li key={s.id}>
              <Icon name="layers" size={14} />
              <span className="snippet-name">{s.name}</span>
              <span className="snippet-meta">{countBlocks(s.block)} Blöcke</span>
              {onShare && (
                <button className="icon-btn" title="Im Marktplatz teilen" onClick={() => onShare(s)}>
                  <Icon name="share" size={14} />
                </button>
              )}
              <button className="icon-btn" title="Umbenennen" onClick={() => onRename(s)}>
                <Icon name="edit" size={14} />
              </button>
              <button className="icon-btn danger" title="Löschen" onClick={() => onDelete(s)}>
                <Icon name="trash" size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {onMarket && (
        <button className="mk-panel-cta" onClick={onMarket}>
          <Icon name="store" size={16} />
          <span>
            <b>Mehr Vorlagen im Marktplatz</b>
            <small>Kostenlose Block-Kombinationen, Dateien und Projekte von anderen – oder teile deine eigenen.</small>
          </span>
        </button>
      )}
    </div>
  );
}

function countBlocks(j: any): number {
  if (!j || typeof j !== 'object') return 0;
  let n = j.type ? 1 : 0;
  for (const v of Object.values(j)) if (v && typeof v === 'object') n += countBlocks(v);
  return n;
}
