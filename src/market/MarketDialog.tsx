// Public marketplace: browse, search, preview and use shared block combinations, files and projects.
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon, IconName } from '../components/Icons';
import { Modal } from '../components/Dialogs';
import YamlView from '../components/YamlView';
import BlockPreview from './BlockPreview';
import { ListQuery, ListResult, market, MARKET_HOST, MarketError, SAME_ORIGIN } from './api';
import { isFile, isProject, isSnippet, projectVars, snippetState, snippetWhere, snippetYaml, yamlOf } from './preview';
import { ItemKind, ItemTarget, KIND_LABEL, KIND_PLURAL, MarketItem, MarketItemFull, SortKey, TARGET_LABEL } from './shared';
import { refreshMe, setMe, useMe } from './useMe';

export type UseAction = 'insert' | 'snippet' | 'file' | 'project' | 'download';
type Scope = '' | 'starred' | 'mine' | 'reported';

interface Props {
  onClose: () => void;
  /** open this item right away (deep link) */
  initialId?: string;
  /** kind of the file open in the editor – decides if a snippet can be inserted */
  activeKind?: 'compose' | 'k8s';
  onUse: (item: MarketItemFull, how: UseAction) => Promise<string | void>;
  onPublish: (edit?: MarketItemFull) => void;
  flash: (msg: string) => void;
  /** bump to reload lists (after publishing) */
  reloadKey: number;
}

export const KIND_ICON: Record<ItemKind, IconName> = { snippet: 'layers', file: 'file', project: 'folder' };
const SORTS: [SortKey, string][] = [
  ['popular', 'Beliebt'],
  ['new', 'Neu'],
  ['stars', 'Meiste Sterne'],
  ['updated', 'Zuletzt aktualisiert'],
];

