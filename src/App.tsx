import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Blockly from 'blockly/core';
import BlockEditor, { BlockEditorHandle } from './components/BlockEditor';
import YamlView from './components/YamlView';
import { Icon } from './components/Icons';
import { ProblemsPanel, SnippetsPanel, VariablesPanel } from './components/Panels';
import { HelpDialog, PasteDialog, ProjectsDialog, PromptDialog, ReportDialog, ReportEntry } from './components/Dialogs';
import { generate, GenResult } from './blocks/generator';
import { registerBlocks } from './blocks/register';
import { composeDemo, openshiftDemo } from './examples';
import { importYaml } from './importer';
import { emptyFile, FileKind, newProject, normalizeProject, parseByob, Project, ProjectFile, ProjectMeta, Snippet, toByob, uid, uniqueName } from './project';
import { db, exportAll, isDesktop, openTexts, saveText } from './storage';

type Tab = 'yaml' | 'vars' | 'problems' | 'snippets';
type Menu = null | 'file' | 'import' | 'export';
type Dialog =
  | null
  | { kind: 'projects' }
  | { kind: 'paste' }
  | { kind: 'help' }
  | { kind: 'report'; entries: ReportEntry[] }
  | { kind: 'prompt'; title: string; label: string; initial: string; confirm: string; done: (v: string) => void };

const EMPTY: GenResult = { yaml: '', docs: 0, warnings: [] };

function varsOf(p: Project | null): Record<string, string> {
  if (!p) return {};
  return Object.fromEntries(p.variables.filter((v) => v.name).map((v) => [v.name, v.values[p.activeEnv] ?? '']));
}

function yamlForFile(f: ProjectFile, vars: Record<string, string>): string {
  registerBlocks();
  const ws = new Blockly.Workspace();
  try {
    Blockly.Events.disable();
    Blockly.serialization.workspaces.load(f.state, ws);
    return generate(ws, vars).yaml;
  } finally {
    Blockly.Events.enable();
    ws.dispose();
  }
}

const slug = (s: string) => s.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'projekt';

