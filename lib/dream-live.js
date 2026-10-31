import express from 'express';
import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import path from 'node:path';

const ROOT='https://dreamlabs.ai/v1/fish_tank';
const stationId=id=>{if(!/^[a-zA-Z0-9_-]{1,100}$/.test(id))throw Error('Invalid station ID');return id;};
export function publicRun(raw){
  if(!raw?.id||!raw.prompt)return null;
  return{id:String(raw.id),task:String(raw.prompt).slice(0,2000),startedAt:raw.started_at||null,model:raw.model||null};
}
export class DreamLive {
  constructor({live,dataDir,fetcher=fetch,now=Date.now}){
    Object.assign(this,{live,dataDir,fetcher,now});this.stations=[];this.checkedAt=0;this.error=null;this.watch=null;this.frames=new Map();this.closed=false;this.busy=false;
    this.file=path.join(dataDir,'dream-live-watch.json');
  }
  async request(url){
    const r=await this.fetcher(url,{headers:{Accept:'application/json, image/jpeg'},redirect:'error',signal:AbortSignal.timeout(8000)});
    if(!r.ok)throw Error(`Dream Labs returned HTTP ${r.status}`);return r;
  }
  async stationList(force=false){
    if(!force&&this.checkedAt&&this.now()-this.checkedAt<5000)return this.stations;
    try{
      const rows=await(await this.request(`${ROOT}/stations`)).json();if(!Array.isArray(rows))throw Error('Station list unavailable');
      this.stations=rows.map(s=>({id:stationId(s.id),name:String(s.display_name||s.id),status:s.status,online:!!s.online,
        scene:String(s.scene||''),reason:s.watch_reason||null,cameras:Array.isArray(s.cameras)?s.cameras:[],
        embodiment:s.embodiment||null,currentRun:publicRun(s.current_run),sourceUrl:`https://dreamlabs.ai/playground/?scene=${encodeURIComponent(s.id)}`}));
      this.checkedAt=this.now();this.error=null;
    }catch(e){this.error=e.message;throw e;}
    return this.stations;
  }
  async currentRun(id){return publicRun((await(await this.request(`${ROOT}/stations/${stationId(id)}/queue`)).json()).now);}
  async camera(id){
    const response=await this.request(`${ROOT}/stations/${stationId(id)}/frame.jpg?cam=head&t=${this.now()}`);
    if(!response.headers.get('content-type')?.startsWith('image/jpeg'))throw Error('Dream Labs camera did not return a JPEG');
    const chunks=[];let size=0;
    for await(const chunk of response.body){size+=chunk.length;if(size>800000)throw Error('Camera frame exceeds the evidence size limit');chunks.push(chunk);}
    const bytes=Buffer.concat(chunks);if(bytes.length<100||bytes[0]!==255||bytes[1]!==216)throw Error('Invalid camera frame');
    return bytes;
  }
  status(){return{stations:this.stations,checkedAt:this.checkedAt,error:this.error,watch:this.watch,transport:'Public Dream Labs station and JPEG endpoints',sampleIntervalMs:1000};}
  async save(){const json=JSON.stringify(this.watch);this.saving=(this.saving||Promise.resolve()).catch(()=>{}).then(async()=>{await mkdir(this.dataDir,{recursive:true});await writeFile(this.file+'.tmp',json);await rename(this.file+'.tmp',this.file);});await this.saving;}
  async start(id){
    const station=(await this.stationList(true)).find(s=>s.id===stationId(id));if(!station)throw Error('Station not found');
    if(!this.live.status().terse.connected||!this.live.status().relay.connected)throw Error('Wait for Terse and Relay to connect');
    if(!this.live.credentials().key)throw Error('Configure the evaluation API key first');
    if(this.watch?.enabled){if(this.watch.stationId===id)return this.status();throw Error('Stop the current station watch first');}
    this.watch={stationId:id,enabled:true,startedAt:this.now(),expiresAt:this.now()+600000,sessionId:null,runId:null,completedRunIds:[],error:null};await this.save();return this.status();
  }
  async seal(reason){
    const w=this.watch;if(!w?.sessionId)return;
    await this.live.finish(w.sessionId,reason);w.lastSessionId=w.sessionId;w.completedRunIds.push(w.runId);w.sessionId=null;w.runId=null;await this.save();
  }
  async stop(){if(this.watch){this.watch.enabled=false;await this.seal('user_stopped');await this.save();}return this.status();}
  async tick(){
    if(this.closed||this.busy||!this.watch?.enabled)return;this.busy=true;
    try{
      const w=this.watch;if(this.now()>=w.expiresAt){await this.stop();return;}
      const station=(await this.stationList()).find(s=>s.id===w.stationId);
      if(!station?.online||!station.cameras.includes('head')){w.error=null;await this.seal('source_unavailable');return;}
      const run=await this.currentRun(w.stationId);
      if(w.sessionId&&run?.id!==w.runId)await this.seal('source_run_changed');
      if(!run||w.completedRunIds.includes(run.id))return;
      // Check run identity on both sides of the image request. A frame straddling
      // a task change is discarded, never attached to the preceding task.
      const bytes=await this.camera(w.stationId),after=await this.currentRun(w.stationId);
      if(after?.id!==run.id){await this.seal('source_run_changed');return;}
      if(!w.enabled||this.closed)return;
      if(!w.sessionId){
        const session=await this.live.start({task:run.task},{sourceKind:'dream_live',task:run.task,scene:station.name,
          stationId:station.id,sourceRunId:run.id,sourceUrl:station.sourceUrl,sourceRunStartedAt:run.startedAt,
          joinedMidRun:!run.startedAt||this.now()-Date.parse(run.startedAt)>2000,captureStartedAt:new Date(this.now()).toISOString(),providerScore:null});
        w.sessionId=session.id;w.runId=run.id;w.captureStartedAt=this.now();await this.save();
        if(!w.enabled){await this.seal('user_stopped');return;}
      }
      const s=await this.live.snapshot(w.sessionId);
      if(s.stopRequested){w.completedRunIds.push(w.runId);w.lastSessionId=w.sessionId;w.sessionId=null;w.runId=null;await this.save();return;}
      await this.live.frame(w.sessionId,bytes,(s.frames.at(-1)?.seq??-1)+1,(this.now()-w.captureStartedAt)/1000);
      this.frames.set(w.stationId,{bytes,at:this.now(),runId:run.id});w.error=null;
    }catch(e){if(this.watch)this.watch.error=e.message;}
    finally{this.busy=false;}
  }
  async init(){
    try{this.watch=JSON.parse(await readFile(this.file,'utf8'));}catch{}
    if(this.watch?.enabled&&this.watch.expiresAt<=this.now())await this.stop().catch(()=>{});
    this.timer=setInterval(()=>void this.tick(),1000);void this.stationList().catch(()=>{});
  }
  routes(){
    const router=express.Router();
    router.get('/status',async(_req,res)=>{await this.stationList().catch(()=>{});res.json(this.status());});
    router.post('/watch',async(req,res)=>res.json(await this.start(req.body.stationId)));
    router.post('/stop',async(_req,res)=>res.json(await this.stop()));
    router.get('/stations/:id/frame.jpg',async(req,res)=>{
      const station=(await this.stationList()).find(s=>s.id===stationId(req.params.id));
      if(!station?.online||!station.cameras.includes('head'))return res.status(503).json({error:'Dream Labs camera is unavailable'});
      let frame=this.frames.get(station.id);
      if(!frame||this.now()-frame.at>1200){frame={bytes:await this.camera(station.id),at:this.now()};this.frames.set(station.id,frame);}
      res.set({'Content-Type':'image/jpeg','Cache-Control':'no-store','X-Capture-Time':new Date(frame.at).toISOString()}).send(frame.bytes);
    });
    return router;
  }
  close(){this.closed=true;clearInterval(this.timer);}
}
