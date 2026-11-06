import type { Router, Request, Response } from "express";
import { createHash } from "node:crypto";
import {
  imageBase,
  parseImageReference,
  type Registry,
  type RegistryImage,
  type ImageTag,
  type ImageManifest,
  type ImageSearch,
  type ImageTags,
} from "../src/registry/types";

class RegistryError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const MAX_BODY = 3_000_000,
  PAGE_SIZE = 24;
const cache = new Map<string, { until: number; value: any }>(),
  pending = new Map<string, Promise<any>>();
let inFlight = 0;
async function cached<T>(
  key: string,
  ttl: number,
  work: () => Promise<T>,
): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.value;
  if (pending.has(key)) return pending.get(key)!;
  if (inFlight >= 24)
    throw new RegistryError(
      503,
      "Die Image-Suche ist gerade ausgelastet. Bitte kurz warten und erneut versuchen.",
    );
  const task = (async () => {
    inFlight++;
    try {
      const value = await work();
      if (cache.size >= 500) cache.delete(cache.keys().next().value!);
      cache.set(key, { until: Date.now() + ttl, value });
      return value;
    } finally {
      inFlight--;
      pending.delete(key);
    }
  })();
  pending.set(key, task);
  return task;
}
async function upstream(
  url: string,
  headers: Record<string, string> = {},
): Promise<{ data: any; response: globalThis.Response; bytes: Buffer }> {
  let response: globalThis.Response;
  try {
    response = await fetch(url, {
      headers: {
        "User-Agent": "BYOBYaml-ImageBrowser/1.0",
        Accept: "application/json",
        ...headers,
      },
      redirect: "error",
      signal: AbortSignal.timeout(14000),
    });
  } catch {
    throw new RegistryError(
      502,
      "Die Registry ist momentan nicht erreichbar. Bitte erneut versuchen.",
    );
  }
  if (!response.ok) {
    if(response.status===403){
      const reason=await response.json().catch(()=>({}));
      const message=String(reason.detail??reason.message??(Array.isArray(reason.errors)?reason.errors.map((entry:any)=>`${entry.code??''} ${entry.message??''}`).join(' '):''));
      if(/pagination offset/i.test(message))throw new RegistryError(422,'Die Registry begrenzt anonyme Ergebnislisten. Bitte mit Suchbegriff oder Herausgeber eingrenzen oder eine bekannte Image-Adresse direkt öffnen.');
      if(/denied|private|forbidden|authentication/i.test(message))throw new RegistryError(404,'Dieses Image ist nicht öffentlich verfügbar oder der anonyme Zugriff wurde verweigert.');
      throw new RegistryError(429,'Die Registry begrenzt gerade anonyme Anfragen. Bitte etwas warten oder ein bekanntes Image direkt öffnen.');
    }
    await response.body?.cancel();
    if (response.status === 429)
      throw new RegistryError(
        429,
        "Die Registry begrenzt gerade Anfragen. Bitte etwas warten; eine bekannte Image-Adresse kann auch direkt geöffnet werden.",
      );
    if (response.status === 401 || response.status === 404)
      throw new RegistryError(
        404,
        "Image oder Tag ist nicht öffentlich verfügbar oder wurde nicht gefunden.",
      );
    throw new RegistryError(
      502,
      `Die Registry hat mit HTTP ${response.status} geantwortet.`,
    );
  }
  if (Number(response.headers.get("content-length")) > MAX_BODY) {
    await response.body?.cancel();
    throw new RegistryError(502, "Die Registry-Antwort ist zu groß.");
  }
  const reader = response.body?.getReader(),
    parts: Uint8Array[] = [];
  let length = 0;
  if (!reader)
    throw new RegistryError(502, "Die Registry hat keine Daten geliefert.");
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > MAX_BODY) {
        await reader.cancel();
        throw new RegistryError(502, "Die Registry-Antwort ist zu groß.");
      }
      parts.push(value);
    }
  } catch (error) {
    if (error instanceof RegistryError) throw error;
    throw new RegistryError(
      502,
      "Die Registry-Antwort konnte nicht vollständig geladen werden.",
    );
  }
  const bytes = Buffer.concat(parts);
  let data: any;
  try {
    data = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new RegistryError(
      502,
      "Die Suchschnittstelle der Registry hat sich geändert oder ist nicht verfügbar. Ein Image kann weiterhin über seine vollständige Adresse geöffnet werden.",
    );
  }
  return { data, response, bytes };
}
const text = (value: any, max = 600) =>
  typeof value === "string" ? value.replace(/<[^>]*>/g, "").slice(0, max) : "";
