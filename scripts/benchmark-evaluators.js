// Optional paid check against an existing local live session. Never changes it.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {observeLive,reviewLive,selectLiveFrames} from '../lib/live-evaluate.js';
import {DEFAULT_EVALUATION_MODEL} from '../lib/evaluation-policy.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const arg=process.argv.indexOf('--session'),id=arg>=0?process.argv[arg+1]:null;
if(!id||!/^[0-9a-f-]{36}$/i.test(id))throw Error('Usage: npm run benchmark -- --session YOUR_SESSION_ID');
if(!process.env.OPENAI_API_KEY)throw Error('Set OPENAI_API_KEY in .env.local before running this paid benchmark');
const dir=path.join(path.resolve(process.env.BRUNO_DATA_DIR||path.join(root,'data')),'live',id);
const stored=JSON.parse(await readFile(path.join(dir,'session.json'),'utf8'));
if(stored.status!=='completed'||!stored.frames?.length)throw Error('Use a completed session with saved frames');
const session={...stored,reviews:[],observations:[]},frames=selectLiveFrames(stored.frames,0,16,true);
const outcomes=await Promise.allSettled(['decisions','responses'].map(async evaluationApi=>{
  const credentials={key:process.env.OPENAI_API_KEY,model:process.env.OPENAI_MODEL||DEFAULT_EVALUATION_MODEL,evaluationApi};
  const observation=await observeLive(session,frames,dir,credentials);
  const review=await reviewLive(session,{frameSeqs:frames.map(f=>f.seq),observation},dir,credentials);
  const result={requestedApi:evaluationApi,actualApi:review.api,frameSeqs:frames.map(f=>f.seq),observation,review};
  console.log(JSON.stringify({requestedApi:evaluationApi,actualApi:review.api,observerMs:observation.latencyMs,reviewerMs:review.latencyMs,verdict:review.verdict}));
  return result;
}));
// Store only safe errors; a raw SDK error can include private request data.
const results=outcomes.map(r=>r.status==='fulfilled'?r:{status:'rejected',error:{name:r.reason?.name,status:r.reason?.status||null}});
const output=path.join(root,'artifacts',`benchmark-${Date.now()}.json`);await mkdir(path.dirname(output),{recursive:true});
await writeFile(output,JSON.stringify({at:new Date().toISOString(),sessionId:id,task:session.task,criteria:session.criteria,method:'One sample per API/model route. Historical judgments removed. Inference only; capture and Relay excluded. Cache state uncontrolled.',results},null,2));
console.log(`Saved ${path.relative(root,output)}`);
if(results.some(r=>r.status==='rejected'))process.exitCode=1;
