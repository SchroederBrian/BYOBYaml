// Marketplace client.
// Web version (server build): same origin, session cookie.
// Desktop / browser dev: talks to the public server (VITE_MARKET_URL, default byobyaml.keksgames.de);
// browsing works anonymously, publishing uses a personal access token from "Anmelden".
import { db } from '../storage';
import type { ItemKind, ItemTarget, MarketItem, MarketItemFull, PublishInput, SortKey } from './shared';

export const SAME_ORIGIN = import.meta.env.VITE_SERVER === '1';
export const MARKET_URL = SAME_ORIGIN ? '' : String(import.meta.env.VITE_MARKET_URL || 'https://byobyaml.keksgames.de').replace(/\/$/, '');
export const MARKET_HOST = SAME_ORIGIN ? location.host : MARKET_URL.replace(/^https?:\/\//, '');

export interface MarketUser {
  id: number;
  name: string;
  email: string;
  admin?: boolean;
}

export class MarketError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const TOKEN_KEY = 'marketToken';
let token: string | null = null;
let tokenLoaded = false;
async function loadToken() {
  if (SAME_ORIGIN || tokenLoaded) return token;
  tokenLoaded = true;
  token = (await db.getSetting(TOKEN_KEY).catch(() => null)) || null;
  return token;
}

async function request<T>(method: string, path: string, body?: any): Promise<T> {
  await loadToken();
  let res: Response;
  try {
    res = await fetch(`${MARKET_URL}/api${path}`, {
      method,
      credentials: SAME_ORIGIN ? 'same-origin' : 'omit',
      headers: {
        'X-BYOB': '1',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new MarketError(0, `Keine Verbindung zu ${MARKET_HOST}. Bist du online?`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && token && !SAME_ORIGIN) {
      // token revoked or expired
      token = null;
      await db.setSetting(TOKEN_KEY, null);
    }
    throw new MarketError(res.status, data?.error || `Fehler ${res.status}`);
  }
  return data as T;
}

const enc = encodeURIComponent;

export interface ListQuery {
  q?: string;
  kind?: ItemKind | '';
  target?: ItemTarget | '';
  tag?: string;
  sort?: SortKey;
  author?: number;
  scope?: '' | 'mine' | 'starred' | 'reported';
  page?: number;
}

export interface ListResult {
  items: MarketItem[];
  total: number;
  page: number;
  pages: number;
}

export const market = {
  list(q: ListQuery) {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== '' && v !== null) p.set(k, String(v));
    return request<ListResult>('GET', `/market/items?${p}`);
  },
  get: (id: string) => request<MarketItemFull>('GET', `/market/items/${enc(id)}`),
  tags: () => request<{ tag: string; n: number }[]>('GET', '/market/tags'),
  stats: () => request<{ items: number; authors: number; downloads: number }>('GET', '/market/stats'),
  publish: (input: PublishInput) => request<MarketItem>('POST', '/market/items', input),
  update: (id: string, input: Partial<PublishInput>) => request<MarketItem>('PUT', `/market/items/${enc(id)}`, input),
  remove: (id: string) => request<{ ok: true }>('DELETE', `/market/items/${enc(id)}`),
  star: (id: string, on: boolean) => request<{ stars: number; starred: boolean }>(on ? 'POST' : 'DELETE', `/market/items/${enc(id)}/star`),
  downloaded: (id: string) => request<{ downloads: number }>('POST', `/market/items/${enc(id)}/download`).catch(() => null),
  report: (id: string, reason: string) => request<{ ok: true }>('POST', `/market/items/${enc(id)}/report`, { reason }),
  reports: (id: string) => request<{ reason: string; createdAt: number; user: string }[]>('GET', `/market/items/${enc(id)}/reports`),
  moderate: (id: string, hidden: boolean) => request<{ ok: true }>('POST', `/market/items/${enc(id)}/moderate`, { hidden }),

  // ---------- account ----------
  async me(): Promise<MarketUser | null> {
    if (!SAME_ORIGIN && !(await loadToken())) return null;
    try {
      return (await request<{ user: MarketUser }>('GET', '/auth/me')).user;
    } catch (e) {
      if (e instanceof MarketError && e.status === 401) return null;
      throw e;
    }
  },
  /** desktop: exchange e-mail + password for a personal access token (never stores the password) */
  async login(email: string, password: string): Promise<MarketUser> {
    const r = await request<{ token: string; user: MarketUser }>('POST', '/auth/token', { email, password, label: 'BYOBYaml Desktop' });
    token = r.token;
    tokenLoaded = true;
    await db.setSetting(TOKEN_KEY, r.token);
    return r.user;
  },
  async logout() {
    if (SAME_ORIGIN) return;
    await request('DELETE', '/auth/token').catch(() => {});
    token = null;
    await db.setSetting(TOKEN_KEY, null);
  },
  registerUrl: () => `${MARKET_URL || location.origin}/app/`,
  itemUrl: (id: string) => `${MARKET_URL || location.origin}/app/?market=${enc(id)}`,
};