const safeName = (value: string, registry: Registry) => {
  const parsed = parseImageReference(
    `${registry === "ghcr" ? "ghcr.io/" : ""}${value}`,
  );
  if (
    !parsed ||
    parsed.registry !== registry ||
    parsed.name !== value ||
    (registry === "dockerhub" && (value.split("/").length !== 2 || !/^[a-z0-9][a-z0-9_-]*$/.test(value.split('/')[0])))
  )
    throw new RegistryError(
      400,
      "Bitte einen gültigen Repository-Namen angeben.",
    );
  return value;
};
const registryOf = (value: any): Registry => {
  if (value !== "dockerhub" && value !== "ghcr")
    throw new RegistryError(400, "Unbekannte Registry.");
  return value;
};
const digest = (value: any) =>
  typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value)
    ? value
    : undefined;
const platform = (value: any) =>
  value?.os &&
  value?.architecture &&
  value.os !== "unknown" &&
  value.architecture !== "unknown"
    ? `${text(value.os, 25)}/${text(value.architecture, 25)}${value.variant ? `/${text(value.variant, 15)}` : ""}`
    : "";
const tagName = (value: string) => {
  if (
    !/^(?:[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}|sha256:[a-f0-9]{64})$/.test(value)
  )
    throw new RegistryError(400, "Ungültiger Tag oder Digest.");
  return value;
};
const hubUrl = (name: string, suffix = "") =>
  `https://hub.docker.com/v2/namespaces/${name.split("/").map(encodeURIComponent).join("/repositories/")}${suffix}`;
const packageUrl = (name: string) =>
  `https://github.com/${name.split("/")[0]}?tab=packages`;
async function token(registry: Registry, name: string): Promise<string> {
  return cached(`token:${registry}:${name}`, 180000, async () => {
    const base =
        registry === "ghcr"
          ? "https://ghcr.io/token"
          : "https://auth.docker.io/token",
      service = registry === "ghcr" ? "ghcr.io" : "registry.docker.io";
    const { data } = await upstream(
      `${base}?${new URLSearchParams({ service, scope: `repository:${name}:pull` })}`,
    );
    const value = data.token ?? data.access_token;
    if (typeof value !== "string" || value.length > 20000)
      throw new RegistryError(
        502,
        "Die Registry hat keinen gültigen öffentlichen Zugriffstoken geliefert.",
      );
    return value;
  });
}
async function registryRequest(
  registry: Registry,
  name: string,
  path: string,
  accept?: string,
) {
  const credential = await token(registry, name);
  return upstream(
    `https://${registry === "ghcr" ? "ghcr.io" : "registry-1.docker.io"}/v2/${name}/${path}`,
    {
      Authorization: `Bearer ${credential}`,
      ...(accept ? { Accept: accept } : {}),
    },
  );
}
const accepts =
  "application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json";
