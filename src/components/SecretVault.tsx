import { useState } from 'react';
import type { Project, ProjectFile } from '../project';
import type { SecretEntry } from '../secrets';
import type { VaultController } from '../useSecretVault';
import { Icon } from './Icons';
import '../styles/vault.css';

export default function SecretVault({ project, activeFile, vault, flash }: {
  project: Project; activeFile?: ProjectFile; vault: VaultController; flash: (message: string) => void;
}) {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [draft, setDraft] = useState<SecretEntry | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [formError, setFormError] = useState('');
  const creating = !project.secretVault;
  const error = formError || vault.error;

  const submitPassword = async () => {
    setFormError('');
    if ((creating || changingPassword) && password.length < 12) return setFormError('Bitte ein Master-Passwort mit mindestens 12 Zeichen wählen.');
    if ((creating || changingPassword) && password !== confirmation) return setFormError('Die Master-Passwörter stimmen nicht überein.');
    const ok = changingPassword ? await vault.changePassword(password) : await vault.unlock(password);
    setPassword('');
    setConfirmation('');
    if (ok) { setChangingPassword(false); flash(creating ? 'Secret-Tresor angelegt' : changingPassword ? 'Master-Passwort geändert' : 'Secret-Tresor entsperrt'); }
  };

  const saveSecret = async () => {
    if (!draft) return;
    const name = draft.name.trim();
    if (!/^[A-Za-z_][\w.-]*$/.test(name)) return setFormError('Name: mit Buchstabe oder _ beginnen; danach Buchstaben, Zahlen, _, Punkt oder Bindestrich.');
    if (vault.entries.some((s) => s.id !== draft.id && s.name === name && s.fileId === draft.fileId)) return setFormError('Dieser Secret-Name ist in diesem Bereich bereits vergeben.');
    const variables = draft.fileId ? project.files.find((f) => f.id === draft.fileId)?.variables : project.variables;
    if (variables?.some((v) => v.name === name)) return setFormError('Es gibt bereits eine normale Variable mit diesem Namen in diesem Bereich. Bitte einen anderen Namen wählen.');
    const entry = { ...draft, name, values: Object.fromEntries(project.envs.map((env) => [env, draft.values[env] ?? ''])) };
    const entries = vault.entries.some((s) => s.id === entry.id) ? vault.entries.map((s) => s.id === entry.id ? entry : s) : [...vault.entries, entry];
    setFormError('');
    if (await vault.save(entries)) { setDraft(null); setRevealed(false); flash('Secret verschlüsselt gespeichert'); }
  };

  return (
    <section className="secret-vault" aria-label="Secret-Tresor">
      <div className="vault-heading">
        <h3><Icon name="lock" size={16} /> Secret-Tresor</h3>
        <span className={`vault-state ${vault.unlocked ? 'unlocked' : ''}`}>{vault.unlocked ? 'Entsperrt' : creating ? 'Nicht eingerichtet' : 'Gesperrt'}</span>
      </div>
      <p className="vault-copy">Passwörter und API-Schlüssel verschlüsselt im Projekt speichern und als <code>{'${NAME}'}</code> verwenden. Werte bleiben in der YAML-Vorschau verdeckt.</p>

      {(!vault.unlocked || changingPassword) ? (
        <form className="vault-form" onSubmit={(event) => { event.preventDefault(); void submitPassword(); }}>
          <label>{changingPassword ? 'Neues Master-Passwort' : 'Master-Passwort'}
            <input className="input" type="password" required maxLength={1024} minLength={creating || changingPassword ? 12 : 1}
              autoComplete={creating || changingPassword ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} disabled={vault.busy} />
          </label>
          {(creating || changingPassword) && <label>Master-Passwort wiederholen
            <input className="input" type="password" required autoComplete="new-password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} disabled={vault.busy} />
          </label>}
          <p className="vault-copy">{creating || changingPassword ? 'Mindestens 12 Zeichen. Dieses Passwort wird nicht gespeichert und kann nicht zurückgesetzt werden. Bewahre es sicher auf.' : 'Nach Neuladen, Projektwechsel oder 15 Minuten Inaktivität wird der Tresor automatisch gesperrt.'}</p>
          <div className="vault-actions">
            <button className="btn" type="submit" disabled={vault.busy}>{vault.busy ? 'Bitte warten …' : changingPassword ? 'Passwort ändern' : creating ? 'Tresor anlegen' : 'Entsperren'}</button>
            {changingPassword && <button className="btn ghost" type="button" disabled={vault.busy} onClick={() => { setChangingPassword(false); setPassword(''); setConfirmation(''); }}>Abbrechen</button>}
          </div>
        </form>
      ) : (
        <>
          <div className="vault-actions">
            <button className="btn sm" disabled={vault.busy || !!draft} onClick={() => { setFormError(''); setDraft({ id: crypto.randomUUID(), name: '', values: Object.fromEntries(project.envs.map((e) => [e, ''])) }); }}><Icon name="plus" size={14} /> Secret</button>
            <button className="btn ghost sm" disabled={vault.busy || !!draft} onClick={() => { setFormError(''); setChangingPassword(true); }}>Passwort ändern</button>
            <button className="btn ghost sm" disabled={vault.busy} onClick={() => { setDraft(null); setRevealed(false); vault.lock(); }}><Icon name="lock" size={13} /> Sperren</button>
          </div>
          {!vault.entries.length && !draft && <p className="vault-copy vault-empty">Noch keine Secrets. Lege ein Passwort oder einen API-Schlüssel mit <b>+ Secret</b> an.</p>}
          <ul className="vault-list">
            {vault.entries.map((entry) => (
              <li key={entry.id}>
                <div className="vault-entry"><code>{'${' + entry.name + '}'}</code><span>{entry.fileId ? project.files.find((f) => f.id === entry.fileId)?.name ?? 'Datei nicht mehr vorhanden' : 'Für alle Dateien'}</span></div>
                <button className="icon-btn" title={`${entry.name}: Platzhalter kopieren`} onClick={async () => { try { await navigator.clipboard.writeText('${' + entry.name + '}'); flash('Secret-Platzhalter kopiert'); } catch { setFormError('Zwischenablage nicht verfügbar. Platzhalter manuell kopieren.'); } }}><Icon name="copy" size={14} /></button>
                <button className="icon-btn" title={`${entry.name} bearbeiten`} disabled={vault.busy || !!draft} onClick={() => { setFormError(''); setRevealed(false); setDraft(structuredClone(entry)); }}><Icon name="edit" size={14} /></button>
                <button className="icon-btn danger" title={`${entry.name} löschen`} disabled={vault.busy || !!draft} onClick={async () => { if (window.confirm(`Secret „${entry.name}“ aus dem Tresor löschen?`)) { if (await vault.save(vault.entries.filter((s) => s.id !== entry.id))) flash('Secret entfernt'); } }}><Icon name="trash" size={14} /></button>
              </li>
            ))}
          </ul>
          {draft && (
            <form className="vault-form vault-editor" onSubmit={(event) => { event.preventDefault(); void saveSecret(); }}>
              <label>Secret-Name<input className="input mono" required autoComplete="off" spellCheck={false} placeholder="API_KEY" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} disabled={vault.busy} /></label>
              <label>Gültig für<select className="input" value={draft.fileId ?? ''} onChange={(e) => setDraft({ ...draft, fileId: e.target.value || undefined })} disabled={vault.busy}>
                <option value="">Alle Dateien</option>
                {project.files.map((file) => <option key={file.id} value={file.id}>{file.folder ? `${file.folder}/` : ''}{file.name}{file.id === activeFile?.id ? ' (ausgewählt)' : ''}</option>)}
              </select></label>
              {project.envs.map((env) => <label key={env}>Wert für {env}{env === project.activeEnv ? ' (aktive Umgebung)' : ''}
                <div className="vault-value"><input className="input mono" type={revealed ? 'text' : 'password'} autoComplete="off" spellCheck={false} aria-label={`Secret-Wert (${env})`} value={draft.values[env] ?? ''} onChange={(e) => setDraft({ ...draft, values: { ...draft.values, [env]: e.target.value } })} disabled={vault.busy} />
                  <button className="icon-btn" type="button" title={revealed ? 'Secret-Werte verbergen' : 'Secret-Werte anzeigen'} aria-pressed={revealed} onClick={() => setRevealed(!revealed)}><Icon name={revealed ? 'eyeOff' : 'eye'} size={15} /></button></div>
              </label>)}
              <div className="vault-actions"><button className="btn" type="submit" disabled={vault.busy}>{vault.busy ? 'Speichert …' : 'Verschlüsselt speichern'}</button><button className="btn ghost" type="button" disabled={vault.busy} onClick={() => { setDraft(null); setRevealed(false); setFormError(''); }}>Abbrechen</button></div>
            </form>
          )}
          <p className="vault-copy">YAML kopieren oder exportieren enthält die entschlüsselten Werte. Projektdateien und Backups enthalten ausschließlich den verschlüsselten Tresor. Der Tresor wird nicht im Marktplatz geteilt.</p>
        </>
      )}
      {error && <p className="vault-error" role="alert">{error}</p>}
    </section>
  );
}
