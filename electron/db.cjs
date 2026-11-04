// Persistent local storage: SQLite file in %APPDATA%\BYOBYaml (no server).
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

function openDb(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'byobyaml.db');
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      data TEXT NOT NULL,
      file_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS snippets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'user',
      data TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  const q = {
    listProjects: db.prepare('SELECT id, title, file_count AS fileCount, created_at AS createdAt, updated_at AS updatedAt FROM projects ORDER BY updated_at DESC'),
    getProject: db.prepare('SELECT data FROM projects WHERE id = ?'),
    upsertProject: db.prepare(`
      INSERT INTO projects (id, title, data, file_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET title = excluded.title, data = excluded.data, file_count = excluded.file_count, updated_at = excluded.updated_at`),
    deleteProject: db.prepare('DELETE FROM projects WHERE id = ?'),
    listSnippets: db.prepare('SELECT id, name, category, data, created_at AS createdAt FROM snippets ORDER BY name COLLATE NOCASE'),
    upsertSnippet: db.prepare(`
      INSERT INTO snippets (id, name, category, data, created_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, category = excluded.category, data = excluded.data`),
    deleteSnippet: db.prepare('DELETE FROM snippets WHERE id = ?'),
    getSetting: db.prepare('SELECT value FROM settings WHERE key = ?'),
    setSetting: db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),
  };

  return {
    file,
    listProjects: () => q.listProjects.all().map((r) => ({ ...r })),
    getProject: (id) => {
      const r = q.getProject.get(id);
      return r ? JSON.parse(r.data) : null;
    },
    saveProject: (p) => {
      const now = Date.now();
      q.upsertProject.run(p.id, p.title || 'Unbenannt', JSON.stringify(p), (p.files || []).length, p.createdAt || now, now);
      return now;
    },
    deleteProject: (id) => q.deleteProject.run(id).changes > 0,
    listSnippets: () => q.listSnippets.all().map((r) => ({ id: r.id, name: r.name, category: r.category, createdAt: r.createdAt, block: JSON.parse(r.data) })),
    saveSnippet: (s) => {
      q.upsertSnippet.run(s.id, s.name, s.category || 'user', JSON.stringify(s.block), s.createdAt || Date.now());
      return true;
    },
    deleteSnippet: (id) => q.deleteSnippet.run(id).changes > 0,
    getSetting: (key) => {
      const r = q.getSetting.get(key);
      return r ? JSON.parse(r.value) : null;
    },
    setSetting: (key, value) => {
      q.setSetting.run(key, JSON.stringify(value));
      return true;
    },
    close: () => db.close(),
  };
}

module.exports = { openDb };
