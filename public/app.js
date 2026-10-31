import {LiveUI} from './live.js';
import {DreamLiveUI} from './dream-live.js';
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const requestedRun=new URL(location.href).searchParams.get('run');
const requestedStation=new URL(location.href).searchParams.get('station');
const requestedLive=new URL(location.href).searchParams.get('live');
const state={dream:{stations:[],watch:null},clips:[],jobs:[],liveSessions:[],mode:'public',selected:null,query:'',scene:'',status:{},signature:''};
const video=$('#video');
const fmt=s=>`${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;
const pretty=s=>String(s||'').replaceAll('_',' ');
let toastTimer;
function toast(message){$('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,6000);}
async function api(url,body){const res=await fetch(url,body instanceof FormData?{method:'POST',body}:body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});const data=await res.json();if(!res.ok)throw Error(data.error||'Request failed');return data;}
const live=new LiveUI({api,toast,isSelected:id=>state.mode==='live'&&state.selected===id,onSession(session,select){state.liveSessions=[session,...state.liveSessions.filter(s=>s.id!==session.id)];if(select){setMode('live');choose(session.id);}else{renderList();if(state.mode==='live')renderSelected();}}});
const dream=new DreamLiveUI({api,toast,onInfo(info){state.dream=info;state.signature='';renderSelected();},onSession(session){setMode('live');choose(session.id);}});
function setMode(mode){state.mode=mode;if(mode!=='dream')dream.hide();$('#dream-live-open').setAttribute('aria-pressed',mode==='dream');state.signature='';for(const name of ['public','saved','live']){$(`#${name}-tab`).classList.toggle('active',mode===name);$(`#${name}-tab`).setAttribute('aria-selected',mode===name);}$('#scene-filter').hidden=mode!=='public';renderList();}
function selected(){return(state.mode==='dream'?state.dream.stations:state.mode==='public'?state.clips:state.mode==='live'?state.liveSessions:state.jobs).find(c=>c.id===state.selected);}
function renderList(){
  $('#public-count').textContent=state.clips.length;$('#saved-count').textContent=state.jobs.length;$('#live-count').textContent=state.liveSessions.length;
  if(state.mode==='dream'){const stations=state.dream.stations;$('#run-list').innerHTML=stations.length?stations.map(s=>`<button class="run-row ${s.id===state.selected?'selected':''}" data-id="${esc(s.id)}"><span class="row-number">●</span><span class="row-text"><strong>${esc(s.name)}</strong><small>${s.cameras.includes('head')?'Camera available':'Waiting for camera'}</small></span></button>`).join(''):'<p class="empty-note">Dream Labs has no public stations available right now.</p>';$('#run-list').querySelectorAll('[data-id]').forEach(el=>el.onclick=()=>choose(el.dataset.id));return;}
  const items=(state.mode==='public'?state.clips:state.mode==='live'?state.liveSessions:state.jobs).filter(c=>(!state.scene||state.mode!=='public'||c.scene===state.scene)&&(`${c.task} ${c.scene} ${c.status||''}`).toLowerCase().includes(state.query));
  $('#run-list').innerHTML=items.length?items.map((c,i)=>`<button class="run-row ${c.id===state.selected?'selected':''}" data-id="${esc(c.id)}" title="${esc(c.task)}">${c.posterUrl?`<img src="${esc(c.posterUrl)}" alt="" loading="lazy">`:c.media?`<img src="/media/${c.id}/frames/000.jpg" alt="" loading="lazy">`:`<span class="row-number">${String(i+1).padStart(2,'0')}</span>`}<span class="row-text"><strong>${esc(c.task)}</strong><small>${esc(state.mode==='public'?pretty(c.scene):c.report?c.report.verdict:pretty(c.status))}</small></span></button>`).join(''):`<p class="empty-note">${state.mode==='public'?'No matching public runs.':'Saved runs and their assessments will appear here.'}</p>`;
  $('#run-list').querySelectorAll('[data-id]').forEach(el=>el.onclick=()=>choose(el.dataset.id));
}
function choose(id){state.selected=id;state.signature='';if(id){const u=new URL(location.href);u.searchParams.delete('run');u.searchParams.delete('live');u.searchParams.delete('station');if(state.mode==='dream')u.searchParams.set('station',id);if(state.mode==='saved')u.searchParams.set('run',id);if(state.mode==='live')u.searchParams.set('live',id);history.replaceState(null,'',u);}renderList();renderSelected();}
function setVideo(src,poster=''){
  video.dataset.live='false';
  if(video.dataset.source!==src||video.srcObject){video.pause();video.srcObject=null;video.controls=true;video.muted=false;video.dataset.source=src||'';if(src){video.src=src;video.poster=poster||'';}else{video.removeAttribute('src');video.removeAttribute('poster');video.load();}}
  $('#video-empty').hidden=!!src;
}
function seek(seconds){if(!video.getAttribute('src'))return;video.currentTime=seconds;video.play().catch(()=>{});}
function bindEvidence(){document.querySelectorAll('[data-time]').forEach(el=>el.onclick=()=>seek(Number(el.dataset.time)));}
function frameStrip(job){if(!job.media)return'';return`<div class="frames">${job.media.frames.map(f=>`<button class="frame" data-time="${f.seconds}" title="Seek to ${f.seconds.toFixed(2)} seconds"><img src="/media/${job.id}/frames/${f.file}" alt="Evidence frame at ${f.seconds.toFixed(2)} seconds" loading="lazy"><span>${fmt(f.seconds)}</span></button>`).join('')}</div>`;}
function renderSelected(){
  const item=selected();if(!item){if(state.mode==='dream')dream.render({id:'',name:'Dream Labs',online:false,cameras:[],scene:state.dream.error||'No public station is available.',sourceUrl:'https://dreamlabs.ai/playground/'},state.dream,state.liveSessions);return;}
  if(state.mode==='dream'){dream.render(item,state.dream,state.liveSessions);return;}
  const signature=`${state.mode}:${item.id}:${item.updated||''}`;if(state.signature===signature)return;state.signature=signature;
  if(state.mode==='live'){live.render(item);return;}
  $('#scene-label').textContent=state.mode==='public'?`${pretty(item.scene)} / PUBLIC RUN`:`${pretty(item.scene)} / SAVED RUN`;
  $('#task-heading').textContent=item.task;$('#run-status').textContent=state.mode==='public'?'Public footage':pretty(item.status);
  if(state.mode==='public')renderPublic(item);else renderJob(item);
}
function renderPublic(clip){
  setVideo(clip.previewUrl,clip.posterUrl);
  $('#video-origin').textContent='Dream Labs · selected public clip · playback may be accelerated';
  $('#download-links').innerHTML='<a href="https://dreamlabs.ai/playground/" target="_blank" rel="noreferrer">View source ↗</a>';
  $('#evidence-heading').textContent='From footage to evidence';$('#frame-label').textContent='Evaluation runs after download';
  $('#evidence-body').innerHTML=`<div class="workflow"><div><b>01</b><h3>Save the original</h3><p>The task, source, and video are archived together.</p></div><div><b>02</b><h3>Assess the outcome</h3><p>Review sampled frames against your criteria.</p></div><div><b>03</b><h3>Inspect the evidence</h3><p>Every judgment points back to visible footage.</p></div></div>`;
  $('#inspector').innerHTML=`<p class="eyebrow">EVALUATION SETUP</p><h2>Define a good outcome.</h2><p class="muted">The original instruction is preserved. Set the criteria before Bruno reviews the video.</p><form id="eval-form"><label for="criteria">Success criteria · one per line<textarea id="criteria" rows="6">${esc(`The requested end state is visibly achieved: ${clip.task}`)}</textarea></label><button type="submit" class="primary">Download & evaluate <span aria-hidden="true">↗</span></button><p class="form-error" role="alert"></p></form><p class="fineprint">The original is saved first. Evaluation continues in the background while you review other runs.</p><div class="divider"></div><div class="facts"><span>Source</span><strong>Public gallery</strong><span>Assessment</span><strong>Visible outcomes</strong><span>Publisher score</span><strong>Withheld from evaluator</strong><span>Human review</span><strong>Available after assessment</strong></div><p class="fineprint">This selected clip cannot establish the model’s overall reliability. A video assessment cannot certify physical safety.</p>`;
  $('#eval-form').onsubmit=async e=>{e.preventDefault();const button=e.target.querySelector('button');button.disabled=true;try{const job=await api('/api/jobs/public',{clipId:clip.id,criteria:$('#criteria').value.split('\n').filter(s=>s.trim())});state.jobs.unshift(job);setMode('saved');choose(job.id);toast('Run queued. The original video will be saved before evaluation.');}catch(err){e.target.querySelector('.form-error').textContent=err.message;button.disabled=false;}};
  $('#eval-form').insertAdjacentHTML('afterend','<button id="start-live-replay" class="live-start">Watch & evaluate live <span aria-hidden="true">↗</span></button>');
  $('#start-live-replay').onclick=async e=>{e.currentTarget.disabled=true;const button=e.currentTarget;button.textContent='Preparing live replay…';try{await live.startReplay(clip.id,$('#criteria').value.split('\n').filter(s=>s.trim()));}catch(err){toast(err.message);button.disabled=false;button.textContent='Watch & evaluate live ↗';}};
}
function renderJob(job){
  setVideo(job.media?`/media/${job.id}/video.mp4`:null);
  $('#video-origin').textContent=job.media?`${fmt(job.media.duration)} saved footage · ${job.media.width} × ${job.media.height} · ${job.media.frames.length} sampled frames`:pretty(job.status);
  $('#download-links').innerHTML=`${job.media?`<a href="/api/jobs/${job.id}/original">Original ↓</a>`:''}<a href="/api/jobs/${job.id}/export">Report JSON ↓</a>`;
  $('#frame-label').textContent=job.media?'Timestamps refer to saved-video time':'Original video is being prepared';
  const timeline=`<ul class="timeline">${(job.events||[]).map(e=>`<li><time>${new Date(e.at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</time><span>${esc(e.message)}</span></li>`).join('')}</ul>`;
  if(job.report){
    const r=job.report;$('#evidence-heading').textContent='Timestamped evidence';
    $('#evidence-body').innerHTML=frameStrip(job)+r.criteria.map(c=>`<article class="criterion"><div class="criterion-heading"><strong>${esc(c.criterion)}</strong><span class="status-chip">${esc(c.verdict)}</span></div><p>${esc(c.explanation)}</p><div class="evidence-links">${c.evidence.map(e=>`<button class="evidence-link" data-time="${e.seconds}" title="${esc(e.observation)}">${fmt(e.seconds)} · ${esc(e.observation)}</button>`).join('')}</div></article>`).join('')+`<div class="section-heading"><h2>Activity</h2></div>${timeline}`;
    $('#inspector').innerHTML=`<p class="eyebrow">AI VISUAL ASSESSMENT</p><div class="verdict ${esc(r.verdict)}">${esc(r.verdict)}</div><p>${esc(r.summary)}</p><p class="fineprint">Provisional assessment · ${esc(r.model)}</p><div class="divider"></div><div class="facts"><span>Publisher score</span><strong>${job.providerScore===null||job.providerScore===undefined?'Not supplied':esc(job.providerScore)+' / 1'}</strong><span>Score shown to evaluator</span><strong>No</strong><span>Evidence</span><strong>${job.media.frames.length} sampled frames</strong></div><p class="fineprint">Publisher scores may use a different rubric. They are not converted into Bruno verdicts.</p><div class="divider"></div><p class="eyebrow">HUMAN REVIEW</p><form id="review-form"><select id="review-verdict" class="review-select" aria-label="Human verdict"><option value="uncertain">Uncertain</option><option value="pass">Pass</option><option value="fail">Fail</option></select><textarea id="review-note" rows="2" aria-label="Review note" placeholder="What did you observe?"></textarea><button class="primary" type="submit">Save my review</button></form>${job.reviews?.length?`<p class="review-saved">Latest review: ${esc(job.reviews.at(-1).verdict)} · ${esc(job.reviews.at(-1).note)}</p>`:''}<div class="divider"></div><p class="eyebrow">LIMITATIONS</p><ul class="limitations">${[...r.limitations,'Sampled footage can miss brief events between frames.','Selected public clips do not measure overall model reliability.'].map(l=>`<li>${esc(l)}</li>`).join('')}</ul><div class="divider"></div><p class="eyebrow">NEXT EXPERIMENTS</p>${r.follow_up_tests.map(t=>`<div class="followup">${esc(t.instruction)}<p>${esc(t.reason)}</p></div>`).join('')}`;
    $('#review-form').onsubmit=async e=>{e.preventDefault();try{const next=await api(`/api/jobs/${job.id}/review`,{verdict:$('#review-verdict').value,note:$('#review-note').value});state.jobs=state.jobs.map(j=>j.id===job.id?next:j);renderSelected();toast('Human review saved. The original AI report is retained.');}catch(err){toast(err.message);}};
  }else{
    $('#evidence-heading').textContent='Background activity';$('#evidence-body').innerHTML=frameStrip(job)+timeline;
    const waiting=job.status==='needs_key',failed=job.status==='failed';
    const descriptions={queued:'Waiting for the current run to finish.',downloading:'Downloading the original public video.',preparing:`Preparing footage and extracting frames${job.framesReady?` (${job.framesReady}/${job.framesTotal})`:''}.`,evaluating:'Reviewing visible outcomes against the saved criteria.',needs_key:'Your video and evidence frames are saved. Configure an API key to begin evaluation.',failed:job.error};
    $('#inspector').innerHTML=`<p class="eyebrow">BACKGROUND JOB</p><h2>${waiting?'Video saved.':failed?'Needs attention.':'Evaluation in progress.'}</h2><p class="${failed?'error-message':'muted'}">${esc(descriptions[job.status]||pretty(job.status))}</p>${!waiting&&!failed?'<div class="progress-track"><span></span></div>':''}${job.status==='downloading'&&job.downloadedBytes?`<p class="busy-label">${(job.downloadedBytes/1048576).toFixed(1)} MB downloaded</p>`:''}${waiting?'<p class="fineprint">Add OPENAI_API_KEY to .env.local. The worker checks for it automatically.</p>':''}${waiting||failed?'<button id="retry" class="primary">Retry evaluation</button>':''}<div class="divider"></div><p class="eyebrow">SAVED CRITERIA</p>${job.criteria.map(c=>`<p>${esc(c)}</p>`).join('')}<div class="divider"></div><p class="fineprint">You can browse other clips or close this page. The local worker continues while its server is running and your Mac is awake.</p>${job.media?`<p class="fineprint">Original SHA-256<br><code>${esc(job.media.originalSha256.slice(0,24))}…</code></p>`:''}`;
    const retry=$('#retry');if(retry)retry.onclick=async()=>{try{await api(`/api/jobs/${job.id}/retry`,{});await refresh();}catch(e){toast(e.message);}};
  }
  bindEvidence();
}
$('#dream-live-open').onclick=()=>{setMode('dream');choose(state.dream.stations[0]?.id);};
$('#public-tab').onclick=()=>{setMode('public');choose(state.clips[0]?.id);};
$('#saved-tab').onclick=()=>{setMode('saved');if(state.jobs[0])choose(state.jobs[0].id);};
$('#live-tab').onclick=()=>{setMode('live');if(state.liveSessions[0])choose(state.liveSessions[0].id);};
$('#search').oninput=e=>{state.query=e.target.value.toLowerCase();renderList();};
$('#scene-filter').onchange=e=>{state.scene=e.target.value;renderList();};
document.querySelectorAll('.dialog-close').forEach(el=>el.onclick=()=>el.closest('dialog').close());
$('#import-open').onclick=()=>$('#import-dialog').showModal();
$('#import-form').onsubmit=async e=>{
  e.preventDefault();const form=e.target,button=form.querySelector('[type=submit]');button.disabled=true;
  try{const data=new FormData(form);const criteria=String(data.get('criteria')).split('\n').filter(s=>s.trim());if(criteria.length)data.set('criteria',JSON.stringify(criteria));else data.delete('criteria');
    const file=data.get('video');let job;if(file?.size){data.delete('videoUrl');job=await api('/api/jobs/upload',data);}else{job=await api('/api/jobs/download',{videoUrl:data.get('videoUrl'),task:data.get('task'),...(criteria.length?{criteria}:{})});}
    state.jobs.unshift(job);$('#import-dialog').close();form.reset();setMode('saved');choose(job.id);toast('Video queued for background evaluation.');
  }catch(err){form.querySelector('.form-error').textContent=err.message;}finally{button.disabled=false;}
};
let recorder=null,recordStream=null,recordTimer=null,recordStarted=0,recordChunks=[],recordInput=null;
$('#record-open').onclick=()=>{if(recorder?.state==='recording')return toast('A recording is already running.');if(!navigator.mediaDevices?.getDisplayMedia)return toast('Use Chrome or Edge on localhost to record a browser tab.');$('#record-dialog').showModal();};
$('#record-form').onsubmit=async e=>{
  e.preventDefault();const form=e.target;
  try{
    recordInput={task:form.elements.task.value,criteria:form.elements.criteria.value.split('\n').filter(s=>s.trim())};
    recordStream=await navigator.mediaDevices.getDisplayMedia({video:{frameRate:30},audio:false,preferCurrentTab:false});
    await live.startCapture(recordStream,recordInput.task,recordInput.criteria);
    const type=['video/webm;codecs=vp9','video/webm;codecs=vp8','video/mp4'].find(t=>MediaRecorder.isTypeSupported(t));
    recorder=new MediaRecorder(recordStream,type?{mimeType:type}:{});recordChunks=[];
    recorder.ondataavailable=e=>{if(e.data.size)recordChunks.push(e.data);};
    recorder.onstop=async()=>{
      clearInterval(recordTimer);$('#recording-banner').hidden=true;
      const session=await live.stop('user_stopped').catch(e=>toast(e.message));
      recordStream.getTracks().forEach(t=>t.stop());
      const mime=recorder.mimeType,blob=new Blob(recordChunks,{type:mime});recordChunks=[];recorder=null;
      const data=new FormData();data.append('video',blob,mime.includes('mp4')?'browser-run.mp4':'browser-run.webm');data.append('task',recordInput.task);data.append('captureKind','browser_recording');if(recordInput.criteria.length)data.append('criteria',JSON.stringify(recordInput.criteria));
      toast('Recording stopped. Saving the video and queuing evaluation…');
      try{const job=await api('/api/jobs/upload',data);state.jobs.unshift(job);setMode('saved');choose(job.id);toast('Recording saved. Evaluation is running in the background.');if(session?.id)await api(`/api/live/sessions/${session.id}/recording`,{jobId:job.id}).catch(e=>toast(`Recording saved; live link: ${e.message}`));}
      catch(err){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=mime.includes('mp4')?'bruno-recording.mp4':'bruno-recording.webm';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),60000);toast(`Upload failed: ${err.message}. A local copy was downloaded.`);}
    };
    recordStream.getVideoTracks()[0].onended=()=>{if(recorder?.state==='recording')recorder.stop();};
    recorder.start(1000);recordStarted=Date.now();recordTimer=setInterval(()=>{$('#record-clock').textContent=`Recording ${fmt((Date.now()-recordStarted)/1000)}`;if(Date.now()-recordStarted>600000&&recorder?.state==='recording')recorder.stop();},1000);
    $('#record-dialog').close();$('#recording-banner').hidden=false;toast('Recording your selected surface. Return here to stop and evaluate.');
  }catch(err){recordStream?.getTracks().forEach(t=>t.stop());form.querySelector('.form-error').textContent=err.message;}
};
$('#stop-record').onclick=()=>{if(recorder?.state==='recording')recorder.stop();};
window.addEventListener('beforeunload',e=>{if(recorder?.state==='recording'||live.active){e.preventDefault();e.returnValue='';}});
let polling=false;
async function refresh(){if(polling)return;polling=true;try{const [jobs,status,sessions,integration,dreamInfo]=await Promise.all([api('/api/jobs'),api('/api/status'),api('/api/live/sessions'),api('/api/live/status'),api('/api/dream-live/status')]);state.dream=dreamInfo;state.jobs=jobs;state.status=status;state.liveSessions=sessions;live.updateIntegration(integration);$('#api-state').textContent=status.apiConfigured?'Evaluator connected':'Evaluator needs key';renderList();renderSelected();}catch(err){$('#api-state').textContent='Worker disconnected';}finally{polling=false;}}
try{const data=await api('/api/catalog');state.clips=data.clips;$('#scene-filter').innerHTML='<option value="">All scenes</option>'+[...new Set(state.clips.map(c=>c.scene))].sort().map(s=>`<option value="${esc(s)}">${esc(pretty(s))}</option>`).join('');renderList();if(state.clips.length)choose(state.clips[0].id);if(data.warning)toast('Showing the last saved public catalog.');}catch(err){$('#run-list').innerHTML=`<p class="empty-note">${esc(err.message)}<br>You can still import a saved video.</p>`;}
await refresh();if(requestedStation&&state.dream.stations.some(s=>s.id===requestedStation)){setMode('dream');choose(requestedStation);}else if(requestedLive&&state.liveSessions.some(j=>j.id===requestedLive)){setMode('live');choose(requestedLive);}else if(requestedRun&&state.jobs.some(j=>j.id===requestedRun)){setMode('saved');choose(requestedRun);}setInterval(refresh,2000);
