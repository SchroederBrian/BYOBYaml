export type Registry = "dockerhub" | "ghcr";
export type ImageSort = "relevance" | "downloads" | "updated";
export interface RegistryImage {
  registry: Registry;
  name: string;
  reference: string;
  description: string;
  owner: string;
  official: boolean;
  stars?: number;
  pulls?: number;
  updated?: string;
  url: string;
  suggestedTag?: string;
}
export interface ImageSearch {
  registry: Registry;
  items: RegistryImage[];
  total: number;
  page: number;
  hasMore: boolean;
  notice?: string;
}
export interface ImageTag {
  name: string;
  digest?: string;
  platforms: string[];
  size?: number;
  updated?: string;
}
export interface ImageTags {
  items: ImageTag[];
  next: string | null;
  notice?: string;
}
export interface ImageManifest {
  digest: string;
  platforms: string[];
  variants: { digest: string; platform: string; size?: number }[];
  verifiedAt: string;
  mediaType: string;
}
export interface ImageTarget {
  id: string;
  label: string;
  reference: string;
  apply: (reference: string) => void;
}

export function parseImageReference(
  value: string,
): { registry: Registry; name: string; tag: string } | null {
  let text = value.trim().replace(/^https?:\/\//, "");
  let registry: Registry = "dockerhub";
  if (text.startsWith("ghcr.io/")) {
    registry = "ghcr";
    text = text.slice(8);
  } else
    text = text.replace(
      /^(?:docker\.io|index\.docker\.io|registry-1\.docker\.io)\//,
      "",
    );
  if (!text || /[\s${}?]/.test(text)) return null;
  let tag = "latest";
  if (text.includes("@")) {
    const at = text.indexOf("@");
    tag = text.slice(at + 1);
    text = text.slice(0, at);
  } else if (text.lastIndexOf(":") > text.lastIndexOf("/")) {
    const at = text.lastIndexOf(":");
    tag = text.slice(at + 1);
    text = text.slice(0, at);
  }
  if (registry === "dockerhub" && text.split("/").length === 1)
    text = "library/" + text;
  if (
    text.length > 255 ||
    !text
      .split("/")
      .every((part) => /^[a-z0-9]+(?:[._-]+[a-z0-9]+)*$/.test(part)) ||
    text.split("/").length < 2
  )
    return null;
  if (!/^(?:[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}|sha256:[a-f0-9]{64})$/.test(tag))
    return null;
  return { registry, name: text, tag };
}
export const imageBase = (registry: Registry, name: string) =>
  registry === "ghcr" ? `ghcr.io/${name}` : name.replace(/^library\//, "");
