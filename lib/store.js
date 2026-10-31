import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export function createStore(root) {
  mkdirSync(root, { recursive: true });
  const db = new DatabaseSync(path.join(root, 'bruno.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, status TEXT NOT NULL, created TEXT NOT NULL, body TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT, at TEXT NOT NULL, message TEXT NOT NULL);
  `);
  const store = {
    create(input) {
      const job = { ...input, id: randomUUID(), status: input.status || 'queued', created: new Date().toISOString(), updated: new Date().toISOString() };
      db.prepare('INSERT INTO jobs VALUES (?,?,?,?)').run(job.id, job.status, job.created, JSON.stringify(job));
      return job;
    },
    get(id) { const row = db.prepare('SELECT body FROM jobs WHERE id=?').get(id); return row ? JSON.parse(row.body) : null; },
    list() { return db.prepare('SELECT body FROM jobs ORDER BY created DESC').all().map(r => JSON.parse(r.body)); },
    update(id, patch) {
      const old = store.get(id); if (!old) throw new Error('Run not found');
      const job = { ...old, ...patch, id, updated: new Date().toISOString() };
      db.prepare('UPDATE jobs SET status=?, body=? WHERE id=?').run(job.status, JSON.stringify(job), id);
      return job;
    },
    event(id, message) { db.prepare('INSERT INTO events(job_id,at,message) VALUES (?,?,?)').run(id, new Date().toISOString(), message); },
    events(id) { return db.prepare('SELECT at,message FROM events WHERE job_id=? ORDER BY id').all(id); },
    close() { db.close(); },
  };
  return store;
}
