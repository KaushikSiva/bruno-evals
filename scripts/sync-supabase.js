import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {stat} from 'node:fs/promises';
import {createStore} from '../lib/store.js';
import {SupabaseArchive, archiveRecord, savedLiveSessions} from '../lib/archive.js';
import {supabaseConfig, createSupabaseRemote} from '../lib/supabase.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dataDir=path.resolve(process.env.BRUNO_DATA_DIR||path.join(root,'data'));
const dryRun=process.argv.includes('--dry-run');
const store=createStore(dataDir);
let archive;
try{
  const records=store.list().map(job=>archiveRecord('job',{...job,events:store.events(job.id)},dataDir));
  const live=new Map((await savedLiveSessions(dataDir)).map(s=>[s.id,s]));
  // The running server has newer Terse snapshots than the inspectable JSON exports.
  let liveSource='saved JSON exports';
  try{
    const response=await fetch(`http://127.0.0.1:${Number(process.env.PORT||5190)}/api/live/sessions`,{signal:AbortSignal.timeout(3000)});
    if(!response.ok)throw Error('Local server unavailable');
    for(const s of await response.json())live.set(s.id,s);
    liveSource='saved exports and running Terse sessions';
  }catch{}
  for(const s of live.values())records.push(archiveRecord('live',s,dataDir));
  let bytes=0,files=0,missing=0;
  for(const r of records)for(const item of r.files){try{bytes+=(await stat(item.file)).size;files++;}catch{missing++;}}
  console.log(JSON.stringify({dryRun,runs:records.length,jobs:records.filter(r=>r.kind==='job').length,
    liveSessions:live.size,liveSource,files,bytes,missing},null,2));
  if(!dryRun){
    const config=supabaseConfig();
    if(!config)throw Error('Configure SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local first.');
    archive=new SupabaseArchive({dataDir,remote:createSupabaseRemote(config)});
    for(const r of records){
      // Preserve original file locations locally; never include them in the cloud document.
      const original=r.files.find(f=>f.role==='original');
      archive.enqueue(r.kind,{...r.document,...(original?{sourceFile:original.file}:{})});
    }
    await archive.flush({force:true});
    const status=archive.status();console.log(JSON.stringify(status,null,2));
    if(status.pending)process.exitCode=1;
  }
}catch(e){console.error(e.message);process.exitCode=1;}
finally{await archive?.close();store.close();}
