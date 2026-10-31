import express from 'express';
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,writeFile,copyFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {actors} from '../integrations/generated/index.js';
import {downloadVideo,replayUrl,replayMatches} from './dream.js';
import {probe} from './media.js';
import {observeLive,reviewLive,selectLiveFrames} from './live-evaluate.js';
import {connectRelay} from './relay.js';

const validId=id=>/^[0-9a-f-]{36}$/i.test(id);
export class LiveEngine {
  constructor({dataDir,catalog,jobs,credentials}){
    Object.assign(this,{dataDir,catalog,jobs,credentials});this.sessions=new Map();this.busy=new Set();this.cooldowns=new Map();this.dispatches=new Map();this.delivering=new Set();
    this.terse={connected:false,transport:'Terse Durable Actors',mode:'local runtime',error:null};
    this.relay=null;this.relayError=null;this.initializing=false;this.closed=false;
    this.directory=actors.SessionDirectory.get('bruno-live-sessions');
  }
  dir(id){if(!validId(id))throw Error('Invalid live session ID');return path.join(this.dataDir,'live',id);}
  actor(id){if(!validId(id))throw Error('Invalid live session ID');return actors.EvaluationSession.get(id);}
  async snapshot(id){const state=JSON.parse(await this.actor(id).snapshot());if(!state.task)throw Error('Live session not found');this.sessions.set(id,state);return state;}
  async init(){
    if(this.initializing||this.closed)return;this.initializing=true;
    try{
      for(const id of await this.directory.list())await this.snapshot(id);
      for(const job of this.jobs().filter(j=>j.media))await this.recordingReady(job);
      this.terse.connected=true;this.terse.error=null;
      if(!this.relay)this.relay=await connectRelay(this.dataDir,{
        reviewer:(payload,message)=>this.handleReview(payload,message),
        observer:(payload,message)=>this.handleCompletion(payload,message),
        error:e=>{this.relayError=e.message;},
      });
      this.relayError=null;
    }catch(e){if(!this.terse.connected)this.terse.error=e.message;else this.relayError=e.message;}
    finally{this.initializing=false;}
  }
  status(){return{terse:this.terse,relay:this.relay?this.relay.status:{connected:false,error:this.relayError,transport:'Agent Relay'},activeSessions:[...this.sessions.values()].filter(s=>['live','finishing'].includes(s.status)).length};}
  async start(input,source=null){
    if(!this.terse.connected||!this.relay?.status.connected)throw Error('Terse and Agent Relay are still connecting. Retry shortly.');
    if(!this.credentials().key)throw Error('Configure the evaluation API key first');
    if(this.status().activeSessions>=2)throw Error('Finish an active live session before opening another');
    const id=randomUUID(),dir=this.dir(id);await mkdir(path.join(dir,'frames'),{recursive:true});
    let meta={};
    if(source){meta=source;}
    else if(input.clipId){
      const clip=(await this.catalog()).find(c=>c.id===input.clipId);if(!clip)throw Error('Public clip not found');
      const file=path.join(dir,'replay.mp4');
      const source=replayUrl(clip);
      const cached=this.jobs().find(j=>replayMatches(j,clip,source)&&j.sourceFile&&existsSync(j.sourceFile));
      if(cached)await copyFile(cached.sourceFile,file);
      else{try{await downloadVideo(source,file);}catch(e){if(source===clip.previewUrl)throw e;await downloadVideo(clip.previewUrl,file);}}
      const media=await probe(file);
      meta={task:clip.task,sourceKind:'public_replay',clipId:clip.id,collection:clip.collection||'public',scene:clip.scene,posterUrl:clip.posterUrl,
        providerScore:clip.providerScore,sourceUrl:clip.sourceUrl,videoUrl:`/live-media/${id}/replay.mp4`,sourceDuration:media.duration};
    }else{
      const task=String(input.task||'').trim().slice(0,2000);if(!task)throw Error('A task instruction is required');
      meta={task,sourceKind:'browser_capture',scene:'Browser recording',providerScore:null};
    }
    const criteria=Array.isArray(input.criteria)?input.criteria.map(c=>String(c).trim().slice(0,1000)).filter(Boolean).slice(0,8):[];
    if(!criteria.length)criteria.push(`The requested end state is visibly achieved: ${meta.task}`);
    const state=JSON.parse(await this.actor(id).initialize(JSON.stringify({...meta,criteria,scope:'Provisional visual observations from sampled footage; not a safety certification.'})));
    await this.directory.add(id);this.sessions.set(id,state);await this.export(state);return state;
  }
  async frame(id,bytes,seq,seconds){
    if(!Number.isInteger(seq)||seq<0||seq>1199||!Number.isFinite(seconds)||seconds<0)throw Error('Invalid frame sequence or timestamp');
    if(!Buffer.isBuffer(bytes)||bytes.length<100||bytes.length>800000||bytes[0]!==255||bytes[1]!==216)throw Error('A JPEG evidence frame is required');
    const hash=createHash('sha256').update(bytes).digest('hex');
    const current=await this.snapshot(id),existing=current.frames.find(f=>f.seq===seq);
    if(existing){if(existing.sha256!==hash)throw Error('Frame sequence already contains different evidence');return{accepted:true,duplicate:true};}
    const file=`${String(seq).padStart(5,'0')}.jpg`,destination=path.join(this.dir(id),'frames',file);
    await writeFile(destination,bytes);
    const state=JSON.parse(await this.actor(id).appendFrame(JSON.stringify({seq,seconds,file,sha256:hash,receivedAt:new Date().toISOString()})));
    this.sessions.set(id,state);return{accepted:true,seq};
  }
  async finish(id,reason){const state=JSON.parse(await this.actor(id).finish(reason));this.sessions.set(id,state);await this.export(state);return state;}
  async recordingReady(job){
    for(const s of this.sessions.values())if(s.recordingJobId===job.id&&s.videoUrl!==`/media/${job.id}/video.mp4`){
      const next=JSON.parse(await this.actor(s.id).attachRecording(job.id,`/media/${job.id}/video.mp4`));this.sessions.set(s.id,next);await this.export(next);
    }
  }
  async export(state){await writeFile(path.join(this.dir(state.id),'session.json'),JSON.stringify(state,null,2));}
  async tick(){
    if(this.closed)return;
    if(!this.terse.connected||!this.relay){void this.init();return;}
    for(const [id,cached] of this.sessions){
      if(!['live','finishing'].includes(cached.status)||this.busy.has(id)||(this.cooldowns.get(id)||0)>Date.now())continue;
      this.busy.add(id);
      void this.process(id).catch(async e=>{
        const message=e.status?`Live evaluation API HTTP ${e.status}`:String(e.message).slice(0,400);
        this.cooldowns.set(id,Date.now()+15000);
        try{const s=await this.snapshot(id);const next=JSON.parse(await this.actor(id).recordError(s.lease?.token||'',message));this.sessions.set(id,next);await this.export(next);}catch{this.terse.connected=false;this.terse.error=message;}
      }).finally(()=>this.busy.delete(id));
    }
  }
  async process(id){
    let s=await this.snapshot(id);const last=s.frames.at(-1);
    if(s.status==='live'&&Date.now()-Date.parse(last?.receivedAt||s.created)>45000)s=await this.finish(id,'capture_disconnected');
    if(!last||last.seq<=s.processedSeq)return;
    if(s.pending&&s.lease?.token===s.pending.token){
      this.queueDispatch(s);
      // Observer progress does not wait for a slower agent handoff. Each draft
      // remains timestamped and separate from the review currently in flight.
      const observed=s.observations.at(-1)?.seq??-1;
      if(last.seq>observed&&(last.seq-observed>=4||s.stopRequested)){
        const frames=selectLiveFrames(s.frames,observed);
        const observation=await observeLive(s,frames,this.dir(id),this.credentials());
        const progress={token:`progress-${randomUUID()}`,seq:last.seq,frameSeqs:frames.map(f=>f.seq),observedThrough:last.seconds,observation,startedAt:Date.now()-observation.latencyMs};
        const next=JSON.parse(await this.actor(id).saveProgress(JSON.stringify(progress)));this.sessions.set(id,next);
      }
      return;
    }
    if(s.lease&&s.lease.until>Date.now())return;
    if(!s.stopRequested&&last.seq-s.processedSeq<4)return;
    const token=randomUUID();if(!await this.actor(id).claim(last.seq,token))return;
    const frames=selectLiveFrames(s.frames,s.processedSeq);
    const saved=s.observations.findLast(o=>o.seq===last.seq);
    const observation=saved?.observation||await observeLive(s,frames,this.dir(id),this.credentials());
    const pending={token,seq:last.seq,frameSeqs:saved?.frameSeqs||frames.map(f=>f.seq),observedThrough:last.seconds,observation,startedAt:saved?.startedAt||Date.now()-observation.latencyMs};
    s=JSON.parse(await this.actor(id).saveObservation(token,JSON.stringify(pending)));this.sessions.set(id,s);
    this.queueDispatch(s);
  }
  queueDispatch(s){
    const {id,pending:p}=s;if(this.delivering.has(id)||Date.now()-(this.dispatches.get(id)||0)<30000)return;
    this.delivering.add(id);
    void (async()=>{
      await this.actor(id).renewLease(p.token);await this.dispatch(s);
    })().catch(async e=>{
      const next=JSON.parse(await this.actor(id).recordError(p.token,String(e.message).slice(0,400)));this.sessions.set(id,next);
    }).catch(()=>{}).finally(()=>this.delivering.delete(id));
  }
  async dispatch(s){
    const {id,pending:p}=s;this.dispatches.set(id,Date.now());
    // Replaying this outbox entry uses the same Relay idempotency key. Persisted
    // observer/reviewer results survive restarts without repeating model calls.
    const payload={kind:'review_requested',sessionId:id,token:p.token,text:`Review through ${p.observedThrough.toFixed(1)}s: ${p.observation.summary}`};
    const message=await this.relay.send('observer',payload,`bruno-review-${id}-${p.token}`);
    s=JSON.parse(await this.actor(id).addMessage(JSON.stringify(message)));this.sessions.set(id,s);
  }
  async handleReview(payload,message){
    if(payload.kind!=='review_requested'||!validId(payload.sessionId))return;
    const id=payload.sessionId;let s=await this.snapshot(id);
    s=JSON.parse(await this.actor(id).addMessage(JSON.stringify(message)));this.sessions.set(id,s);
    if(s.lease?.token!==payload.token||!s.pending)return;
    let result=s.pending.review;
    if(!result){
      result=await reviewLive(s,s.pending,this.dir(id),this.credentials());
      s=JSON.parse(await this.actor(id).saveReviewDraft(payload.token,JSON.stringify(result)));this.sessions.set(id,s);
    }
    const reply=await this.relay.send('reviewer',{kind:'review_completed',sessionId:id,token:payload.token,text:`${result.verdict}: ${result.summary}`},`bruno-result-${id}-${payload.token}`);
    s=JSON.parse(await this.actor(id).addMessage(JSON.stringify(reply)));this.sessions.set(id,s);
  }
  async handleCompletion(payload,message){
    if(payload.kind!=='review_completed'||!validId(payload.sessionId))return;
    const id=payload.sessionId;let s=await this.snapshot(id);
    s=JSON.parse(await this.actor(id).addMessage(JSON.stringify(message)));this.sessions.set(id,s);
    if(s.lease?.token!==payload.token||!s.pending?.review)return;
    const pending=s.pending;
    const result={...pending.review,token:payload.token,seq:pending.seq,observedThrough:pending.observedThrough,
      observer:pending.observation,relayMessageId:message.id,relayDeliveryId:message.deliveryId,
      totalLatencyMs:Date.now()-pending.startedAt,receivedAt:new Date().toISOString(),frameSeqs:pending.frameSeqs};
    s=JSON.parse(await this.actor(id).completeReview(payload.token,JSON.stringify(result)));this.sessions.set(id,s);await this.export(s);
    this.dispatches.delete(id);
  }
  routes(){
    const router=express.Router();
    router.get('/status',(_req,res)=>res.json(this.status()));
    router.get('/sessions',(_req,res)=>res.json([...this.sessions.values()].sort((a,b)=>b.created.localeCompare(a.created))));
    router.post('/sessions',async(req,res)=>res.status(201).json(await this.start(req.body)));
    router.get('/sessions/:id',async(req,res)=>res.json(await this.snapshot(req.params.id)));
    router.post('/sessions/:id/socket',async(req,res)=>{await this.snapshot(req.params.id);res.json(await actors.EvaluationSession.prepareWebsocket({actorId:req.params.id,metadata:null}));});
    router.post('/sessions/:id/frames',express.raw({type:'image/jpeg',limit:'800kb'}),async(req,res)=>res.json(await this.frame(req.params.id,req.body,Number(req.query.seq),Number(req.query.seconds))));
    router.post('/sessions/:id/finish',async(req,res)=>res.json(await this.finish(req.params.id,['video_ended','user_stopped','capture_disconnected'].includes(req.body.reason)?req.body.reason:'user_stopped')));
    router.post('/sessions/:id/recording',async(req,res)=>{
      const s=await this.snapshot(req.params.id),job=this.jobs().find(j=>j.id===req.body.jobId);
      if(!job?.sourceFile||job.captureKind!=='browser_recording'||job.task!==s.task)throw Error('Matching saved browser recording required');
      const next=JSON.parse(await this.actor(s.id).attachRecording(job.id,`/media/${job.id}/${job.media?'video.mp4':path.basename(job.sourceFile)}`));
      this.sessions.set(s.id,next);await this.export(next);res.json(next);
    });
    router.get('/sessions/:id/export',async(req,res)=>res.attachment(`bruno-live-${req.params.id}.json`).json(await this.snapshot(req.params.id)));
    return router;
  }
  startWorker(){void this.init();this.timer=setInterval(()=>void this.tick(),1500);}
  async close(){this.closed=true;clearInterval(this.timer);await this.relay?.close();}
}
