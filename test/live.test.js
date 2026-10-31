import test from 'node:test';
import assert from 'node:assert/strict';
import {selectLiveFrames,attachLiveEvidence,liveWindowContext} from '../lib/live-evaluate.js';
import {LiveEngine} from '../lib/live.js';

test('live windows contain only received evidence, preserving a baseline and recent motion',()=>{
  const received=Array.from({length:20},(_,seq)=>({seq,seconds:seq+.25}));
  const window=selectLiveFrames(received,8);
  assert.deepEqual(window.map(f=>f.seq),[0,14,15,16,17,18,19]);
  assert.ok(window.every(f=>received.includes(f)));assert.equal(new Set(window.map(f=>f.seq)).size,window.length);
  assert.deepEqual(selectLiveFrames([],0),[]);assert.deepEqual(selectLiveFrames(received.slice(0,1),-1),received.slice(0,1));
});
test('live judgments cannot cite future frames or invent timestamps',()=>{
  const frames=[{seq:5,seconds:5.25}];
  assert.throws(()=>attachLiveEvidence({verdict:'pass',evidence:[{seq:6,observation:'Done'}]},frames),/unavailable/);
  assert.equal(attachLiveEvidence({verdict:'pass',evidence:[{seq:5,observation:'Done',seconds:99}]},frames).evidence[0].seconds,5.25);
  for(const verdict of ['pass','fail'])assert.equal(attachLiveEvidence({verdict,evidence:[]},frames).verdict,'uncertain');
});
test('a delayed early-window review cannot mistake stopped capture for a visible final outcome',()=>{
  const session={task:'Move cube',criteria:['Cube in bowl'],frames:[{seq:0,seconds:0},{seq:20,seconds:20}],reviews:[],stopRequested:true,stopReason:'video_ended'};
  const early=liveWindowContext(session,session.frames.slice(0,1));assert.equal(early.isFinalWindow,false);assert.equal(early.captureStopped,false);assert.equal(early.stopReason,null);
  assert.equal(liveWindowContext(session,session.frames).isFinalWindow,true);
});
test('restart recovery dispatches checkpointed work with a stable key without calling a model',async()=>{
  const engine=new LiveEngine({dataDir:'/unused',catalog:()=>[],jobs:()=>[],credentials:()=>{throw Error('Must not call a model during transport recovery');}});
  const id='00000000-0000-4000-8000-000000000001',token='checkpoint';
  const state={id,status:'finishing',frames:[{seq:3,seconds:3}],processedSeq:-1,stopRequested:true,lease:{token,until:0},observations:[{seq:3}],pending:{token,seq:3,observedThrough:3,observation:{summary:'Saved observation'}},messages:[]};
  const sent=[];engine.snapshot=async()=>state;engine.actor=()=>({renewLease:async t=>{assert.equal(t,token);return true;},addMessage:async json=>{state.messages.push(JSON.parse(json));return JSON.stringify(state);}});
  engine.relay={send:async(role,payload,key)=>{sent.push({role,payload,key});return{id:'real-service-id-in-production'};}};
  await engine.process(id);await new Promise(r=>setTimeout(r,0));engine.dispatches.clear();await engine.process(id);await new Promise(r=>setTimeout(r,0));
  assert.equal(sent.length,2);assert.equal(sent[0].key,sent[1].key);assert.equal(sent[0].payload.token,token);
});

test('duplicate Relay completion does not append another review',async()=>{
  const engine=new LiveEngine({dataDir:'/unused',catalog:()=>[],jobs:()=>[],credentials:()=>({})});
  const id='00000000-0000-4000-8000-000000000002';
  const state={id,status:'completed',lease:null,pending:null};let completions=0;
  engine.snapshot=async()=>state;engine.actor=()=>({addMessage:async()=>JSON.stringify(state),completeReview:async()=>{completions++;}});
  await engine.handleCompletion({kind:'review_completed',sessionId:id,token:'old'},{id:'duplicate'});
  assert.equal(completions,0);
});
