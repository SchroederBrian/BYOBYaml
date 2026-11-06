import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./Icons";
import { imageApi } from "../registry/api";
import {
  imageBase,
  parseImageReference,
  type ImageManifest,
  type ImageSearch,
  type ImageSort,
  type ImageTag,
  type ImageTarget,
  type Registry,
  type RegistryImage,
} from "../registry/types";
import "../styles/market.css";
import "../styles/images.css";

const registryLabel = (registry: Registry) =>
  registry === "ghcr" ? "GHCR" : "Docker Hub";
const count = (value?: number) =>
  value === undefined
    ? "–"
    : new Intl.NumberFormat("de", {
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(value);
const date = (value?: string) =>
  value && !Number.isNaN(Date.parse(value))
    ? new Date(value).toLocaleDateString("de-DE")
    : "–";
const size = (value?: number) =>
  value
    ? `${(value / 1024 / 1024).toLocaleString("de", { maximumFractionDigits: 1 })} MB`
    : "–";
const matchesPlatform = (platform: string, filter: string) =>
  !filter || platform === filter || platform.startsWith(filter + "/");
const keyFor = (image: RegistryImage) => `${image.registry}:${image.name}`;
const favoriteKey = "byobyaml.images.saved.v1";
function readFavorites(): RegistryImage[] {
  try {
    const value = JSON.parse(localStorage.getItem(favoriteKey) || "[]");
    return Array.isArray(value)
      ? value
          .filter(
            (image) =>
              image &&
              parseImageReference(image.reference)?.name === image.name &&
              ["ghcr", "dockerhub"].includes(image.registry),
          )
          .slice(0, 100)
      : [];
  } catch {
    return [];
  }
}
function useDebounced(value: string) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value.trim()), 350);
    return () => clearTimeout(timer);
  }, [value]);
  return debounced;
}

