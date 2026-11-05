// File explorer: folder tree, multi-select (Strg/Shift-Klick or select mode) and batch actions.
import { DragEvent, KeyboardEvent, MouseEvent, useEffect, useMemo, useRef, useState } from 'react';
import { baseName, cleanFolder, isInside, joinPath, normalizeFolders, parentOf, withParents } from '../folders';
import { FileKind, ProjectFile, uid, uniqueName } from '../project';
import { Icon } from './Icons';
import { isGuest } from '../storage';

interface Props {
  projectId: string;
  files: ProjectFile[];
  folders: string[];
  activeId: string;
  /** folder new files and imports go into */
  currentFolder: string;
  setCurrentFolder: (f: string) => void;
  onOpen: (id: string) => void;
  /** replace files + folders in one step */
  onUpdate: (files: ProjectFile[], folders: string[]) => void;
  onAddFile: (kind: FileKind) => void;
  onImport: () => void;
  onPaste: () => void;
  onExport: (files: ProjectFile[]) => void;
  flash: (msg: string) => void;
}

type Row = { type: 'folder'; path: string; depth: number; count: number; open: boolean } | { type: 'file'; file: ProjectFile; depth: number };

const DND = 'application/x-byob-explorer';
const byName = (a: string, b: string) => a.localeCompare(b, 'de', { sensitivity: 'base', numeric: true });
const sameFolder = (f: ProjectFile, folder: string) => (f.folder ?? '') === folder;

const folderStateKey = (projectId: string) => `byobyaml.v2.explorer.${projectId}`;
function loadCollapsed(projectId: string): Set<string> {
  try {
    if (isGuest()) return new Set();
    const saved: unknown = JSON.parse(localStorage.getItem(folderStateKey(projectId)) ?? '[]');
    return new Set(Array.isArray(saved) ? saved.filter((path): path is string => typeof path === 'string' && !!path) : []);
  } catch {
    return new Set();
  }
}

