import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import BlockEditor, { BlockEditorHandle } from './components/BlockEditor';
import YamlView from './components/YamlView';
import Explorer from './components/Explorer';
import type { CanvasMode } from './blocks/multiselect';
import { joinPath } from './folders';
import { Icon } from './components/Icons';
import { ProblemsPanel, SnippetsPanel, VariablesPanel } from './components/Panels';
import { HelpDialog, PasteDialog, ProjectsDialog, PromptDialog, ReportDialog, ReportEntry } from './components/Dialogs';
import type { GenResult } from './blocks/generator';
import { yamlForFile } from './projectYaml';
import DependencyGraph from './components/DependencyGraph';
import HelmExport from './components/HelmExport';
import CustomBlockDesigner from './components/CustomBlockDesigner';
import { useCustomLibrary } from './custom-blocks/useLibrary';
import { setCustomBlockAccess } from './custom-blocks/runtime';
import { expandCustomState, hasCustomBlocks } from './custom-blocks/recipe';
import type { CustomBlockDefinition } from './custom-blocks/model';
import { composeDemo, openshiftDemo } from './examples';
import { importYaml } from './importer';
import { emptyFile, FileKind, fileKindLabel, outputExtensions, newProject, normalizeProject, parseByob, Project, ProjectFile, ProjectMeta, Snippet, toByob, uid, uniqueName } from './project';
import { importDockerfile, isDockerfileName } from './dockerfile';
import DockerfileView from './components/DockerfileView';
import MarketDialog, { UseAction } from './market/MarketDialog';
import PublishDialog, { PublishSources } from './market/PublishDialog';
import { fileVars, isFile, isProject, isSnippet, snippetWhere } from './market/preview';
import type { MarketItemFull } from './market/shared';
import { db, exportAll, isDesktop, isGuest, leaveGuestMode, openTexts, saveText } from './storage';
import { secretVariables, type SecretVaultEnvelope } from './secrets';
import { useSecretVault } from './useSecretVault';

type Tab = 'yaml' | 'vars' | 'problems' | 'snippets';
type Menu = null | 'file' | 'import' | 'export';
type Dialog =
  | null
  | { kind: 'projects' }
  | { kind: 'block-designer'; initial?: CustomBlockDefinition }
  | { kind: 'paste' }
  | { kind: 'paste-dockerfile' }
  | { kind: 'help' }
  | { kind: 'helm'; project: Project; activeFileId: string }
  | { kind: 'report'; entries: ReportEntry[] }
  | { kind: 'prompt'; title: string; label: string; initial: string; confirm: string; done: (v: string) => void };

const EMPTY: GenResult = { yaml: '', docs: 0, warnings: [] };

// Serialize autosave and explicit vault writes so older saves cannot replace a new vault.
let saveQueue: Promise<unknown> = Promise.resolve();
function saveProject(p: Project): Promise<number> {
  const write = saveQueue.catch(() => {}).then(() => db.saveProject(p));
  saveQueue = write;
  return write;
}

const slug = (s: string) => s.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'projekt';