export default function ImageBrowser({
  targets,
  initialReference,
  onClose,
  flash,
}: {
  targets: ImageTarget[];
  initialReference?: string;
  onClose: () => void;
  flash: (message: string) => void;
}) {
  const initial = useRef(
    initialReference ? parseImageReference(initialReference) : null,
  );
  const [registry, setRegistry] = useState<Registry>(
      initial.current?.registry ?? "dockerhub",
    ),
    [savedView, setSavedView] = useState(false);
  const [query, setQuery] = useState(""),
    [owner, setOwner] = useState(""),
    [official, setOfficial] = useState(false),
    [sort, setSort] = useState<ImageSort>("downloads"),
    [page, setPage] = useState(1);
  const q = useDebounced(query),
    publisher = useDebounced(owner);
  const [result, setResult] = useState<ImageSearch | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0);
  const [detail, setDetail] = useState<{
      image: RegistryImage;
      tag?: string;
    } | null>(null),
    [opening, setOpening] = useState(false);
  const [favorites, setFavorites] = useState(readFavorites),
    [targetId, setTargetId] = useState(targets[0]?.id ?? "");
  const root = useRef<HTMLDivElement>(null);
  const directAbort=useRef<AbortController|null>(null);
  useEffect(()=>()=>directAbort.current?.abort(),[]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const handle = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        onClose();
      }
      if (event.key === "Tab" && root.current) {
        const focusable = Array.from(
          root.current.querySelectorAll<HTMLElement>(
            'button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),[tabindex="0"]',
          ),
        ).filter((element) => element.getClientRects().length);
        const first = focusable[0],
          last = focusable.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener("keydown", handle, true);
    (
      root.current?.querySelector<HTMLElement>(".image-search input") ??
      root.current?.querySelector<HTMLElement>("button")
    )?.focus();
    return () => {
      window.removeEventListener("keydown", handle, true);
      if (previous?.isConnected) previous.focus();
    };
  }, [onClose]);
  useEffect(() => {
    setPage(1);
  }, [registry, q, publisher, official, sort]);
  useEffect(() => {
    if (savedView || detail) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setResult(null);
    imageApi
      .search(
        {
          registry,
          q,
          owner: publisher,
          official: official && registry === "dockerhub" ? "1" : "",
          sort,
          page,
        },
        controller.signal,
      )
      .then(setResult)
      .catch((reason) => {
        if (!controller.signal.aborted) setError(reason.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [registry, q, publisher, official, sort, page, retry, savedView, detail]);
  const openDirect = async (reference: string) => {
    directAbort.current?.abort();
    const controller=new AbortController();directAbort.current=controller;
    const parsed = parseImageReference(reference);
    if (!parsed) {
      setError(
        "Image-Adresse zum Beispiel nginx:alpine oder ghcr.io/home-assistant/home-assistant:stable angeben.",
      );
      return;
    }
    setOpening(true);
    setError("");
    try {
      const image = await imageApi.repository(parsed.registry, parsed.name, controller.signal);
      if(controller.signal.aborted)return;
      setRegistry(parsed.registry);
      setSavedView(false);
      setDetail({ image, tag: parsed.tag });
    } catch (reason) {
      if(!controller.signal.aborted)setError((reason as Error).message);
    } finally {
      if(!controller.signal.aborted)setOpening(false);
    }
  };
  useEffect(() => {
    if (initial.current) void openDirect(initialReference!);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const toggleFavorite = (image: RegistryImage) =>
    setFavorites((current) => {
      const next = current.some((entry) => keyFor(entry) === keyFor(image))
        ? current.filter((entry) => keyFor(entry) !== keyFor(image))
        : [image, ...current].slice(0, 100);
      try {
        localStorage.setItem(favoriteKey, JSON.stringify(next));
      } catch {
        flash("Merkliste konnte auf diesem Gerät nicht gespeichert werden.");
      }
      return next;
    });
  const saved = (image: RegistryImage) =>
    favorites.some((entry) => keyFor(entry) === keyFor(image));
  const items = savedView
    ? favorites.filter((image) =>
        `${image.name} ${image.description}`
          .toLowerCase()
          .includes(q.toLowerCase()),
      )
    : (result?.items ?? []);
  const useImage = (reference: string) => {
    const target = targets.find((entry) => entry.id === targetId);
    if (!target) throw new Error("Kein Ziel ausgewählt.");
    target.apply(reference);
    flash(`${reference} übernommen`);
    onClose();
  };
  const directReference =
    registry === "ghcr" && !query.startsWith("ghcr.io/") && query.includes("/")
      ? `ghcr.io/${query}`
      : query;
  const selectRegistry = (next: Registry) => {
    directAbort.current?.abort();setOpening(false);
    setRegistry(next);
    setSavedView(false);
    setDetail(null);
    setError("");
    setPage(1);
  };
  return (
    <div
      className="mk-overlay image-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Image-Browser"
      ref={root}
    >
      <header className="mk-head">
        <div className="mk-brand">
          <span className="mk-brand-ico">
            <Icon name="box" size={20} />
          </span>
          <div>
            <div className="mk-title">Image-Browser</div>
            <div className="mk-sub">
              Öffentliche Container-Images · Docker Hub & GitHub Container
              Registry
            </div>
          </div>
        </div>
        <div className="mk-head-right">
          <label className="image-target">
            Einsetzen in
            <select
              className="input"
              aria-label="Ziel für Image-Auswahl"
              value={targetId}
              onChange={(event) => setTargetId(event.target.value)}
            >
              {targets.map((target) => (
                <option key={target.id} value={target.id}>
                  {target.label}{target.reference?` [${target.reference}]`:''}
                </option>
              ))}
            </select>
          </label>
          <button
            className="icon-btn"
            onClick={onClose}
            title="Image-Browser schließen (Esc)"
            aria-label="Image-Browser schließen"
          >
            <Icon name="x" />
          </button>
        </div>
      </header>
      <div className="mk-body">
        <nav className="mk-nav" aria-label="Image-Quellen">
          <button
            className={`mk-nav-btn ${!savedView && registry === "dockerhub" ? "on" : ""}`}
            onClick={() => selectRegistry("dockerhub")}
          >
            <Icon name="whale" size={17} />
            Docker Hub
          </button>
          <button
            className={`mk-nav-btn ${!savedView && registry === "ghcr" ? "on" : ""}`}
            onClick={() => selectRegistry("ghcr")}
          >
            <Icon name="box" size={17} />
            GHCR
          </button>
          <button
            className={`mk-nav-btn ${savedView ? "on" : ""}`}
            onClick={() => {
              setSavedView(true);
              setDetail(null);
              setError("");
            }}
          >
            <Icon name="star" size={17} />
            Gemerkt <span className="image-nav-count">{favorites.length}</span>
          </button>
          <div className="mk-nav-sep" />
          {!savedView && (
            <>
              <label className="image-filter-label">
                Herausgeber
                <input
                  className="input"
                  aria-label="Image-Herausgeber filtern"
                  placeholder={
                    registry === "ghcr"
                      ? "z. B. linuxserver"
                      : "z. B. library oder bitnami"
                  }
                  value={owner}
                  onChange={(event) => {
                    setOwner(event.target.value);
                    setDetail(null);
                  }}
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
              {registry === "dockerhub" && (
                <label className="image-check">
                  <input
                    type="checkbox"
                    checked={official}
                    onChange={(event) => {
                      setOfficial(event.target.checked);
                      setDetail(null);
                    }}
                  />
                  Nur Docker Official Images
                </label>
              )}
            </>
          )}
          <div className="mk-nav-foot">
            <Icon name="globe" size={14} />
            <span>
              Öffentliche Repositories und echte Tags. Keine Registry-Passwörter
              nötig. Die Merkliste bleibt auf diesem Gerät.
            </span>
          </div>
        </nav>
        <section className="mk-main image-main">
          {detail ? (
            <ImageDetail
              key={keyFor(detail.image)}
              image={detail.image}
              initialTag={detail.tag || (/^v?\d+\.\d+/.test(detail.image.suggestedTag??'')?detail.image.suggestedTag:undefined)}
              onBack={() => setDetail(null)}
              saved={saved(detail.image)}
              toggleFavorite={() => toggleFavorite(detail.image)}
              onUse={useImage}
              target={targets.find((entry) => entry.id === targetId)}
              flash={flash}
            />
          ) : (
            <>
              <div className="mk-toolbar">
                <div className="search mk-search image-search">
                  <Icon name="search" size={15} />
                  <input
                    autoFocus
                    aria-label="Container-Images suchen"
                    placeholder={
                      registry === "ghcr"
                        ? "Pakete suchen oder ghcr.io/organisation/image:tag"
                        : "Images suchen: nginx, postgres, redis …"
                    }
                    value={query}
                    onChange={(event) => {
                      setQuery(event.target.value);
                      setPage(1);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") setRetry((value) => value + 1);
                    }}
                    spellCheck={false}
                  />
                  {query && (
                    <button
                      className="icon-btn"
                      title="Image-Suche leeren"
                      onClick={() => setQuery("")}
                    >
                      <Icon name="x" size={13} />
                    </button>
                  )}
                </div>
                <button
                  className="btn"
                  disabled={!query.trim() || opening}
                  onClick={() => void openDirect(directReference)}
                >
                  {opening ? "Öffnet …" : "Adresse öffnen"}
                </button>
                {!savedView && (
                  <label className="mk-sort">
                    Sortieren
                    <select
                      aria-label="Image-Sortierung"
                      value={sort}
                      onChange={(event) =>
                        setSort(event.target.value as ImageSort)
                      }
                    >
                      <option value="downloads">Downloads</option>
                      <option value="relevance">Relevanz</option>
                      <option value="updated">Aktualisiert</option>
                    </select>
                  </label>
                )}
              </div>
              <div className="mk-result-head">
                <h2>{savedView ? "Gemerkt" : registryLabel(registry)}</h2>
                <span className="muted">
                  {loading
                    ? "Images werden geladen …"
                    : savedView
                      ? `${items.length} Images`
                      : result
                        ? `${count(result.total)} Ergebnisse`
                        : ""}
                </span>
                <div className="spacer" />
                {!savedView && (
                  <button
                    className="icon-btn"
                    title="Image-Ergebnisse neu laden"
                    onClick={() => setRetry((value) => value + 1)}
                  >
                    <Icon name="refresh" size={15} />
                  </button>
                )}
              </div>
              {result?.notice && !savedView && (
                <p className="image-notice">{result.notice}</p>
              )}
              {error && (
                <div className="image-error" role="alert">
                  <Icon name="alert" size={17} />
                  <span>{error}</span>
                  <button
                    className="btn ghost sm"
                    onClick={() => setRetry((value) => value + 1)}
                  >
                    Erneut versuchen
                  </button>
                </div>
              )}
              {loading && !savedView ? (
                <div className="mk-grid">
                  {Array.from({ length: 8 }, (_, index) => (
                    <div key={index} className="mk-card skeleton image-card" />
                  ))}
                </div>
              ) : (
                <div className="mk-grid">
                  {items.map((image) => (
                    <article key={keyFor(image)} className="mk-card image-card">
                      <button
                        className="image-card-open"
                        onClick={() => {
                          setError("");
                          setDetail({ image });
                        }}
                        aria-label={`${image.reference} öffnen`}
                      >
                        <div className="image-card-identity">
                          <span className={`image-repo-icon ${image.registry}`}>
                            <Icon
                              name={
                                image.registry === "dockerhub" ? "whale" : "box"
                              }
                              size={23}
                            />
                          </span>
                          <span>
                            <span className="image-owner">
                              {image.owner === "library"
                                ? "Docker Official Images"
                                : image.owner}
                            </span>
                            <strong>
                              {image.name.replace(/^library\//, "")}
                            </strong>
                          </span>
                        </div>
                        <p>
                          {image.description || "Öffentliches Container-Image"}
                        </p>
                        <div className="image-card-badges">
                          <span className="kind-pill">
                            {registryLabel(image.registry)}
                          </span>
                          {image.official && (
                            <span className="image-official">
                              <Icon name="check" size={12} />
                              Official
                            </span>
                          )}
                        </div>
                      </button>
                      <div className="image-card-footer">
                        <span title="Downloads / Pulls">
                          <Icon name="download" size={13} />
                          {count(image.pulls)}
                        </span>
                        {image.stars !== undefined && (
                          <span title="Docker-Hub-Sterne">
                            <Icon name="star" size={13} />
                            {count(image.stars)}
                          </span>
                        )}
                        <button
                          className={`icon-btn ${saved(image) ? "image-saved" : ""}`}
                          aria-label={
                            saved(image)
                              ? `${image.reference} aus Merkliste entfernen`
                              : `${image.reference} merken`
                          }
                          aria-pressed={saved(image)}
                          onClick={() => toggleFavorite(image)}
                        >
                          <Icon name="star" size={15} />
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
              {!loading && !items.length && !error && (
                <div className="mk-state">
                  <span className="mk-state-ico">
                    <Icon name="search" size={24} />
                  </span>
                  <p className="empty-title">
                    {savedView
                      ? "Noch keine passenden gemerkten Images"
                      : "Keine passenden Images gefunden"}
                  </p>
                  <p>
                    {savedView
                      ? "Mit dem Stern an einem Image zur Merkliste hinzufügen."
                      : "Anderen Suchbegriff verwenden, Herausgeber-Filter prüfen oder eine vollständige Image-Adresse öffnen."}
                  </p>
                </div>
              )}
              {!savedView && result && !loading && (
                <div className="image-pagination">
                  <button
                    className="btn"
                    disabled={page <= 1}
                    onClick={() => setPage((value) => value - 1)}
                  >
                    Zurück
                  </button>
                  <span>Seite {page}</span>
                  <button
                    className="btn"
                    disabled={!result.hasMore}
                    onClick={() => setPage((value) => value + 1)}
                  >
                    Weitere Images
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function ImageDetail({
  image,
  initialTag,
  onBack,
  saved,
  toggleFavorite,
  onUse,
  target,
  flash,
}: {
  image: RegistryImage;
  initialTag?: string;
  onBack: () => void;
  saved: boolean;
  toggleFavorite: () => void;
  onUse: (reference: string) => void;
  target?: ImageTarget;
  flash: (message: string) => void;
}) {
  const [tags, setTags] = useState<ImageTag[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [query, setQuery] = useState(""),
    [loading, setLoading] = useState(false),
    [listError, setListError] = useState("");
  const [checkedTag, setCheckedTag] = useState("");
  const [listRetry,setListRetry]=useState(0),[manifestRetry,setManifestRetry]=useState(0);
  const q = useDebounced(query),
    [selected, setSelected] = useState(initialTag ?? ""),
    [manifest, setManifest] = useState<ImageManifest | null>(null),
    [manifestError, setManifestError] = useState(""),
    [checking, setChecking] = useState(false),
    [platform, setPlatform] = useState(""),
    [pin, setPin] = useState(false),
    [actionError, setActionError] = useState("");
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setListError("");
    setTags([]);
    setCursor(null);
    imageApi
      .tags(image.registry, image.name, q, "", controller.signal)
      .then((data) => {
        setTags(data.items);
        setCursor(data.next);
        if (!selectedRef.current && data.items.length)
          setSelected(
            data.items.find((tag) => tag.name === "latest")?.name ??
              data.items[0].name,
          );
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setListError(reason.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [image.registry, image.name, q,listRetry]);
  useEffect(() => {
    setManifest(null);
    setCheckedTag("");
    setManifestError("");
    setActionError("");
    if (!selected) return;
    const controller = new AbortController();
    setChecking(true);
    imageApi
      .manifest(image.registry, image.name, selected, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) {
          setManifest(value);
          setCheckedTag(selected);
        }
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setManifestError(reason.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setChecking(false);
      });
    return () => controller.abort();
  }, [image.registry, image.name, selected,manifestRetry]);
  const loadMore = async () => {
    if (!cursor || loading) return;
    setLoading(true);
    setListError("");
    try {
      const data = await imageApi.tags(image.registry, image.name, q, cursor);
      setTags((old) => [
        ...old,
        ...data.items.filter(
          (tag) => !old.some((entry) => entry.name === tag.name),
        ),
      ]);
      setCursor(data.next);
    } catch (reason) {
      setListError((reason as Error).message);
    } finally {
      setLoading(false);
    }
  };
  const inspect = () => {
    const value = query.trim();
    if (!value) return;
    setSelected(value);
    setActionError("");
  };
  const matching = useMemo(
    () =>
      tags.filter(
        (tag) =>
          !platform ||
          image.registry === "ghcr" ||
          tag.platforms.some((value) => matchesPlatform(value, platform)),
      ),
    [tags, platform, image.registry],
  );
  const variant = manifest?.variants.find((entry) =>
    matchesPlatform(entry.platform, platform),
  );
  const compatible =
    checkedTag === selected &&
    (!platform ||
      !!manifest?.platforms.some((value) => matchesPlatform(value, platform)));
  const chosenDigest = platform ? variant?.digest : manifest?.digest;
  const reference = `${imageBase(image.registry, image.name)}${pin ? `@${chosenDigest ?? ""}` : `${selected.startsWith("sha256:") ? "@" : ":"}${selected}`}`;
  const useSelection = () => {
    try {
      if (
        !manifest ||
        !compatible ||
        !selected ||
        checking ||
        (pin && !chosenDigest)
      )
        return;
      onUse(reference);
    } catch (reason) {
      setActionError((reason as Error).message);
    }
  };
  return (
    <div className="image-detail">
      <button className="btn ghost sm image-back" onClick={onBack}>
        <Icon name="back" size={15} />
        Zu den Images
      </button>
      <div className="image-detail-head">
        <span className={`image-repo-icon large ${image.registry}`}>
          <Icon
            name={image.registry === "dockerhub" ? "whale" : "box"}
            size={31}
          />
        </span>
        <div>
          <div className="image-owner">
            {registryLabel(image.registry)} · {image.owner}
          </div>
          <h1>{image.reference}</h1>
          <p>{image.description}</p>
        </div>
        <button
          className={`btn ${saved ? "image-saved" : ""}`}
          onClick={toggleFavorite}
        >
          <Icon name="star" size={15} />
          {saved ? "Gemerkt" : "Merken"}
        </button>
      </div>
      <div className="image-detail-meta">
        {image.official && (
          <span className="image-official">
            <Icon name="check" size={13} />
            Docker Official Image
          </span>
        )}
        {image.pulls !== undefined && (
          <span>{count(image.pulls)} Downloads / Pulls</span>
        )}
        {image.updated && <span>Aktualisiert: {date(image.updated)}</span>}
        <a
          className="link-ext"
          href={image.url}
          target="_blank"
          rel="noreferrer"
        >
          Auf {registryLabel(image.registry)} ansehen{" "}
          <Icon name="link" size={12} />
        </a>
      </div>
      <div className="image-detail-grid">
        <section className="image-tags-panel" data-registry={image.registry}>
          <div className="image-tag-toolbar">
            <div className="search">
              <Icon name="search" size={14} />
              <input
                aria-label="Image-Tags suchen"
                placeholder="Tags filtern, z. B. alpine, stable oder 1.28"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => event.key === "Enter" && inspect()}
                spellCheck={false}
              />
            </div>
            <button className="btn" disabled={!query.trim()} onClick={inspect}>
              Tag direkt prüfen
            </button>
          </div>
          <label className="image-platform-filter">
            Plattform
            <select
              className="input"
              aria-label="Image-Plattform filtern"
              value={platform}
              onChange={(event) => setPlatform(event.target.value)}
            >
              <option value="">Alle Plattformen</option>
              <option value="linux/amd64">Linux · amd64</option>
              <option value="linux/arm64">Linux · arm64</option>
              <option value="linux/arm/v7">Linux · arm/v7</option>
              <option value="windows/amd64">Windows · amd64</option>
            </select>
          </label>
          {image.registry === "ghcr" && (
            <p className="image-notice">
              GHCR liefert alphabetische Tag-Seiten. „Tag direkt prüfen“ findet
              auch einen Tag außerhalb der geladenen Seiten. Plattformen werden
              für die Auswahl live geprüft.
            </p>
          )}
          {listError && (
            <div className="image-error" role="alert"><span>{listError}</span><button className="btn ghost sm" onClick={()=>setListRetry((value)=>value+1)}>Erneut laden</button></div>
          )}
          <div className="image-tag-list" aria-label="Verfügbare Image-Tags">
            {matching.map((tag) => (
              <button
                key={tag.name}
                className={`image-tag-row ${selected === tag.name ? "on" : ""}`}
                aria-pressed={selected === tag.name}
                onClick={() => setSelected(tag.name)}
              >
                <span className="image-tag-name">
                  <Icon name="layers" size={14} />
                  <strong>{tag.name}</strong>
                </span>
                <span className="image-tag-platforms">
                  {tag.platforms.length
                    ? [...tag.platforms.filter((value)=>platform&&matchesPlatform(value,platform)),...tag.platforms.filter((value)=>!platform||!matchesPlatform(value,platform))].slice(0,4).join(" · ")
                    : image.registry === "ghcr"
                      ? "Plattformen bei Auswahl prüfen"
                      : "Keine Plattformangabe"}
                </span>
                <span className="image-tag-size">{size(tag.size)}</span>
                <span className="image-tag-date">{date(tag.updated)}</span>
              </button>
            ))}
          </div>
          {loading && (
            <p className="image-notice" role="status">
              Tags werden geladen …
            </p>
          )}
          {!loading && !matching.length && !listError && (
            <p className="image-notice">
              Keine passenden Tags auf den geladenen Seiten. Filter ändern,
              weitere Tags laden oder einen Tag direkt prüfen.
            </p>
          )}
          {cursor && (
            <button
              className="btn image-more-tags"
              disabled={loading}
              onClick={() => void loadMore()}
            >
              Weitere Tags laden
            </button>
          )}
        </section>
        <aside className="image-selection">
          <h2>Deine Auswahl</h2>
          <div className="image-selected-tag">
            {selected || "Tag auswählen"}
          </div>
          {checking && (
            <p role="status">Manifest wird direkt bei der Registry geprüft …</p>
          )}
          {manifestError && (
            <div className="image-error" role="alert"><span>{manifestError}</span><button className="btn ghost sm" onClick={()=>setManifestRetry((value)=>value+1)}>Prüfung wiederholen</button></div>
          )}
          {manifest && checkedTag===selected && (
            <>
              <div className="image-verified">
                <Icon name="check" size={15} />
                Manifest geprüft
              </div>
              <div className="image-platform-badges">
                {manifest.platforms.length ? (
                  manifest.platforms.map((value) => (
                    <span key={value}>{value}</span>
                  ))
                ) : (
                  <span>Plattform nicht im Manifest angegeben</span>
                )}
              </div>
              <label className="image-check">
                <input
                  type="checkbox"
                  checked={pin}
                  onChange={(event) => setPin(event.target.checked)}
                />
                Nach Digest fixieren
              </label>
              <p className="image-notice">
                {pin
                  ? "Die Auswahl bleibt an genau diesen Image-Inhalt gebunden."
                  : "Tags können vom Herausgeber auf neue Image-Versionen gesetzt werden."}
              </p>
            </>
          )}
          {manifest && !compatible && !checking && checkedTag===selected && (
            <p className="image-error" role="alert">
              Die gewählte Plattform ist für diesen Tag nicht im Manifest
              verfügbar. Andere Plattform oder anderen Tag wählen.
            </p>
          )}
          <code className="image-reference">{reference}</code>
          {target && (
            <p className="image-target-hint">
              Ziel: {target.label}
              {target.reference && (
                <>
                  <br />
                  Ersetzt: <code>{target.reference}</code>
                </>
              )}
            </p>
          )}
          {actionError && (
            <p className="image-error" role="alert">
              {actionError}
            </p>
          )}
          <button
            className="btn primary image-use"
            disabled={
              !target ||
              !manifest ||
              checking ||
              !compatible ||
              (pin && !chosenDigest)
            }
            onClick={useSelection}
          >
            <Icon name="check" size={15} />
            Image übernehmen
          </button>
          <button
            className="btn ghost image-use"
            disabled={
              !manifest || checking || !compatible || (pin && !chosenDigest)
            }
            onClick={() =>
              void navigator.clipboard
                .writeText(reference)
                .then(() => flash("Image-Adresse kopiert"))
                .catch(() =>
                  setActionError("Adresse konnte nicht kopiert werden."),
                )
            }
          >
            <Icon name="copy" size={14} />
            Adresse kopieren
          </button>
          <p className="image-notice">
            Die Prüfung bestätigt das öffentliche Manifest. Sie ist keine
            Prüfung auf Sicherheitslücken oder eine Startgarantie.
          </p>
        </aside>
      </div>
    </div>
  );
}