export default function App() {
  const [project, setProject] = useState<Project | null>(null);
  const [activeId, setActiveId] = useState('');
  const [result, setResult] = useState<GenResult>(EMPTY);
  const [tab, setTab] = useState<Tab>('yaml');
  const [menu, setMenu] = useState<Menu>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [saveState, setSaveState] = useState<{ s: 'saved' | 'saving' | 'error'; at?: number }>({ s: 'saved' });
  const [dbFile, setDbFile] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  // phones: one pane at a time (files / blocks / inspector), switched via the bottom bar
  const [mobileView, setMobileView] = useState<'files' | 'canvas' | 'inspector'>('canvas');

  const editor = useRef<BlockEditorHandle>(null);
  const projectRef = useRef(project);
  projectRef.current = project;
  const activeRef = useRef(activeId);
  activeRef.current = activeId;

  const vars = useMemo(() => varsOf(project), [project?.variables, project?.activeEnv]); // eslint-disable-line react-hooks/exhaustive-deps
  const active = project?.files.find((f) => f.id === activeId) ?? project?.files[0];

  const flash = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 2600);
  }, []);

  const patch = useCallback((p: Partial<Project>) => setProject((cur) => (cur ? { ...cur, ...p } : cur)), []);

  const refreshProjects = useCallback(async () => setProjects(await db.listProjects()), []);

  // ---------- boot ----------
  useEffect(() => {
    (async () => {
      setDbFile((await db.info()).file);
      setSnippets(await db.listSnippets());
      const lastId = await db.getSetting('lastProjectId');
      let p: Project | null = lastId ? await db.getProject(lastId) : null;
      if (!p) {
        const list = await db.listProjects();
        if (list.length) p = await db.getProject(list[0].id);
      }
      if (!p) {
        // first start: seed examples
        const compose = composeDemo();
        await db.saveProject(compose);
        p = openshiftDemo();
        await db.saveProject(p);
      }
      openProject(normalizeProject(p));
      refreshProjects();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadedKey = useRef('');
  const openProject = (p: Project) => {
    // flush pending edits of the project we are leaving
    const cur = projectRef.current;
    if (cur && cur.id !== p.id) db.saveProject(cur);
    loadedKey.current = '';
    setProject(p);
    setActiveId(p.files[0]?.id ?? '');
    db.setSetting('lastProjectId', p.id);
  };

  // ---------- autosave to SQLite ----------
  const firstSave = useRef(true);
  useEffect(() => {
    if (!project) return;
    if (firstSave.current) {
      firstSave.current = false;
      return;
    }
    setSaveState({ s: 'saving' });
    const t = window.setTimeout(async () => {
      try {
        const at = await db.saveProject(project);
        setSaveState({ s: 'saved', at });
      } catch (e) {
        console.error(e);
        setSaveState({ s: 'error' });
      }
    }, 350);
    return () => window.clearTimeout(t);
  }, [project]);

  // ---------- load active file into the editor ----------
  useEffect(() => {
    if (!project || !active) return;
    const key = `${project.id}:${active.id}`;
    if (loadedKey.current === key) return;
    loadedKey.current = key;
    editor.current?.load(active.state, active.kind, !!active.needsLayout);
  }, [project, active]);

  useEffect(() => {
    document.title = project ? `${project.title} – BYOBYaml` : 'BYOBYaml';
  }, [project?.title]); // eslint-disable-line react-hooks/exhaustive-deps

  const onChange = useCallback((res: GenResult) => {
    setResult(res);
    const state = editor.current?.save();
    if (!state) return;
    setProject((p) => {
      if (!p) return p;
      const f = p.files.find((x) => x.id === activeRef.current);
      if (!f || (JSON.stringify(f.state) === JSON.stringify(state) && !f.needsLayout)) return p;
      return { ...p, files: p.files.map((x) => (x.id === activeRef.current ? { ...x, state, needsLayout: false } : x)) };
    });
  }, []);

  // ---------- files ----------
  const addFile = (kind: FileKind) => {
    if (!project) return;
    const f = emptyFile(kind, project.files.map((x) => x.name));
    patch({ files: [...project.files, f] });
    setActiveId(f.id);
    setMobileView('canvas');
  };
  const duplicateFile = (f: ProjectFile) => {
    if (!project) return;
    const copy: ProjectFile = { ...f, id: uid(), name: uniqueName(f.name.replace(/(\.ya?ml)?$/, '-kopie$1'), project.files.map((x) => x.name)) };
    patch({ files: [...project.files, copy] });
    setActiveId(copy.id);
  };
  const deleteFile = (f: ProjectFile) => {
    if (!project) return;
    if (project.files.length <= 1) return flash('Mindestens eine Datei muss bleiben.');
    if (!window.confirm(`"${f.name}" löschen?`)) return;
    const rest = project.files.filter((x) => x.id !== f.id);
    patch({ files: rest });
    if (f.id === activeId) setActiveId(rest[0].id);
  };
  const renameFile = (id: string, name: string) => {
    if (!project || !name.trim()) return setRenaming(null);
    patch({ files: project.files.map((f) => (f.id === id ? { ...f, name: name.trim() } : f)) });
    setRenaming(null);
  };

  // ---------- import ----------
  const importTexts = async (list: { name: string; content: string }[]) => {
    const p = projectRef.current;
    if (!p || !list.length) return;
    const entries: ReportEntry[] = [];
    const added: ProjectFile[] = [];
    const names = p.files.map((f) => f.name);
    let openAfter: Project | null = null;
    for (const item of list) {
      try {
        if (/\.byob$/i.test(item.name) || /^\s*\{[\s\S]*"format"\s*:\s*"byobyaml"/.test(item.content)) {
          const { projects: ps, snippets: ss } = parseByob(item.content);
          for (const ip of ps) {
            if (await db.getProject(ip.id)) {
              ip.id = uid();
              ip.title = `${ip.title} (Import)`;
            }
            await db.saveProject(ip);
            openAfter ??= ip;
          }
          for (const s of ss) await db.saveSnippet({ ...s, id: s.id || uid() });
          entries.push({ name: item.name, ok: true, lines: [`${ps.length} Projekt(e) und ${ss.length} Vorlage(n) in die Datenbank übernommen.`] });
        } else {
          const r = importYaml(item.content, item.name);
          r.file.name = uniqueName(r.file.name, names);
          names.push(r.file.name);
          added.push(r.file);
          entries.push({ name: item.name, ok: true, lines: r.notes });
        }
      } catch (e: any) {
        entries.push({ name: item.name, ok: false, lines: [String(e?.message ?? e)] });
      }
    }
    if (added.length) {
      patch({ files: [...p.files, ...added] });
      setActiveId(added[0].id);
    }
    if (openAfter) {
      setSnippets(await db.listSnippets());
      if (!added.length) openProject(openAfter);
    }
    refreshProjects();
    setDialog({ kind: 'report', entries });
  };

  const importFromDisk = async (ext: string[]) => {
    setMenu(null);
    importTexts(await openTexts(ext, true));
  };

  // drag & drop files onto the window
  useEffect(() => {
    const over = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) {
        e.preventDefault();
        setDragOver(true);
      }
    };
    const leave = (e: DragEvent) => {
      if (!e.relatedTarget) setDragOver(false);
    };
    const drop = async (e: DragEvent) => {
      if (!e.dataTransfer?.files.length) return;
      e.preventDefault();
      setDragOver(false);
      const files = [...e.dataTransfer.files].filter((f) => /\.(ya?ml|byob|json)$/i.test(f.name));
      if (!files.length) return flash('Nur .yaml, .yml oder .byob Dateien.');
      importTexts(await Promise.all(files.map(async (f) => ({ name: f.name, content: await f.text() }))));
    };
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  });

  // ---------- export ----------
  const saveYaml = async () => {
    setMenu(null);
    if (!active) return;
    const r = await saveText(active.name, result.yaml, ['yaml', 'yml']);
    if (r) flash(`Gespeichert: ${r}`);
  };
  const exportFolder = async () => {
    setMenu(null);
    const p = projectRef.current;
    if (!p) return;
    const files = p.files.map((f) => ({ name: f.name, content: f.id === activeId ? result.yaml : yamlForFile(f, vars) }));
    const r = await exportAll(files);
    if (r) flash(`${files.length} Dateien (${p.activeEnv}) → ${r}`);
  };
  const exportProject = async () => {
    setMenu(null);
    if (!project) return;
    const r = await saveText(`${slug(project.title)}.byob`, toByob([project]), ['byob']);
    if (r) flash('Projekt exportiert');
  };
  const exportBackup = async () => {
    setMenu(null);
    const metas = await db.listProjects();
    const ps = (await Promise.all(metas.map((m) => db.getProject(m.id)))).filter(Boolean) as Project[];
    const r = await saveText(`byobyaml-backup-${new Date().toISOString().slice(0, 10)}.byob`, toByob(ps, await db.listSnippets()), ['byob']);
    if (r) flash(`Backup: ${ps.length} Projekte`);
  };

  // ---------- projects ----------
  const showProjects = async () => {
    setMenu(null);
    await refreshProjects();
    setDialog({ kind: 'projects' });
  };
  const createProject = async (p: Project) => {
    await db.saveProject(p);
    openProject(p);
    refreshProjects();
    setDialog(null);
  };
  const openById = async (id: string) => {
    const p = await db.getProject(id);
    if (p) openProject(normalizeProject(p));
    setDialog(null);
  };
  const duplicateProject = async (id: string) => {
    const p = await db.getProject(id);
    if (!p) return;
    await db.saveProject({ ...normalizeProject(p), id: uid(), title: `${p.title} (Kopie)`, createdAt: Date.now() });
    refreshProjects();
  };
  const deleteProject = async (id: string) => {
    const m = projects.find((x) => x.id === id);
    if (!m || !window.confirm(`Projekt "${m.title}" endgültig löschen?`)) return;
    await db.deleteProject(id);
    refreshProjects();
  };

  // ---------- snippets ----------
  const onSaveSnippet = useCallback((state: any) => {
    setDialog({
      kind: 'prompt',
      title: 'Als Vorlage speichern',
      label: 'Name der Vorlage',
      initial: state?.type ? `Vorlage ${new Date().toLocaleDateString('de-DE')}` : 'Vorlage',
      confirm: 'Speichern',
      done: async (name) => {
        await db.saveSnippet({ id: uid(), name, category: 'user', block: state });
        setSnippets(await db.listSnippets());
        flash(`Vorlage „${name}“ gespeichert`);
      },
    });
  }, [flash]);

  const renameSnippet = (s: Snippet) =>
    setDialog({
      kind: 'prompt',
      title: 'Vorlage umbenennen',
      label: 'Name',
      initial: s.name,
      confirm: 'Umbenennen',
      done: async (name) => {
        await db.saveSnippet({ ...s, name });
        setSnippets(await db.listSnippets());
      },
    });
  const deleteSnippet = async (s: Snippet) => {
    if (!window.confirm(`Vorlage "${s.name}" löschen?`)) return;
    await db.deleteSnippet(s.id);
    setSnippets(await db.listSnippets());
  };

  // ---------- keyboard + menus ----------
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.menu-anchor')) setMenu(null);
    };
    const key = async (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        const p = projectRef.current;
        if (p) {
          const at = await db.saveProject(p);
          setSaveState({ s: 'saved', at });
          flash('Gespeichert');
        }
      }
      if (e.key === 'Escape') setMenu(null);
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', key);
    };
  }, [flash]);

  const lines = result.yaml ? result.yaml.split('\n').length - 1 : 0;
  const savedLabel =
    saveState.s === 'saving' ? 'Speichert…' : saveState.s === 'error' ? 'Speichern fehlgeschlagen' : saveState.at ? `Gespeichert ${new Date(saveState.at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}` : 'Gespeichert';

  const MenuButton = ({ id, label }: { id: Exclude<Menu, null>; label: string }) => (
    <button className={`menu-btn ${menu === id ? 'open' : ''}`} onClick={() => setMenu(menu === id ? null : id)}>
      {label}
    </button>
  );

  return (
    <div className={`app mv-${mobileView}`}>
      {/* ================= title bar ================= */}
      <header className="titlebar">
        <div className="brand" title="Build Your Own Blocks → YAML">
          <span className="brand-mark">
            <span />
            <span />
            <span />
          </span>
          BYOB<span className="brand-y">yaml</span>
        </div>

        <nav className="menus">
          <div className="menu-anchor">
            <MenuButton id="file" label="Datei" />
            {menu === 'file' && (
              <div className="dropdown">
                <button onClick={() => (setMenu(null), createProject(newProject()))}>
                  <Icon name="plus" /> Neues Projekt
                </button>
                <button onClick={showProjects}>
                  <Icon name="folder" /> Projekte öffnen… <kbd>alle in SQLite</kbd>
                </button>
                <div className="sep" />
                <button onClick={() => (setMenu(null), addFile('compose'))}>
                  <Icon name="whale" /> Neue Compose-Datei
                </button>
                <button onClick={() => (setMenu(null), addFile('k8s'))}>
                  <Icon name="helm" /> Neue Kubernetes-Datei
                </button>
                <div className="sep" />
                <button onClick={() => (setMenu(null), setDialog({ kind: 'help' }))}>
                  <Icon name="help" /> Kurzreferenz
                </button>
              </div>
            )}
          </div>
          <div className="menu-anchor">
            <MenuButton id="import" label="Importieren" />
            {menu === 'import' && (
              <div className="dropdown">
                <button onClick={() => importFromDisk(['yaml', 'yml'])}>
                  <Icon name="upload" /> YAML-Dateien… <kbd>Compose · K8s · OpenShift</kbd>
                </button>
                <button onClick={() => (setMenu(null), setDialog({ kind: 'paste' }))}>
                  <Icon name="code" /> YAML einfügen…
                </button>
                <div className="sep" />
                <button onClick={() => importFromDisk(['byob', 'json'])}>
                  <Icon name="db" /> BYOBYaml-Datei (.byob)…
                </button>
                <div className="menu-note">Tipp: Dateien einfach ins Fenster ziehen.</div>
              </div>
            )}
          </div>
          <div className="menu-anchor">
            <MenuButton id="export" label="Exportieren" />
            {menu === 'export' && (
              <div className="dropdown">
                <button onClick={saveYaml}>
                  <Icon name="file" /> {active?.name ?? 'Datei'} als YAML…
                </button>
                <button onClick={exportFolder}>
                  <Icon name="folder" /> Alle Dateien in Ordner… <kbd>{project?.activeEnv}</kbd>
                </button>
                <div className="sep" />
                <button onClick={exportProject}>
                  <Icon name="db" /> Projekt als .byob…
                </button>
                <button onClick={exportBackup}>
                  <Icon name="layers" /> Backup: alles als .byob…
                </button>
              </div>
            )}
          </div>
        </nav>

        <div className="title-center">
          <button className="project-switch" onClick={showProjects} title="Projekte">
            <Icon name="folder" size={14} />
          </button>
          <input className="project-title" value={project?.title ?? ''} onChange={(e) => patch({ title: e.target.value })} spellCheck={false} aria-label="Projektname" />
        </div>

        <div className="title-right">
          <label className="env-select" title="Aktive Umgebung für Variablen und Export">
            <span>Umgebung</span>
            <select value={project?.activeEnv ?? ''} onChange={(e) => patch({ activeEnv: e.target.value })}>
              {project?.envs.map((e) => (
                <option key={e}>{e}</option>
              ))}
            </select>
          </label>
          <button className="icon-btn" title="Kurzreferenz" onClick={() => setDialog({ kind: 'help' })}>
            <Icon name="help" />
          </button>
        </div>
      </header>

      <div className="workbench">
        {/* ================= explorer ================= */}
        <aside className="explorer">
          <div className="pane-head">
            <span>Dateien</span>
            <div className="pane-actions">
              <button className="icon-btn" title="Neue Compose-Datei" onClick={() => addFile('compose')}>
                <Icon name="whale" />
              </button>
              <button className="icon-btn" title="Neue Kubernetes-Datei" onClick={() => addFile('k8s')}>
                <Icon name="helm" />
              </button>
              <button className="icon-btn" title="YAML importieren" onClick={() => importFromDisk(['yaml', 'yml'])}>
                <Icon name="upload" />
              </button>
            </div>
          </div>
          <ul className="file-list">
            {project?.files.map((f) => (
              <li key={f.id} className={f.id === active?.id ? 'active' : ''} onClick={() => (setActiveId(f.id), setMobileView('canvas'))} onDoubleClick={() => setRenaming(f.id)}>
                <span className={`kind kind-${f.kind}`}>{f.kind === 'compose' ? 'DC' : 'K8'}</span>
                {renaming === f.id ? (
                  <input
                    className="rename"
                    autoFocus
                    defaultValue={f.name}
                    onClick={(e) => e.stopPropagation()}
                    onBlur={(e) => renameFile(f.id, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') renameFile(f.id, (e.target as HTMLInputElement).value);
                      if (e.key === 'Escape') setRenaming(null);
                    }}
                  />
                ) : (
                  <span className="fname" title={f.name}>
                    {f.name}
                  </span>
                )}
                <span className="row-actions">
                  <button className="icon-btn" title="Umbenennen" onClick={(e) => (e.stopPropagation(), setRenaming(f.id))}>
                    <Icon name="edit" size={13} />
                  </button>
                  <button className="icon-btn" title="Duplizieren" onClick={(e) => (e.stopPropagation(), duplicateFile(f))}>
                    <Icon name="dup" size={13} />
                  </button>
                  <button className="icon-btn danger" title="Löschen" onClick={(e) => (e.stopPropagation(), deleteFile(f))}>
                    <Icon name="trash" size={13} />
                  </button>
                </span>
              </li>
            ))}
          </ul>
          <div className="explorer-foot">
            <button className="btn ghost block" onClick={() => setDialog({ kind: 'paste' })}>
              <Icon name="code" size={14} /> YAML einfügen
            </button>
          </div>
        </aside>

        {/* ================= canvas ================= */}
        <main className="canvas">
          <div className="canvas-head">
            <div className="crumbs">
              <span className="muted">{project?.title}</span>
              <span className="crumb-sep">/</span>
              <span>{active?.name}</span>
              <span className={`kind-pill kind-${active?.kind}`}>{active?.kind === 'compose' ? 'Docker Compose' : 'Kubernetes / OpenShift'}</span>
            </div>
            <div className="canvas-tools">
              <button className="btn ghost sm" onClick={() => editor.current?.cleanUp()} title="Stapel untereinander anordnen">
                <Icon name="broom" size={14} /> Anordnen
              </button>
              <button className="btn ghost sm" onClick={() => editor.current?.zoomToFit()} title="Alles sichtbar machen">
                <Icon name="fit" size={14} /> Einpassen
              </button>
            </div>
          </div>
          <div className="canvas-body">
            <BlockEditor ref={editor} vars={vars} userSnippets={snippets} onChange={onChange} onSaveSnippet={onSaveSnippet} />
          </div>
        </main>

        {/* ================= inspector ================= */}
        <aside className="inspector">
          <div className="tabs">
            {(
              [
                ['yaml', 'YAML'],
                ['vars', 'Variablen'],
                ['problems', 'Probleme'],
                ['snippets', 'Vorlagen'],
              ] as [Tab, string][]
            ).map(([id, label]) => (
              <button key={id} className={`tab ${tab === id ? 'on' : ''}`} onClick={() => setTab(id)}>
                {label}
                {id === 'problems' && result.warnings.length > 0 && <span className="badge warn">{result.warnings.length}</span>}
                {id === 'vars' && project && project.variables.length > 0 && <span className="badge">{project.variables.length}</span>}
                {id === 'snippets' && snippets.length > 0 && <span className="badge">{snippets.length}</span>}
              </button>
            ))}
          </div>

          {tab === 'yaml' && (
            <>
              <div className="yaml-toolbar">
                <span className="muted mono">{active?.name}</span>
                <div className="spacer" />
                <button
                  className="btn ghost sm"
                  disabled={!result.yaml}
                  onClick={async () => {
                    await navigator.clipboard.writeText(result.yaml);
                    flash('YAML kopiert');
                  }}
                >
                  <Icon name="copy" size={14} /> Kopieren
                </button>
                <button className="btn ghost sm" disabled={!result.yaml} onClick={saveYaml}>
                  <Icon name="download" size={14} /> Speichern
                </button>
              </div>
              <div className="yaml-scroll">
                <YamlView yaml={result.yaml} />
              </div>
            </>
          )}
          {tab === 'vars' && project && <VariablesPanel project={project} onChange={patch} flash={flash} />}
          {tab === 'problems' && <ProblemsPanel warnings={result.warnings} onSelect={(id) => editor.current?.select(id)} />}
          {tab === 'snippets' && <SnippetsPanel snippets={snippets} onRename={renameSnippet} onDelete={deleteSnippet} />}
        </aside>
      </div>

      {/* ================= mobile bottom bar (hidden on desktop) ================= */}
      <nav className="mobile-nav" aria-label="Ansicht">
        <button className={mobileView === 'files' ? 'on' : ''} onClick={() => setMobileView('files')}>
          <Icon name="folder" size={18} />
          <span>Dateien</span>
        </button>
        <button className={mobileView === 'canvas' ? 'on' : ''} onClick={() => setMobileView('canvas')}>
          <Icon name="layers" size={18} />
          <span>Blöcke</span>
        </button>
        <button className={mobileView === 'inspector' ? 'on' : ''} onClick={() => setMobileView('inspector')}>
          <Icon name="code" size={18} />
          <span>YAML</span>
          {result.warnings.length > 0 && <span className="badge warn">{result.warnings.length}</span>}
        </button>
      </nav>

      {/* ================= status bar ================= */}
      <footer className="statusbar">
        <span className="status-env">
          <Icon name="env" size={12} /> {project?.activeEnv}
        </span>
        <span>
          {result.docs} Dokument{result.docs === 1 ? '' : 'e'} · {lines} Zeilen
        </span>
        <button className={`status-link ${result.warnings.length ? 'warn' : ''}`} onClick={() => setTab('problems')}>
          <Icon name={result.warnings.length ? 'alert' : 'check'} size={12} /> {result.warnings.length} Probleme
        </button>
        <div className="spacer" />
        <button className="status-link" onClick={() => isDesktop && window.byob?.revealData()} title={dbFile}>
          <Icon name="db" size={12} /> {isDesktop ? 'SQLite' : 'Browser-Speicher'}
        </button>
        <span className={`save-state ${saveState.s}`}>{savedLabel}</span>
      </footer>

      {dragOver && (
        <div className="drop-overlay">
          <div>
            <Icon name="upload" size={28} />
            <p>Loslassen zum Importieren</p>
            <span>.yaml / .yml → Blöcke · .byob → Projekte & Vorlagen</span>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}

      {dialog?.kind === 'help' && <HelpDialog onClose={() => setDialog(null)} />}
      {dialog?.kind === 'report' && <ReportDialog entries={dialog.entries} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'paste' && (
        <PasteDialog
          onDone={(r) => {
            setDialog(null);
            if (r) importTexts([{ name: r.name, content: r.text }]);
          }}
        />
      )}
      {dialog?.kind === 'prompt' && (
        <PromptDialog
          title={dialog.title}
          label={dialog.label}
          initial={dialog.initial}
          confirm={dialog.confirm}
          onDone={(v) => {
            const d = dialog;
            setDialog(null);
            if (v) d.done(v);
          }}
        />
      )}
      {dialog?.kind === 'projects' && project && (
        <ProjectsDialog
          projects={projects}
          currentId={project.id}
          dbFile={dbFile}
          onOpen={openById}
          onNew={() => createProject(newProject())}
          onExample={(w) => createProject(w === 'openshift' ? openshiftDemo() : composeDemo())}
          onDuplicate={duplicateProject}
          onDelete={deleteProject}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
