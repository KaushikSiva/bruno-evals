// Optional integration smoke test. Requires npm start and spends API credits.
// --capture uses a controlled canvas stream, never the user's desktop.
import {chromium} from 'playwright';
import {writeFile,mkdir,readFile} from 'node:fs/promises';
import {openSync} from 'node:fs';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
const capture=process.argv.includes('--capture');
const restart=process.argv.includes('--restart');
const name=capture?'live-capture':'live-replay',base='http://127.0.0.1:5190';
await mkdir('artifacts',{recursive:true});
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1512,height:982},reducedMotion:'reduce'});
const proof={kind:capture?'controlled browser capture':'public replay',errors:[],websocketMessages:0,websocketStates:0,states:[]};
if(capture)await page.route('**/api/live/sessions/*/frames?seq=2&*',async route=>{
  if(!proof.lostFrameResponse){const response=await route.fetch();assert.equal(response.status(),200);proof.lostFrameResponse=true;await route.abort('failed');}
  else{const response=await route.fetch();proof.frameRetryWasDuplicate=(await response.json()).duplicate===true;await route.fulfill({response});}
});
page.on('pageerror',e=>proof.errors.push(e.message));
page.on('websocket',ws=>ws.on('framereceived',e=>{try{const m=JSON.parse(e.payload);proof.websocketMessages++;const json=m.state?.stateJson||m.changes?.stateJson||m.stateJson;if(json){proof.websocketStates++;const s=JSON.parse(json);proof.lastWebsocketFrame=s.frames?.at(-1)?.seq;}}catch{}}));
if(capture)await page.addInitScript(()=>{
  navigator.mediaDevices.getDisplayMedia=async()=>{
    const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;
    const ctx=canvas.getContext('2d');let i=0;
    const paint=()=>{ctx.fillStyle='#e8e9de';ctx.fillRect(0,0,640,360);ctx.fillStyle='#3b5b45';ctx.fillRect(380,100,180,180);ctx.fillStyle='#e86738';ctx.fillRect(Math.min(100+i++*2,420),170,50,50);ctx.fillStyle='#202820';ctx.font='20px sans-serif';ctx.fillText('Controlled recording test — synthetic footage',25,40);};
    paint();const timer=setInterval(paint,100);const stream=canvas.captureStream(10);stream.getTracks()[0].addEventListener('ended',()=>clearInterval(timer));return stream;
  };
});
try{
  await page.goto(base);await page.waitForSelector('[data-id="dream-public-14"]');
  if(capture){
    await page.click('#record-open');await page.locator('#record-form [name=task]').fill('Synthetic test: move the orange square into the green rectangle.');
    await page.locator('#record-form [type=submit]').click();
  }else{await page.click('[data-id="dream-public-14"]');await page.click('#start-live-replay');}
  await page.waitForURL(/live=/,{timeout:30000});proof.id=new URL(page.url()).searchParams.get('live');
  await writeFile(`artifacts/${name}-id.txt`,proof.id);
  const started=Date.now();let stopped=false,session;
  for(let i=0;i<65;i++){
    await page.waitForTimeout(2000);
    try{session=await(await fetch(`${base}/api/live/sessions/${proof.id}`)).json();}
    catch(e){if(proof.restarted&&Date.now()-proof.restartAt<30000){(proof.restartInterruptions??=[]).push(e.message);continue;}throw e;}
    const row={elapsed:Math.round((Date.now()-started)/1000),status:session.status,frames:session.frames.length,observations:session.observations.length,reviews:session.reviews.length,messages:session.messages.length,error:session.lastError||null};
    proof.states.push(row);console.log(JSON.stringify(row));
    if(session.status==='live'&&session.reviews.length)proof.reviewBeforeEnd=true;
    if(session.status==='live'&&session.observations.length)proof.observationBeforeEnd=true;
    if(session.status==='live'&&session.observations.length>=3)proof.continuousObservationsBeforeEnd=true;
    if(i===8)await page.screenshot({path:`artifacts/${name}-during.png`,fullPage:true});
    if(capture&&!stopped&&row.elapsed>=24){await page.click('#stop-record');stopped=true;}
    await writeFile(`artifacts/${name}-proof.json`,JSON.stringify(proof,null,2));
    if(restart&&!proof.restarted&&session.status==='finishing'&&session.pending){
      proof.restartCheckpoint={token:session.pending.token,observationResponseId:session.pending.observation.responseId,reviewResponseId:session.pending.review?.responseId,frames:session.frames.length};
      process.kill(Number(await readFile('artifacts/server.pid','utf8')),'SIGTERM');
      await new Promise(r=>setTimeout(r,1200));
      const log=openSync('artifacts/server.log','a');const child=spawn(process.execPath,['--env-file-if-exists=.env.local','scripts/start.js'],{cwd:process.cwd(),stdio:['ignore',log,log],detached:true});child.unref();await writeFile('artifacts/server.pid',String(child.pid));
      for(let j=0;j<60;j++){try{const health=await(await fetch(base+'/api/live/status')).json();if(health.relay.connected)break;}catch{}await new Promise(r=>setTimeout(r,500));}
      proof.restarted=true;proof.restartAt=Date.now();
    }
    if(session.status==='completed')break;
  }
  proof.sessionStatus=session.status;proof.stopReason=session.stopReason;
  if(restart){const recovered=session.reviews.find(r=>r.token===proof.restartCheckpoint?.token);assert.ok(recovered);assert.equal(recovered.observer.responseId,proof.restartCheckpoint.observationResponseId);if(proof.restartCheckpoint.reviewResponseId)assert.equal(recovered.responseId,proof.restartCheckpoint.reviewResponseId);assert.equal(session.frames.length,proof.restartCheckpoint.frames);proof.checkpointRecovered=true;}
  proof.receipts=session.reviews.map(r=>({messageId:r.relayMessageId,deliveryId:r.relayDeliveryId,latencyMs:r.totalLatencyMs,through:r.observedThrough}));
  if(capture){const jobs=await(await fetch(base+'/api/jobs')).json();proof.recording=jobs.find(j=>j.task===session.task);}
  await page.goto(`${base}/?live=${proof.id}`);await page.waitForSelector('.agent-lanes');
  await page.screenshot({path:`artifacts/${name}-completed.png`,fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:`artifacts/${name}-mobile.png`,fullPage:true});
  proof.mobileOverflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
  assert.equal(session.status,'completed');assert.ok(proof.observationBeforeEnd);assert.ok(proof.websocketStates>5);assert.ok(proof.receipts.length>0);assert.ok(proof.receipts.every(r=>r.messageId&&r.deliveryId));assert.equal(proof.mobileOverflow,false);assert.deepEqual(proof.errors,[]);
  assert.ok(proof.continuousObservationsBeforeEnd);
  // The observer must update during capture. Relay-backed review may lag beyond
  // a short clip; retain its measured latency rather than assuming subsecond delivery.
  if(!capture)assert.equal(session.stopReason,'video_ended');
  else{assert.ok(proof.recording?.id);assert.equal(session.recordingJobId,proof.recording.id);assert.ok(session.videoUrl.endsWith('/video.mp4'));assert.ok(proof.frameRetryWasDuplicate);}
  proof.passed=true;
}catch(e){proof.failure=e.message;process.exitCode=1;console.error(e);}
finally{await writeFile(`artifacts/${name}-proof.json`,JSON.stringify(proof,null,2));await browser.close();}
