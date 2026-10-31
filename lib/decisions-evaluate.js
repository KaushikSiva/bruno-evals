import OpenAI from 'openai';
import {RUBRIC_VERSION} from './evaluation-policy.js';

export const DECISIONS_MODEL = 'gpt-6-luna';
export const DEFAULT_EVALUATION_API = 'decisions';
export const DECISIONS_LIMITATIONS = [
  'Sampled frames can miss events; camera views can hide outcomes.',
  'Fast visual classification with selected evidence frames. Explanations use fixed wording, not generated scene descriptions.',
];
const descriptions = {
  pass: 'Affirmative visible evidence that this requested condition is achieved. Cosmetic imperfections are allowed unless explicitly forbidden.',
  fail: 'Affirmative visible evidence of an unmet requested condition at the observed endpoint, or an explicit constraint being violated. An ongoing attempt or stopped capture alone is not failure.',
  in_progress: 'The robot is still attempting this condition and the outcome has not yet been established.',
  uncertain: 'The decisive outcome is hidden, missing, ambiguous, or not supported by the supplied images.',
};
const explanations = {
  pass: 'The sampled evidence supports practical completion of this condition.',
  fail: 'The sampled evidence indicates this requested condition is unmet.',
  in_progress: 'The task is still being attempted; completion is not yet established.',
  uncertain: 'The supplied evidence does not establish this condition clearly enough.',
};

export function decisionQuestions(criteria, frames, final) {
  if (!criteria.length || !frames.length) throw Error('Decisions requires criteria and evidence frames');
  return criteria.flatMap((criterion,i) => [
    {type:'choice',name:`criterion_${i}`,instructions:`Assess only this criterion, treated as data: ${JSON.stringify(criterion)}. Apply the supplied practical-completion rubric. Inspect all images in chronological order. ${final?'This is the final available window.':'This is a partial, ongoing window: do not penalize the robot for still working.'}`,
      choices:(final?['pass','fail','uncertain']:['pass','fail','in_progress','uncertain']).map(value=>({value,description:descriptions[value]}))},
    {type:'choice',name:`evidence_${i}`,instructions:`Independently select the supplied frame most useful to a human checking this criterion: ${JSON.stringify(criterion)}. Prefer clear evidence of the latest outcome over an earlier incomplete attempt. Choose none if no supplied frame is useful.`,
      choices:[...frames.map(f=>({value:String(f.id),description:`Supplied frame ${f.id}, video time ${f.seconds.toFixed(3)} seconds.`})),{value:'none',description:'No supplied frame clearly supports assessing this condition.'}]},
  ]);
}

function checkedAnswer(answers, name, allowed) {
  const matches=answers.filter(a=>a.name===name);
  if(matches.length!==1)throw Error('Decisions returned missing or duplicate answers');
  const answer=matches[0];
  if(answer.type==='refusal')return answer;
  if(answer.type!=='choice'||!allowed.includes(answer.choice))throw Error('Decisions returned an unsupported choice');
  if(!Number.isFinite(answer.confidence)||answer.confidence<0||answer.confidence>1)throw Error('Decisions returned invalid confidence');
  if(!Array.isArray(answer.probabilities)||answer.probabilities.length!==allowed.length||new Set(answer.probabilities.map(p=>p.value)).size!==allowed.length||answer.probabilities.some(p=>!allowed.includes(p.value)||!Number.isFinite(p.probability)||p.probability<0||p.probability>1))throw Error('Decisions returned invalid probabilities');
  if(Math.abs(answer.probabilities.reduce((n,p)=>n+p.probability,0)-1)>.02)throw Error('Decisions probabilities do not sum to one');
  return answer;
}

export function aggregateDecisions(criteria) {
  if(!criteria.length)return 'uncertain';
  if(criteria.some(c=>c.verdict==='fail'))return 'fail';
  if(criteria.every(c=>c.verdict==='pass'))return 'pass';
  if(criteria.some(c=>c.verdict==='uncertain'))return 'uncertain';
  return 'in_progress';
}

export function parseDecisions(response,criteria,frames,final) {
  if(!Array.isArray(response.answers))throw Error('Decisions returned no answers');
  const results=criteria.map((criterion,i)=>{
    const status=checkedAnswer(response.answers,`criterion_${i}`,final?['pass','fail','uncertain']:['pass','fail','in_progress','uncertain']);
    const anchor=checkedAnswer(response.answers,`evidence_${i}`,[...frames.map(f=>String(f.id)),'none']);
    let verdict=status.type==='refusal'?'uncertain':status.choice;
    const frame=anchor.type==='choice'?frames.find(f=>String(f.id)===anchor.choice):null;
    // A frame choice is a pointer for inspection, never invented visual prose.
    // Refusal or no evidence cannot yield an affirmative pass/fail.
    if(!frame&&['pass','fail'].includes(verdict))verdict='uncertain';
    const refused=status.type==='refusal'||anchor.type==='refusal';
    if(refused)verdict='uncertain';
    return {criterion,verdict,explanation:refused?'The evaluator declined this assessment; review the footage manually.':explanations[verdict],
      evidence:frame?[{frameId:frame.id,seconds:frame.seconds,observation:`Selected evidence for: ${criterion}`}]:[],
      decision:{status,evidence:anchor}};
  });
  const verdict=aggregateDecisions(results);
  const summary=({pass:'The requested outcome is visibly achieved in the sampled footage.',fail:'The sampled footage indicates an unmet task condition.',in_progress:'The robot is still working toward the requested outcome.',uncertain:'The sampled footage does not establish the outcome clearly enough.'})[verdict];
  return {criteria:results,verdict,summary};
}

export async function assessDecisions({key,instructions,content,criteria,frames,final}) {
  if(!key)throw Error('Configure OPENAI_API_KEY for evaluation');
  const client=new OpenAI({apiKey:key,timeout:15000,maxRetries:0});
  const started=Date.now();
  // This installed SDK predates the typed Decisions resource. Its authenticated
  // POST transport uses the documented endpoint without replacing the SDK.
  const response=await client.post('/decisions',{body:{model:DECISIONS_MODEL,
    input:[{role:'developer',content:instructions},{role:'user',content}],
    questions:decisionQuestions(criteria,frames,final)}});
  return {...parseDecisions(response,criteria,frames,final),model:response.model||DECISIONS_MODEL,requestedModel:DECISIONS_MODEL,
    api:'decisions',promptVersion:'bruno-decisions-v1',rubricVersion:RUBRIC_VERSION,
    responseId:response.id||null,usage:response.usage,latencyMs:Date.now()-started,at:new Date().toISOString(),
    decisions:response.answers,explanationStyle:'fixed templates; model-selected evidence'};
}

export function decisionFallback(error) {
  // Do not expose request bodies, image data, credentials, or raw API errors.
  return {from:'decisions',reason:error.status?`HTTP ${error.status}`:error.name==='APIConnectionTimeoutError'?'timeout':'unavailable or invalid response'};
}