async function manifest(
  registry: Registry,
  name: string,
  tag: string,
): Promise<ImageManifest> {
  return cached(`manifest:${registry}:${name}:${tag}`, 90000, async () => {
    const { data, response, bytes } = await registryRequest(
      registry,
      name,
      `manifests/${encodeURIComponent(tag)}`,
      accepts,
    );
    const actual = "sha256:" + createHash("sha256").update(bytes).digest("hex"),
      declared = digest(response.headers.get("docker-content-digest"));
    if (
      (declared && declared !== actual) ||
      (tag.startsWith("sha256:") && tag !== actual)
    )
      throw new RegistryError(
        502,
        "Der Image-Digest stimmt nicht mit den Registry-Daten überein.",
      );
    if (data.schemaVersion !== 2)
      throw new RegistryError(
        422,
        "Dieses Paket ist kein unterstütztes Container-Image.",
      );
    const variants = (
      Array.isArray(data.manifests) ? data.manifests.slice(0, 100) : []
    )
      .map((entry: any) => ({
        digest: digest(entry.digest),
        platform: platform(entry.platform),
        size: Number(entry.size) || undefined,
      }))
      .filter((entry: any) => entry.digest && entry.platform);
    if (
      !Array.isArray(data.manifests) &&
      ![
        "application/vnd.oci.image.config.v1+json",
        "application/vnd.docker.container.image.v1+json",
      ].includes(data.config?.mediaType)
    )
      throw new RegistryError(
        422,
        "Dieses Paket enthält ein anderes OCI-Artefakt und kein ausführbares Container-Image.",
      );
    if (Array.isArray(data.manifests) && !variants.length)
      throw new RegistryError(
        422,
        "Dieses Paket enthält keine unterstützten Image-Plattformen.",
      );
    return {
      digest: actual,
      platforms: [
        ...new Set<string>(variants.map((entry: any) => entry.platform)),
      ],
      variants,
      verifiedAt: new Date().toISOString(),
      mediaType: text(
        data.mediaType || response.headers.get("content-type"),
        150,
      ),
    };
  });
}
async function repository(
  registry: Registry,
  name: string,
): Promise<RegistryImage> {
  return cached(`repository:${registry}:${name}`, 300000, async () => {
    if (registry === "ghcr") {
      await registryRequest(registry, name, "tags/list?n=1");
      return {
        registry,
        name,
        reference: imageBase(registry, name),
        owner: name.split("/")[0],
        description:
          "Öffentliches Container-Paket auf GitHub Container Registry.",
        official: false,
        url: packageUrl(name),
      };
    }
    const { data } = await upstream(hubUrl(name));
    if (data.is_private)
      throw new RegistryError(404, "Dieses Repository ist nicht öffentlich.");
    return {
      registry,
      name,
      reference: imageBase(registry, name),
      owner: name.split("/")[0],
      description: text(data.description),
      official: name.startsWith("library/"),
      stars: Number(data.star_count) || 0,
      pulls: Number(data.pull_count) || 0,
      updated: text(data.last_updated, 40),
      url: name.startsWith("library/")
        ? `https://hub.docker.com/_/${name.slice(8)}`
        : `https://hub.docker.com/r/${name}`,
    };
  });
}
async function search(
  registry: Registry,
  q: string,
  owner: string,
  official: boolean,
  sort: string,
  page: number,
): Promise<ImageSearch> {
  return cached(
    `search:${JSON.stringify([registry, q, owner, official, sort, page])}`,
    120000,
    async () => {
      if (registry === "dockerhub") {
        if (official || owner === "library" || !q && !owner) {
          if (owner && owner !== "library") return {registry,items:[],total:0,page,hasMore:false};
          const catalogue = await cached<RegistryImage[]>(`hub-official-catalogue:${q}`,300000,async()=>{
              const params=new URLSearchParams({page_size:'100',page:'1'});if(q)params.set('name',q);
              const {data}=await upstream(`https://hub.docker.com/v2/namespaces/library/repositories?${params}`);
              if(!Array.isArray(data.results))throw new RegistryError(502,'Docker Hub hat keinen gültigen offiziellen Katalog geliefert.');
            const entries:any[]=data.results;
            return entries.filter((entry)=>!entry.is_private).map((entry)=>({registry:'dockerhub',name:`library/${text(entry.name,180)}`,reference:text(entry.name,180),owner:'library',description:text(entry.description),official:true,stars:Number(entry.star_count)||0,pulls:Number(entry.pull_count)||0,updated:text(entry.last_updated,40),url:`https://hub.docker.com/_/${encodeURIComponent(entry.name)}`}));
          });
          const filtered=catalogue.filter((image)=>`${image.name} ${image.description}`.toLowerCase().includes(q.toLowerCase()));
          filtered.sort((a,b)=>sort==='updated'?Date.parse(b.updated||'0')-Date.parse(a.updated||'0'):sort==='relevance'&&q?Number(b.reference.toLowerCase()===q.toLowerCase())-Number(a.reference.toLowerCase()===q.toLowerCase()):((b.pulls||0)-(a.pulls||0)));
          return {registry,items:filtered.slice((page-1)*PAGE_SIZE,page*PAGE_SIZE),total:filtered.length,page,hasMore:page*PAGE_SIZE<filtered.length,notice:!q?'Zum Einstieg: bis zu 100 öffentlich geladene Docker Official Images. Mit einem Suchbegriff findest du weitere Images.':undefined};
        }
        if(owner&&!q){
          const {data}=await upstream(`https://hub.docker.com/v2/namespaces/${encodeURIComponent(owner)}/repositories?${new URLSearchParams({page:String(page),page_size:String(PAGE_SIZE),ordering:sort==='updated'?'last_updated':'pull_count'})}`);
          if(!Array.isArray(data.results))throw new RegistryError(502,'Docker Hub hat keine gültige Repository-Liste geliefert.');
          const items:RegistryImage[]=data.results.filter((entry:any)=>!entry.is_private).map((entry:any)=>({registry,name:`${owner}/${text(entry.name,180)}`,reference:`${owner}/${text(entry.name,180)}`,owner,description:text(entry.description),official:false,stars:Number(entry.star_count)||0,pulls:Number(entry.pull_count)||0,updated:text(entry.last_updated,40),url:`https://hub.docker.com/r/${owner}/${encodeURIComponent(entry.name)}`}));
          items.sort((a,b)=>sort==='updated'?Date.parse(b.updated||'0')-Date.parse(a.updated||'0'):(b.pulls||0)-(a.pulls||0));
          return {registry,items,total:Number(data.count)||0,page,hasMore:!!data.next&&page*PAGE_SIZE<100,notice:page*PAGE_SIZE>=96&&data.next?'Für weitere Treffer bitte den Suchbegriff eingrenzen; die Registry begrenzt anonyme Ergebnislisten.':undefined};
        }
        const params = new URLSearchParams({
          query: owner && owner !== "library" ? `${owner}/${q}` : q,
          page: String(page),
          page_size: String(PAGE_SIZE),
        });
        if (official || owner === "library") params.set("is_official", "true");
        if (sort === "downloads") params.set("ordering", "-pull_count");
        if (sort === "updated") params.set("ordering", "-last_updated");
        const { data } = await upstream(
          `https://hub.docker.com/v2/search/repositories/?${params}`,
        );
        if (!Array.isArray(data.results))
          throw new RegistryError(
            502,
            "Docker Hub hat keine gültige Ergebnisliste geliefert.",
          );
        const items: RegistryImage[] = data.results.flatMap((entry: any) => {
          const parsed = parseImageReference(text(entry.repo_name, 255));
          if (!parsed || parsed.registry !== "dockerhub") return [];
          if (
            (official && !entry.is_official) ||
            (owner && parsed.name.split("/")[0] !== owner)
          )
            return [];
          return [
            {
              registry,
              name: parsed.name,
              reference: imageBase(registry, parsed.name),
              owner: parsed.name.split("/")[0],
              description: text(entry.short_description),
              official: !!entry.is_official,
              stars: Number(entry.star_count) || 0,
              pulls: Number(entry.pull_count) || 0,
              url: entry.is_official
                ? `https://hub.docker.com/_/${parsed.name.split("/")[1]}`
                : `https://hub.docker.com/r/${parsed.name}`,
            },
          ];
        });
        return {
          registry,
          items,
          total: Number(data.count) || 0,
          page,
          hasMore: !!data.next&&page*PAGE_SIZE<100,
          notice: page*PAGE_SIZE>=96&&data.next?'Für weitere Treffer bitte den Suchbegriff oder Herausgeber eingrenzen.':undefined,
        };
      }
      // GitHub's public package search supplies discovery; actual tags/manifests are always read from GHCR.
      const query = [q, owner ? `user:${owner}` : "", "type:container"]
        .filter(Boolean)
        .join(" ");
      const params = new URLSearchParams({
        q: query,
        type: "registrypackages",
        p: String(page),
      });
      if (sort !== "relevance") {
        params.set("s", sort === "downloads" ? "downloads" : "updated");
        params.set("o", "desc");
      }
      const { data } = await upstream(`https://github.com/search?${params}`);
      const payload = data.payload?.blackbirdSearchRoute ?? data.payload;
      if (!payload || !Array.isArray(payload.results))
        throw new RegistryError(
          502,
          "GitHubs öffentliche Paketsuche ist gerade nicht verfügbar. Öffne ein bekanntes Image direkt als ghcr.io/organisation/image.",
        );
      if (payload.errors?.length)
        throw new RegistryError(
          400,
          "GitHub konnte diese Suchanfrage nicht verarbeiten. Bitte einen einfachen Image-Namen oder eine vollständige GHCR-Adresse verwenden.",
        );
      const items: RegistryImage[] = payload.results.flatMap((entry: any) => {
        const source = entry.source ?? {};
        if (
          source.package_type !== "container" ||
          source.visibility === "private"
        )
          return [];
        let name = `${source.namespace}/${source.name}`.toLowerCase();
        try {
          safeName(name, "ghcr");
        } catch {
          return [];
        }
        if (owner && name.split("/")[0] !== owner) return [];
        const url =
          typeof entry.package_url === "string" &&
          /^\/(?:orgs|users)\/[a-zA-Z0-9-]+\/packages\/container\/package\//.test(
            entry.package_url,
          )
            ? `https://github.com${entry.package_url}`
            : packageUrl(name);
        return [
          {
            registry,
            name,
            reference: imageBase(registry, name),
            owner: name.split("/")[0],
            description: text(
              entry.summary ||
                source.summary ||
                `Container-Paket von ${source.namespace}`,
            ),
            official: false,
            pulls: Number(source.downloads) || 0,
            updated: text(entry.updated_at || source.updated_at, 40),
            url,
            suggestedTag:
              text(
                source.versions?.find((version: any) => version.latest)
                  ?.version,
                128,
              ) || undefined,
          },
        ];
      });
      return {
        registry,
        items,
        total: Number(payload.result_count) || items.length,
        page,
        hasMore: page < Number(payload.page_count || 1),
        notice: payload.warn_limited_results
          ? "GitHub begrenzt die öffentliche Ergebnisliste. Mit einem Herausgeber oder einer vollständigen Image-Adresse eingrenzen."
          : undefined,
      };
    },
  );
}
async function tags(
  registry: Registry,
  name: string,
  q: string,
  cursor: string,
): Promise<ImageTags> {
  return cached(
    `tags:${JSON.stringify([registry, name, q, cursor])}`,
    90000,
    async () => {
      if (registry === "dockerhub") {
        const page = cursor ? Number(cursor) : 1;
        if (!Number.isInteger(page) || page < 1 || page > 10000)
          throw new RegistryError(400, "Ungültige Tag-Seite.");
        const params = new URLSearchParams({
          page: String(page),
          page_size: "50",
          ordering: "last_updated",
        });
        if (q) params.set("name", q);
        const { data } = await upstream(`${hubUrl(name, "/tags")}?${params}`);
        if (!Array.isArray(data.results))
          throw new RegistryError(
            502,
            "Docker Hub hat keine gültige Tag-Liste geliefert.",
          );
        const items: ImageTag[] = data.results.map((tag: any) => ({
          name: text(tag.name, 128),
          digest: digest(tag.digest),
          platforms: [
            ...new Set<string>(
              (Array.isArray(tag.images) ? tag.images : [])
                .map(platform)
                .filter(Boolean),
            ),
          ],
          size: Number(tag.full_size) || undefined,
          updated: text(tag.last_updated || tag.tag_last_pushed, 40),
        }));
        return { items, next: data.next ? String(page + 1) : null };
      }
      let last = cursor;
      if (last) tagName(last);
      const items: ImageTag[] = [];
      let next: string | null = null;
      // Filtering GHCR tags is client-side at the protocol level: scan a bounded batch and expose continuation.
      for (let batch = 0; batch < (q ? 5 : 1); batch++) {
        const params = new URLSearchParams({ n: "100" });
        if (last) params.set("last", last);
        const { data, response } = await registryRequest(
          registry,
          name,
          `tags/list?${params}`,
        );
        if (!Array.isArray(data.tags))
          throw new RegistryError(
            502,
            "GHCR hat keine gültige Tag-Liste geliefert.",
          );
        for (const name of data.tags)
          if (
            typeof name === "string" &&
            (!q || name.toLowerCase().includes(q.toLowerCase()))
          )
            items.push({ name, platforms: [] });
        const tail = data.tags.at(-1);
        next =
          (response.headers.get("link") || data.tags.length === 100) &&
          typeof tail === "string" &&
          tail !== last
            ? tail
            : null;
        if (!next || items.length >= 50) break;
        last = next;
      }
      if(!cursor){
        const aliases=await Promise.allSettled(['latest','stable'].filter((aliasName)=>!q||aliasName.includes(q.toLowerCase())).map(async(aliasName)=>{
          const value=await manifest(registry,name,aliasName);
          return {name:aliasName,digest:value.digest,platforms:value.platforms} as ImageTag;
        }));
        const available=aliases.flatMap((result)=>result.status==='fulfilled'?[result.value]:[]);
        items.unshift(...available.filter((alias)=>!items.some((tag)=>tag.name===alias.name)));
      }
      return {
        items,
        next,
        notice:
          "GHCR liefert Tags alphabetisch. „Tag direkt prüfen“ findet auch Tags außerhalb der geladenen Seiten. Plattformen werden beim Auswählen aus dem Manifest gelesen.",
      };
    },
  );
}

