import { useEffect, useRef, useState } from 'react';
import type { Project } from './project';
import { createVault, decryptVault, encryptVault, type SecretEntry, type SecretVaultEnvelope } from './secrets';

type Session = { projectId: string; key: CryptoKey; entries: SecretEntry[]; envelope: SecretVaultEnvelope };
const NO_SECRETS: SecretEntry[] = [];

export function useSecretVault(project: Project | null, persist: (projectId: string, envelope: SecretVaultEnvelope) => Promise<void>) {
  const [stored, setStored] = useState<Session | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const epoch = useRef(0);
  const session = stored?.projectId === project?.id && stored?.envelope.ciphertext === project?.secretVault?.ciphertext ? stored : null;
  const lock = () => { epoch.current++; setStored(null); setBusy(false); setError(''); };

  useEffect(() => {
    lock();
    return () => { epoch.current++; };
  }, [project?.id]);

  useEffect(() => {
    if (!session) return;
    let timer: number;
    const reset = () => { window.clearTimeout(timer); timer = window.setTimeout(lock, 15 * 60_000); };
    const logout = () => lock();
    reset();
    window.addEventListener('pointerdown', reset);
    window.addEventListener('keydown', reset);
    window.addEventListener('byob:logged-out', logout);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pointerdown', reset);
      window.removeEventListener('keydown', reset);
      window.removeEventListener('byob:logged-out', logout);
    };
  }, [!!session]);

  const run = async (work: (current: () => boolean) => Promise<void>): Promise<boolean> => {
    const generation = epoch.current;
    setBusy(true);
    setError('');
    try {
      await work(() => epoch.current === generation);
      return epoch.current === generation;
    } catch (e) {
      if (epoch.current === generation) setError(e instanceof Error ? e.message : 'Tresor konnte nicht gespeichert werden. Bitte erneut versuchen.');
      return false;
    } finally {
      if (epoch.current === generation) setBusy(false);
    }
  };

  const unlock = (password: string) => run(async (current) => {
    if (!project) return;
    const envelope = project.secretVault;
    const opened = envelope ? { ...await decryptVault(envelope, password), envelope } : await createVault(password);
    if (!current()) return;
    if (!envelope) await persist(project.id, opened.envelope);
    if (current()) setStored({ projectId: project.id, ...opened });
  });

  const save = (entries: SecretEntry[]) => run(async (current) => {
    if (!session) throw new Error('Bitte zuerst den Tresor entsperren.');
    const envelope = await encryptVault(entries, session.key, session.envelope.salt);
    if (!current()) return;
    await persist(session.projectId, envelope);
    if (current()) setStored({ ...session, entries, envelope });
  });

  const changePassword = (password: string) => run(async (current) => {
    if (!session) throw new Error('Bitte zuerst den Tresor entsperren.');
    const fresh = await createVault(password);
    const envelope = await encryptVault(session.entries, fresh.key, fresh.envelope.salt);
    if (!current()) return;
    await persist(session.projectId, envelope);
    if (current()) setStored({ ...session, key: fresh.key, envelope });
  });

  return { unlocked: !!session, entries: session?.entries ?? NO_SECRETS, busy, error, lock, unlock, save, changePassword };
}

export type VaultController = ReturnType<typeof useSecretVault>;
