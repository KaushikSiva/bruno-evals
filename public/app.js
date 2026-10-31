import {LiveUI} from './live.js';
import {DreamLiveUI} from './dream-live.js';
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const requestedClip=new URL(location.href).searchParams.get('clip');
const stateCollection=new URL(location.href).searchParams.get('collection')==='public'?'public':'best';
const requestedRun=new URL(location.href).searchParams.get('run');
const requestedStation=new URL(location.href).searchParams.get('station');
const requestedLive=new URL(location.href).searchParams.get('live');
const state={dream:{stations:[],watch:null},clips:[],jobs:[],liveSessions:[],mode:'public',selected:null,query:'',collection:stateCollection,scene:'',status:{},signature:''};
const video=$('#video');
const fmt=s=>`${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;
const pretty=s=>String(s||'').replaceAll('_',' ');
let toastTimer;
function toast(message){$('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,6000);}
async function api(url,body){const res=await fetch(url,body instanceof FormData?{method:'POST',body}:body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});const data=await res.json();if(!res.ok)throw Error(data.error||'Request failed');return data;}
const live=new LiveUI({api,toast,isSelected:id=>state.mode==='live'&&state.selected===id,onSession(session,select){state.liveSessions=[session,...state.liveSessions.filter(s=>s.id!==session.id)];if(select){setMode('live');choose(session.id);}else{renderList();if(state.mode==='live')renderSelected();}}});
const dream=new DreamLiveUI({api,toast,onInfo(info){state.dream=info;state.signature='';renderSelected();},onSession(session){setMode('live');choose(session.id);}});
function reviewItems(){return [...state.jobs,...state.liveSessions].sort((a,b)=>String(b.created||'').localeCompare(String(a.created||'')));}
function publicItems(){return state.clips.filter(c=>(c.collection||'public')===state.collection);}
function setMode(mode){
  state.mode=mode;if(mode!=='dream')dream.hide();state.signature='';
  $('#dream-live-open').setAttribute('aria-pressed',mode==='dream');
  for(const name of ['public','saved','live']){const active=name==='saved'?['saved','live'].includes(mode):name==='public'&&mode==='public';$(`#${name}-tab`).classList.toggle('active',active);$(`#${name}-tab`).setAttribute('aria-selected',active);}
  $('#collection-filter').hidden=mode!=='public';$('#search').hidden=mode==='dream';renderList();
}
function selected(){return(state.mode==='dream'?state.dream.stations:state.mode==='public'?state.clips:reviewItems()).find(c=>c.id===state.selected);}
function renderList(){
  $('#public-label').textContent=state.collection==='best'?'Best runs':'Public clips';$('#public-count').textContent=publicItems().length;$('#saved-count').textContent=reviewItems().length;$('#live-count').textContent=state.liveSessions.length;
  if(state.mode==='dream'){
    $('#run-list').innerHTML=state.dream.stations.map(s=>`<button class="run-row station-row ${s.id===state.selected?'selected':''}" data-id="${esc(s.id)}"><span class="row-text"><strong>${esc(s.name)}</strong><small>${s.cameras.includes('head')?'Camera available':'Waiting for camera'}</small></span></button>`).join('')||'<p class="empty-note">No public camera is available right now.</p>';
  }else{
    const items=(state.mode==='public'?publicItems():reviewItems()).filter(c=>(`${c.task} ${c.scene} ${c.status||''}`).toLowerCase().includes(state.query));
    $('#run-list').innerHTML=items.map((c,i)=>`<button class="run-row ${c.id===state.selected?'selected':''}" data-id="${esc(c.id)}" title="${esc(c.task)}">${c.posterUrl?`<img src="${esc(c.posterUrl)}" alt="" loading="lazy">`:c.media?`<img src="/media/${c.id}/frames/000.jpg" alt="" loading="lazy">`:`<span class="row-number">${String(i+1).padStart(2,'0')}</span>`}<span class="row-text"><strong>${esc(c.task)}</strong>${state.mode==='public'?'':`<small>${esc(c.report?.verdict||c.reviews?.at(-1)?.verdict||pretty(c.status))}</small>`}</span></button>`).join('')||'<p class="empty-note">No matching runs.</p>';
  }
  $('#run-list').querySelectorAll('[data-id]').forEach(el=>el.onclick=()=>choose(el.dataset.id));
}
function choose(id){
  if(['saved','live'].includes(state.mode))setMode(state.liveSessions.some(s=>s.id===id)?'live':'saved');
  state.selected=id;state.signature='';
  if(id){const u=new URL(location.href);for(const key of ['run','live','station','clip','collection'])u.searchParams.delete(key);if(state.mode==='dream')u.searchParams.set('station',id);if(state.mode==='saved')u.searchParams.set('run',id);if(state.mode==='live')u.searchParams.set('live',id);if(state.mode==='public'){u.searchParams.set('clip',id);if(state.collection!=='best')u.searchParams.set('collection',state.collection);}history.replaceState(null,'',u);}
  renderList();renderSelected();
}
function setVideo(src,poster=''){
  video.dataset.live='false';
  if(video.dataset.source!==src||video.srcObject){video.pause();video.srcObject=null;video.controls=true;video.muted=false;video.dataset.source=src||'';if(src){video.src=src;video.poster=poster||'';}else{video.removeAttribute('src');video.removeAttribute('poster');video.load();}}
  $('#video-empty').hidden=!!src;
}
function seek(seconds){if(!video.getAttribute('src'))return;video.currentTime=seconds;video.play().catch(()=>{});}
function bindEvidence(){document.querySelectorAll('[data-time]').forEach(el=>el.onclick=()=>seek(Number(el.dataset.time)));}
function frameStrip(job){if(!job.media)return'';return`<div class="frames">${job.media.frames.map(f=>`<button class="frame" data-time="${f.seconds}" title="Seek to ${f.seconds.toFixed(2)} seconds"><img src="/media/${job.id}/frames/${f.file}" alt="Evidence frame at ${f.seconds.toFixed(2)} seconds" loading="lazy"><span>${fmt(f.seconds)}</span></button>`).join('')}</div>`;}
function renderSelected(){
  const item=selected();if(!item){if(state.mode==='dream')dream.render({id:'',name:'Dream Labs',online:false,cameras:[],scene:state.dream.error||'No public station is available.',sourceUrl:'https://dreamlabs.ai/playground/'},state.dream,state.liveSessions);else{setVideo(null);$('#scene-label').textContent='My reviews';$('#task-heading').textContent='Your reviews will appear here.';$('#run-status').textContent='No reviews';$('#video-empty').innerHTML='<p>Choose a run and click Evaluate to begin.</p>';$('#video-origin').textContent='';$('#download-links').innerHTML='';$('.evidence-section').hidden=true;$('#inspector').innerHTML='<h2>Start with a run.</h2><p class="muted">Choose a Best run or add your own video.</p>';}return;}
  if(state.mode==='dream'){dream.render(item,state.dream,state.liveSessions);return;}
  const signature=`${state.mode}:${item.id}:${item.updated||''}`;if(state.signature===signature)return;state.signature=signature;
  $('.evidence-section').hidden=false;
  if(state.mode==='live'){live.render(item);return;}
  $('#scene-label').textContent=state.mode==='public'?`${item.collection==='best'?'Best runs':'Public clips'} · Dream Labs`:`${pretty(item.scene)} / SAVED RUN`;
  $('#task-heading').textContent=item.task;$('#run-status').textContent=state.mode==='public'?'Recorded':pretty(item.status);
  if(state.mode==='public')renderPublic(item);else renderJob(item);
}
function renderPublic(clip){
  setVideo(clip.previewUrl,clip.posterUrl);
  $('#video-origin').textContent='Dream Labs · recorded robot run';
  $('#download-links').innerHTML=`<a href="${esc(clip.sourceUrl)}" target="_blank" rel="noreferrer">Original ↗</a>`;
  $('.evidence-section').hidden=true;
  $('#inspector').innerHTML=`<p class="eyebrow">REVIEW</p><h2>See how it goes.</h2><p class="muted">Get observations as this video plays.</p><button id="start-live-replay" class="primary">Evaluate <span aria-hidden="true">↗</span></button><p class="fineprint">AI findings are provisional.</p><details class="review-details"><summary>Options</summary><form id="eval-form"><label for="criteria">Success criteria<textarea id="criteria" rows="4">${esc(`The requested end state is visibly achieved: ${clip.task}`)}</textarea></label><button type="submit" class="live-start">Evaluate the entire video</button><p class="form-error" role="alert"></p></form><p class="fineprint">Full-video evaluation runs in the background. Best runs are selected by Dream Labs and do not measure overall reliability. Publisher scores are withheld from the evaluator.</p></details>`;
  $('#eval-form').onsubmit=async e=>{e.preventDefault();const button=e.target.querySelector('button');button.disabled=true;try{const job=await api('/api/jobs/public',{clipId:clip.id,criteria:$('#criteria').value.split('\n').filter(s=>s.trim())});state.jobs.unshift(job);setMode('saved');choose(job.id);toast('Video saved to the review queue.');}catch(err){e.target.querySelector('.form-error').textContent=err.message;button.disabled=false;}};
  $('#start-live-replay').onclick=async e=>{const button=e.currentTarget;button.disabled=true;button.textContent='Preparing…';try{await live.startReplay(clip.id,$('#criteria').value.split('\n').filter(s=>s.trim()));}catch(err){toast(err.message);button.disabled=false;button.textContent='Evaluate ↗';}};
}
function renderJob(job){
  setVideo(job.media?`/media/${job.id}/video.mp4`:null);
  $('#video-origin').textContent=job.media?`${fmt(job.media.duration)} · saved video`:pretty(job.status);
  $('#download-links').innerHTML=`${job.media?`<a href="/api/jobs/${job.id}/original">Video ↓</a>`:''}<a href="/api/jobs/${job.id}/export">Report ↓</a>`;
  const timeline=`<ul class="timeline">${(job.events||[]).map(e=>`<li><time>${new Date(e.at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</time><span>${esc(e.message)}</span></li>`).join('')}</ul>`;
  if(job.report){
    const r=job.report;
    $('#evidence-body').innerHTML=`<details class="review-details"><summary>Evidence</summary>${frameStrip(job)}${r.criteria.map(c=>`<article class="criterion"><div class="criterion-heading"><strong>${esc(c.criterion)}</strong><span class="status-chip">${esc(c.verdict)}</span></div><p>${esc(c.explanation)}</p><div class="evidence-links">${c.evidence.map(e=>`<button class="evidence-link" data-time="${e.seconds}">${fmt(e.seconds)} · ${esc(e.observation)}</button>`).join('')}</div></article>`).join('')}</details><details class="review-details"><summary>Activity</summary>${timeline}</details>`;
    $('#inspector').innerHTML=`<p class="eyebrow">RESULT</p><div class="verdict ${esc(r.verdict)}">${esc(r.verdict)}</div><p>${esc(r.summary)}</p><p class="fineprint">Provisional AI assessment.</p><details class="review-details"><summary>Add your judgment</summary><form id="review-form"><select id="review-verdict" class="review-select" aria-label="Human verdict"><option value="uncertain">Uncertain</option><option value="pass">Pass</option><option value="fail">Fail</option></select><textarea id="review-note" rows="2" aria-label="Review note" placeholder="What did you observe?"></textarea><button class="live-start" type="submit">Save review</button></form>${job.reviews?.length?`<p class="review-saved">Latest: ${esc(job.reviews.at(-1).verdict)} · ${esc(job.reviews.at(-1).note)}</p>`:''}</details><details class="review-details"><summary>Method & limitations</summary><p class="fineprint">${esc(r.model)}${r.api==='decisions'?' · Decisions API':r.api==='responses'?' · Responses API':''}${r.fallback?' · fallback':''}${Number.isFinite(r.latencyMs)?` · ${(r.latencyMs/1000).toFixed(2)}s evaluation`:''} · ${job.media.frames.length} sampled frames. Publisher score ${job.providerScore==null?'not supplied':esc(job.providerScore)+' / 1'}; withheld from the evaluator.</p><ul class="limitations">${[...r.limitations,'Samples can miss events. Selected clips do not establish overall reliability.'].map(l=>`<li>${esc(l)}</li>`).join('')}</ul>${r.follow_up_tests.map(t=>`<div class="followup">${esc(t.instruction)}<p>${esc(t.reason)}</p></div>`).join('')}</details>`;
    $('#review-form').onsubmit=async e=>{e.preventDefault();try{const next=await api(`/api/jobs/${job.id}/review`,{verdict:$('#review-verdict').value,note:$('#review-note').value});state.jobs=state.jobs.map(j=>j.id===job.id?next:j);renderSelected();toast('Your review is saved.');}catch(err){toast(err.message);}};
  }else{
    const failed=job.status==='failed',waiting=job.status==='needs_key';
    const descriptions={queued:'Waiting to start.',downloading:'Saving the video.',preparing:'Preparing evidence.',evaluating:'Reviewing the video.',needs_key:'Add your API key to start the review.',failed:job.error};
    $('#evidence-body').innerHTML=`<details class="review-details"><summary>Activity</summary>${timeline}</details>`;
    $('#inspector').innerHTML=`<p class="eyebrow">REVIEW</p><h2>${failed?'Needs attention.':waiting?'Video saved.':'Reviewing…'}</h2><p class="${failed?'error-message':'muted'}">${esc(descriptions[job.status]||pretty(job.status))}</p>${!failed&&!waiting?'<div class="progress-track"><span></span></div>':'<button id="retry" class="primary">Retry</button>'}<p class="fineprint">The review continues in the background while this server runs.</p>`;
    const retry=$('#retry');if(retry)retry.onclick=async()=>{try{await api(`/api/jobs/${job.id}/retry`,{});await refresh();}catch(e){toast(e.message);}};
  }
  bindEvidence();
}
$('#dream-live-open').onclick=()=>{setMode('dream');choose(state.dream.stations[0]?.id);};
$('#public-tab').onclick=()=>{setMode('public');choose(publicItems()[0]?.id);};
$('#saved-tab').onclick=()=>{setMode('saved');choose(reviewItems()[0]?.id);};
$('#live-tab').onclick=()=>{setMode('live');if(state.liveSessions[0])choose(state.liveSessions[0].id);};
$('#search').oninput=e=>{state.query=e.target.value.toLowerCase();renderList();};
$('#collection-filter').value=state.collection;
$('#collection-filter').onchange=e=>{state.collection=e.target.value;state.query='';$('#search').value='';choose(publicItems()[0]?.id);};
$('#scene-filter').onchange=e=>{state.scene=e.target.value;renderList();};
document.querySelectorAll('.dialog-close').forEach(el=>el.onclick=()=>el.closest('dialog').close());
$('#import-open').onclick=()=>{$('.add-video-menu').open=false;$('#import-dialog').showModal();};
$('#import-form').onsubmit=async e=>{
  e.preventDefault();const form=e.target,button=form.querySelector('[type=submit]');button.disabled=true;
  try{const data=new FormData(form);const criteria=String(data.get('criteria')).split('\n').filter(s=>s.trim());if(criteria.length)data.set('criteria',JSON.stringify(criteria));else data.delete('criteria');
    const file=data.get('video');let job;if(file?.size){data.delete('videoUrl');job=await api('/api/jobs/upload',data);}else{job=await api('/api/jobs/download',{videoUrl:data.get('videoUrl'),task:data.get('task'),...(criteria.length?{criteria}:{})});}
    state.jobs.unshift(job);$('#import-dialog').close();form.reset();setMode('saved');choose(job.id);toast('Video queued for background evaluation.');
  }catch(err){form.querySelector('.form-error').textContent=err.message;}finally{button.disabled=false;}
};
let recorder=null,recordStream=null,recordTimer=null,recordStarted=0,recordChunks=[],recordInput=null;
$('#record-open').onclick=()=>{$('.add-video-menu').open=false;if(recorder?.state==='recording')return toast('A recording is already running.');if(!navigator.mediaDevices?.getDisplayMedia)return toast('Use Chrome or Edge on localhost to record a browser tab.');$('#record-dialog').showModal();};
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
async function refresh(){if(polling)return;polling=true;try{const [jobs,status,sessions,integration,dreamInfo]=await Promise.all([api('/api/jobs'),api('/api/status'),api('/api/live/sessions'),api('/api/live/status'),api('/api/dream-live/status')]);state.dream=dreamInfo;state.jobs=jobs;state.status=status;state.liveSessions=sessions;live.updateIntegration(integration);$('#api-state').textContent=status.apiConfigured?(integration.relay.connected&&integration.terse.connected?'Ready':'Connecting…'):'Setup needed';renderList();renderSelected();}catch(err){$('#api-state').textContent='Disconnected';}finally{polling=false;}}
try{const data=await api('/api/catalog');state.clips=data.clips;$('#scene-filter').innerHTML='<option value="">All scenes</option>'+[...new Set(state.clips.map(c=>c.scene))].sort().map(s=>`<option value="${esc(s)}">${esc(pretty(s))}</option>`).join('');renderList();if(publicItems().length)choose(publicItems()[0].id);if(data.warning)toast('Showing the last saved public catalog.');}catch(err){$('#run-list').innerHTML=`<p class="empty-note">${esc(err.message)}<br>You can still import a saved video.</p>`;}
await refresh();if(requestedClip&&state.clips.some(c=>c.id===requestedClip)){const clip=state.clips.find(c=>c.id===requestedClip);state.collection=clip.collection||'public';$('#collection-filter').value=state.collection;setMode('public');choose(clip.id);}else if(requestedStation&&state.dream.stations.some(s=>s.id===requestedStation)){setMode('dream');choose(requestedStation);}else if(requestedLive&&state.liveSessions.some(j=>j.id===requestedLive)){setMode('live');choose(requestedLive);}else if(requestedRun&&state.jobs.some(j=>j.id===requestedRun)){setMode('saved');choose(requestedRun);}setInterval(refresh,2000);
