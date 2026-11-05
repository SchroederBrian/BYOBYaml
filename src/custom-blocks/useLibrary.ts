import { useCallback, useEffect, useState } from 'react';
import { normalizeDefinition, type CustomBlockDefinition, type CustomLibrary } from './model';
import { ensureCustomValidation, setCustomBlockLibrary } from './runtime';

const empty: CustomLibrary = { version: 1, revision: 0, blocks: [] };
async function request(method: 'GET' | 'PUT', body?: unknown) {
  const response = await fetch('/api/custom-blocks', { method, credentials: 'same-origin', headers: { 'X-BYOB': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Die Blockbibliothek ist momentan nicht erreichbar.');
  return data;
}
export function useCustomLibrary(allowed: boolean) {
  const [library, setLibrary] = useState<CustomLibrary>(empty);
  const [ready, setReady] = useState(false), [error, setError] = useState('');
  const install = useCallback((value: CustomLibrary) => {
    const normalized = { ...value, blocks: value.blocks.map(normalizeDefinition) };
    setCustomBlockLibrary(normalized.blocks); setLibrary(normalized); setError('');
  }, []);
  const reload = useCallback(async () => {
    if (!allowed) return;
    await ensureCustomValidation(); install(await request('GET')); setReady(true);
  }, [allowed, install]);
  useEffect(() => {
    let current = true;
    if (!allowed) { setReady(false); setLibrary(empty); return; }
    (async () => {
      try { await ensureCustomValidation(); const value = await request('GET'); if (current) { install(value); setReady(true); } }
      catch (e) { if (current) setError((e as Error).message); }
    })();
    return () => { current = false; setCustomBlockLibrary([]); };
  }, [allowed, install]);
  const save = async (definition: CustomBlockDefinition) => {
    if (!allowed) throw new Error('Bitte zuerst anmelden.');
    const result = await request('PUT', { baseRevision: library.revision, definition });
    install(result.library); return result.definition as CustomBlockDefinition;
  };
  return { library, ready, error, save, reload };
}
export type CustomLibraryController = ReturnType<typeof useCustomLibrary>;
