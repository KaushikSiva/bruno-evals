import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {DreamLive,publicRun} from '../lib/dream-live.js';

async function fixture(t,{cameras=['head'],runs=[]}={}){
  const dir=await mkdtemp(path.join(os.tmpdir(),'bruno-dream-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  let clock=100000;const calls=[],sessions=new Map(),seals=[];let index=0;
  const live={status:()=>({terse:{connected:true},relay:{connected:true}}),credentials:()=>({key:'test-only'}),
    start:async(input,source)=>{const s={...source,id:'session-'+sessions.size,frames:[]};sessions.set(s.id,s);return s;},
    snapshot:async id=>sessions.get(id),frame:async(id,bytes,seq,seconds)=>sessions.get(id).frames.push({seq,seconds,bytes:bytes.length}),
    finish:async(id,reason)=>{seals.push({id,reason});sessions.get(id).stopRequested=true;}};
  const jpeg=Buffer.alloc(120,0);jpeg[0]=255;jpeg[1]=216;
  const fetcher=async(url,options)=>{
    calls.push({url,method:options.method||'GET'});
    if(url.endsWith('/stations'))return Response.json([{id:'live-1',display_name:'Station 1',online:true,status:'live',cameras,scene:'Public station'}]);
    if(url.endsWith('/queue'))return Response.json({now:runs[Math.min(index++,runs.length-1)]||null});
    if(url.includes('/frame.jpg'))return new Response(jpeg,{headers:{'Content-Type':'image/jpeg'}});
    throw Error('Unexpected URL '+url);
  };
  const monitor=new DreamLive({live,dataDir:dir,fetcher,now:()=>clock});await monitor.start('live-1');
  return{monitor,sessions,seals,calls,advance:ms=>clock+=ms,dir};
}
const run=id=>({id,prompt:`Task ${id}`,started_at:'1970-01-01T00:01:00Z',score:100,note:'Publisher verdict'});

test('public metadata preserves the task and withholds publisher judgments',()=>{
  assert.deepEqual(publicRun(run('a')),{id:'a',task:'Task a',startedAt:'1970-01-01T00:01:00Z',model:null});assert.equal(publicRun(null),null);
});
test('an unavailable camera creates no sessions, frame requests, or model work',async t=>{
  const f=await fixture(t,{cameras:[]});await f.monitor.tick();assert.equal(f.sessions.size,0);assert.ok(f.calls.every(c=>c.url.endsWith('/stations')));
});
test('a frame straddling a public task change is discarded',async t=>{
  const f=await fixture(t,{runs:[run('a'),run('b')]});await f.monitor.tick();assert.equal(f.sessions.size,0);
});
test('each public run receives its own session and ending reason',async t=>{
  const f=await fixture(t,{runs:[run('a'),run('a'),run('b'),run('b')]});await f.monitor.tick();f.advance(1000);await f.monitor.tick();
  assert.equal(f.sessions.size,2);const [a,b]=[...f.sessions.values()];assert.equal(a.sourceRunId,'a');assert.equal(b.sourceRunId,'b');assert.equal(a.task,'Task a');assert.equal(a.joinedMidRun,true);assert.equal(a.frames.length,1);assert.equal(b.frames.length,1);assert.deepEqual(f.seals,[{id:a.id,reason:'source_run_changed'}]);assert.ok(f.calls.every(c=>c.method==='GET'));
});
test('stopping and the deadline stop ingestion and preserve the saved watch',async t=>{
  const f=await fixture(t,{runs:[run('a'),run('a')]});await f.monitor.tick();await f.monitor.stop();const n=f.calls.length;await f.monitor.tick();assert.equal(f.calls.length,n);assert.equal(f.seals.at(-1).reason,'user_stopped');assert.equal(JSON.parse(await readFile(path.join(f.dir,'dream-live-watch.json'),'utf8')).enabled,false);
  await f.monitor.start('live-1');f.advance(600001);await f.monitor.tick();assert.equal(f.monitor.watch.enabled,false);
});
