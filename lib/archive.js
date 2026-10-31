import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import {stat, realpath, readdir, readFile} from 'node:fs/promises';
import path from 'node:path';
import {sha256} from './media.js';
import {ARCHIVE_BUCKET} from './supabase.js';

const hash = value=>createHash('sha256').update(value).digest('hex');
const isId = id=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
const mime = file=>({'.mp4':'video/mp4','.webm':'video/webm','.mov':'video/quicktime','.jpg':'image/jpeg'}[path.extname(file).toLowerCase()] || 'application/octet-stream');

export function archiveRecord(kind, record, dataDir) {
  if (!['job','live'].includes(kind) || !isId(record.id)) throw Error('Invalid archive run ID.');
  const document = structuredClone(record);
  delete document.sourceFile;
  const root = path.join(dataDir, kind === 'job' ? 'runs' : 'live', record.id);
  const files = [];
  const add = (file, role, extra = {})=>files.push({file, role, ...extra});
  if (kind === 'job') {
    if (record.sourceFile && !['receiving','downloading'].includes(record.status)) add(record.sourceFile, 'original');
    if (record.media) {
      add(path.join(root,'video.mp4'), 'video');
      for (const f of record.media.frames) add(path.join(root,'frames',f.file), 'frame', {seconds:f.seconds, index:f.index});
    }
  } else {
    if (record.videoUrl === `/live-media/${record.id}/replay.mp4`) add(path.join(root,'replay.mp4'), 'video');
    for (const f of record.frames || []) add(path.join(root,'frames',f.file), 'frame', {seconds:f.seconds, seq:f.seq});
  }
  return {kind, id:record.id, document, files, root};
}

