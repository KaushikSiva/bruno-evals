import express from 'express';
import multer from 'multer';
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from './lib/store.js';
import { fetchCatalog, downloadVideo, allowedMediaUrl } from './lib/dream.js';
import { prepareMedia } from './lib/media.js';
import { evaluateRun } from './lib/evaluate.js';
import { LiveEngine } from './lib/live.js';
import { DreamLive } from './lib/dream-live.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(process.env.BRUNO_DATA_DIR || path.join(ROOT,'data'));
const PORT = Number(process.env.PORT || 5190);
await mkdir(path.join(DATA,'uploads'),{recursive:true});
const store = createStore(DATA);
let catalog = [], catalogAt = 0, catalogError = null;
async function getCatalog() {
  if (catalog.length && Date.now()-catalogAt < 300000) return catalog;
  try { catalog = await fetchCatalog(); catalogAt = Date.now(); catalogError = null;
    await writeFile(path.join(DATA,'public-catalog.json'),JSON.stringify({fetchedAt:new Date().toISOString(),clips:catalog},null,2));
  } catch (e) {
    catalogError = e.message;
    if (!catalog.length && existsSync(path.join(DATA,'public-catalog.json'))) catalog = JSON.parse(await readFile(path.join(DATA,'public-catalog.json'),'utf8')).clips;
    if (!catalog.length) throw e;
  }
  return catalog;
}
function credentials() {
  // Reload a locally configured key without restarting queued work. Never return it to a client.
  let key = process.env.OPENAI_API_KEY || '', model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
  try {
    const raw = process.getBuiltinModule('fs').readFileSync(path.join(ROOT,'.env.local'),'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const m=line.match(/^\s*(?:export\s+)?(OPENAI_API_KEY|OPENAI_MODEL)\s*=\s*(.*?)\s*$/);
      if (m) { const value=m[2].replace(/^(['"])(.*)\1$/,'$2'); if(m[1]==='OPENAI_API_KEY')key=value;else model=value; }
    }
  } catch {}
  return {key,model};
}
const dirFor = id => path.join(DATA,'runs',id);
const cleanJob = job => ({...job, sourceFile:undefined, events:store.events(job.id)});
function inputs(body) {
  const task=String(body.task || '').trim().slice(0,2000);
  if (!task) throw new Error('Enter the original task instruction');
  let criteria = body.criteria;
  if (typeof criteria === 'string') { try { criteria=JSON.parse(criteria); } catch { criteria=criteria.split('\n'); } }
  if (!Array.isArray(criteria)) criteria=[`The requested end state is visibly achieved: ${task}`];
  criteria=criteria.map(x=>String(x).trim()).filter(Boolean).slice(0,8).map(x=>x.slice(0,1000));
  if (!criteria.length) throw new Error('Add at least one success criterion');
  return {task,criteria};
}
async function persistManifest(job) {
  await mkdir(dirFor(job.id),{recursive:true});
  await writeFile(path.join(dirFor(job.id),'run.json'),JSON.stringify({...cleanJob(job),originalFile:job.sourceFile ? path.basename(job.sourceFile):null},null,2));
}
function event(id,message) { store.event(id,message); }

// Recovery is explicit. No fabricated result is substituted for an interrupted API call.
for (const job of store.list()) {
  if (['downloading','preparing','evaluating'].includes(job.status)) {
    store.update(job.id,{status:'queued',error:null});
    event(job.id,'Worker restarted. Resuming from saved artifacts; an interrupted evaluator request may be repeated.');
  }
}
let working=false, stopping=false;
async function work() {
  if(working || stopping) return;
  const {key,model}=credentials();
  const job=store.list().reverse().find(j=>j.status==='queued' || (j.status==='needs_key' && key));
  if(!job)return;
  working=true;
  try {
    const dir=dirFor(job.id); await mkdir(dir,{recursive:true});
    let current=job;
    if(!current.sourceFile || !existsSync(current.sourceFile)) {
      if(!current.videoUrl) throw new Error('Source video is missing. Upload it again.');
      const file=path.join(dir,'original.mp4');
      store.update(job.id,{status:'downloading',error:null});event(job.id,'Downloading the original public video.');
      const progress=(bytes,total)=>store.update(job.id,{downloadedBytes:bytes,totalBytes:total});
      try { await downloadVideo(current.videoUrl,file,progress); }
      catch (error) {
        if (!current.previewUrl || current.previewUrl===current.videoUrl) throw error;
        event(job.id,'The high-resolution source is unavailable. Downloading the public playback source.');
        current=store.update(job.id,{requestedVideoUrl:current.videoUrl,videoUrl:current.previewUrl});
        await downloadVideo(current.previewUrl,file,progress);
      }
      current=store.update(job.id,{sourceFile:file});
    }
    if(!current.media || !existsSync(path.join(dir,'media.json'))) {
      store.update(job.id,{status:'preparing'});event(job.id,'Saving a seekable MP4 and sampling timestamped evidence frames.');
      const media=await prepareMedia(current.sourceFile,dir,(done,total)=>store.update(job.id,{framesReady:done,framesTotal:total}));
      current=store.update(job.id,{media});
      event(job.id,`Saved ${media.frames.length} evidence frames. Original SHA-256: ${media.originalSha256.slice(0,12)}…`);
    }
    await live.recordingReady(current).catch(e=>console.warn(`Live recording link will retry at restart: ${e.message}`));
    if(!key) {
      current=store.update(job.id,{status:'needs_key'});event(job.id,'Video is saved. Waiting for an OpenAI API key to evaluate it.');
    } else {
      store.update(job.id,{status:'evaluating',error:null});event(job.id,'Evaluating visible outcomes. Publisher score is withheld from the evaluator.');
      const report=await evaluateRun(current,dir,key,model);
      current=store.update(job.id,{status:'completed',report});event(job.id,`Assessment complete: ${report.verdict}. Ready for human review.`);
    }
    await persistManifest(current);
  } catch(e) {
    const message=e.status ? `Evaluation API returned HTTP ${e.status}. Check the key, billing, and model access, then retry.` : String(e.message || 'Processing failed').slice(0,500);
    const current=store.update(job.id,{status:'failed',error:message});event(job.id,message);
    await persistManifest(current).catch(()=>{});
  } finally { working=false; }
}

const app=express();
app.disable('x-powered-by');
app.use((req,res,next)=>{
  const host=req.get('host')||'';
  if(!['127.0.0.1','localhost','[::1]'].some(h=>host===`${h}:${PORT}`))return res.status(403).json({error:'Local access only'});
  const origin=req.get('origin');
  if(origin && ![`http://127.0.0.1:${PORT}`,`http://localhost:${PORT}`].includes(origin))return res.status(403).json({error:'Cross-origin requests are disabled'});
  res.set('Referrer-Policy','no-referrer'); res.set('X-Content-Type-Options','nosniff'); next();
});
app.use(express.json({limit:'100kb'}));
const upload=multer({dest:path.join(DATA,'uploads'),limits:{fileSize:512*1024*1024,files:1,fields:10}});
const live=new LiveEngine({dataDir:DATA,catalog:getCatalog,jobs:()=>store.list(),credentials});
const dreamLive=new DreamLive({live,dataDir:DATA});
app.use('/api/dream-live',dreamLive.routes());
app.use('/api/live',live.routes());
app.use('/live-media',express.static(path.join(DATA,'live'),{dotfiles:'deny',index:false}));
app.get('/api/status',(_req,res)=>res.json({apiConfigured:!!credentials().key,model:credentials().model,working,dataDirectory:DATA,catalogAt,catalogError}));
app.get('/api/catalog',async(_req,res)=>res.json({clips:await getCatalog(),fetchedAt:catalogAt,warning:catalogError}));
app.get('/api/jobs',(_req,res)=>res.json(store.list().map(cleanJob)));
app.get('/api/jobs/:id',(req,res)=>{const j=store.get(req.params.id);if(!j)return res.status(404).json({error:'Run not found'});res.json(cleanJob(j));});
app.post('/api/jobs/public',async(req,res)=>{
  const clip=(await getCatalog()).find(c=>c.id===req.body.clipId);
  if(!clip)return res.status(404).json({error:'Public clip not found'});
  const input=inputs({...req.body,task:clip.task});
  const job=store.create({...clip,...input,captureKind:'public_download',provenance:'Existing public gallery clip; task criteria created before Bruno evaluation, after original run.'});
  event(job.id,'Public clip added to the background queue.');await persistManifest(job);
  res.status(202).json(cleanJob(job));void work();
});
app.post('/api/jobs/download',async(req,res)=>{
  const input=inputs(req.body), videoUrl=allowedMediaUrl(req.body.videoUrl);
  const job=store.create({...input,videoUrl,sourceUrl:videoUrl,scene:'Imported video',origin:'User-supplied Dream Labs video',captureKind:'public_download',providerScore:null});
  event(job.id,'Video added to the background download queue.');await persistManifest(job);res.status(202).json(cleanJob(job));void work();
});
app.post('/api/jobs/upload',upload.single('video'),async(req,res)=>{
  if(!req.file)throw new Error('Choose a video file');
  try {
    const input=inputs(req.body);
    const job=store.create({...input,scene:'Imported video',origin:req.body.captureKind==='browser_recording'?'Browser recording':'Local video upload',
      sourceUrl:String(req.body.sourceUrl||'').slice(0,2000),captureKind:req.body.captureKind==='browser_recording'?'browser_recording':'upload',providerScore:null,status:'receiving'});
    const dir=dirFor(job.id);await mkdir(dir,{recursive:true});
    const ext=/\.webm$/i.test(req.file.originalname)?'.webm':/\.mov$/i.test(req.file.originalname)?'.mov':'.mp4';
    const file=path.join(dir,'original'+ext);await rename(req.file.path,file);
    const saved=store.update(job.id,{sourceFile:file,status:'queued'});event(job.id,'Video saved locally and queued for evaluation.');
    await persistManifest(saved);res.status(202).json(cleanJob(saved));void work();
  } catch(e) {await rm(req.file.path,{force:true});throw e;}
});
app.post('/api/jobs/:id/retry',async(req,res)=>{
  const job=store.get(req.params.id);if(!job)return res.status(404).json({error:'Run not found'});
  if(!['failed','needs_key'].includes(job.status))return res.status(409).json({error:'Only a failed or waiting run can be retried'});
  const next=store.update(job.id,{status:'queued',error:null});event(job.id,'Retry requested. Saved video and frames will be reused.');res.json(cleanJob(next));void work();
});
app.post('/api/jobs/:id/review',async(req,res)=>{
  const job=store.get(req.params.id);if(!job?.report)return res.status(409).json({error:'Wait for the assessment before reviewing it'});
  if(!['pass','fail','uncertain'].includes(req.body.verdict))throw new Error('Choose a valid verdict');
  const review={verdict:req.body.verdict,note:String(req.body.note||'').slice(0,2000),at:new Date().toISOString()};
  const next=store.update(job.id,{reviews:[...(job.reviews||[]),review]});event(job.id,`Human review saved: ${review.verdict}. Original AI assessment retained.`);
  await persistManifest(next);res.json(cleanJob(next));
});
app.get('/api/jobs/:id/export',async(req,res)=>{
  const job=store.get(req.params.id);if(!job)return res.status(404).json({error:'Run not found'});
  res.attachment(`bruno-${job.id}.json`).json(cleanJob(job));
});
app.get('/api/jobs/:id/original',(req,res)=>{
  const job=store.get(req.params.id);if(!job?.sourceFile)return res.status(404).json({error:'Video is not saved yet'});
  res.download(job.sourceFile,`bruno-${job.id}${path.extname(job.sourceFile)}`);
});
app.use('/media',express.static(path.join(DATA,'runs'),{dotfiles:'deny',index:false}));
app.use(express.static(path.join(ROOT,'public')));
app.use((err,_req,res,_next)=>res.status(err.code==='LIMIT_FILE_SIZE'?413:400).json({error:err.message||'Request failed'}));
const server=app.listen(PORT,'127.0.0.1',()=>console.log(`Bruno is running at http://127.0.0.1:${PORT}`));
const interval=setInterval(()=>void work(),1500);
function shutdown(){stopping=true;clearInterval(interval);dreamLive.close();void live.close();server.close(()=>{store.close();process.exit(0);});}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
void getCatalog().catch(e=>console.warn('Public catalog unavailable:',e.message));
live.startWorker();
void dreamLive.init();