export default function Explorer(p: Props) {
  const { files, folders, activeId, currentFolder } = p;
  const [collapsed, setCollapsedState] = useState(() => loadCollapsed(p.projectId));
  const collapsedRef = useRef(collapsed);
  const setCollapsed = (update: (current: Set<string>) => Set<string>) => {
    const next = update(collapsedRef.current);
    if (next === collapsedRef.current) return;
    collapsedRef.current = next;
    setCollapsedState(next);
    try {
      // Write immediately so a reload right after a click keeps the new state (guests: nothing persisted).
      if (isGuest()) return;
      localStorage.setItem(folderStateKey(p.projectId), JSON.stringify([...next]));
    } catch {
      // Keep the explorer usable when browser storage is unavailable.
    }
  };
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [renaming, setRenaming] = useState<{ kind: 'file' | 'folder'; id: string } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  // forget selected files that no longer exist
  useEffect(() => {
    setSelected((s) => {
      const ids = new Set(files.map((f) => f.id));
      const next = new Set([...s].filter((id) => ids.has(id)));
      return next.size === s.size ? s : next;
    });
  }, [files]);

  // Reveal newly selected files, but respect saved folders when opening a project.
  const active = files.find((f) => f.id === activeId);
  const previousActiveId = useRef(activeId);
  useEffect(() => {
    if (previousActiveId.current === activeId) return;
    previousActiveId.current = activeId;
    const f = active?.folder;
    if (!f) return;
    setCollapsed((c) => {
      const open = withParents(f).filter((x) => c.has(x));
      if (!open.length) return c;
      const n = new Set(c);
      open.forEach((x) => n.delete(x));
      return n;
    });
  }, [active?.id, active?.folder]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- tree rows in display order ----------
  const rows = useMemo(() => {
    const out: Row[] = [];
    const allFolders = normalizeFolders(folders, files.map((f) => f.folder ?? ''));
    const countIn = (path: string) => files.filter((f) => isInside(f.folder ?? '', path)).length;
    const walk = (parent: string, depth: number) => {
      for (const path of allFolders.filter((x) => parentOf(x) === parent).sort((a, b) => byName(baseName(a), baseName(b)))) {
        const open = !collapsed.has(path);
        out.push({ type: 'folder', path, depth, count: countIn(path), open });
        if (open) walk(path, depth + 1);
      }
      for (const f of files.filter((x) => sameFolder(x, parent))) out.push({ type: 'file', file: f, depth });
    };
    walk('', 0);
    return out;
  }, [files, folders, collapsed]);
  const visibleFiles = rows.filter((r): r is Extract<Row, { type: 'file' }> => r.type === 'file').map((r) => r.file);
  const selectedFiles = files.filter((f) => selected.has(f.id));
  const allFolders = useMemo(() => normalizeFolders(folders, files.map((f) => f.folder ?? '')), [folders, files]);

  // ---------- selection ----------
  const clearSel = () => {
    setSelected(new Set());
    setAnchor(null);
  };
  const clickFile = (e: MouseEvent, f: ProjectFile) => {
    const toggle = e.ctrlKey || e.metaKey || selectMode;
    if (e.shiftKey && anchor) {
      const a = visibleFiles.findIndex((x) => x.id === anchor);
      const b = visibleFiles.findIndex((x) => x.id === f.id);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        setSelected(new Set([...(toggle ? selected : []), ...visibleFiles.slice(lo, hi + 1).map((x) => x.id)]));
        return;
      }
    }
    if (toggle) {
      const n = new Set(selected);
      if (n.has(f.id)) n.delete(f.id);
      else n.add(f.id);
      setSelected(n);
      setAnchor(f.id);
      return;
    }
    clearSel();
    setAnchor(f.id);
    p.setCurrentFolder(f.folder ?? '');
    p.onOpen(f.id);
  };
  const clickFolder = (e: MouseEvent, path: string) => {
    if (e.ctrlKey || e.metaKey || selectMode) {
      // select all files inside
      const ids = files.filter((f) => isInside(f.folder ?? '', path)).map((f) => f.id);
      const all = ids.every((id) => selected.has(id));
      const n = new Set(selected);
      ids.forEach((id) => (all ? n.delete(id) : n.add(id)));
      setSelected(n);
      return;
    }
    p.setCurrentFolder(path);
    setCollapsed((c) => {
      const n = new Set(c);
      if (n.has(path)) n.delete(path);
      else n.add(path);
      return n;
    });
  };

  // ---------- mutations ----------
  const keepFolders = (fl: string[]) => normalizeFolders(fl, []);

  const moveFiles = (ids: string[], target: string) => {
    const moving = new Set(ids);
    const names = (folder: string, except: Set<string>) => files.filter((f) => sameFolder(f, folder) && !except.has(f.id)).map((f) => f.name);
    const taken = names(target, moving);
    let n = 0;
    const next = files.map((f) => {
      if (!moving.has(f.id) || sameFolder(f, target)) return f;
      n++;
      const name = uniqueName(f.name, taken);
      taken.push(name);
      const { folder: _old, ...rest } = f;
      return target ? { ...rest, name, folder: target } : { ...rest, name };
    });
    if (!n) return;
    p.onUpdate(next, keepFolders([...folders, target]));
    if (target) setCollapsed((c) => new Set([...c].filter((x) => !isInside(target, x))));
    p.flash(`${n} ${n === 1 ? 'Datei' : 'Dateien'} → ${target || 'oberste Ebene'}`);
  };

  const moveFolder = (src: string, targetParent: string) => {
    if (isInside(targetParent, src)) return p.flash('Ein Ordner kann nicht in sich selbst verschoben werden.');
    const dest = joinPath(targetParent, baseName(src));
    if (dest === src) return;
    if (allFolders.includes(dest)) return p.flash(`„${dest}“ gibt es schon.`);
    const re = (x: string) => (isInside(x, src) ? dest + x.slice(src.length) : x);
    p.onUpdate(
      files.map((f) => (f.folder && isInside(f.folder, src) ? { ...f, folder: re(f.folder) } : f)),
      keepFolders(folders.map(re)),
    );
    setCollapsed((c) => new Set([...c].map(re)));
    if (isInside(currentFolder, src)) p.setCurrentFolder(re(currentFolder));
  };

  const newFolder = () => {
    const base = 'Neuer Ordner';
    let name = joinPath(currentFolder, base);
    for (let i = 2; allFolders.includes(name); i++) name = joinPath(currentFolder, `${base} ${i}`);
    p.onUpdate(files, keepFolders([...folders, name]));
    setCollapsed((c) => new Set([...c].filter((x) => !isInside(name, x))));
    setRenaming({ kind: 'folder', id: name });
  };

  const renameFolder = (path: string, raw: string) => {
    setRenaming(null);
    const name = cleanFolder(raw).replace(/\//g, '-');
    if (!name || name === baseName(path)) return;
    const dest = joinPath(parentOf(path), name);
    if (allFolders.includes(dest)) return p.flash(`„${dest}“ gibt es schon.`);
    const re = (x: string) => (isInside(x, path) ? dest + x.slice(path.length) : x);
    p.onUpdate(
      files.map((f) => (f.folder && isInside(f.folder, path) ? { ...f, folder: re(f.folder) } : f)),
      keepFolders(folders.map(re)),
    );
    setCollapsed((c) => new Set([...c].map(re)));
    if (isInside(currentFolder, path)) p.setCurrentFolder(re(currentFolder));
  };

  const deleteFolder = (path: string) => {
    const inside = files.filter((f) => isInside(f.folder ?? '', path));
    const parent = parentOf(path);
    const msg = inside.length
      ? `Ordner „${baseName(path)}“ auflösen?\n\nDie ${inside.length} ${inside.length === 1 ? 'Datei darin wird' : 'Dateien darin werden'} nach „${parent || 'oberste Ebene'}“ verschoben. Es wird nichts gelöscht.`
      : `Leeren Ordner „${baseName(path)}“ entfernen?`;
    if (!window.confirm(msg)) return;
    const taken = files.filter((f) => sameFolder(f, parent)).map((f) => f.name);
    const next = files.map((f) => {
      if (!isInside(f.folder ?? '', path)) return f;
      // sub folders keep their structure below the parent
      const rest = (f.folder ?? '').slice(path.length).replace(/^\//, '');
      const folder = joinPath(parent, rest);
      const name = folder === parent ? uniqueName(f.name, taken) : f.name;
      if (folder === parent) taken.push(name);
      const { folder: _old, ...plain } = f;
      return folder ? { ...plain, name, folder } : { ...plain, name };
    });
    const re = (x: string) => (isInside(x, path) ? joinPath(parent, x.slice(path.length).replace(/^\//, '')) : x);
    p.onUpdate(next, keepFolders(folders.filter((x) => x !== path).map(re).filter(Boolean)));
    setCollapsed((c) => new Set([...c].filter((x) => x !== path).map(re)));
    if (isInside(currentFolder, path)) p.setCurrentFolder(parent);
  };

  const renameFile = (id: string, raw: string) => {
    setRenaming(null);
    const f = files.find((x) => x.id === id);
    const name = raw.trim().replace(/[\\/]/g, '-');
    if (!f || !name || name === f.name) return;
    const taken = files.filter((x) => sameFolder(x, f.folder ?? '') && x.id !== id).map((x) => x.name);
    if (taken.includes(name)) return p.flash(`„${name}“ gibt es in diesem Ordner schon.`);
    p.onUpdate(
      files.map((x) => (x.id === id ? { ...x, name } : x)),
      folders,
    );
  };

  const duplicate = (list: ProjectFile[]) => {
    const dup = new Set(list.map((f) => f.id));
    const taken = (folder: string) => files.filter((x) => sameFolder(x, folder)).map((x) => x.name);
    const used = new Map<string, string[]>();
    const out: ProjectFile[] = [];
    const copies: ProjectFile[] = [];
    for (const f of files) {
      out.push(f);
      if (!dup.has(f.id)) continue;
      const folder = f.folder ?? '';
      if (!used.has(folder)) used.set(folder, taken(folder));
      const names = used.get(folder)!;
      const copy: ProjectFile = { ...structuredClone(f), id: uid(), name: uniqueName(f.name.replace(/(\.ya?ml)?$/, '-kopie$1'), names) };
      names.push(copy.name);
      out.push(copy);
      copies.push(copy);
    }
    p.onUpdate(out, folders);
    setSelected(new Set(copies.map((c) => c.id)));
    p.flash(`${copies.length} ${copies.length === 1 ? 'Kopie' : 'Kopien'} angelegt`);
  };

  const remove = (list: ProjectFile[]) => {
    if (!list.length) return;
    if (list.length >= files.length) return p.flash('Mindestens eine Datei muss im Projekt bleiben.');
    const names = list.slice(0, 5).map((f) => `• ${joinPath(f.folder ?? '', f.name)}`).join('\n');
    const more = list.length > 5 ? `\n… und ${list.length - 5} weitere` : '';
    if (!window.confirm(list.length === 1 ? `„${list[0].name}“ löschen?` : `${list.length} Dateien löschen?\n\n${names}${more}`)) return;
    const ids = new Set(list.map((f) => f.id));
    const rest = files.filter((f) => !ids.has(f.id));
    p.onUpdate(rest, folders);
    if (ids.has(activeId)) p.onOpen(rest[0].id);
    clearSel();
    p.flash(list.length === 1 ? 'Datei gelöscht' : `${list.length} Dateien gelöscht`);
  };

  // ---------- drag & drop (files and folders) ----------
  const startDrag = (e: DragEvent, payload: { files?: string[]; folder?: string }) => {
    e.dataTransfer.setData(DND, JSON.stringify(payload));
    e.dataTransfer.effectAllowed = 'move';
    setDragging(true);
  };
  const dragFile = (e: DragEvent, f: ProjectFile) => {
    const ids = selected.has(f.id) ? [...selected] : [f.id];
    startDrag(e, { files: ids });
    if (ids.length > 1) {
      const ghost = document.createElement('div');
      ghost.className = 'ex-drag-ghost';
      ghost.textContent = `${ids.length} Dateien`;
      document.body.appendChild(ghost);
      e.dataTransfer.setDragImage(ghost, 10, 10);
      setTimeout(() => ghost.remove(), 0);
    }
  };
  const over = (e: DragEvent, target: string) => {
    if (!e.dataTransfer.types.includes(DND)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    if (dropTarget !== target) setDropTarget(target);
  };
  const drop = (e: DragEvent, target: string) => {
    if (!e.dataTransfer.types.includes(DND)) return;
    e.preventDefault();
    e.stopPropagation();
    setDropTarget(null);
    setDragging(false);
    try {
      const d = JSON.parse(e.dataTransfer.getData(DND));
      if (d.folder !== undefined) moveFolder(d.folder, target);
      else if (Array.isArray(d.files)) moveFiles(d.files, target);
    } catch {
      /* ignore */
    }
  };
  const endDrag = () => {
    setDragging(false);
    setDropTarget(null);
  };

  // ---------- keyboard ----------
  const onKey = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      setSelected(new Set(visibleFiles.map((f) => f.id)));
    } else if (e.key === 'Escape') {
      clearSel();
      setSelectMode(false);
    } else if (e.key === 'Delete' && selectedFiles.length) {
      e.preventDefault();
      remove(selectedFiles);
    } else if (e.key === 'F2' && active) {
      e.preventDefault();
      setRenaming({ kind: 'file', id: active.id });
    }
  };

  const showChecks = selectMode || selected.size > 0;
  const pad = (depth: number) => ({ paddingLeft: 8 + depth * 14 });

  return (
    <aside className="explorer" onKeyDown={onKey}>
      <div className="pane-head">
        <span>Dateien</span>
        <div className="pane-actions">
          <button className="icon-btn" title="Neue Compose-Datei" onClick={() => p.onAddFile('compose')}>
            <Icon name="whale" />
          </button>
          <button className="icon-btn" title="Neue Kubernetes-Datei" onClick={() => p.onAddFile('k8s')}>
            <Icon name="helm" />
          </button>
          <button className="icon-btn" title="Neue Dockerfile" onClick={() => p.onAddFile('dockerfile')}><Icon name="box" /></button>
          <button className="icon-btn" title={`Neuer Ordner${currentFolder ? ` in „${baseName(currentFolder)}“` : ''}`} onClick={newFolder}>
            <Icon name="folderPlus" />
          </button>
          <button className="icon-btn" title="YAML importieren" onClick={p.onImport}>
            <Icon name="upload" />
          </button>
          <button className={`icon-btn ${selectMode ? 'on' : ''}`} title="Mehrere Dateien auswählen (oder Strg/Shift + Klick)" aria-pressed={selectMode} onClick={() => (selectMode ? (setSelectMode(false), clearSel()) : setSelectMode(true))}>
            <Icon name="checks" />
          </button>
        </div>
      </div>

      {showChecks && (
        <div className="ex-batch" role="toolbar" aria-label="Ausgewählte Dateien">
          <div className="ex-batch-top">
            <button className="ex-check-all" onClick={() => (selected.size === visibleFiles.length ? clearSel() : setSelected(new Set(visibleFiles.map((f) => f.id))))} title="Alle auswählen (Strg+A)">
              <span className={`ex-check ${selected.size && selected.size === visibleFiles.length ? 'on' : selected.size ? 'some' : ''}`} />
            </button>
            <span className="ex-batch-count">{selected.size ? `${selected.size} ausgewählt` : 'Dateien antippen zum Auswählen'}</span>
            <button className="icon-btn" title="Auswahl beenden (Esc)" onClick={() => (clearSel(), setSelectMode(false))}>
              <Icon name="x" size={13} />
            </button>
          </div>
          <div className="ex-batch-actions">
            <div className="menu-anchor ex-move">
              <button className="btn sm" disabled={!selected.size} onClick={() => setMoveOpen((o) => !o)}>
                <Icon name="folder" size={13} /> Verschieben
              </button>
              {moveOpen && selected.size > 0 && (
                <div className="dropdown ex-move-menu" onMouseLeave={() => setMoveOpen(false)}>
                  <button onClick={() => (setMoveOpen(false), moveFiles([...selected], ''))}>
                    <Icon name="folder" /> oberste Ebene
                  </button>
                  {allFolders.map((f) => (
                    <button key={f} onClick={() => (setMoveOpen(false), moveFiles([...selected], f))} style={{ paddingLeft: 10 + (f.split('/').length - 1) * 12 }}>
                      <Icon name="folder" /> {baseName(f)}
                    </button>
                  ))}
                  <div className="sep" />
                  <button
                    onClick={() => {
                      setMoveOpen(false);
                      const raw = window.prompt('Name des neuen Ordners', 'Neuer Ordner');
                      const name = cleanFolder(raw ?? '');
                      if (name) moveFiles([...selected], joinPath(currentFolder, name));
                    }}
                  >
                    <Icon name="folderPlus" /> Neuer Ordner…
                  </button>
                </div>
              )}
            </div>
            <button className="btn sm" disabled={!selected.size} onClick={() => duplicate(selectedFiles)} title="Duplizieren">
              <Icon name="dup" size={13} />
            </button>
            <button className="btn sm" disabled={!selected.size} onClick={() => p.onExport(selectedFiles)} title="Als YAML exportieren">
              <Icon name="download" size={13} />
            </button>
            <button className="btn sm danger" disabled={!selected.size} onClick={() => remove(selectedFiles)} title="Löschen (Entf)">
              <Icon name="trash" size={13} />
            </button>
          </div>
        </div>
      )}

      <div
        ref={listRef}
        className={`file-tree ${dragging ? 'dragging' : ''} ${dropTarget === '' ? 'drop-root' : ''}`}
        tabIndex={-1}
        onDragOver={(e) => over(e, '')}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setDropTarget(null);
        }}
        onDrop={(e) => drop(e, '')}
      >
        <ul className="file-list" role="tree">
          {rows.map((r) =>
            r.type === 'folder' ? (
              <li
                key={`d:${r.path}`}
                role="treeitem"
                aria-expanded={r.open}
                className={`folder-row ${currentFolder === r.path ? 'current' : ''} ${dropTarget === r.path ? 'drop' : ''}`}
                style={pad(r.depth)}
                draggable={renaming?.id !== r.path}
                onDragStart={(e) => startDrag(e, { folder: r.path })}
                onDragEnd={endDrag}
                onDragOver={(e) => over(e, r.path)}
                onDrop={(e) => drop(e, r.path)}
                onClick={(e) => clickFolder(e, r.path)}
                onDoubleClick={() => setRenaming({ kind: 'folder', id: r.path })}
              >
                <span className={`chev ${r.open ? 'open' : ''}`}>
                  <Icon name="chevron" size={12} />
                </span>
                <Icon name="folder" size={14} className="folder-ico" />
                {renaming?.kind === 'folder' && renaming.id === r.path ? (
                  <RenameInput value={baseName(r.path)} onDone={(v) => (v === null ? setRenaming(null) : renameFolder(r.path, v))} />
                ) : (
                  <span className="fname" title={r.path}>
                    {baseName(r.path)}
                  </span>
                )}
                <span className="folder-count">{r.count}</span>
                <span className="row-actions">
                  <button className="icon-btn" title="Umbenennen" onClick={(e) => (e.stopPropagation(), setRenaming({ kind: 'folder', id: r.path }))}>
                    <Icon name="edit" size={13} />
                  </button>
                  <button className="icon-btn danger" title="Ordner auflösen" onClick={(e) => (e.stopPropagation(), deleteFolder(r.path))}>
                    <Icon name="trash" size={13} />
                  </button>
                </span>
              </li>
            ) : (
              <li
                key={r.file.id}
                role="treeitem"
                aria-selected={selected.has(r.file.id)}
                className={`${r.file.id === activeId ? 'active' : ''} ${selected.has(r.file.id) ? 'selected' : ''}`}
                style={pad(r.depth)}
                draggable={renaming?.id !== r.file.id}
                onDragStart={(e) => dragFile(e, r.file)}
                onDragEnd={endDrag}
                onDragOver={(e) => over(e, r.file.folder ?? '')}
                onDrop={(e) => drop(e, r.file.folder ?? '')}
                onClick={(e) => clickFile(e, r.file)}
                onDoubleClick={() => !showChecks && setRenaming({ kind: 'file', id: r.file.id })}
              >
                {showChecks ? <span className={`ex-check ${selected.has(r.file.id) ? 'on' : ''}`} /> : <span className="chev-space" />}
                <span className={`kind kind-${r.file.kind}`}>{r.file.kind === 'dockerfile' ? 'DF' : r.file.kind === 'compose' ? 'DC' : 'K8'}</span>
                {renaming?.kind === 'file' && renaming.id === r.file.id ? (
                  <RenameInput value={r.file.name} onDone={(v) => (v === null ? setRenaming(null) : renameFile(r.file.id, v))} />
                ) : (
                  <span className="fname" title={joinPath(r.file.folder ?? '', r.file.name)}>
                    {r.file.name}
                  </span>
                )}
                {!showChecks && (
                  <span className="row-actions">
                    <button className="icon-btn" title="Umbenennen (F2)" onClick={(e) => (e.stopPropagation(), setRenaming({ kind: 'file', id: r.file.id }))}>
                      <Icon name="edit" size={13} />
                    </button>
                    <button className="icon-btn" title="Duplizieren" onClick={(e) => (e.stopPropagation(), duplicate([r.file]))}>
                      <Icon name="dup" size={13} />
                    </button>
                    <button className="icon-btn danger" title="Löschen" onClick={(e) => (e.stopPropagation(), remove([r.file]))}>
                      <Icon name="trash" size={13} />
                    </button>
                  </span>
                )}
              </li>
            ),
          )}
        </ul>
        {dragging && (
          <div className={`ex-root-drop ${dropTarget === '' ? 'on' : ''}`} onDragOver={(e) => over(e, '')} onDrop={(e) => drop(e, '')}>
            Hierher ziehen: oberste Ebene
          </div>
        )}
      </div>
      <div className="explorer-foot">
        <button className="btn ghost block" onClick={p.onPaste}>
          <Icon name="code" size={14} /> YAML einfügen
        </button>
      </div>
    </aside>
  );
}

function RenameInput({ value, onDone }: { value: string; onDone: (v: string | null) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    // select the name without extension
    const dot = value.lastIndexOf('.');
    el.setSelectionRange(0, dot > 0 ? dot : value.length);
  }, [value]);
  const finish = (v: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(v);
  };
  return (
    <input
      ref={ref}
      className="rename"
      defaultValue={value}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onBlur={(e) => finish(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') finish((e.target as HTMLInputElement).value);
        if (e.key === 'Escape') finish(null);
      }}
    />
  );
}