// Read local exports when Terse is unavailable; live actor snapshots override them.
export async function savedLiveSessions(dataDir) {
  let entries;
  try { entries = await readdir(path.join(dataDir,'live')); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
  const sessions = [];
  for (const id of entries.filter(isId)) {
    try { sessions.push(JSON.parse(await readFile(path.join(dataDir,'live',id,'session.json'),'utf8'))); }
    catch (e) { if (e.code !== 'ENOENT' && !(e instanceof SyntaxError)) throw e; }
  }
  return sessions;
}

export class SupabaseArchive {
  constructor({dataDir, remote, configurationError = null}) {
    this.dataDir = path.resolve(dataDir); this.remote = remote; this.error = configurationError;
    this.running = null; this.closed = false; this.lastSuccess = null;
    if (!remote) return;
    mkdirSync(this.dataDir, {recursive:true});
    this.scope = hash(remote.scope);
    this.db = new DatabaseSync(path.join(this.dataDir,'supabase-sync.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS archive_queue (
        scope TEXT NOT NULL, kind TEXT NOT NULL, id TEXT NOT NULL, version TEXT NOT NULL,
        payload TEXT NOT NULL, done_version TEXT, attempts INTEGER NOT NULL DEFAULT 0,
        retry_at INTEGER NOT NULL DEFAULT 0, error TEXT, PRIMARY KEY(scope,kind,id));
      CREATE TABLE IF NOT EXISTS archive_files (
        scope TEXT NOT NULL, object_path TEXT NOT NULL, sha256 TEXT NOT NULL,
        PRIMARY KEY(scope,object_path));`);
  }
  enqueue(kind, record) {
    if (!this.remote || this.closed) return;
    const payload = JSON.stringify(archiveRecord(kind,record,this.dataDir)), version = hash(payload);
    this.db.prepare(`INSERT INTO archive_queue(scope,kind,id,version,payload) VALUES (?,?,?,?,?)
      ON CONFLICT(scope,kind,id) DO UPDATE SET version=excluded.version,payload=excluded.payload
      WHERE archive_queue.version<>excluded.version`).run(this.scope,kind,record.id,version,payload);
  }
  status() {
    if (!this.remote) return {configured:false, error:this.error, pending:0, synced:0};
    const totals = this.db.prepare(`SELECT
      sum(CASE WHEN done_version IS NULL OR version<>done_version THEN 1 ELSE 0 END) AS pending,
      sum(CASE WHEN version=done_version THEN 1 ELSE 0 END) AS synced,
      sum(CASE WHEN error IS NOT NULL THEN 1 ELSE 0 END) AS failed
      FROM archive_queue WHERE scope=?`).get(this.scope);
    return {configured:true, provider:'Supabase', mode:'private archive', bucket:ARCHIVE_BUCKET,
      pending:totals.pending || 0, synced:totals.synced || 0, failed:totals.failed || 0,
      syncing:!!this.running, lastSuccess:this.lastSuccess, error:this.error};
  }
  flush({force = false} = {}) {
    if (!this.remote || this.closed) return Promise.resolve();
    if (this.running) return this.running;
    this.running = this.drain(force).finally(()=>{this.running = null;});
    return this.running;
  }
  async drain(force) {
    const rows = this.db.prepare(`SELECT * FROM archive_queue WHERE scope=?
      AND (done_version IS NULL OR version<>done_version) AND retry_at<=? ORDER BY retry_at,kind,id`)
      .all(this.scope, force ? Number.MAX_SAFE_INTEGER : Date.now());
    if (!rows.length) return;
    try { await this.remote.ready(); }
    catch (e) { for (const row of rows) this.fail(row,e); return; }
    for (const row of rows) {
      if (this.closed) break;
      try {
        await this.sync(JSON.parse(row.payload));
        // A newer snapshot can arrive during an upload. Acknowledge only this version.
        this.db.prepare(`UPDATE archive_queue SET done_version=?,attempts=0,retry_at=0,error=NULL
          WHERE scope=? AND kind=? AND id=?`).run(row.version,this.scope,row.kind,row.id);
        this.lastSuccess = new Date().toISOString(); this.error = null;
      } catch (e) { this.fail(row,e); }
    }
  }
  fail(row, error) {
    // Only our bounded error messages are persisted; never raw SDK/network errors.
    const message = /^(Supabase |Archive )/.test(error.message) ? error.message.slice(0,240) : 'Archive upload failed. Local data is retained; retry is pending.';
    this.error = message;
    this.db.prepare(`UPDATE archive_queue SET attempts=attempts+1,retry_at=?,error=? WHERE scope=? AND kind=? AND id=?`)
      .run(Date.now() + Math.min(300000, 5000 * 2 ** Math.min(row.attempts,6)),message,this.scope,row.kind,row.id);
  }
  async sync(record) {
    const assets = [];
    const root = await realpath(record.root).catch(()=>null);
    for (const item of record.files) {
      const actual = await realpath(item.file).catch(()=>null);
      // Reject traversal and symlinks outside this run, including another run's files.
      if (!root || !actual || !actual.startsWith(root + path.sep)) throw Error('Archive media is missing or outside its run directory.');
      const info = await stat(actual);
      if (!info.isFile()) throw Error('Archive media is not a regular file.');
      const digest = await sha256(actual);
      const asset = {bucket:ARCHIVE_BUCKET, path:`${record.kind}/${record.id}/${digest}/${path.basename(actual)}`,
        sha256:digest, bytes:info.size, contentType:mime(actual), role:item.role,
        ...(item.seconds === undefined ? {} : {seconds:item.seconds}),
        ...(item.seq === undefined ? {} : {seq:item.seq}), ...(item.index === undefined ? {} : {index:item.index})};
      const cached = this.db.prepare('SELECT 1 FROM archive_files WHERE scope=? AND object_path=? AND sha256=?').get(this.scope,asset.path,digest);
      if (!cached) {
        await this.remote.upload(asset,actual);
        const after = await stat(actual);
        if (after.size !== info.size || after.mtimeMs !== info.mtimeMs) throw Error('Archive media changed during upload; retry is pending.');
        this.db.prepare('INSERT OR REPLACE INTO archive_files VALUES (?,?,?)').run(this.scope,asset.path,digest);
      }
      assets.push(asset);
    }
    const d = record.document;
    const updated = [d.updated || d.created, ...(d.events || []).map(e=>e.at)].filter(Boolean).sort().at(-1);
    await this.remote.save({kind:record.kind,id:record.id,task:d.task,status:d.status,
      verdict:record.kind === 'job' ? d.report?.verdict || null : d.reviews?.at(-1)?.verdict || null,
      created_at:d.created, source_updated_at:updated, document:d, assets});
  }
  async close() { this.closed = true; await this.running; this.db?.close(); }
}
