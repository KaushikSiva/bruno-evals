import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createStore} from '../lib/store.js';
import {allowedMediaUrl,normalizeCatalog,replayUrl,replayMatches} from '../lib/dream.js';
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
test('Best runs uses the dedicated gallery and keeps its IDs separate from general clips',()=>{
 const clips=normalizeCatalog({clips:[{idx:1,prompt:'General task',src:'clips/1.mp4',score:0.5}],best:[{idx:1,prompt:'Best task',src:'clips/best/1.mp4',download:'clips/best/dl/1.mp4',score:1}]});
 assert.equal(clips.length,2);assert.equal(clips[0].id,'dream-best-1');assert.equal(clips[1].id,'dream-public-1');assert.equal(clips[0].task,'Best task');assert.equal(clips[0].sourceUrl,'https://dreamlabs.ai/playground/?clip=best1');
 assert.equal(replayUrl(clips[0]),clips[0].previewUrl);assert.notEqual(clips[0].previewUrl,clips[0].videoUrl);
 assert.equal(replayMatches({index:1,collection:'public',videoUrl:clips[0].previewUrl},clips[0],clips[0].previewUrl),false);
 assert.equal(replayMatches({sourceClipId:clips[0].id,videoUrl:clips[0].videoUrl},clips[0],clips[0].previewUrl),false);
 assert.equal(replayMatches({sourceClipId:clips[0].id,videoUrl:clips[0].previewUrl},clips[0],clips[0].previewUrl),true);
});
test('older manifests use the same Best runs fallback as the public website',()=>{
 const clips=normalizeCatalog({clips:[{idx:0,prompt:'A',src:'clips/0.mp4',score:1},{idx:1,prompt:'B',src:'clips/1.mp4',score:.5}]});
 assert.deepEqual(clips.filter(c=>c.collection==='best').map(c=>c.index),[0]);
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
