// Only encrypted envelopes belong in Project/storage; unlocked values stay in memory.
import type { Project, ProjectFile, Variable } from './project';

export interface SecretEntry extends Variable {
  id: string;
  fileId?: string;
}

export interface SecretVaultEnvelope {
  version: 1;
  algorithm: 'AES-256-GCM';
  kdf: 'PBKDF2-SHA-256';
  iterations: 600000;
  salt: string;
  iv: string;
  ciphertext: string;
}

const ITERATIONS = 600000;
const encoder = new TextEncoder();
const additionalData = encoder.encode('byobyaml.secret-vault.v1');
const encode = (bytes: Uint8Array) => btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''));
const decode = (value: string) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));

export function normalizeVault(value: unknown): SecretVaultEnvelope | undefined {
  if (value == null) return undefined;
  const v = value as SecretVaultEnvelope;
  if (v.version !== 1 || v.algorithm !== 'AES-256-GCM' || v.kdf !== 'PBKDF2-SHA-256' || v.iterations !== ITERATIONS ||
      typeof v.salt !== 'string' || typeof v.iv !== 'string' || typeof v.ciphertext !== 'string' || v.ciphertext.length > 2_000_000) {
    throw new Error('Das Secret-Tresor-Format wird nicht unterstützt.');
  }
  try {
    if (decode(v.salt).length !== 16 || decode(v.iv).length !== 12 || decode(v.ciphertext).length < 16) throw new Error();
  } catch {
    throw new Error('Der verschlüsselte Secret-Tresor ist beschädigt.');
  }
  // Explicit allowlist: never carry a password, key or decrypted values into storage.
  return { version: 1, algorithm: 'AES-256-GCM', kdf: 'PBKDF2-SHA-256', iterations: ITERATIONS, salt: v.salt, iv: v.iv, ciphertext: v.ciphertext };
}

export async function deriveVaultKey(password: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  if (!globalThis.crypto?.subtle) throw new Error('Der Tresor benötigt HTTPS und einen Browser mit Web Crypto.');
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS }, material,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function encryptVault(entries: SecretEntry[], key: CryptoKey, salt: string): Promise<SecretVaultEnvelope> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const bytes = encoder.encode(JSON.stringify(entries));
  try {
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData, tagLength: 128 }, key, bytes);
    return { version: 1, algorithm: 'AES-256-GCM', kdf: 'PBKDF2-SHA-256', iterations: ITERATIONS, salt, iv: encode(iv), ciphertext: encode(new Uint8Array(ciphertext)) };
  } finally {
    bytes.fill(0);
  }
}

export async function createVault(password: string) {
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveVaultKey(password, saltBytes);
  const envelope = await encryptVault([], key, encode(saltBytes));
  return { key, envelope, entries: [] as SecretEntry[] };
}

export async function decryptVault(envelope: SecretVaultEnvelope, password: string) {
  const valid = normalizeVault(envelope)!;
  const key = await deriveVaultKey(password, decode(valid.salt));
  let bytes: ArrayBuffer;
  try {
    bytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(valid.iv), additionalData, tagLength: 128 }, key, decode(valid.ciphertext));
  } catch {
    throw new Error('Master-Passwort falsch oder Tresor beschädigt. Bitte erneut versuchen.');
  }
  try {
    const entries: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!Array.isArray(entries) || entries.some((e) => !e || typeof e.id !== 'string' || !/^[A-Za-z_][\w.-]*$/.test(e.name) ||
        (e.fileId !== undefined && typeof e.fileId !== 'string') || !e.values || typeof e.values !== 'object' || Array.isArray(e.values) || Object.values(e.values).some((v) => typeof v !== 'string'))) {
      throw new Error('Der Secret-Tresor enthält ungültige Einträge.');
    }
    return { key, entries: entries as SecretEntry[] };
  } finally {
    new Uint8Array(bytes).fill(0);
  }
}

/** Same precedence as variables: globals, global secrets, locals, local secrets. */
export function secretVariables(project: Project, file: ProjectFile | undefined, entries: SecretEntry[], masked: boolean): Record<string, string> {
  const values = (list: Variable[]) => Object.fromEntries(list.map((v) => [v.name, v.values[project.activeEnv] ?? '']));
  const secrets = (fileId?: string) => Object.fromEntries(entries.filter((e) => e.fileId === fileId).map((e) => {
    if (!masked && !Object.hasOwn(e.values, project.activeEnv)) throw new Error(`Secret ${e.name}: Wert für Umgebung „${project.activeEnv}“ fehlt. Im Tresor ergänzen.`);
    return [e.name, masked ? `[Secret: ${e.name}]` : e.values[project.activeEnv]];
  }));
  return { ...values(project.variables), ...secrets(), ...values(file?.variables ?? []), ...(file ? secrets(file.id) : {}) };
}
