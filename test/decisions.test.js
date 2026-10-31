import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {decisionQuestions,parseDecisions,aggregateDecisions} from '../lib/decisions-evaluate.js';
import {observeLive} from '../lib/live-evaluate.js';

const frames=[{id:0,seconds:0},{id:20,seconds:4.2}],criteria=['Cube in bowl'];
const choice=(name,value,values)=>({name,type:'choice',choice:value,confidence:.8,probabilities:values.map(v=>({value:v,probability:v===value?1:0}))});
const response=(verdict='pass',anchor='20')=>({answers:[choice('criterion_0',verdict,['pass','fail','uncertain']),choice('evidence_0',anchor,['0','20','none'])]});

test('decisions preserves criterion order and distinguishes partial from final footage',()=>{
  const questions=decisionQuestions(['Cube in bowl','Gripper empty'],frames,true);
  assert.deepEqual(questions.map(q=>q.name),['criterion_0','evidence_0','criterion_1','evidence_1']);
  assert.ok(!questions[0].choices.some(c=>c.value==='in_progress'));
  assert.ok(decisionQuestions(criteria,frames,false)[0].choices.some(c=>c.value==='in_progress'));
  assert.throws(()=>decisionQuestions([],frames,true));
});
test('decisions maps evidence only to supplied timestamps and handles answer reordering',()=>{
  const raw=response();raw.answers.reverse();const result=parseDecisions(raw,criteria,frames,true);
  assert.equal(result.verdict,'pass');assert.equal(result.criteria[0].criterion,criteria[0]);
  assert.equal(result.criteria[0].evidence[0].seconds,4.2);
  assert.equal(result.criteria[0].evidence[0].frameId,20);
  raw.answers[0].choice='999';assert.throws(()=>parseDecisions(raw,criteria,frames,true),/unsupported/);
});
test('refusals, missing evidence, and uncertain conditions cannot become a pass',()=>{
  for(const verdict of ['pass','fail'])assert.equal(parseDecisions(response(verdict,'none'),criteria,frames,true).verdict,'uncertain');
  for(const index of [0,1]){
    const raw=response();raw.answers[index]={name:raw.answers[index].name,type:'refusal'};
    assert.equal(parseDecisions(raw,criteria,frames,true).verdict,'uncertain');
  }
  assert.equal(aggregateDecisions([{verdict:'pass'},{verdict:'uncertain'}]),'uncertain');
  assert.equal(aggregateDecisions([{verdict:'pass'},{verdict:'fail'}]),'fail');
  assert.equal(aggregateDecisions([{verdict:'pass'},{verdict:'in_progress'}]),'in_progress');
  assert.equal(aggregateDecisions([]),'uncertain');
});
test('malformed Decisions responses fail validation rather than inventing a judgment',()=>{
  const cases=[{answers:[]},response(),response(),response()];
  cases[1].answers.push(cases[1].answers[0]);
  cases[2].answers[0].confidence=NaN;
  cases[3].answers[0].probabilities[0].probability=2;
  for(const raw of cases)assert.throws(()=>parseDecisions(raw,criteria,frames,true));
});

test('Decisions outage falls back to Responses with honest provenance',async()=>{
  const requests=[];
  const server=createServer(async(req,res)=>{
    let body='';for await(const chunk of req)body+=chunk;
    requests.push({url:req.url,body:JSON.parse(body)});res.setHeader('Content-Type','application/json');
    if(req.url==='/v1/decisions'){
      res.writeHead(503);res.end(JSON.stringify({error:{message:'Unavailable',type:'server_error'}}));return;
    }
    res.end(JSON.stringify({id:'test-response',model:'gpt-6.1-sol',object:'response',status:'completed',output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',annotations:[],text:JSON.stringify({summary:'Cube is still outside the bowl.',progress:'in_progress',evidence:[{seq:0,observation:'Cube outside bowl'}],concerns:[]})}]}]}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const oldBase=process.env.OPENAI_BASE_URL,dir=await mkdtemp(path.join(os.tmpdir(),'bruno-decisions-'));
  process.env.OPENAI_BASE_URL=`http://127.0.0.1:${server.address().port}/v1`;
  try{
    await mkdir(path.join(dir,'frames'));await writeFile(path.join(dir,'frames','0.jpg'),Buffer.from([255,216,255,217]));
    const received=[{seq:0,seconds:0,file:'0.jpg'}];
    const result=await observeLive({task:'Move cube',criteria,frames:received,reviews:[],stopRequested:false},received,dir,{key:'local-test-only',model:'gpt-6.1-sol',evaluationApi:'decisions'});
    assert.deepEqual(requests.map(r=>r.url),['/v1/decisions','/v1/responses']);
    assert.equal(requests[0].body.model,'gpt-6-luna');assert.equal(result.api,'responses');
    assert.equal(result.fallback.reason,'HTTP 503');assert.equal(result.progress,'in_progress');
    assert.equal(result.model,'gpt-6.1-sol');assert.equal(result.evidence[0].seconds,0);
  }finally{
    if(oldBase===undefined)delete process.env.OPENAI_BASE_URL;else process.env.OPENAI_BASE_URL=oldBase;
    await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true});
  }
});
