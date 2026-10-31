import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {PGlite} from '@electric-sql/pglite';
import {SupabaseArchive} from '../lib/archive.js';
import {supabaseConfig} from '../lib/supabase.js';

const id='00000000-0000-4000-8000-000000000001';
const base=()=>({id,task:'Fold the dress',status:'completed',created:'2026-10-31T18:00:00.000Z',updated:'2026-10-31T18:01:00.000Z',report:{verdict:'pass'},reviews:[]});
async function fixture(t, remoteOverrides={}) {
  const dataDir=await mkdtemp(path.join(os.tmpdir(),'reality-check-archive-'));
  const root=path.join(dataDir,'runs',id);await mkdir(root,{recursive:true});
  const sourceFile=path.join(root,'original.mp4');await writeFile(sourceFile,'saved test footage');
  const uploaded=[],saved=[];
  const remote={scope:'https://project.example/bruno-evidence',ready:async()=>{},
    upload:async asset=>uploaded.push(asset),save:async row=>saved.push(row),...remoteOverrides};
  const archive=new SupabaseArchive({dataDir,remote});
  t.after(async()=>{if(!archive.closed)await archive.close();await rm(dataDir,{recursive:true,force:true});});
  return {dataDir,root,sourceFile,remote,archive,uploaded,saved,job:{...base(),sourceFile}};
}

test('Supabase stays optional and rejects browser keys and credential-bearing URLs',()=>{
  assert.equal(supabaseConfig({}),null);
  assert.throws(()=>supabaseConfig({SUPABASE_URL:'https://project.example'}),/Set SUPABASE/);
  assert.throws(()=>supabaseConfig({SUPABASE_URL:'https://project.example',SUPABASE_SECRET_KEY:'sb_publishable_test'}),/server secret/);
  assert.throws(()=>supabaseConfig({SUPABASE_URL:'http://project.example',SUPABASE_SECRET_KEY:'sb_secret_test'}),/HTTPS/);
  assert.throws(()=>supabaseConfig({SUPABASE_URL:'https://user:password@project.example',SUPABASE_SECRET_KEY:'sb_secret_test'}),/HTTPS/);
  assert.equal(supabaseConfig({SUPABASE_URL:'https://project.example/',SUPABASE_SECRET_KEY:'sb_secret_test'}).url,'https://project.example');
});

test('an archived review references uploaded private media and omits local absolute paths',async t=>{
  const f=await fixture(t);f.archive.enqueue('job',f.job);await f.archive.flush();
  assert.equal(f.saved.length,1);assert.equal(f.uploaded.length,1);
  assert.equal(f.saved[0].document.sourceFile,undefined);assert.equal(f.saved[0].assets[0].role,'original');
  assert.equal(f.saved[0].assets[0].sha256.length,64);assert.equal(f.saved[0].verdict,'pass');
  assert.ok(!JSON.stringify(f.saved).includes(f.dataDir));assert.equal(f.archive.status().synced,1);
});

test('failed database writes survive restart without uploading already-saved files twice',async t=>{
  let fail=true;
  const f=await fixture(t,{save:async()=>{if(fail)throw Error('Supabase save failed (503).');}});
  f.archive.enqueue('job',f.job);await f.archive.flush();assert.equal(f.archive.status().pending,1);
  assert.equal(f.archive.status().failed,1);await f.archive.close();fail=false;
  const restarted=new SupabaseArchive({dataDir:f.dataDir,remote:f.remote});
  await restarted.flush({force:true});assert.equal(restarted.status().pending,0);assert.equal(f.uploaded.length,1);
  restarted.enqueue('job',f.job);await restarted.flush();assert.equal(f.uploaded.length,1);await restarted.close();
});

test('new reviews arriving during an upload stay queued until that exact snapshot is saved',async t=>{
  let signal,release;
  const started=new Promise(r=>signal=r),blocked=new Promise(r=>release=r);
  const f=await fixture(t,{upload:async()=>{signal();await blocked;}});
  f.archive.enqueue('job',f.job);const flush=f.archive.flush();await started;
  f.archive.enqueue('job',{...f.job,updated:'2026-10-31T18:02:00.000Z',reviews:[{verdict:'fail',note:'Human correction'}]});
  release();await flush;assert.equal(f.archive.status().pending,1);
  await f.archive.flush();assert.equal(f.archive.status().pending,0);
  assert.equal(f.saved.at(-1).document.reviews[0].verdict,'fail');assert.equal(f.saved.length,2);
});

test('failed connectivity does not lose queued reviews or expose raw errors',async t=>{
  const f=await fixture(t,{ready:async()=>{throw Error('fetch failed with sensitive-provider-detail');}});
  f.archive.enqueue('job',f.job);await f.archive.flush();
  assert.equal(f.archive.status().pending,1);assert.equal(f.uploaded.length,0);
  assert.ok(!JSON.stringify(f.archive.status()).includes('sensitive-provider-detail'));
});

test('a missing frame leaves the archive pending rather than claiming a complete backup',async t=>{
  const f=await fixture(t);f.archive.enqueue('job',{...f.job,media:{frames:[{file:'missing.jpg',seconds:1,index:0}]}});
  await f.archive.flush();assert.equal(f.saved.length,0);assert.equal(f.archive.status().pending,1);
});

test('run-local media cannot follow a symlink to another directory',async t=>{
  const f=await fixture(t);const privateFile=path.join(f.dataDir,'private.txt');await writeFile(privateFile,'must not be uploaded');
  const link=path.join(f.root,'linked.mp4');await symlink(privateFile,link);
  f.archive.enqueue('job',{...f.job,sourceFile:link});await f.archive.flush();
  assert.equal(f.uploaded.length,0);assert.equal(f.archive.status().pending,1);
});

test('changing the destination project does not reuse another project’s upload receipts',async t=>{
  const f=await fixture(t);f.archive.enqueue('job',f.job);await f.archive.flush();await f.archive.close();
  const other=new SupabaseArchive({dataDir:f.dataDir,remote:{...f.remote,scope:'https://other.example/bruno-evidence'}});
  other.enqueue('job',f.job);await other.flush();assert.equal(f.uploaded.length,2);await other.close();
});

test('Postgres migration blocks public access, is repeatable, and rejects stale snapshots',async t=>{
  const db=new PGlite();t.after(()=>db.close());
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean);`);
  const sql=await readFile(new URL('../supabase/migrations/202610310001_bruno_archive.sql',import.meta.url),'utf8');
  await db.exec(sql);await db.exec(sql);
  assert.equal((await db.query('SELECT public FROM storage.buckets')).rows[0].public,false);
  const payload={kind:'job',id,task:'Fold the dress',status:'completed',verdict:'pass',created_at:base().created,
    source_updated_at:base().updated,document:base(),assets:[]};
  await db.exec('SET ROLE service_role');
  await db.query('SELECT public.bruno_archive_run($1::jsonb)',[JSON.stringify(payload)]);
  await db.query('SELECT public.bruno_archive_run($1::jsonb)',[JSON.stringify({...payload,verdict:'fail',source_updated_at:base().created})]);
  assert.equal((await db.query('SELECT verdict FROM public.bruno_runs')).rows[0].verdict,'pass');
  for(const role of ['anon','authenticated']){
    await db.exec(`RESET ROLE; SET ROLE ${role}`);
    await assert.rejects(db.query('SELECT * FROM public.bruno_runs'),/permission denied/);
    await assert.rejects(db.query('SELECT public.bruno_archive_run($1::jsonb)',[JSON.stringify(payload)]),/permission denied/);
  }
});