export default function App() {
  const [project, setProject] = useState<Project | null>(null);
  const [activeId, setActiveId] = useState('');
  const [result, setResult] = useState<GenResult>(EMPTY);
  // guest: basic editor only — no projects list, no marketplace, nothing persisted
  const guest = isGuest();
  const canManageCustomBlocks: boolean = false;
  setCustomBlockAccess(canManageCustomBlocks);
  const customLibrary = useCustomLibrary(canManageCustomBlocks);
  const [tab, setTab] = useState<Tab>('yaml');
  const [menu, setMenu] = useState<Menu>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const snippetsRef = useRef(snippets);
  snippetsRef.current = snippets;
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [saveState, setSaveState] = useState<{ s: 'saved' | 'saving' | 'error'; at?: number }>({ s: 'saved' });
  const [dbFile, setDbFile] = useState('');
  // folder new files / imports go into
  const [currentFolder, setCurrentFolder] = useState('');
  // canvas: drag on empty space selects (select) or moves the view (pan)
  const [canvasMode, setCanvasMode] = useState<CanvasMode>(() => (localStorage.getItem('byob.canvasMode') === 'pan' || window.matchMedia('(max-width: 820px)').matches ? 'pan' : 'select'));
  const [graphOpen, setGraphOpen] = useState(false);
  const [selCount, setSelCount] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  // phones: one pane at a time (files / blocks / inspector), switched via the bottom bar
  const [mobileView, setMobileView] = useState<'files' | 'canvas' | 'inspector'>('canvas');
  // marketplace: overlay + publish dialog (can be open on top of it)
  const [marketOpen, setMarketOpen] = useState<{ initialId?: string } | null>(() => {
    const id = new URLSearchParams(location.search).get('market');
    return id && !guest ? { initialId: id } : null;
  });
  const [publish, setPublish] = useState<{ sources: PublishSources; edit?: MarketItemFull } | null>(null);
  const [marketReload, setMarketReload] = useState(0);

  const editor = useRef<BlockEditorHandle>(null);
  const projectRef = useRef(project);
  projectRef.current = project;
  const activeRef = useRef(activeId);
  activeRef.current = activeId;
  const currentFolderRef = useRef(currentFolder);
  currentFolderRef.current = currentFolder;

  const active = project?.files.find((f) => f.id === activeId) ?? project?.files[0];
  const variableCount = (project?.variables.length ?? 0) + (active?.variables?.length ?? 0);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 2600);
  }, []);

  const patch = useCallback((p: Partial<Project>) => setProject((cur) => (cur ? { ...cur, ...p } : cur)), []);

  const persistVault = async (projectId: string, envelope: SecretVaultEnvelope) => {
    const current = projectRef.current;
    if (!current || current.id !== projectId) throw new Error('Projekt gewechselt. Bitte den Tresor im ursprünglichen Projekt erneut öffnen.');
    const next = { ...current, secretVault: envelope };
    // Update the ref immediately so following exports and saves see the new envelope.
    projectRef.current = next;
    setProject(next);
    setSaveState({ s: 'saving' });
    try {
      const at = await saveProject(next);
      setSaveState({ s: 'saved', at });
    } catch {
      setSaveState({ s: 'error' });
      // Keep the ciphertext in the editor for autosave/retry, never claim success.
      throw new Error('Tresor konnte nicht dauerhaft gespeichert werden. Verbindung prüfen und erneut speichern.');
    }
  };
  const vault = useSecretVault(project, persistVault);
  const vars = useMemo(() => project ? secretVariables(project, active, vault.entries, true) : {}, [project?.variables, project?.activeEnv, active?.variables, active?.id, vault.entries]); // eslint-disable-line react-hooks/exhaustive-deps

  const exportVariables = (p: Project, file: ProjectFile) => {
    if (p.secretVault && !vault.unlocked) throw new Error('Bitte den Secret-Tresor im Bereich „Variablen“ entsperren, bevor du YAML kopierst oder exportierst.');
    return secretVariables(p, file, vault.entries, false);
  };
  const activeYaml = () => {
    const p = projectRef.current;
    if (!p || !active) return '';
    return yamlForFile({ ...active, state: editor.current?.save() ?? active.state }, exportVariables(p, active));
  };

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
      if (!p && guest) {
        // guest: a single example project to play with
        p = composeDemo();
        await saveProject(p);
      }
      if (!p) {
        // first start: seed examples
        const compose = composeDemo();
        await saveProject(compose);
        p = openshiftDemo();
        await saveProject(p);
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
    if (cur && cur.id !== p.id) void saveProject(cur).catch(() => flash('Projekt konnte nicht gespeichert werden.'));
    loadedKey.current = '';
    setProject(p);
    setActiveId(p.files[0]?.id ?? '');
    setCurrentFolder('');
    db.setSetting('lastProjectId', p.id);
  };

  // ---------- autosave to SQLite ----------
  const firstSave = useRef(true);
  const guestDirty = useRef(false);
  useEffect(() => {
    if (!project) return;
    if (firstSave.current) {
      firstSave.current = false;
      return;
    }
    guestDirty.current = true;
    setSaveState({ s: 'saving' });
    const t = window.setTimeout(async () => {
      try {
        // Read current ciphertext after any explicit vault write in this project.
        const current = projectRef.current;
        const at = await saveProject(current?.id === project.id ? current : project);
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
  const namesIn = (p: Project, folder: string) => p.files.filter((x) => (x.folder ?? '') === folder).map((x) => x.name);
  const addFile = (kind: FileKind) => {
    if (!project) return;
    const f: ProjectFile = { ...emptyFile(kind, namesIn(project, currentFolder)), ...(currentFolder ? { folder: currentFolder } : {}) };
    patch({ files: [...project.files, f] });
    setActiveId(f.id);
    setMobileView('canvas');
  };
  useEffect(() => localStorage.setItem('byob.canvasMode', canvasMode), [canvasMode]);

  // ---------- import ----------
  const importTexts = async (list: { name: string; content: string }[], dockerfile = false) => {
    const p = projectRef.current;
    if (!p || !list.length) return;
    const entries: ReportEntry[] = [];
    const added: ProjectFile[] = [];
    const folder = currentFolderRef.current;
    const names = namesIn(p, folder);
    let openAfter: Project | null = null;
    for (const item of list) {
      try {
        if (/\.byob$/i.test(item.name) || /^\s*\{[\s\S]*"format"\s*:\s*"byobyaml"/.test(item.content)) {
          const { projects: ps, snippets: ss } = parseByob(item.content);
          if (!canManageCustomBlocks && (ps.some((ip) => ip.files.some((file) => hasCustomBlocks(file.state))) || ss.some((snippet) => hasCustomBlocks(snippet.block)))) throw new Error('Eigene Blocktypen benötigen ein angemeldetes Konto. Bitte zuerst anmelden.');
          for (const ip of ps) {
            if (await db.getProject(ip.id)) {
              ip.id = uid();
              ip.title = `${ip.title} (Import)`;
            }
            await saveProject(ip);
            openAfter ??= ip;
          }
          for (const s of ss) await db.saveSnippet({ ...s, id: s.id || uid() });
          entries.push({ name: item.name, ok: true, lines: [`${ps.length} Projekt(e) und ${ss.length} Vorlage(n) ${guest ? 'für diese Sitzung geladen (Gastmodus, nicht gespeichert)' : 'in die Datenbank übernommen'}.`] });
        } else {
          const r = dockerfile || isDockerfileName(item.name) ? importDockerfile(item.content, item.name) : importYaml(item.content, item.name);
          r.file.name = uniqueName(r.file.name, names);
          if (folder) r.file.folder = folder;
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

  const importFromDisk = async (ext: string[], dockerfile = false) => {
    setMenu(null);
    importTexts(await openTexts(ext, true), dockerfile);
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
      const files = [...e.dataTransfer.files].filter((f) => /\.(ya?ml|byob|json)$/i.test(f.name) || isDockerfileName(f.name));
      if (!files.length) return flash('Dockerfile, .yaml, .yml oder .byob Dateien verwenden.');
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
  const showHelmExport = () => {
    setMenu(null);
    const current = projectRef.current;
    if (!current) return;
    const state = editor.current?.save();
    const snapshot = { ...current, files: current.files.map((file) => file.id === activeRef.current && state ? { ...file, state } : file) };
    setDialog({ kind: 'helm', project: snapshot, activeFileId: activeRef.current });
  };
  const saveYaml = async () => {
    setMenu(null);
    if (!active) return;
    try {
      const r = await saveText(active.name, activeYaml(), outputExtensions(active.kind));
      if (r) flash(`Gespeichert: ${r}`);
    } catch (e) { flash(e instanceof Error ? e.message : 'YAML konnte nicht gespeichert werden.'); }
  };
  const exportFolder = async () => {
    setMenu(null);
    const p = projectRef.current;
    if (!p) return;
    try {
      const files = p.files.map((f) => ({ name: joinPath(f.folder ?? '', f.name), content: yamlForFile(f, exportVariables(p, f)) }));
      const r = await exportAll(files);
      if (r) flash(`${files.length} Dateien (${p.activeEnv}) → ${r}`);
    } catch (e) { flash(e instanceof Error ? e.message : 'YAML konnte nicht exportiert werden.'); }
  };
  const exportSome = async (list: ProjectFile[]) => {
    const p = projectRef.current;
    if (!p || !list.length) return;
    try {
      const files = list.map((f) => ({ name: joinPath(f.folder ?? '', f.name), content: yamlForFile(f, exportVariables(p, f)) }));
      const r = files.length === 1 ? await saveText(list[0].name, files[0].content, outputExtensions(list[0].kind)) : await exportAll(files);
      if (r) flash(`${files.length} ${files.length === 1 ? 'Datei' : 'Dateien'} (${p.activeEnv}) → ${r}`);
    } catch (e) { flash(e instanceof Error ? e.message : 'YAML konnte nicht exportiert werden.'); }
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
    await saveProject(p);
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
    await saveProject({ ...normalizeProject(p), id: uid(), title: `${p.title} (Kopie)`, createdAt: Date.now() });
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

  // ---------- marketplace ----------
  const currentSources = (preset?: { block: any }): PublishSources => {
    const p = projectRef.current;
    const f = p?.files.find((x) => x.id === activeRef.current) ?? p?.files[0];
    const liveState = editor.current?.save();
    const native = (state: any, file?: ProjectFile) => hasCustomBlocks(state) ? expandCustomState(state, p && file ? secretVariables(p, file, [], false) : {}, false, true).state : state;
    const nativeBlock = (block: any) => native({ blocks: { blocks: [block] } }, f)?.blocks?.blocks?.[0];
    return {
      preset: preset ? { block: nativeBlock(preset.block) } : undefined,
      file: f ? { name: f.name, kind: f.kind, state: native(liveState ?? f.state, f), variables: f.variables, envs: p?.envs } : undefined,
      project: p
        ? {
            title: p.title,
            files: p.files.map((x) => ({ name: x.name, kind: x.kind, variables: x.variables, state: native(x.id === f?.id && liveState ? liveState : x.state, x), ...(x.folder ? { folder: x.folder } : {}) })),
            variables: p.variables,
            envs: p.envs,
          }
        : undefined,
      snippets: snippetsRef.current.map((snippet) => ({ ...snippet, block: nativeBlock(snippet.block) })),
    };
  };
  const openPublish = (edit?: MarketItemFull, preset?: { block: any }) => {
    setMenu(null);
    try { setPublish({ sources: currentSources(preset), edit }); }
    catch (error) { flash(error instanceof Error ? error.message : 'Inhalt konnte nicht vorbereitet werden.'); }
  };
  const onShareSnippet = useCallback((state: any) => openPublish(undefined, { block: state }), []); // eslint-disable-line react-hooks/exhaustive-deps
  const shareMySnippet = (s: Snippet) => openPublish(undefined, { block: s.block });

  /** use downloaded marketplace content; returns a short confirmation */
  const useMarketItem = async (item: MarketItemFull, how: UseAction): Promise<string> => {
    const d = item.data;
    const p = projectRef.current;
    if (how === 'insert' && isSnippet(d)) {
      if (item.target !== 'any' && item.target !== 'mixed' && item.target !== p?.files.find((file) => file.id === activeRef.current)?.kind) throw new Error('Diese Vorlage passt nicht zum geöffneten Dateityp.');
      editor.current?.insert(d.block);
      setMarketOpen(null);
      setMobileView('canvas');
      const where = snippetWhere(d);
      return where && !where.startsWith('Startblock') ? `„${item.title}“ eingefügt – ${where}` : `„${item.title}“ eingefügt`;
    }
    if (how === 'snippet' && isSnippet(d)) {
      await db.saveSnippet({ id: uid(), name: item.title, category: 'market', block: d.block });
      setSnippets(await db.listSnippets());
      return `In „Meine Vorlagen“: ${item.title}`;
    }
    if (how === 'file' && isFile(d) && p) {
      const f: ProjectFile = { id: uid(), name: uniqueName(d.name, namesIn(p, currentFolder)), kind: d.kind, state: d.state, variables: d.variables, needsLayout: true, ...(currentFolder ? { folder: currentFolder } : {}) };
      patch({ files: [...p.files, f], envs: [...new Set([...p.envs, ...(d.envs ?? [])])] });
      setActiveId(f.id);
      setMarketOpen(null);
      setMobileView('canvas');
      return `${f.name} zum Projekt hinzugefügt`;
    }
    if (how === 'project' && isProject(d)) {
      const np = normalizeProject({
        format: 'byobyaml',
        version: 2,
        id: uid(),
        title: d.title || item.title,
        createdAt: Date.now(),
        files: d.files.map((f) => ({ id: uid(), name: f.name, kind: f.kind, state: f.state, variables: f.variables, needsLayout: true, folder: f.folder })),
        variables: d.variables,
        envs: d.envs,
        activeEnv: d.envs[0] ?? 'dev',
      });
      await saveProject(np);
      openProject(np);
      refreshProjects();
      setMarketOpen(null);
      setMobileView('canvas');
      return `Projekt „${np.title}“ geöffnet`;
    }
    // download as a file
    const base = slug(item.title);
    let r: string | null;
    if (isFile(d)) r = await saveText(d.name || (d.kind === 'dockerfile' ? 'Dockerfile' : `${base}.yaml`), yamlForFile({ id: 'x', ...d }, fileVars(d)), outputExtensions(d.kind));
    else if (isProject(d)) {
      const np = normalizeProject({ format: 'byobyaml', version: 2, id: uid(), title: d.title || item.title, files: d.files.map((f) => ({ id: uid(), ...f })), variables: d.variables, envs: d.envs, activeEnv: d.envs[0] ?? 'dev' });
      r = await saveText(`${base}.byob`, toByob([np]), ['byob']);
    } else r = await saveText(`${base}.byob`, toByob([], [{ id: uid(), name: item.title, category: 'market', block: (d as any).block }]), ['byob']);
    if (!r) throw new Error('Abgebrochen');
    return `Gespeichert: ${r}`;
  };

  // drop ?market=… from the address bar once handled
  useEffect(() => {
    if (new URLSearchParams(location.search).has('market')) history.replaceState(null, '', location.pathname + (guest ? '?gast' : ''));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // guest: work is lost on reload/close, so ask first once something changed
  useEffect(() => {
    if (!guest) return;
    const warn = (e: BeforeUnloadEvent) => {
      if (!guestDirty.current) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [guest]);

  // ---------- keyboard + menus ----------
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.menu-anchor')) setMenu(null);
    };
    const key = async (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (guest) return flash('Gastmodus: nichts wird gespeichert. Sichern über „Exportieren“.');
        const p = projectRef.current;
        if (p) {
          const at = await saveProject(p);
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
  const savedLabel = guest
    ? 'Nicht gespeichert'
    : saveState.s === 'saving' ? 'Speichert…' : saveState.s === 'error' ? 'Speichern fehlgeschlagen' : saveState.at ? `Gespeichert ${new Date(saveState.at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}` : 'Gespeichert';

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
                {!guest && (
                  <>
                    <button onClick={() => (setMenu(null), createProject(newProject()))}>
                      <Icon name="plus" /> Neues Projekt
                    </button>
                    <button onClick={showProjects}>
                      <Icon name="folder" /> Projekte öffnen… <kbd>alle in SQLite</kbd>
                    </button>
                    <div className="sep" />
                  </>
                )}
                <button onClick={() => (setMenu(null), addFile('compose'))}>
                  <Icon name="whale" /> Neue Compose-Datei
                </button>
                <button onClick={() => (setMenu(null), addFile('k8s'))}>
                  <Icon name="helm" /> Neue Kubernetes-Datei
                </button>
                <button onClick={() => (setMenu(null), addFile('dockerfile'))}><Icon name="box" /> Neue Dockerfile</button>
                <div className="sep" />
                {guest ? (
                  <button onClick={() => (setMenu(null), leaveGuestMode())}>
                    <Icon name="user" /> Anmelden oder Konto erstellen
                  </button>
                ) : (
                  <>
                    <button onClick={() => (setMenu(null), setMarketOpen({}))}>
                      <Icon name="store" /> Marktplatz öffnen
                    </button>
                    <button onClick={() => openPublish()}>
                      <Icon name="share" /> Im Marktplatz veröffentlichen…
                    </button>
                  </>
                )}
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
                <button onClick={() => importFromDisk(['*'], true)}><Icon name="box" /> Dockerfile öffnen…</button>
                <button onClick={() => (setMenu(null), setDialog({ kind: 'paste-dockerfile' }))}><Icon name="code" /> Dockerfile einfügen…</button>
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
                  <Icon name="file" /> {active?.name ?? 'Datei'} {active?.kind === 'dockerfile' ? 'exportieren…' : 'als YAML…'}
                </button>
                <button onClick={exportFolder}>
                  <Icon name="folder" /> Alle Dateien in Ordner… <kbd>{project?.activeEnv}</kbd>
                </button>
                <button onClick={showHelmExport}><Icon name="helm" /> Helm-Chart (.tgz)…</button>
                <div className="sep" />
                <button onClick={exportProject}>
                  <Icon name="db" /> Projekt als .byob…
                </button>
                {!guest && (
                  <button onClick={exportBackup}>
                    <Icon name="layers" /> Backup: alles als .byob…
                  </button>
                )}
              </div>
            )}
          </div>
          {!guest && (
            <button className="menu-btn market-btn" onClick={() => setMarketOpen({})} title="Öffentlicher Marktplatz: Blöcke, Dateien und Projekte teilen und laden">
              <Icon name="store" size={14} /> Marktplatz
            </button>
          )}
        </nav>

        <div className="title-center">
          {!guest && (
            <button className="project-switch" onClick={showProjects} title="Projekte">
              <Icon name="folder" size={14} />
            </button>
          )}
          <input className="project-title" value={project?.title ?? ''} onChange={(e) => patch({ title: e.target.value })} spellCheck={false} aria-label="Projektname" />
        </div>

        <div className="title-right">
          {guest && (
            <span className="guest-chip" title="Gastmodus: kein Konto, nichts wird gespeichert, kein Marktplatz. Arbeit über „Exportieren“ sichern.">
              <Icon name="user" size={13} /> Gast
              <button className="link" onClick={leaveGuestMode}>
                Anmelden
              </button>
            </span>
          )}
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
        <Explorer
          key={project?.id ?? ''}
          projectId={project?.id ?? ''}
          files={project?.files ?? []}
          folders={project?.folders ?? []}
          activeId={active?.id ?? ''}
          currentFolder={currentFolder}
          setCurrentFolder={setCurrentFolder}
          onOpen={(id) => (setActiveId(id), setMobileView('canvas'))}
          onUpdate={(files, folders) => patch({ files, folders })}
          onAddFile={addFile}
          onImport={() => importFromDisk(['yaml', 'yml'])}
          onPaste={() => setDialog({ kind: 'paste' })}
          onExport={exportSome}
          flash={flash}
        />

        {/* ================= canvas ================= */}
        <main className="canvas">
          <div className="canvas-head">
            <div className="crumbs">
              <span className="muted">{project?.title}</span>
              <span className="crumb-sep">/</span>
              <span>{active?.folder ? `${active.folder}/${active.name}` : active?.name}</span>
              <span className={`kind-pill kind-${active?.kind}`}>{fileKindLabel(active?.kind)}</span>
            </div>
            <div className="seg graph-mode-switch" role="group" aria-label="Editoransicht">
              <button className={!graphOpen ? 'on' : ''} aria-pressed={!graphOpen} onClick={() => setGraphOpen(false)}><Icon name="layers" size={13} /> Blöcke</button>
              <button className={graphOpen ? 'on' : ''} aria-pressed={graphOpen} onClick={() => setGraphOpen(true)} title="Abhängigkeiten zwischen Services, Ressourcen und Dateien"><Icon name="graph" size={13} /> Graph</button>
            </div>
            <div className="canvas-tools">
              {!graphOpen && <>
              {selCount > 0 && (
                <span className="sel-info" title="Entf löscht · Strg+C kopiert · Strg+D dupliziert · gemeinsam verschieben durch Ziehen · Esc hebt die Auswahl auf">
                  {selCount} {selCount === 1 ? 'Block' : 'Blöcke'} ausgewählt
                  <button className="icon-btn" onClick={() => editor.current?.clearSelection()} title="Auswahl aufheben (Esc)">
                    <Icon name="x" size={12} />
                  </button>
                </span>
              )}
              <div className="seg canvas-mode" role="group" aria-label="Ziehen auf freier Fläche">
                <button onMouseDown={(e) => e.preventDefault()} className={canvasMode === 'select' ? 'on' : ''} onClick={() => setCanvasMode('select')} title="Ziehen auf freier Fläche wählt Blöcke aus (Shift = hinzufügen). Leertaste oder mittlere Maustaste halten = Fläche verschieben.">
                  <Icon name="select" size={13} /> Auswählen
                </button>
                <button onMouseDown={(e) => e.preventDefault()} className={canvasMode === 'pan' ? 'on' : ''} onClick={() => setCanvasMode('pan')} title="Ziehen auf freier Fläche verschiebt die Ansicht. Shift + Klick wählt einzelne Blöcke aus.">
                  <Icon name="hand" size={13} /> Verschieben
                </button>
              </div>
              <button className="btn ghost sm" onClick={() => editor.current?.cleanUp()} title="Stapel untereinander anordnen">
                <Icon name="broom" size={14} /> <span className="btn-label">Anordnen</span>
              </button>
              <button className="btn ghost sm" onClick={() => editor.current?.zoomToFit()} title="Alles sichtbar machen">
                <Icon name="fit" size={14} /> <span className="btn-label">Einpassen</span>
              </button>
              </>}
            </div>
          </div>
          <div className="canvas-body" style={{ display: graphOpen ? 'none' : undefined }}>
            <BlockEditor ref={editor} fileKey={`${project?.id ?? ''}:${active?.id ?? ''}`} vars={vars} userSnippets={snippets} onChange={onChange} onSaveSnippet={onSaveSnippet} onShareSnippet={guest ? undefined : onShareSnippet} mode={canvasMode} onSelectionChange={setSelCount} customLibraryVersion={`${customLibrary.library.revision}:${customLibrary.ready}:${customLibrary.error}`} onDesignCustomBlocks={canManageCustomBlocks && active?.kind !== 'dockerfile' ? (initial) => setDialog({ kind: 'block-designer', initial }) : undefined} />
          </div>
          {graphOpen && project && <div className="canvas-body"><DependencyGraph key={project.id} project={project} activeFileId={active?.id ?? ''} onOpen={(id) => { setActiveId(id); setGraphOpen(false); setMobileView('canvas'); }} /></div>}
        </main>

        {/* ================= inspector ================= */}
        <aside className="inspector">
          <div className="tabs">
            {(
              [
                ['yaml', active?.kind === 'dockerfile' ? 'Dockerfile' : 'YAML'],
                ['vars', 'Variablen'],
                ['problems', 'Probleme'],
                ['snippets', 'Vorlagen'],
              ] as [Tab, string][]
            ).map(([id, label]) => (
              <button key={id} className={`tab ${tab === id ? 'on' : ''}`} onClick={() => setTab(id)}>
                {label}
                {id === 'problems' && result.warnings.length > 0 && <span className="badge warn">{result.warnings.length}</span>}
                {id === 'vars' && project && variableCount > 0 && <span className="badge">{variableCount}</span>}
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
                  disabled={!result.yaml || result.blocked}
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(activeYaml());
                      flash(active?.kind === 'dockerfile' ? 'Dockerfile kopiert' : 'YAML kopiert');
                    } catch (e) { flash(e instanceof Error ? e.message : 'YAML konnte nicht kopiert werden.'); }
                  }}
                >
                  <Icon name="copy" size={14} /> Kopieren
                </button>
                <button className="btn ghost sm" disabled={!result.yaml || result.blocked} onClick={saveYaml}>
                  <Icon name="download" size={14} /> Speichern
                </button>
              </div>
              {project?.secretVault && <div className="vault-notice">{vault.unlocked ? 'Secret-Werte sind in der Vorschau verdeckt. Kopieren und Speichern enthalten die echten Werte.' : 'Secret-Tresor gesperrt. Zum Kopieren oder Speichern von YAML zuerst entsperren.'} <button onClick={() => setTab('vars')}>Zum Tresor</button></div>}
              {result.blocked && <div className="vault-notice" role="alert">{active?.kind === 'dockerfile' ? 'Dockerfile enthält ungültige Anweisungen. Export ist gesperrt.' : 'Ein eigener Block ist noch nicht gültig. YAML-Export ist gesperrt.'} <button onClick={() => setTab('problems')}>Probleme anzeigen</button></div>}
              {active?.kind === 'dockerfile' && <div className="dockerfile-notice">Blöcke werden von oben nach unten ausgeführt. Geprüft werden Struktur und Eingaben, kein Image-Build. <code>docker build -t mein-image -f '{joinPath(active.folder ?? '', active.name).replace(/'/g, `'"'"'`)}' .</code>Der Punkt ist der Build-Kontext mit deinen Quelldateien. Secrets über den Build-Secret-Block bereitstellen.</div>}
              <div className="yaml-scroll">
                {active?.kind === 'dockerfile' ? <DockerfileView source={result.yaml} /> : <YamlView yaml={result.yaml} />}
              </div>
            </>
          )}
          {tab === 'vars' && project && <VariablesPanel project={project} activeFile={active} onChange={patch} flash={flash} vault={vault} />}
          {tab === 'problems' && <ProblemsPanel warnings={result.warnings} onSelect={(id) => editor.current?.select(id)} />}
          {tab === 'snippets' && <SnippetsPanel snippets={snippets} onRename={renameSnippet} onDelete={deleteSnippet} onShare={guest ? undefined : shareMySnippet} onMarket={guest ? undefined : () => setMarketOpen({})} />}
        </aside>
      </div>

      {dialog?.kind === 'helm' && <HelmExport project={dialog.project} activeFileId={dialog.activeFileId} onClose={() => setDialog(null)} onOpen={(id) => { setActiveId(id); setGraphOpen(false); setMobileView('canvas'); }} flash={flash} />}

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
        {!guest && (
          <button onClick={() => setMarketOpen({})}>
            <Icon name="store" size={18} />
            <span>Markt</span>
          </button>
        )}
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
            <span>Dockerfile / .yaml / .yml → Blöcke · .byob → Projekte & Vorlagen</span>
          </div>
        </div>
      )}

      {marketOpen && !guest && (
        <MarketDialog
          initialId={marketOpen.initialId}
          activeKind={active?.kind}
          onClose={() => setMarketOpen(null)}
          onUse={useMarketItem}
          onPublish={(edit) => openPublish(edit)}
          flash={flash}
          reloadKey={marketReload}
        />
      )}
      {publish && !guest && (
        <PublishDialog
          sources={publish.sources}
          edit={publish.edit}
          flash={flash}
          onClose={() => setPublish(null)}
          onDone={(item, view) => {
            setPublish(null);
            setMarketReload((n) => n + 1);
            if (view) setMarketOpen({ initialId: item.id });
          }}
        />
      )}

      {toast && <div className="toast">{toast}</div>}

      {dialog?.kind === 'block-designer' && canManageCustomBlocks && <CustomBlockDesigner controller={customLibrary} initial={dialog.initial} kind={active?.kind === 'compose' ? 'compose' : 'k8s'} onClose={() => setDialog(null)} flash={flash} />}
      {dialog?.kind === 'help' && <HelpDialog onClose={() => setDialog(null)} />}
      {dialog?.kind === 'report' && <ReportDialog entries={dialog.entries} onClose={() => setDialog(null)} />}
      {(dialog?.kind === 'paste' || dialog?.kind === 'paste-dockerfile') && (
        <PasteDialog
          format={dialog.kind === 'paste-dockerfile' ? 'dockerfile' : 'yaml'}
          onDone={(r) => {
            setDialog(null);
            if (r) importTexts([{ name: r.name, content: r.text }], dialog?.kind === 'paste-dockerfile');
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
