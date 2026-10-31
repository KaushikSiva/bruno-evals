import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createStore} from '../lib/store.js';
import {allowedMediaUrl,normalizeCatalog} from '../lib/dream.js';
import {sampleTimes} from '../lib/media.js';
import {validateEvidence,overallVerdict} from '../lib/evaluate.js';

test('download URLs cannot access local services or unrelated hosts',()=>{
 for(const u of ['http://dreamlabs.ai/a.mp4','http://127.0.0.1/a','https://localhost/a','https://dreamlabs.ai.evil.test/a','https://user:pass@dreamlabs.ai/a','https://dreamlabs.ai:8888/a'])assert.throws(()=>allowedMediaUrl(u));
 assert.equal(allowedMediaUrl('https://dreamlabs.ai/playground/clips/0.mp4'),'https://dreamlabs.ai/playground/clips/0.mp4');
});
test('catalog preserves publisher score and original task as provenance',()=>{
 const [clip]=normalizeCatalog({clips:[{idx:0,prompt:'Pick up a cube',src:'clips/0.mp4',score:0.75}]});
 assert.equal(clip.previewUrl,'https://dreamlabs.ai/playground/clips/0.mp4');assert.equal(clip.providerScore,0.75);assert.equal(clip.task,'Pick up a cube');
});
test('sampling includes beginning and near-final frame without seeking past EOF',()=>{
 for(const duration of [0.1,1,8.3,95]){const times=sampleTimes(duration);assert.equal(times[0],0);assert.ok(times.at(-1)<duration);assert.ok(times.length<=24);assert.ok(times.every((t,i)=>!i||t>=times[i-1]));}
 assert.throws(()=>sampleTimes(NaN));
});
test('jobs and their event history survive a process restart',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'bruno-store-'));let s=createStore(root);
 const j=s.create({task:'Move cube',criteria:['Cube in bowl']});s.update(j.id,{status:'preparing'});s.event(j.id,'Downloaded source');s.close();
 s=createStore(root);assert.equal(s.get(j.id).status,'preparing');assert.equal(s.events(j.id)[0].message,'Downloaded source');s.close();await rm(root,{recursive:true});
});
const frames=[{seconds:0},{seconds:2.3}],criteria=['Cube in bowl'];
const report=()=>({summary:'Observed',criteria:[{criterion:'Cube in bowl',verdict:'pass',explanation:'Visible',evidence:[{frame_index:1,observation:'Cube in bowl'}]}],limitations:[],follow_up_tests:[]});
test('evidence timestamps are derived from real frame indices',()=>{assert.equal(validateEvidence(report(),frames,criteria).criteria[0].evidence[0].seconds,2.3);});
test('fabricated frame indices and changed criteria are rejected',()=>{
 const r=report();r.criteria[0].evidence[0].frame_index=33;assert.throws(()=>validateEvidence(r,frames,criteria));
 const r2=report();r2.criteria[0].criterion='Different task';assert.throws(()=>validateEvidence(r2,frames,criteria));
});
test('unsupported pass becomes uncertain and empty results cannot pass',()=>{
 const r=report();r.criteria[0].evidence=[];assert.equal(validateEvidence(r,frames,criteria).verdict,'uncertain');assert.equal(overallVerdict([]),'uncertain');
});
