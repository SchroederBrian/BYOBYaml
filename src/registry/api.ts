import { MARKET_URL } from "../market/api";
import type {
  ImageManifest,
  ImageSearch,
  ImageTags,
  RegistryImage,
} from "./types";

export async function registryRequest<T>(
  route: string,
  params: Record<string, string | number | boolean | undefined>,
  signal?: AbortSignal,
): Promise<T> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    if (value !== undefined && value !== "") query.set(key, String(value));
  const response = await fetch(`${MARKET_URL}/api/images/${route}?${query}`, {
    credentials: "omit",
    signal,
    headers: { "X-BYOB": "1" },
  });
  const data = await response
    .json()
    .catch(() => ({
      error: "Der Image-Dienst hat keine gültige Antwort geliefert.",
    }));
  if (!response.ok)
    throw new Error(
      data.error || "Der Image-Dienst ist momentan nicht erreichbar.",
    );
  return data;
}
export const imageApi = {
  search: (
    params: Record<string, string | number | boolean | undefined>,
    signal?: AbortSignal,
  ) => registryRequest<ImageSearch>("search", params, signal),
  repository: (registry: string, name: string, signal?: AbortSignal) =>
    registryRequest<RegistryImage>("repository", { registry, name }, signal),
  tags: (
    registry: string,
    name: string,
    q: string,
    cursor: string,
    signal?: AbortSignal,
  ) =>
    registryRequest<ImageTags>("tags", { registry, name, q, cursor }, signal),
  manifest: (
    registry: string,
    name: string,
    tag: string,
    signal?: AbortSignal,
  ) =>
    registryRequest<ImageManifest>("manifest", { registry, name, tag }, signal),
};
