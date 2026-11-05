// Publish (or edit) a marketplace entry.
import { useEffect, useMemo, useState } from 'react';
import { Icon } from '../components/Icons';
import { Modal } from '../components/Dialogs';
import { market, MARKET_HOST, SAME_ORIGIN } from './api';
import { checkData, findSecrets, ItemData, ItemKind, LIMITS, MarketItem, MarketItemFull, parseTags, ProjectData, FileData, stripVariableValues } from './shared';
import { LoginDialog, plural, TargetPill } from './MarketDialog';
import { useMe } from './useMe';
import type { Snippet } from '../project';
import { fileKindLabel } from '../project';

export interface PublishSources {
  /** block chain from the context menu ("Ab hier im Marktplatz teilen") */
  preset?: { block: any };
  file?: FileData;
  project?: ProjectData;
  snippets: Snippet[];
}

type Source = 'preset' | 'file' | 'project' | 'snippet' | 'keep';

interface Props {
  sources: PublishSources;
  edit?: MarketItemFull;
  onClose: () => void;
  /** view=true: open the entry in the marketplace */
  onDone: (item: MarketItem, view: boolean) => void;
  flash: (msg: string) => void;
}

const stripExt = (s: string) => s.replace(/\.ya?ml$/i, '');

export default function PublishDialog({ sources, edit, onClose, onDone, flash }: Props) {
  const { user, loaded } = useMe();
  const firstSource: Source = edit ? 'keep' : sources.preset ? 'preset' : sources.file ? 'file' : sources.project ? 'project' : 'snippet';
  const [source, setSource] = useState<Source>(firstSource);
  const [snippetId, setSnippetId] = useState(sources.snippets[0]?.id ?? '');
  const [title, setTitle] = useState(edit?.title ?? '');
  const [titleTouched, setTitleTouched] = useState(!!edit);
  const [description, setDescription] = useState(edit?.description ?? '');
  const [tagText, setTagText] = useState(edit?.tags.join(', ') ?? '');
  const [stripVars, setStripVars] = useState(true);
  const [secretOk, setSecretOk] = useState(false);
  const [license, setLicense] = useState(!!edit);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [published, setPublished] = useState<MarketItem | null>(null);
  const [login, setLogin] = useState(false);
  const [suggest, setSuggest] = useState<string[]>([]);

  useEffect(() => {
    market
      .tags()
      .then((t) => setSuggest(t.map((x) => x.tag)))
      .catch(() => {});
  }, []);

  // what would be uploaded
  const payload = useMemo((): { kind: ItemKind; data: ItemData; name: string } | null => {
    if (source === 'keep' && edit) return { kind: edit.kind, data: edit.data, name: edit.title };
    if (source === 'preset' && sources.preset) return { kind: 'snippet', data: { block: sources.preset.block }, name: '' };
    if (source === 'file' && sources.file) return { kind: 'file', data: stripVars ? stripVariableValues(sources.file) : sources.file, name: stripExt(sources.file.name) };
    if (source === 'project' && sources.project) {
      const p = sources.project;
      return { kind: 'project', data: stripVars ? stripVariableValues(p) : p, name: p.title };
    }
    if (source === 'snippet') {
      const s = sources.snippets.find((x) => x.id === snippetId);
      if (s) return { kind: 'snippet', data: { block: s.block }, name: s.name };
    }
    return null;
  }, [source, snippetId, stripVars, sources, edit]);

  // suggest a title from the source until the user types one
  useEffect(() => {
    if (!titleTouched && payload?.name) setTitle(payload.name);
  }, [payload?.name, titleTouched]);

  const check = useMemo(() => {
    if (!payload) return { error: 'Bitte auswählen, was du teilen möchtest.' };
    try {
      return { ok: checkData(payload.kind, payload.data) };
    } catch (e: any) {
      return { error: e.message as string };
    }
  }, [payload]);
  // unchanged content was already confirmed when it was published
  const secrets = useMemo(() => (payload && source !== 'keep' ? findSecrets(payload.data) : []), [payload, source]);
  useEffect(() => setSecretOk(false), [secrets.length, source]);

  const tags = parseTags(tagText);
  const titleLen = title.trim().length;
  const titleOk = titleLen >= LIMITS.title[0] && titleLen <= LIMITS.title[1];
  const canSubmit = !!user && !!check.ok && titleOk && description.length <= LIMITS.description && license && (secrets.length === 0 || secretOk) && !busy;

  const submit = async () => {
    if (!payload) return;
    setBusy(true);
    setErr('');
    try {
      const input = { kind: payload.kind, title: title.trim(), description: description.trim(), tags, data: payload.data };
      const item = edit ? await market.update(edit.id, source === 'keep' ? { title: input.title, description: input.description, tags } : input) : await market.publish(input);
      setPublished(item);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (published)
    return (
      <Modal title={edit ? 'Gespeichert' : 'Veröffentlicht'} onClose={() => onDone(published, false)}>
        <div className="mk-success">
          <span className="ok-mark big">
            <Icon name="check" size={24} />
          </span>
          <p className="empty-title">„{published.title}“ ist {edit ? 'aktualisiert' : 'jetzt öffentlich'}.</p>
          <p className="muted">Alle können es im Marktplatz finden, ansehen und kostenlos laden.</p>
          <div className="mk-success-actions">
            <button
              className="btn"
              onClick={async () => {
                await navigator.clipboard.writeText(market.itemUrl(published.id));
                flash('Link kopiert');
              }}
            >
              <Icon name="link" size={14} /> Link kopieren
            </button>
            <button className="btn primary" onClick={() => onDone(published, true)}>
              <Icon name="store" size={14} /> Im Marktplatz ansehen
            </button>
          </div>
        </div>
      </Modal>
    );

  const SourceCard = ({ id, icon, title: t, sub, disabled }: { id: Source; icon: any; title: string; sub: string; disabled?: boolean }) => (
    <label className={`mk-source ${source === id ? 'on' : ''} ${disabled ? 'off' : ''}`}>
      <input type="radio" name="src" disabled={disabled} checked={source === id} onChange={() => setSource(id)} />
      <Icon name={icon} size={16} />
      <span>
        <b>{t}</b>
        <small>{sub}</small>
      </span>
    </label>
  );

  const blocksIn = (b: any): number => (b && typeof b === 'object' ? (typeof b.type === 'string' ? 1 : 0) + Object.entries(b).reduce((n, [k, v]) => n + (k === 'fields' ? 0 : blocksIn(v)), 0) : 0);

  return (
    <>
      <Modal
        wide
        title={edit ? 'Eintrag bearbeiten' : 'Im Marktplatz veröffentlichen'}
        onClose={onClose}
        footer={
          <>
            <span className="foot-hint">
              <Icon name="globe" size={13} /> Öffentlich auf {MARKET_HOST}
            </span>
            <button className="btn ghost" onClick={onClose}>
              Abbrechen
            </button>
            {user ? (
              <button className="btn primary" disabled={!canSubmit} onClick={submit} title={!license ? 'Bitte die Bedingungen bestätigen' : undefined}>
                <Icon name="share" size={14} /> {busy ? 'Lädt hoch…' : edit ? 'Änderungen speichern' : 'Veröffentlichen'}
              </button>
            ) : (
              <button className="btn primary" disabled={!loaded} onClick={() => setLogin(true)}>
                <Icon name="user" size={14} /> {SAME_ORIGIN ? 'Bitte anmelden' : 'Anmelden zum Veröffentlichen'}
              </button>
            )}
          </>
        }
      >
        <div className="mk-publish">
          <div className="mk-step">
            <div className="mk-step-num">1</div>
            <div className="mk-step-body">
              <div className="mk-step-title">{edit ? 'Inhalt' : 'Was möchtest du teilen?'}</div>
              <div className="mk-sources">
                {edit && <SourceCard id="keep" icon="check" title="Inhalt beibehalten" sub={`Nur Titel, Beschreibung und Tags ändern (v${edit.version})`} />}
                {sources.preset && <SourceCard id="preset" icon="layers" title="Ausgewählte Block-Kombination" sub={`${plural(blocksIn(sources.preset.block), 'Block', 'Blöcke')} ab dem angeklickten Block`} />}
                {sources.file && (!edit || edit.kind === 'file') && <SourceCard id="file" icon="file" title={edit ? 'Durch aktuelle Datei ersetzen' : 'Aktuelle Datei'} sub={`${sources.file.name} · ${fileKindLabel(sources.file.kind)}`} />}
                {sources.project && (!edit || edit.kind === 'project') && <SourceCard id="project" icon="folder" title={edit ? 'Durch aktuelles Projekt ersetzen' : 'Ganzes Projekt'} sub={`${sources.project.title} · ${sources.project.files.length} Dateien`} />}
                {(!edit || edit.kind === 'snippet') && <SourceCard id="snippet" icon="star" title={edit ? 'Durch eine meiner Vorlagen ersetzen' : 'Eine meiner Vorlagen'} sub={sources.snippets.length ? `${sources.snippets.length} eigene Vorlagen` : 'Noch keine eigenen Vorlagen'} disabled={!sources.snippets.length} />}
              </div>
              {source === 'snippet' && sources.snippets.length > 0 && (
                <select className="input" value={snippetId} onChange={(e) => setSnippetId(e.target.value)} aria-label="Vorlage">
                  {sources.snippets.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              )}
              {(source === 'project' || source === 'file') && (
                <label className="mk-check">
                  <input type="checkbox" checked={stripVars} onChange={(e) => setStripVars(e.target.checked)} />
                  <span>
                    Variablenwerte nicht mitschicken <small>Nur die Variablennamen werden geteilt – sicher für Passwörter und Hosts.</small>
                  </span>
                </label>
              )}
              <div className={`mk-check-result ${check.ok ? 'ok' : 'err'}`}>
                {check.ok ? (
                  <>
                    <Icon name="check" size={13} /> {plural(check.ok.blockCount, 'Block', 'Blöcke')}{check.ok.fileCount > 1 ? ` in ${check.ok.fileCount} Dateien` : ''} · <TargetPill target={check.ok.target} /> · {Math.max(1, Math.round(check.ok.bytes / 1000))} KB
                  </>
                ) : (
                  <>
                    <Icon name="alert" size={13} /> {check.error}
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="mk-step">
            <div className="mk-step-num">2</div>
            <div className="mk-step-body">
              <div className="mk-step-title">Beschreiben</div>
              <label className="field">
                <span>
                  Titel <em className={titleOk || !titleLen ? '' : 'bad'}>{titleLen}/{LIMITS.title[1]}</em>
                </span>
                <input
                  className="input"
                  value={title}
                  maxLength={LIMITS.title[1]}
                  placeholder="z. B. PostgreSQL mit Healthcheck und Volume"
                  onChange={(e) => (setTitle(e.target.value), setTitleTouched(true))}
                />
              </label>
              <label className="field">
                <span>
                  Beschreibung <em>{description.length}/{LIMITS.description}</em>
                </span>
                <textarea
                  className="textarea mk-textarea"
                  value={description}
                  maxLength={LIMITS.description}
                  placeholder="Wofür ist das gedacht? Was muss man anpassen (Variablen, Hostnamen, Secrets)?"
                  onChange={(e) => setDescription(e.target.value)}
                />
              </label>
              <label className="field">
                <span>Tags (mit Komma trennen, max. {LIMITS.tags})</span>
                <input className="input" value={tagText} placeholder="postgres, datenbank, healthcheck" onChange={(e) => setTagText(e.target.value)} />
              </label>
              <div className="mk-tag-row">
                {tags.map((t) => (
                  <span key={t} className="mk-tag on static">
                    #{t}
                  </span>
                ))}
                {suggest
                  .filter((s) => !tags.includes(s))
                  .slice(0, tags.length >= LIMITS.tags ? 0 : 8)
                  .map((s) => (
                    <button key={s} className="mk-tag ghost" onClick={() => setTagText(tags.concat(s).join(', '))} title="Tag hinzufügen">
                      +{s}
                    </button>
                  ))}
              </div>
            </div>
          </div>

          <div className="mk-step">
            <div className="mk-step-num">3</div>
            <div className="mk-step-body">
              <div className="mk-step-title">Prüfen</div>
              {secrets.length > 0 && (
                <div className="mk-banner warn col">
                  <div>
                    <Icon name="alert" size={14} /> Sieht nach Passwörtern oder Schlüsseln aus – alle können das sehen:
                  </div>
                  <ul>
                    {secrets.slice(0, 8).map((s, i) => (
                      <li key={i}>
                        <span className="mono">{s.key}</span> <span className="muted">in {s.where}</span>
                      </li>
                    ))}
                    {secrets.length > 8 && <li className="muted">… und {secrets.length - 8} weitere</li>}
                  </ul>
                  <div className="muted">Tipp: Werte durch Variablen wie ${'{DB_PASSWORD}'} ersetzen.</div>
                  <label className="mk-check">
                    <input type="checkbox" checked={secretOk} onChange={(e) => setSecretOk(e.target.checked)} />
                    <span>Ich habe geprüft: das sind keine echten Zugangsdaten.</span>
                  </label>
                </div>
              )}
              <label className="mk-check">
                <input type="checkbox" checked={license} onChange={(e) => setLicense(e.target.checked)} />
                <span>
                  Ich darf das teilen. Es wird öffentlich und ist für alle kostenlos und frei nutzbar (CC0). <small>Ich kann den Eintrag jederzeit bearbeiten oder löschen.</small>
                </span>
              </label>
              {err && <div className="form-error">{err}</div>}
            </div>
          </div>
        </div>
      </Modal>
      {login && <LoginDialog onClose={() => setLogin(false)} onDone={() => setLogin(false)} />}
    </>
  );
}
