import type { RequestHandler, Router } from 'express';
import type { Pool } from 'mysql2/promise';
import { normalizeDefinition, type CustomLibrary } from '../src/custom-blocks/model';
import { validateDefinition } from '../src/custom-blocks/validation';

export const CUSTOM_BLOCK_TABLES = [`CREATE TABLE IF NOT EXISTS custom_block_libraries (
  user_id INT UNSIGNED NOT NULL PRIMARY KEY,
  data MEDIUMTEXT NOT NULL,
  CONSTRAINT fk_custom_block_library_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`];
const empty = (): CustomLibrary => ({ version: 1, revision: 0, blocks: [] });
function readLibrary(value?: string): CustomLibrary {
  if (!value) return empty();
  const library = JSON.parse(value);
  if (library?.version !== 1 || !Number.isSafeInteger(library.revision) || !Array.isArray(library.blocks)) throw new Error('Die Blockbibliothek ist beschädigt.');
  return { version: 1, revision: library.revision, blocks: library.blocks.map(normalizeDefinition) };
}
export function mountCustomBlocks(api: Router, options: { pool: Pool; requireUser: RequestHandler }) {
  const { pool, requireUser } = options;
  api.get('/custom-blocks', requireUser, async (req, res, next) => {
    try {
      const [rows]: any = await pool.query('SELECT data FROM custom_block_libraries WHERE user_id = ?', [(req as any).user.id]);
      res.setHeader('Cache-Control', 'no-store'); res.json(readLibrary(rows[0]?.data));
    } catch (error) { next(error); }
  });
  api.put('/custom-blocks', requireUser, async (req, res, next) => {
    if (!req.body || !Number.isSafeInteger(req.body.baseRevision)) return void res.status(400).json({ error: 'Ungültige Bibliotheksversion.' });
    let checked: ReturnType<typeof validateDefinition>;
    try {
      if (JSON.stringify(req.body.definition).length > 80000) return void res.status(413).json({ error: 'Die Blockdefinition ist zu groß.' });
      checked = validateDefinition(req.body.definition);
    } catch { return void res.status(400).json({ error: 'Ungültige Blockdefinition.' }); }
    if (!checked.definition || checked.issues.length) return void res.status(400).json({ error: checked.issues[0]?.message || 'Der Block ist nicht gültig.', issues: checked.issues });
    let connection: Awaited<ReturnType<Pool['getConnection']>> | undefined;
    try {
      connection = await pool.getConnection();
      await connection.beginTransaction();
      const userId = (req as any).user.id;
      await connection.query('INSERT IGNORE INTO custom_block_libraries (user_id,data) VALUES (?,?)', [userId, JSON.stringify(empty())]);
      const [rows]: any = await connection.query('SELECT data FROM custom_block_libraries WHERE user_id = ? FOR UPDATE', [userId]);
      const library = readLibrary(rows[0]?.data), definition = checked.definition;
      const old = library.blocks.find((block) => block.id === definition.id);
      if (library.revision !== req.body.baseRevision || old && old.revision !== definition.revision || !old && definition.revision !== 0) {
        await connection.rollback(); return void res.status(409).json({ error: 'Die Bibliothek wurde in einem anderen Fenster geändert. Bitte neu laden; dein Entwurf bleibt erhalten.' });
      }
      if (!old && library.blocks.length >= 50) { await connection.rollback(); return void res.status(400).json({ error: 'Höchstens 50 eigene Blocktypen pro Konto.' }); }
      if (!definition.archived && library.blocks.some((block) => block.id !== definition.id && !block.archived && block.kind === definition.kind && block.name.toLocaleLowerCase('de') === definition.name.toLocaleLowerCase('de'))) {
        await connection.rollback(); return void res.status(400).json({ error: 'Dieser Blockname ist in deiner Bibliothek bereits vergeben.' });
      }
      const saved = { ...definition, revision: (old?.revision ?? 0) + 1 };
      const updated: CustomLibrary = { version: 1, revision: library.revision + 1, blocks: [...library.blocks.filter((block) => block.id !== saved.id), saved] };
      const json = JSON.stringify(updated);
      if (Buffer.byteLength(json, 'utf8') > 2000000) { await connection.rollback(); return void res.status(413).json({ error: 'Die Bibliothek überschreitet 2 MB. Bausteinstruktur verkleinern oder einzelne Typen exportieren.' }); }
      await connection.query('UPDATE custom_block_libraries SET data = ? WHERE user_id = ?', [json, userId]);
      await connection.commit(); res.json({ library: updated, definition: saved });
    } catch (error) { await connection?.rollback(); next(error); }
    finally { connection?.release(); }
  });
}