export function mountImageBrowser(api: Router) {
  const limits = new Map<string, { until: number; count: number }>();
  const handle =
    (work: (req: Request) => Promise<unknown>) =>
    async (req: Request, res: Response) => {
      res.setHeader("Cache-Control", "no-store");
      const key = req.ip ?? "anonymous",
        now = Date.now();
      let limit = limits.get(key);
      if (!limit || limit.until < now) {
        limit = { until: now + 60000, count: 0 };
        limits.set(key, limit);
      }
      if (limits.size > 3000)
        for (const [key, value] of limits)
          if (value.until < now) limits.delete(key);
      if (++limit.count > 100) {
        res.setHeader("Retry-After", "60");
        res
          .status(429)
          .json({
            error: "Zu viele Image-Anfragen. Bitte eine Minute warten.",
          });
        return;
      }
      try {
        res.json(await work(req));
      } catch (error) {
        const known = error instanceof RegistryError;
        res
          .status(known ? error.status : 502)
          .json({
            error: known
              ? error.message
              : "Die Registry-Anfrage konnte nicht verarbeitet werden.",
          });
      }
    };
  const value = (req: Request, key: string, max: number) => {
    const raw = req.query[key];
    if (raw !== undefined && typeof raw !== "string")
      throw new RegistryError(400, "Ungültige Anfrage.");
    if ((raw ?? "").length > max)
      throw new RegistryError(400, "Die Suchanfrage ist zu lang.");
    return String(raw ?? "").trim();
  };
  api.get(
    "/images/search",
    handle(async (req) => {
      const registry = registryOf(value(req, "registry", 12)),
        q = value(req, "q", 150),
        owner = value(req, "owner", 100).toLowerCase(),
        sort = value(req, "sort", 20) || "relevance",
        page = Number(value(req, "page", 6) || 1);
      if (
        (owner && !/^[a-z0-9][a-z0-9_-]*$/.test(owner)) ||
        !["relevance", "downloads", "updated"].includes(sort) ||
        !Number.isInteger(page) ||
        page < 1 ||
        page > 100
      )
        throw new RegistryError(400, "Ungültiger Suchfilter.");
      return search(
        registry,
        q,
        owner,
        value(req, "official", 1) === "1",
        sort,
        page,
      );
    }),
  );
  api.get(
    "/images/repository",
    handle(async (req) => {
      const registry = registryOf(value(req, "registry", 12));
      return repository(registry, safeName(value(req, "name", 255), registry));
    }),
  );
  api.get(
    "/images/tags",
    handle(async (req) => {
      const registry = registryOf(value(req, "registry", 12));
      return tags(
        registry,
        safeName(value(req, "name", 255), registry),
        value(req, "q", 128),
        value(req, "cursor", 128),
      );
    }),
  );
  api.get(
    "/images/manifest",
    handle(async (req) => {
      const registry = registryOf(value(req, "registry", 12));
      return manifest(
        registry,
        safeName(value(req, "name", 255), registry),
        tagName(value(req, "tag", 135)),
      );
    }),
  );
}
