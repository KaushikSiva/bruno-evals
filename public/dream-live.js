const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const time=s=>`${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;

export class DreamLiveUI {
  constructor({api,toast,onInfo,onSession}){Object.assign(this,{api,toast,onInfo,onSession});this.station=null;this.busy=false;this.url=null;this.timer=setInterval(()=>void this.picture(),1000);}
  hide(){this.station=null;$('#dream-camera').hidden=true;$('#video').hidden=false;}
  async picture(){
    const station=this.station;if(!station?.online||!station.cameras.includes('head')||this.busy)return;this.busy=true;
    try{
      const r=await fetch(`/api/dream-live/stations/${encodeURIComponent(station.id)}/frame.jpg?t=${Date.now()}`,{signal:AbortSignal.timeout(8000)});
      if(!r.ok)throw Error('Camera unavailable; waiting for Dream Labs.');const blob=await r.blob();
      if(this.station?.id!==station.id)return;
      if(this.url)URL.revokeObjectURL(this.url);this.url=URL.createObjectURL(blob);$('#dream-camera').src=this.url;$('#dream-camera').hidden=false;$('#video-empty').hidden=true;
      $('#video-origin').textContent=`Dream Labs · ${station.name} · live snapshots · updated ${new Date().toLocaleTimeString()}`;
    }catch(e){if(this.station?.id===station.id){$('#dream-camera').hidden=true;$('#video-empty').hidden=false;$('#video-empty').innerHTML=`<span class="empty-mark">b.</span><p>${esc(e.message)}</p>`;}}
    finally{this.busy=false;}
  }
  render(station,info,sessions){
    const detailsOpen=!!document.querySelector('#dream-details[open]');
    $('.evidence-section').hidden=false;
    const w=info.watch,watching=!!w?.enabled&&w.stationId===station.id;
    const cameraReady=!info.error&&station.online&&station.cameras.includes('head');
    if(this.station?.id!==station.id&&this.url){URL.revokeObjectURL(this.url);this.url=null;$('#dream-camera').hidden=true;}
    this.station=cameraReady?station:null;
    const video=$('#video');video.pause();video.hidden=true;
    $('#scene-label').textContent='Dream Labs · live camera';$('#task-heading').textContent=station.name;
    $('#run-status').textContent=info.error?'SOURCE UNAVAILABLE':cameraReady?'LIVE CAMERA':'WAITING FOR CAMERA';
    if(!cameraReady){$('#dream-camera').hidden=true;$('#video-empty').hidden=false;$('#video-empty').innerHTML=`<span class="empty-mark">b.</span><p>${esc(info.error?'Dream Labs status is temporarily unavailable.':station.reason||station.scene||'Waiting for Dream Labs to bring this camera online.')}</p>`;}
    else if(!this.url){$('#video-empty').hidden=false;$('#video-empty').innerHTML='<p>Connecting to the public camera…</p>';void this.picture();}
    $('#video-origin').textContent=`Dream Labs · ${station.name} · ${cameraReady?'Live snapshots, about 1 per second':'No live camera available'}`;
    $('#download-links').innerHTML=`<a href="${esc(station.sourceUrl)}" target="_blank" rel="noreferrer">Open Dream Labs ↗</a>`;
    const session=sessions.find(s=>s.id===(w?.sessionId||w?.lastSessionId)&&s.stationId===station.id);
    const observed=session?.observations.at(-1),review=session?.reviews.at(-1);
    $('#evidence-heading').textContent='Live run evaluation';$('#frame-label').textContent=session?`${session.frames.length} evidence frames saved`:'Waiting for a public task';
    $('#evidence-body').innerHTML=session?`<p class="dream-task">${esc(session.task)}</p><div class="agent-lanes"><div><p class="eyebrow">OBSERVER · ${observed?time(observed.observedThrough):'COLLECTING'}</p><p>${esc(observed?.observation.summary||'Waiting for enough camera evidence…')}</p></div><div><p class="eyebrow">REVIEWER · ${review?time(review.observedThrough):'WAITING'}</p><p>${esc(review?.summary||'The reviewer receives observations through Agent Relay.')}</p></div></div><button id="dream-open-evaluation" class="live-start">Open evidence & agent messages ↗</button>`:'<p class="fineprint">Reviews appear here when a public task starts.</p>';
    $('#inspector').innerHTML=`<p class="eyebrow">LIVE CAMERA</p><h2>${watching?'Watching.':cameraReady?'Ready to watch.':'Waiting for camera.'}</h2><p class="muted">${esc(station.currentRun?.task||station.scene||'No task is running.')}</p><button id="dream-watch" class="primary">${watching?'Stop watching':'Watch & evaluate'}</button><p class="fineprint">${watching?`Watching until ${new Date(w.expiresAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}.`:'Watches for up to 10 minutes.'} Evaluation begins when a task and camera are available.</p>${w?.error?`<p class="error-message">${esc(w.error)}</p>`:''}<details id="dream-details" class="review-details"><summary>Details</summary><p class="fineprint">Public camera snapshots, about one per second. The watch continues while the local server runs. Each run keeps its original task and a separate review.</p><p class="fineprint">Terse saves session state; Agent Relay carries review messages. Start robot tasks on Dream Labs. Captures may begin mid-run; verdicts describe visible evidence only.</p></details>`;
    $('#dream-details').open=detailsOpen;
    const button=$('#dream-watch');button.disabled=!station.id;button.onclick=async()=>{button.disabled=true;try{this.onInfo(await this.api(watching?'/api/dream-live/stop':'/api/dream-live/watch',watching?{}:{stationId:station.id}));}catch(err){this.toast(err.message);button.disabled=false;}};
    const open=$('#dream-open-evaluation');if(open)open.onclick=()=>this.onSession(session);
  }
}
