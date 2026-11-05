import { useEffect, useMemo, useRef, useState } from 'react';
import * as Blockly from 'blockly/core';
import { buildTheme, FIXED_FLYOUT, registerBlocks } from '../blocks/register';
import { CATEGORIES } from '../blocks/types';
import { CUSTOM_BLOCK, designerBlocks, makeParameter, normalizeDefinition, walkRecipe, type CustomBlockDefinition, type CustomParameter, type RecipeNode } from '../custom-blocks/model';
import { newDefinition } from '../custom-blocks/presets';
import { customValidation } from '../custom-blocks/runtime';
import type { CustomLibraryController } from '../custom-blocks/useLibrary';
import { openTexts, saveText } from '../storage';
import { Modal } from './Dialogs';
import { Icon } from './Icons';
import '../styles/custom-blocks.css';

const toolbox = (kind: 'compose' | 'k8s') => ({ kind: 'categoryToolbox', contents: CATEGORIES.map((category) => ({ category, blocks: designerBlocks.filter((block) => block.cat === category.id && (kind === 'compose' ? ['compose','service'].includes(block.cat) : !['compose','service'].includes(block.cat))) })).filter((entry) => entry.blocks.length).map(({ category, blocks }) => ({ kind: 'category', name: category.name, categorystyle: category.id, contents: blocks.map((block) => ({ kind: 'block', type: block.type })) })) });
const titleFor = (type: string) => designerBlocks.find((block) => block.type === type)?.msg.replace(/%\d+/g, '').replace(/\s+/g, ' ').trim() || type;
const toField = (value: any) => typeof value === 'boolean' ? value ? 'TRUE' : 'FALSE' : String(value ?? '');