export function ago(t: number): string {
  const s = Math.max(1, Math.round((Date.now() - t) / 1000));
  if (s < 60) return 'gerade eben';
  const m = Math.round(s / 60);
  if (m < 60) return `vor ${m} Min.`;
  const h = Math.round(m / 60);
  if (h < 24) return `vor ${h} Std.`;
  const d = Math.round(h / 24);
  if (d < 30) return `vor ${d} ${d === 1 ? 'Tag' : 'Tagen'}`;
  return new Date(t).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const num = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace('.', ',')}k` : String(n));

export default function MarketDialog({ onClose, initialId, activeKind, onUse, onPublish, flash, reloadKey }: Props) {
  const { user, loaded, offline } = useMe();
  const [scope, setScope] = useState<Scope>('');
  const [q, setQ] = useState('');
  const [qLive, setQLive] = useState('');
  const [kind, setKind] = useState<ItemKind | ''>('');
  const [target, setTarget] = useState<ItemTarget | ''>('');
  const [sort, setSort] = useState<SortKey>('popular');
  const [tag, setTag] = useState('');
  const [author, setAuthor] = useState<{ id: number; name: string } | null>(null);
  const [res, setRes] = useState<ListResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tags, setTags] = useState<{ tag: string; n: number }[]>([]);
  const [stats, setStats] = useState<{ items: number; authors: number; downloads: number } | null>(null);
  const [openId, setOpenId] = useState<string | null>(initialId ?? null);
  const [login, setLogin] = useState(false);
  const reqNo = useRef(0);

  // deep link / "Im Marktplatz ansehen" while the marketplace is already open
  useEffect(() => {
    if (initialId) setOpenId(initialId);
  }, [initialId]);

  // debounce search typing
  useEffect(() => {
    const t = window.setTimeout(() => setQ(qLive.trim()), 280);
    return () => window.clearTimeout(t);
  }, [qLive]);

  const query: ListQuery = useMemo(() => ({ q, kind, target, sort, tag, author: author?.id, scope }), [q, kind, target, sort, tag, author, scope]);

  const load = useCallback(
    async (page = 1) => {
      const no = ++reqNo.current;
      setLoading(true);
      setError('');
      try {
        const r = await market.list({ ...query, page });
        if (no !== reqNo.current) return;
        setRes((cur) => (page > 1 && cur ? { ...r, items: [...cur.items, ...r.items] } : r));
      } catch (e: any) {
        if (no === reqNo.current) setError(e.message);
      } finally {
        if (no === reqNo.current) setLoading(false);
      }
    },
    [query],
  );

  useEffect(() => {
    load(1);
  }, [load, reloadKey]);

  useEffect(() => {
    market.tags().then(setTags).catch(() => {});
    market.stats().then(setStats).catch(() => {});
  }, [reloadKey]);

  const resetFilters = () => {
    setQLive('');
    setQ('');
    setKind('');
    setTarget('');
    setTag('');
    setAuthor(null);
  };
  const filtered = !!(q || kind || target || tag || author);

  const goScope = (s: Scope) => {
    if ((s === 'mine' || s === 'starred') && !user) return setLogin(true);
    setScope(s);
    setOpenId(null);
  };

  const patchItem = (it: Partial<MarketItem> & { id: string }) => setRes((cur) => (cur ? { ...cur, items: cur.items.map((x) => (x.id === it.id ? { ...x, ...it } : x)) } : cur));
  const dropItem = (id: string) => setRes((cur) => (cur ? { ...cur, items: cur.items.filter((x) => x.id !== id), total: cur.total - 1 } : cur));

  const scopeTitle = scope === 'mine' ? 'Meine Uploads' : scope === 'starred' ? 'Gemerkt' : scope === 'reported' ? 'Moderation' : 'Entdecken';

  return (
    <div className="mk-overlay" role="dialog" aria-label="Marktplatz">
      <header className="mk-head">
        <div className="mk-brand">
          <span className="mk-brand-ico">
            <Icon name="store" size={18} />
          </span>
          <div>
            <div className="mk-title">Marktplatz</div>
            <div className="mk-sub">
              Kostenlos teilen und laden: Block-Kombinationen, Dateien und ganze Projekte
              {stats && stats.items > 0 && (
                <span className="mk-stats">
                  {' '}
                  · {num(stats.items)} Einträge · {num(stats.authors)} Autor:innen · {num(stats.downloads)} Downloads
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="mk-head-right">
          <AccountChip onLogin={() => setLogin(true)} />
          <button className="btn primary" onClick={() => (user ? onPublish() : setLogin(true))}>
            <Icon name="share" size={14} /> Veröffentlichen
          </button>
          <button className="icon-btn" onClick={onClose} title="Schließen (Esc)">
            <Icon name="x" />
          </button>
        </div>
      </header>

      <div className="mk-body">
        <nav className="mk-nav" aria-label="Bereiche">
          <NavBtn on={scope === ''} icon="globe" label="Entdecken" onClick={() => goScope('')} />
          <NavBtn on={scope === 'starred'} icon="star" label="Gemerkt" onClick={() => goScope('starred')} />
          <NavBtn on={scope === 'mine'} icon="user" label="Meine Uploads" onClick={() => goScope('mine')} />
          {user?.admin && <NavBtn on={scope === 'reported'} icon="shield" label="Moderation" onClick={() => goScope('reported')} />}
          <div className="mk-nav-sep" />
          <div className="mk-nav-label">Art</div>
          {(['', 'snippet', 'file', 'project'] as const).map((k) => (
            <NavBtn key={k || 'all'} small on={kind === k} icon={k ? KIND_ICON[k] : 'grid'} label={k ? KIND_PLURAL[k] : 'Alles'} onClick={() => (setKind(k), setOpenId(null))} />
          ))}
          <div className="mk-nav-label">Für</div>
          {(['', 'compose', 'k8s'] as const).map((t) => (
            <NavBtn key={t || 'all'} small on={target === t} icon={t === 'compose' ? 'whale' : t === 'k8s' ? 'helm' : 'grid'} label={t ? TARGET_LABEL[t] : 'Alle Editoren'} onClick={() => (setTarget(t), setOpenId(null))} />
          ))}
          <div className="mk-nav-foot">
            <Icon name="lock" size={12} /> Alles hier ist kostenlos und frei nutzbar (CC0).
          </div>
        </nav>

        <section className="mk-main">
          {openId ? (
            <ItemDetail
              id={openId}
              activeKind={activeKind}
              onBack={() => setOpenId(null)}
              onUse={onUse}
              onEdit={onPublish}
              onAuthor={(a) => (setAuthor(a), setScope(''), setOpenId(null))}
              onTag={(t) => (setTag(t), setScope(''), setOpenId(null))}
              onChanged={patchItem}
              onDeleted={(id) => (dropItem(id), setOpenId(null))}
              needLogin={() => setLogin(true)}
              flash={flash}
              reloadKey={reloadKey}
            />
          ) : (
            <>
              <div className="mk-toolbar">
                <div className="search mk-search">
                  <Icon name="search" size={14} />
                  <input autoFocus placeholder="Suchen: nginx, postgres, route, healthcheck …" value={qLive} onChange={(e) => setQLive(e.target.value)} aria-label="Marktplatz durchsuchen" />
                  {qLive && (
                    <button className="icon-btn" onClick={() => setQLive('')} title="Suche leeren">
                      <Icon name="x" size={13} />
                    </button>
                  )}
                </div>
                <label className="mk-sort">
                  <span>Sortieren</span>
                  <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
                    {SORTS.map(([k, l]) => (
                      <option key={k} value={k}>
                        {l}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {tags.length > 0 && scope === '' && (
                <div className="mk-tags" aria-label="Beliebte Tags">
                  {tags.slice(0, 18).map((t) => (
                    <button key={t.tag} className={`mk-tag ${tag === t.tag ? 'on' : ''}`} onClick={() => setTag(tag === t.tag ? '' : t.tag)}>
                      #{t.tag}
                      <span>{t.n}</span>
                    </button>
                  ))}
                </div>
              )}

              <div className="mk-result-head">
                <h2>{scopeTitle}</h2>
                {res && !loading && (
                  <span className="muted">
                    {res.total} {res.total === 1 ? 'Eintrag' : 'Einträge'}
                  </span>
                )}
                {author && (
                  <span className="mk-filter-pill">
                    <Icon name="user" size={12} /> {author.name}
                    <button onClick={() => setAuthor(null)} title="Filter entfernen">
                      <Icon name="x" size={11} />
                    </button>
                  </span>
                )}
                {tag && (
                  <span className="mk-filter-pill">
                    #{tag}
                    <button onClick={() => setTag('')} title="Filter entfernen">
                      <Icon name="x" size={11} />
                    </button>
                  </span>
                )}
                {filtered && (
                  <button className="btn ghost sm" onClick={resetFilters}>
                    Filter zurücksetzen
                  </button>
                )}
                <div className="spacer" />
                <button className="icon-btn" onClick={() => load(1)} title="Neu laden">
                  <Icon name="refresh" size={14} />
                </button>
              </div>

              {error ? (
                <div className="mk-state">
                  <span className="mk-state-ico err">
                    <Icon name="alert" size={20} />
                  </span>
                  <p className="empty-title">Marktplatz nicht erreichbar</p>
                  <p>{error}</p>
                  <button className="btn" onClick={() => load(1)}>
                    <Icon name="refresh" size={14} /> Erneut versuchen
                  </button>
                </div>
              ) : !res && loading ? (
                <div className="mk-grid">
                  {Array.from({ length: 9 }, (_, i) => (
                    <div key={i} className="mk-card skeleton" />
                  ))}
                </div>
              ) : res && res.items.length === 0 ? (
                <EmptyState scope={scope} filtered={filtered} onReset={resetFilters} onPublish={() => (user ? onPublish() : setLogin(true))} />
              ) : (
                <>
                  <div className={`mk-grid ${loading ? 'busy' : ''}`}>
                    {res?.items.map((it) => (
                      <ItemCard key={it.id} item={it} onOpen={() => setOpenId(it.id)} onTag={setTag} />
                    ))}
                  </div>
                  {res && res.page < res.pages && (
                    <div className="mk-more">
                      <button className="btn" disabled={loading} onClick={() => load(res.page + 1)}>
                        {loading ? 'Lädt…' : `Mehr laden (${res.total - res.items.length} weitere)`}
                      </button>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </section>
      </div>

      {!SAME_ORIGIN && loaded && offline && <div className="mk-offline">Offline: {MARKET_HOST} ist gerade nicht erreichbar.</div>}
      {login && (
        <LoginDialog
          onClose={() => setLogin(false)}
          onDone={() => {
            setLogin(false);
            flash('Angemeldet');
          }}
        />
      )}
    </div>
  );
}

function NavBtn({ on, icon, label, onClick, small }: { on: boolean; icon: IconName; label: string; onClick: () => void; small?: boolean }) {
  return (
    <button className={`mk-nav-btn ${on ? 'on' : ''} ${small ? 'small' : ''}`} onClick={onClick} aria-pressed={on}>
      <Icon name={icon} size={small ? 13 : 15} />
      <span>{label}</span>
    </button>
  );
}

function AccountChip({ onLogin }: { onLogin: () => void }) {
  const { user, loaded } = useMe();
  if (!loaded) return null;
  if (!user)
    return (
      <button className="btn ghost" onClick={onLogin}>
        <Icon name="user" size={14} /> Anmelden
      </button>
    );
  return (
    <span className="mk-account" title={`${user.email}${SAME_ORIGIN ? '' : ` · ${MARKET_HOST}`}`}>
      <span className="avatar">{user.name.slice(0, 1).toUpperCase()}</span>
      <span className="mk-account-name">{user.name}</span>
      {!SAME_ORIGIN && (
        <button
          className="icon-btn"
          title="Abmelden"
          onClick={async () => {
            await market.logout();
            setMe(null);
          }}
        >
          <Icon name="x" size={12} />
        </button>
      )}
    </span>
  );
}

function EmptyState({ scope, filtered, onReset, onPublish }: { scope: Scope; filtered: boolean; onReset: () => void; onPublish: () => void }) {
  const text: Record<Scope, [string, string]> = {
    '': filtered ? ['Nichts gefunden', 'Andere Suchbegriffe probieren oder Filter zurücksetzen.'] : ['Noch leer', 'Sei die erste Person, die etwas teilt.'],
    starred: ['Noch nichts gemerkt', 'Mit dem Stern merkst du dir Einträge für später.'],
    mine: ['Du hast noch nichts geteilt', 'Teile eine Datei, ein Projekt oder per Rechtsklick eine Block-Kombination.'],
    reported: ['Keine Meldungen', 'Alles in Ordnung.'],
  };
  const [title, sub] = text[scope];
  return (
    <div className="mk-state">
      <span className="mk-state-ico">
        <Icon name={scope === 'starred' ? 'star' : scope === 'reported' ? 'shield' : 'store'} size={20} />
      </span>
      <p className="empty-title">{title}</p>
      <p>{sub}</p>
      {filtered && scope === '' ? (
        <button className="btn" onClick={onReset}>
          Filter zurücksetzen
        </button>
      ) : scope === '' || scope === 'mine' ? (
        <button className="btn primary" onClick={onPublish}>
          <Icon name="share" size={14} /> Etwas veröffentlichen
        </button>
      ) : null}
    </div>
  );
}

function ItemCard({ item, onOpen, onTag }: { item: MarketItem; onOpen: () => void; onTag: (t: string) => void }) {
  return (
    <article className={`mk-card kind-${item.kind} ${item.hidden ? 'is-hidden' : ''}`} onClick={onOpen} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onOpen()}>
      <div className="mk-card-top">
        <span className={`mk-kind kind-${item.kind}`}>
          <Icon name={KIND_ICON[item.kind]} size={12} /> {KIND_LABEL[item.kind]}
        </span>
        <TargetPill target={item.target} />
        {item.hidden && (
          <span className="mk-hidden-pill" title="Nur für dich und Moderation sichtbar">
            <Icon name="eyeOff" size={11} /> ausgeblendet
          </span>
        )}
      </div>
      <h3 className="mk-card-title">{item.title}</h3>
      <p className="mk-card-desc">{item.description || <span className="muted">Keine Beschreibung.</span>}</p>
      {item.tags.length > 0 && (
        <div className="mk-card-tags">
          {item.tags.slice(0, 4).map((t) => (
            <button
              key={t}
              onClick={(e) => {
                e.stopPropagation();
                onTag(t);
              }}
            >
              #{t}
            </button>
          ))}
        </div>
      )}
      <footer className="mk-card-foot">
        <span className="mk-author">
          <span className="avatar sm">{item.author.name.slice(0, 1).toUpperCase()}</span>
          {item.author.name}
        </span>
        <span className="spacer" />
        <span title="Downloads">
          <Icon name="download" size={12} /> {num(item.downloads)}
        </span>
        <span title="Sterne" className={item.starred ? 'starred' : ''}>
          <Icon name="star" size={12} /> {num(item.stars)}
        </span>
        <span title={new Date(item.updatedAt).toLocaleString('de-DE')}>{ago(item.updatedAt)}</span>
      </footer>
    </article>
  );
}

export function TargetPill({ target }: { target: ItemTarget }) {
  if (target === 'any') return <span className="kind-pill">{TARGET_LABEL.any}</span>;
  if (target === 'mixed') return <span className="kind-pill">Compose + K8s</span>;
  return <span className={`kind-pill kind-${target}`}>{target === 'compose' ? 'Docker Compose' : 'Kubernetes'}</span>;
}

// ---------------------------------------------------------------------------------------------- detail
function ItemDetail({
  id,
  activeKind,
  onBack,
  onUse,
  onEdit,
  onAuthor,
  onTag,
  onChanged,
  onDeleted,
  needLogin,
  flash,
  reloadKey,
}: {
  id: string;
  reloadKey: number;
  activeKind?: 'compose' | 'k8s';
  onBack: () => void;
  onUse: (item: MarketItemFull, how: UseAction) => Promise<string | void>;
  onEdit: (item: MarketItemFull) => void;
  onAuthor: (a: { id: number; name: string }) => void;
  onTag: (t: string) => void;
  onChanged: (it: Partial<MarketItem> & { id: string }) => void;
  onDeleted: (id: string) => void;
  needLogin: () => void;
  flash: (msg: string) => void;
}) {
  const { user } = useMe();
  const [item, setItem] = useState<MarketItemFull | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'blocks' | 'yaml'>('blocks');
  const [fileIdx, setFileIdx] = useState(0);
  const [busy, setBusy] = useState<UseAction | 'star' | 'delete' | 'mod' | null>(null);
  const [done, setDone] = useState<UseAction | null>(null);
  const [report, setReport] = useState(false);
  const [reports, setReports] = useState<{ reason: string; createdAt: number; user: string }[] | null>(null);

  useEffect(() => {
    setItem(null);
    setError('');
    setFileIdx(0);
    setDone(null);
    market
      .get(id)
      .then(setItem)
      .catch((e) => setError(e instanceof MarketError && e.status === 404 ? 'Dieser Eintrag existiert nicht mehr.' : e.message));
  }, [id, user?.id, reloadKey]);

  useEffect(() => {
    if (item && user?.admin) market.reports(item.id).then(setReports).catch(() => setReports(null));
  }, [item?.id, user?.admin]); // eslint-disable-line react-hooks/exhaustive-deps

  const d = item?.data;
  const file = d && isProject(d) ? d.files[Math.min(fileIdx, d.files.length - 1)] : d && isFile(d) ? d : null;
  const previewState = useMemo(() => (d && isSnippet(d) ? snippetState(d) : file?.state), [d, file]);
  const yaml = useMemo(() => {
    if (tab !== 'yaml' || !d) return '';
    if (isSnippet(d)) return snippetYaml(d);
    if (!file) return '';
    return yamlOf(file.state, file.kind, isProject(d) ? projectVars(d) : {}).yaml;
  }, [tab, d, file]);

  if (error)
    return (
      <div className="mk-detail">
        <button className="btn ghost sm mk-back" onClick={onBack}>
          <Icon name="back" size={14} /> Zurück
        </button>
        <div className="mk-state">
          <span className="mk-state-ico err">
            <Icon name="alert" size={20} />
          </span>
          <p className="empty-title">Nicht verfügbar</p>
          <p>{error}</p>
        </div>
      </div>
    );
  if (!item || !d)
    return (
      <div className="mk-detail">
        <button className="btn ghost sm mk-back" onClick={onBack}>
          <Icon name="back" size={14} /> Zurück
        </button>
        <div className="mk-detail-skel">
          <div className="skeleton" style={{ height: 28, width: '50%' }} />
          <div className="skeleton" style={{ height: 14, width: '30%' }} />
          <div className="skeleton" style={{ height: 320 }} />
        </div>
      </div>
    );

  const run = async (how: UseAction) => {
    setBusy(how);
    try {
      const msg = await onUse(item, how);
      market.downloaded(item.id).then((r) => r && (setItem((x) => (x ? { ...x, downloads: r.downloads } : x)), onChanged({ id: item.id, downloads: r.downloads })));
      setDone(how);
      if (msg) flash(msg);
    } catch (e: any) {
      flash(e.message);
    } finally {
      setBusy(null);
    }
  };
  const toggleStar = async () => {
    if (!user) return needLogin();
    setBusy('star');
    try {
      const r = await market.star(item.id, !item.starred);
      setItem({ ...item, ...r });
      onChanged({ id: item.id, ...r });
    } catch (e: any) {
      flash(e.message);
    } finally {
      setBusy(null);
    }
  };
  const del = async () => {
    if (!window.confirm(`„${item.title}“ aus dem Marktplatz löschen? Das kann nicht rückgängig gemacht werden.`)) return;
    setBusy('delete');
    try {
      await market.remove(item.id);
      flash('Gelöscht');
      onDeleted(item.id);
    } catch (e: any) {
      flash(e.message);
      setBusy(null);
    }
  };
  const moderate = async (hidden: boolean) => {
    setBusy('mod');
    try {
      await market.moderate(item.id, hidden);
      setItem({ ...item, hidden });
      onChanged({ id: item.id, hidden });
      flash(hidden ? 'Ausgeblendet' : 'Wieder sichtbar');
    } catch (e: any) {
      flash(e.message);
    } finally {
      setBusy(null);
    }
  };
  const copyLink = async () => {
    await navigator.clipboard.writeText(market.itemUrl(item.id));
    flash('Link kopiert');
  };

  const snippetMismatch = isSnippet(d) && activeKind && item.target !== 'any' && item.target !== 'mixed' && item.target !== activeKind;
  const primary: { how: UseAction; label: string; icon: IconName; disabled?: string }[] = isSnippet(d)
    ? [
        { how: 'insert', label: 'In Arbeitsfläche einfügen', icon: 'plus', disabled: snippetMismatch ? `Passt nicht zur geöffneten Datei (${activeKind === 'compose' ? 'Compose' : 'Kubernetes'}). Öffne eine ${item.target === 'compose' ? 'Compose' : 'Kubernetes'}-Datei.` : undefined },
        { how: 'snippet', label: 'Zu Meine Vorlagen', icon: 'layers' },
      ]
    : isProject(d)
      ? [{ how: 'project', label: 'Als neues Projekt öffnen', icon: 'folder' }]
      : [{ how: 'file', label: 'Als Datei ins Projekt', icon: 'filePlus' }];
  const doneLabel: Partial<Record<UseAction, string>> = { insert: 'Eingefügt', snippet: 'In Meine Vorlagen', file: 'Hinzugefügt', project: 'Geöffnet', download: 'Gespeichert' };

  return (
    <div className="mk-detail">
      <button className="btn ghost sm mk-back" onClick={onBack}>
        <Icon name="back" size={14} /> Zurück
      </button>
      {item.hidden && (
        <div className="mk-banner warn">
          <Icon name="eyeOff" size={14} /> Dieser Eintrag ist ausgeblendet{item.mine ? ' (nach Meldungen). Nur du und die Moderation sehen ihn.' : '.'}
        </div>
      )}
      <div className="mk-detail-head">
        <div className="mk-detail-main">
          <div className="mk-card-top">
            <span className={`mk-kind kind-${item.kind}`}>
              <Icon name={KIND_ICON[item.kind]} size={12} /> {KIND_LABEL[item.kind]}
            </span>
            <TargetPill target={item.target} />
            <span className="muted mk-meta-small">
              v{item.version} · {plural(item.blockCount, 'Block', 'Blöcke')}{item.fileCount > 1 ? ` · ${item.fileCount} Dateien` : ''} · {Math.max(1, Math.round(item.bytes / 1000))} KB
            </span>
          </div>
          <h2 className="mk-detail-title">{item.title}</h2>
          <div className="mk-detail-by">
            <button className="mk-author link" onClick={() => onAuthor(item.author)} title="Alle Einträge dieser Person">
              <span className="avatar sm">{item.author.name.slice(0, 1).toUpperCase()}</span>
              {item.author.name}
            </button>
            <span className="muted">
              · veröffentlicht {ago(item.createdAt)}
              {item.updatedAt - item.createdAt > 60_000 ? ` · aktualisiert ${ago(item.updatedAt)}` : ''}
            </span>
          </div>
        </div>
        <div className="mk-detail-stats">
          <div>
            <b>{num(item.downloads)}</b>
            <span>Downloads</span>
          </div>
          <div>
            <b>{num(item.stars)}</b>
            <span>Sterne</span>
          </div>
        </div>
      </div>

      <div className="mk-actions">
        {primary.map((a, i) => (
          <button key={a.how} className={`btn ${i === 0 ? 'primary' : ''}`} disabled={!!busy || !!a.disabled} title={a.disabled} onClick={() => run(a.how)}>
            <Icon name={done === a.how ? 'check' : a.icon} size={14} /> {done === a.how ? doneLabel[a.how] : a.label}
          </button>
        ))}
        <button className="btn" disabled={!!busy} onClick={() => run('download')} title={isSnippet(d) ? 'Als .byob-Datei speichern' : isProject(d) ? 'Als .byob-Datei speichern' : 'YAML-Datei speichern'}>
          <Icon name="download" size={14} /> {isFile(d) ? 'YAML herunterladen' : '.byob herunterladen'}
        </button>
        <button className={`btn ${item.starred ? 'starred' : ''}`} disabled={busy === 'star'} onClick={toggleStar} aria-pressed={item.starred}>
          <Icon name="star" size={14} /> {item.starred ? 'Gemerkt' : 'Merken'}
        </button>
        <div className="spacer" />
        <button className="icon-btn" title="Link kopieren" onClick={copyLink}>
          <Icon name="link" size={15} />
        </button>
        {item.mine ? (
          <>
            <button className="btn ghost sm" onClick={() => onEdit(item)}>
              <Icon name="edit" size={13} /> Bearbeiten
            </button>
            <button className="btn ghost sm danger" disabled={busy === 'delete'} onClick={del}>
              <Icon name="trash" size={13} /> Löschen
            </button>
          </>
        ) : (
          <button className="btn ghost sm" onClick={() => (user ? setReport(true) : needLogin())} title="Unpassende Inhalte oder echte Zugangsdaten melden">
            <Icon name="flag" size={13} /> Melden
          </button>
        )}
        {user?.admin && (
          <button className="btn ghost sm" disabled={busy === 'mod'} onClick={() => moderate(!item.hidden)}>
            <Icon name={item.hidden ? 'eye' : 'eyeOff'} size={13} /> {item.hidden ? 'Einblenden' : 'Ausblenden'}
          </button>
        )}
      </div>

      {isSnippet(d) && <p className="mk-where">{snippetWhere(d)}</p>}

      {item.description && <div className="mk-desc">{item.description}</div>}
      {item.tags.length > 0 && (
        <div className="mk-card-tags big">
          {item.tags.map((t) => (
            <button key={t} onClick={() => onTag(t)}>
              #{t}
            </button>
          ))}
        </div>
      )}

      {user?.admin && reports && reports.length > 0 && (
        <div className="mk-reports">
          <div className="section-head">Meldungen ({reports.length})</div>
          {reports.map((r, i) => (
            <div key={i} className="mk-report">
              <b>{r.user}</b> <span className="muted">{ago(r.createdAt)}</span>
              <div>{r.reason}</div>
            </div>
          ))}
        </div>
      )}

      <div className="mk-preview">
        <div className="mk-preview-head">
          <div className="seg">
            <button className={tab === 'blocks' ? 'on' : ''} onClick={() => setTab('blocks')}>
              <Icon name="layers" size={13} /> Blöcke
            </button>
            <button className={tab === 'yaml' ? 'on' : ''} onClick={() => setTab('yaml')}>
              <Icon name="code" size={13} /> YAML
            </button>
          </div>
          {isProject(d) && d.files.length > 1 && (
            <select className="mk-file-select" value={fileIdx} onChange={(e) => setFileIdx(Number(e.target.value))} aria-label="Datei für Vorschau">
              {d.files.map((f, i) => (
                <option key={i} value={i}>
                  {f.name}
                </option>
              ))}
            </select>
          )}
          {file && !(isProject(d) && d.files.length > 1) && <span className="muted mono">{file.name}</span>}
          <div className="spacer" />
          <span className="muted mk-preview-hint">{tab === 'blocks' ? 'Nur Vorschau · Ziehen zum Verschieben, Mausrad + Strg zum Zoomen' : isProject(d) && d.variables.length ? `Variablen: ${d.envs[0]}` : ''}</span>
        </div>
        {tab === 'blocks' ? (
          previewState ? <BlockPreview state={previewState} height={isSnippet(d) ? Math.min(380, 120 + item.blockCount * 26) : 420} /> : null
        ) : yaml === null ? (
          <div className="mk-preview-note">Diese Kombination beginnt nicht mit einem Startblock. YAML entsteht, sobald du sie in einer Datei unter den passenden Block legst.</div>
        ) : (
          <div className="mk-yaml">
            <YamlView yaml={yaml || ''} />
          </div>
        )}
      </div>

      {report && (
        <ReportDialog
          onClose={() => setReport(false)}
          onSend={async (reason) => {
            await market.report(item.id, reason);
            setReport(false);
            flash('Danke, die Meldung ist eingegangen.');
          }}
        />
      )}
    </div>
  );
}

const REPORT_REASONS = ['Enthält echte Passwörter oder Zugangsdaten', 'Spam oder Werbung', 'Funktioniert nicht / irreführend', 'Unangemessener Inhalt', 'Urheberrechtsverletzung'];

function ReportDialog({ onClose, onSend }: { onClose: () => void; onSend: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState(REPORT_REASONS[0]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  return (
    <Modal
      title="Eintrag melden"
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            Abbrechen
          </button>
          <button
            className="btn primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setErr('');
              try {
                await onSend(note.trim() ? `${reason}: ${note.trim()}` : reason);
              } catch (e: any) {
                setErr(e.message);
                setBusy(false);
              }
            }}
          >
            <Icon name="flag" size={14} /> Melden
          </button>
        </>
      }
    >
      <div className="mk-radio-list">
        {REPORT_REASONS.map((r) => (
          <label key={r} className={`mk-radio ${reason === r ? 'on' : ''}`}>
            <input type="radio" name="reason" checked={reason === r} onChange={() => setReason(r)} />
            {r}
          </label>
        ))}
      </div>
      <label className="field" style={{ marginTop: 12 }}>
        <span>Details (optional)</span>
        <input className="input" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      {err && <div className="form-error">{err}</div>}
    </Modal>
  );
}

// ---------------------------------------------------------------------------------------------- login (desktop)
export function LoginDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const u = await market.login(email.trim(), password);
      setMe(u);
      refreshMe();
      onDone();
    } catch (e: any) {
      setErr(e.message);
      setBusy(false);
    }
  };
  if (SAME_ORIGIN)
    return (
      <Modal title="Anmelden" onClose={onClose}>
        <p>Bitte melde dich an, um zu veröffentlichen oder Einträge zu merken.</p>
      </Modal>
    );
  return (
    <Modal
      title="Mit dem Marktplatz verbinden"
      onClose={onClose}
      footer={
        <>
          <a className="foot-hint link-ext" href={market.registerUrl()} target="_blank" rel="noreferrer">
            Noch kein Konto? Auf {MARKET_HOST} registrieren
          </a>
          <button className="btn ghost" onClick={onClose}>
            Abbrechen
          </button>
          <button className="btn primary" disabled={busy || !email.trim() || !password} onClick={() => submit()}>
            {busy ? 'Verbinde…' : 'Anmelden'}
          </button>
        </>
      }
    >
      <form className="mk-login" onSubmit={submit}>
        <p className="muted">
          Zum Durchsuchen und Laden brauchst du kein Konto. Zum Veröffentlichen, Merken und Melden meldest du dich mit deinem Konto von <b>{MARKET_HOST}</b> an.
        </p>
        <label className="field">
          <span>E-Mail</span>
          <input className="input" type="email" autoComplete="username" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field">
          <span>Passwort</span>
          <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <p className="mk-fine">
          <Icon name="lock" size={12} /> Das Passwort wird nicht gespeichert. BYOBYaml bekommt nur einen persönlichen Zugriffsschlüssel, den du jederzeit per Abmelden widerrufst.
        </p>
        {err && <div className="form-error">{err}</div>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