export default function CustomBlockDesigner({ controller, initial, kind, onClose, flash }: { controller: CustomLibraryController; initial?: CustomBlockDefinition; kind: 'compose' | 'k8s'; onClose: () => void; flash: (message: string) => void }) {
  const first = useRef(initial ? controller.library.blocks.find((block) => block.id === initial.id) ?? { ...initial, id: crypto.randomUUID(), revision: 0, archived: false } : newDefinition(kind));
  const [draft, setDraft] = useState<CustomBlockDefinition>(() => structuredClone(first.current));
  const [source, setSource] = useState<any>(() => ({ blocks: { languageVersion: 0, blocks: [first.current.root] } }));
  const [selectedId, setSelectedId] = useState(first.current.root.id);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [dirty, setDirty] = useState(false);
  const [loadVersion, setLoadVersion] = useState(0);
  const editorHost = useRef<HTMLDivElement>(null), previewHost = useRef<HTMLDivElement>(null);
  const editor = useRef<Blockly.WorkspaceSvg | null>(null), preview = useRef<Blockly.WorkspaceSvg | null>(null);
  const suppress = useRef(false), draftRef = useRef(draft);
  draftRef.current = draft;
  const current = useMemo(() => {
    const roots = source.blocks?.blocks ?? [];
    if (roots.length !== 1) return null;
    try {
      const ids = new Set(walkRecipe(roots[0]).map((node) => node.id));
      const bindings = draft.bindings.filter((binding) => ids.has(binding.blockId));
      return { ...draft, root: roots[0], bindings, parameters: draft.parameters.filter((parameter) => bindings.some((binding) => binding.parameterId === parameter.id)) };
    } catch { return null; }
  }, [draft, source]);
  const checked = useMemo(() => current ? customValidation()?.validateDefinition(current) ?? { definition: null, issues: [{ message: 'Die Schema-Prüfung wird geladen.' }], yaml: '', hint: '' } : { definition: null, issues: [{ message: 'Verbinde die Bausteine zu genau einem zusammenhängenden Block.' }], yaml: '', hint: '' }, [current, controller.ready]);
  const duplicate = controller.library.blocks.some((block) => block.id !== draft.id && !block.archived && block.kind === draft.kind && block.name.toLocaleLowerCase('de') === draft.name.trim().toLocaleLowerCase('de'));
  const issues = duplicate ? [...checked.issues, { message: 'Dieser Name ist bereits vergeben.' }] : checked.issues;
  const nodes = useMemo(() => { try { return (source.blocks?.blocks ?? []).flatMap((root: RecipeNode) => walkRecipe(root)); } catch { return []; } }, [source]);
  const selected = nodes.find((node: RecipeNode) => node.id === selectedId) as RecipeNode | undefined;
  const selectedSpec = designerBlocks.find((block) => block.type === selected?.type);

  const load = (definition: CustomBlockDefinition) => {
    setDraft(structuredClone(definition)); setSource({ blocks: { languageVersion: 0, blocks: [structuredClone(definition.root)] } }); setSelectedId(definition.root.id); setDirty(false); setError(''); setLoadVersion((version) => version + 1);
  };
  const changeDraft = (patch: Partial<CustomBlockDefinition>) => { setDraft((value) => ({ ...value, ...patch })); setDirty(true); };
  const close = () => { if (!busy && (!dirty || window.confirm('Ungespeicherte Änderungen am Blocktyp verwerfen?'))) onClose(); };
  const publishWorkspace = () => { if (editor.current && !suppress.current) { setSource(Blockly.serialization.workspaces.save(editor.current)); setDirty(true); } };

  useEffect(() => {
    registerBlocks();
    const workspace = Blockly.inject(editorHost.current!, { renderer: 'thrasos', theme: buildTheme(), toolbox: toolbox(first.current.kind), trashcan: true, sounds: false, zoom: { controls: true, wheel: true, startScale: 0.78, minScale: 0.35, maxScale: 1.5 }, move: { scrollbars: true, drag: true, wheel: false }, plugins: { flyoutsVerticalToolbox: FIXED_FLYOUT } });
    const visual = Blockly.inject(previewHost.current!, { renderer: 'thrasos', theme: buildTheme(), readOnly: true, sounds: false, zoom: { startScale: 0.75, minScale: 0.25, maxScale: 1 }, move: { scrollbars: true, drag: true } });
    editor.current = workspace; preview.current = visual;
    let timer: number | undefined;
    workspace.addChangeListener((event) => {
      if (suppress.current) return;
      const detail = event as any;
      if (event.type === 'selected' && detail.newElementId && workspace.getBlockById(detail.newElementId)) setSelectedId(detail.newElementId);
      if (event.isUiEvent) return;
      if (detail.element === 'field' && detail.blockId && detail.name) {
        const binding = draftRef.current.bindings.find((binding) => binding.blockId === detail.blockId && binding.field === detail.name);
        if (binding) {
          const parameter = draftRef.current.parameters.find((p) => p.id === binding.parameterId)!;
          const value = parameter.kind === 'boolean' ? detail.newValue === true || detail.newValue === 'TRUE' : detail.newValue === '__none__' ? '' : detail.newValue;
          setDraft((current) => ({ ...current, parameters: current.parameters.map((p) => p.id === parameter.id ? { ...p, value } : p) }));
          Blockly.Events.disable();
          try { for (const other of draftRef.current.bindings.filter((other) => other.parameterId === parameter.id && (other.blockId !== detail.blockId || other.field !== detail.name))) workspace.getBlockById(other.blockId)?.setFieldValue(toField(value), other.field); }
          finally { Blockly.Events.enable(); }
        }
      }
      window.clearTimeout(timer); timer = window.setTimeout(publishWorkspace, 100);
    });
    const resize = new ResizeObserver(() => { Blockly.svgResize(workspace); Blockly.svgResize(visual); });
    resize.observe(editorHost.current!); resize.observe(previewHost.current!);
    return () => { window.clearTimeout(timer); resize.disconnect(); workspace.dispose(); visual.dispose(); editor.current = null; preview.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!editor.current) return;
    suppress.current = true; Blockly.Events.disable();
    try { editor.current.clear(); editor.current.updateToolbox(toolbox(draft.kind)); Blockly.serialization.workspaces.load(source, editor.current); editor.current.clearUndo(); }
    finally { Blockly.Events.enable(); suppress.current = false; }
    requestAnimationFrame(() => { if (editor.current) { Blockly.svgResize(editor.current); const root = editor.current.getTopBlocks(true)[0]; if (root) editor.current.centerOnBlock(root.id); } });
    // Only explicit load/new actions replace the designer canvas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadVersion]);
  useEffect(() => {
    const workspace = preview.current;
    if (!workspace) return;
    Blockly.Events.disable();
    try {
      workspace.clear();
      if (checked.definition) Blockly.serialization.blocks.append({ type: CUSTOM_BLOCK, extraState: { definition: checked.definition }, x: 12, y: 12 }, workspace);
      workspace.zoomToFit();
    } catch { /* The validation message remains visible for an incomplete draft. */ }
    finally { Blockly.Events.enable(); }
    if (editor.current) for (const block of editor.current.getAllBlocks(false)) block.setWarningText(issues.filter((issue) => 'blockId' in issue && issue.blockId === block.id).map((issue) => issue.message).join('\n') || null);
  }, [checked, issues.length]);

  const updateParameter = (id: string, patch: Partial<CustomParameter>) => {
    setDraft((current) => ({ ...current, parameters: current.parameters.map((parameter) => parameter.id === id ? { ...parameter, ...patch } : parameter) })); setDirty(true);
    if ('value' in patch && editor.current) {
      Blockly.Events.disable();
      try { for (const binding of draft.bindings.filter((binding) => binding.parameterId === id)) editor.current.getBlockById(binding.blockId)?.setFieldValue(toField(patch.value), binding.field); }
      finally { Blockly.Events.enable(); }
      setSource(Blockly.serialization.workspaces.save(editor.current));
    }
  };
  const expose = (field: string, enabled: boolean) => {
    if (!selected || !selectedSpec) return;
    const arg = selectedSpec.args?.find((arg) => arg.name === field); if (!arg) return;
    if (!enabled) { changeDraft({ bindings: draft.bindings.filter((binding) => binding.blockId !== selected.id || binding.field !== field) }); return; }
    const parameter = makeParameter(selected, arg);
    changeDraft({ parameters: [...draft.parameters, parameter], bindings: [...draft.bindings, { blockId: selected.id, field, parameterId: parameter.id }] });
  };
  const save = async (archived = draft.archived) => {
    if (!checked.definition || issues.length) return;
    setBusy(true); setError('');
    try { const saved = await controller.save({ ...checked.definition, archived }); load(saved); flash(archived ? 'Blocktyp archiviert. Bestehende Instanzen bleiben erhalten.' : 'Eigener Blocktyp gespeichert und in der Palette verfügbar.'); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const importType = async () => {
    try { const files = await openTexts(['json'], false); if (!files.length) return; if (files[0].content.length > 80000) throw new Error('Die Blockdefinition ist zu groß.'); const definition = normalizeDefinition(JSON.parse(files[0].content)); if (dirty && !window.confirm('Ungespeicherten Entwurf durch den importierten Block ersetzen?')) return; load({ ...definition, id: crypto.randomUUID(), revision: 0, archived: false }); setDirty(true); }
    catch (e) { setError((e as Error).message); }
  };
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty || busy) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, busy]);

  return <Modal wide title="Eigene Blocktypen" onClose={close} footer={<><span className="foot-hint">{issues.length ? `${issues.length} Punkt(e) vor dem Speichern beheben` : 'Schema und Standardwerte geprüft · kein Cluster-Zugriff'}</span><button className="btn ghost" onClick={close} disabled={busy}>Schließen</button><button className="btn primary" onClick={() => void save(false)} disabled={busy || !controller.ready || !!issues.length}>{busy ? 'Speichert …' : draft.archived ? 'Wiederherstellen' : 'Blocktyp speichern'}</button></>}>
    <div className="custom-designer">
      <div className="custom-library-row"><label>Deine Bibliothek<select className="input" aria-label="Eigene Blockbibliothek" value={controller.library.blocks.some((block) => block.id === draft.id) ? draft.id : ''} onChange={(event) => { const block = controller.library.blocks.find((block) => block.id === event.target.value); if (block && (!dirty || window.confirm('Ungespeicherten Entwurf verwerfen?'))) load(block); }}><option value="">Neuer Blocktyp</option>{controller.library.blocks.map((block) => <option key={block.id} value={block.id}>{block.archived ? 'Archiviert · ' : ''}{block.name} · v{block.revision}</option>)}</select></label><button className="btn sm" disabled={busy} onClick={() => { if (!dirty || window.confirm('Ungespeicherten Entwurf verwerfen?')) load(newDefinition(draft.kind)); }}><Icon name="plus" size={13} /> Neu</button><button className="btn ghost sm" disabled={busy || !current} onClick={() => { if (current) { load({ ...current, id: crypto.randomUUID(), revision: 0, name: `${current.name.slice(0,65)} (Kopie)`, archived: false }); setDirty(true); } }}>Duplizieren</button><button className="icon-btn" title="Blocktyp importieren" disabled={busy} onClick={() => void importType()}><Icon name="upload" size={15} /></button><button className="icon-btn" title="Blocktyp als JSON exportieren" disabled={!!issues.length || !checked.definition} onClick={() => checked.definition && void saveText(`${checked.definition.name.replace(/[^A-Za-z0-9_-]/g,'-')}.block.json`, JSON.stringify(checked.definition,null,2),['json'])}><Icon name="download" size={15} /></button>{draft.revision > 0 && !draft.archived && <button className="btn ghost sm" disabled={busy} onClick={() => void save(true)}>Archivieren</button>}</div>
      <p className="custom-intro">Bausteine kombinieren, einen Baustein anklicken und seine sichtbaren Eingabefelder festlegen. Nur freigegebene Compose-/Kubernetes-Felder sind verfügbar. Bestehende Instanzen behalten beim Bearbeiten ihre gespeicherte Version.</p>
      {(error || controller.error) && <div className="custom-api-error" role="alert">{error || controller.error}<button className="btn ghost sm" onClick={() => { controller.reload().catch((e) => setError(e.message)); }}>Bibliothek neu laden</button></div>}
      <div className="custom-metadata"><label>Blockname<input className="input" aria-label="Name des eigenen Blocks" maxLength={80} value={draft.name} onChange={(event) => changeDraft({ name: event.target.value })} /></label><label>Beschreibung<input className="input" maxLength={600} value={draft.description} onChange={(event) => changeDraft({ description: event.target.value })} /></label><label>Farbe<input type="color" aria-label="Blockfarbe" value={draft.color} onChange={(event) => changeDraft({ color: event.target.value })} /></label></div>
      <div className="custom-start-row"><label>Art<select className="input" aria-label="Blockart" value={draft.kind} onChange={(event) => { if (!dirty || window.confirm('Neue Bausteinstruktur beginnen?')) { const next = newDefinition(event.target.value as 'compose'|'k8s'); load(next); } }}><option value="compose">Docker Compose</option><option value="k8s">Kubernetes</option></select></label><label>Beginnen mit<select className="input" aria-label="Grundbaustein" value={current?.root.type ?? draft.root.type} onChange={(event) => { if (!dirty || window.confirm('Bausteinstruktur durch die neue Vorlage ersetzen?')) { const next = newDefinition(draft.kind,event.target.value); load({ ...next, id: draft.id, revision: draft.revision, name: draft.name, description: draft.description, color: draft.color }); } }}>{CATEGORIES.map((category) => { const blocks = designerBlocks.filter((block) => block.cat === category.id && (draft.kind === 'compose' ? ['compose','service'].includes(block.cat) : !['compose','service'].includes(block.cat))); return blocks.length ? <optgroup key={category.id} label={category.name}>{blocks.map((block) => <option key={block.type} value={block.type}>{titleFor(block.type)}</option>)}</optgroup> : null; })}</select></label><span>Standardwerte müssen gültige Beispiele sein. Im Editor kannst du später <code>{'${VARIABLEN}'}</code> einsetzen.</span></div>
      <div className="custom-main">
        <div className="custom-build"><div className="custom-section-head">Bausteine zusammensetzen</div><div ref={editorHost} className="custom-workspace" aria-label="Baustein-Designer" /></div>
        <aside className="custom-inspector"><div className="custom-section-head">{selectedSpec ? titleFor(selectedSpec.type) : 'Baustein auswählen'}</div><div className="custom-inspector-scroll">
          {!selectedSpec && <p className="custom-intro">Klicke einen Baustein auf der Arbeitsfläche an, um seine Eingabefelder anzupassen.</p>}
          {selectedSpec?.args?.map((arg) => {
            const binding = draft.bindings.find((binding) => binding.blockId === selectedId && binding.field === arg.name), parameter = draft.parameters.find((p) => p.id === binding?.parameterId);
            return <div className="custom-field" key={arg.name}><label className="custom-expose"><input type="checkbox" checked={!!parameter} onChange={(event) => expose(arg.name,event.target.checked)} />{arg.name} als Eingabefeld</label>{parameter && <>
              <label>Beschriftung<input className="input" aria-label={`Beschriftung ${arg.name}`} value={parameter.label} maxLength={60} onChange={(event) => updateParameter(parameter.id,{label:event.target.value})} /></label>
              <label>Standardwert{parameter.kind === 'boolean' ? <select className="input" aria-label={`Standardwert ${arg.name}`} value={String(parameter.value === true || parameter.value === 'TRUE')} onChange={(event) => updateParameter(parameter.id,{value:event.target.value==='true'})}><option value="true">Wahr</option><option value="false">Falsch</option></select> : parameter.kind === 'select' ? <select className="input" aria-label={`Standardwert ${arg.name}`} value={String(parameter.value)} onChange={(event) => updateParameter(parameter.id,{value:event.target.value})}>{parameter.choices?.map((choice) => <option key={choice} value={choice}>{choice || 'Standard'}</option>)}</select> : parameter.kind === 'multiline' ? <textarea className="textarea" aria-label={`Standardwert ${arg.name}`} value={String(parameter.value)} onChange={(event) => updateParameter(parameter.id,{value:event.target.value})} /> : <input className="input" aria-label={`Standardwert ${arg.name}`} value={String(parameter.value)} onChange={(event) => updateParameter(parameter.id,{value:event.target.value})} />}</label>
              <details><summary>Weitere Feldeinstellungen</summary><label>Darstellung<select className="input" value={parameter.kind} onChange={(event) => updateParameter(parameter.id,{kind:event.target.value as CustomParameter['kind'],...(event.target.value==='select'?{choices:[String(parameter.value)]}:{})})}>{(arg.kind==='chk'?['boolean']:arg.kind==='dd'?['select']:arg.kind==='num'?(arg.precision===1?['integer']:['number','integer']):['text','multiline','integer','number','boolean','select']).map((type)=><option key={type} value={type}>{({text:'Text',multiline:'Mehrzeiliger Text',integer:'Ganze Zahl',number:'Zahl',boolean:'Wahr / Falsch',select:'Auswahl'} as any)[type]}</option>)}</select></label>
                {parameter.kind==='select'&&<label>Auswahlwerte (eine Zeile je Wert)<textarea className="textarea" value={parameter.choices?.join('\n')??''} onChange={(event)=>updateParameter(parameter.id,{choices:event.target.value.split('\n')})}/></label>}
                {['integer','number'].includes(parameter.kind)&&<div className="custom-number-limits"><label>Minimum<input className="input" type="number" value={parameter.min??''} onChange={(event)=>updateParameter(parameter.id,{min:event.target.value===''?undefined:Number(event.target.value)})}/></label><label>Maximum<input className="input" type="number" value={parameter.max??''} onChange={(event)=>updateParameter(parameter.id,{max:event.target.value===''?undefined:Number(event.target.value)})}/></label></div>}
                <label className="custom-expose"><input type="checkbox" checked={parameter.required} onChange={(event)=>updateParameter(parameter.id,{required:event.target.checked})}/>Pflichtfeld</label>
                <label>Wert mit anderem Eingabefeld teilen<select className="input" value={parameter.id} onChange={(event)=>changeDraft({bindings:draft.bindings.map((b)=>b.blockId===selectedId&&b.field===arg.name?{...b,parameterId:event.target.value}:b)})}>{draft.parameters.filter((p)=>p.id===parameter.id||current?.parameters.some((used)=>used.id===p.id)).map((p)=><option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
                <div className="custom-field-order"><button className="btn ghost sm" onClick={()=>{const i=draft.parameters.findIndex((p)=>p.id===parameter.id);if(i>0){const list=[...draft.parameters];[list[i-1],list[i]]=[list[i],list[i-1]];changeDraft({parameters:list});}}}>Nach oben</button><button className="btn ghost sm" onClick={()=>{const i=draft.parameters.findIndex((p)=>p.id===parameter.id);if(i>=0&&i<draft.parameters.length-1){const list=[...draft.parameters];[list[i],list[i+1]]=[list[i+1],list[i]];changeDraft({parameters:list});}}}>Nach unten</button></div>
              </details>
            </>}</div>;
          })}
          <div className="custom-section-head">Dein fertiger Block</div><div className="custom-preview" ref={previewHost}/>
          <div className={`custom-validation ${issues.length?'invalid':'valid'}`} role="status"><Icon name={issues.length?'alert':'check'} size={15}/>{issues.length?'Noch nicht verwendbar':'Schema und Standardwerte geprüft'}</div>
          {!!issues.length&&<ul className="custom-issues" role="alert">{issues.slice(0,10).map((issue,index)=><li key={index}>{'blockId'in issue&&issue.blockId?<button onClick={()=>{const block=editor.current?.getBlockById(issue.blockId!);if(block){editor.current?.centerOnBlock(block.id);Blockly.common.setSelected(block as Blockly.BlockSvg);setSelectedId(block.id);}}}>{issue.message}</button>:issue.message}{'path'in issue&&issue.path&&<code>{issue.path}</code>}</li>)}</ul>}
          <details className="custom-yaml"><summary>YAML-Vorschau im Beispielkontext</summary><p>{checked.hint}</p><pre>{checked.yaml}</pre></details>
          <p className="custom-intro">Die Prüfung prüft Struktur, Feldtypen und wichtige Werte. Images, Referenzen und Cluster-Zulassung werden nicht live abgefragt. Passwörter über Variablen einsetzen; Standardwerte werden im Konto und beim Export gespeichert.</p>
        </div></aside>
      </div>
    </div>
  </Modal>;
}
