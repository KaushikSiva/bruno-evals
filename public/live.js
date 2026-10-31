const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=s=>`${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;

export class LiveUI {
  constructor({api,toast,onSession,isSelected}){Object.assign(this,{api,toast,onSession,isSelected});this.sockets=new Map();this.active=null;this.integration=null;}
  updateIntegration(info){this.integration=info;const el=$('#integration-state');if(!el)return;el.innerHTML=`<span class="${info.terse.connected?'ready':''}">Terse ${info.terse.connected?'connected':'connecting'}</span><span class="${info.relay.connected?'ready':''}">Relay ${info.relay.connected?'connected':'connecting'}</span>`;el.title=info.terse.error||info.relay.error||'Live sessions are persisted by Terse; agents coordinate through Agent Relay.';}
  async subscribe(session){
    if(this.sockets.has(session.id))return;
    // Reserve the subscription while obtaining the grant; render and begin can
    // both request it before the first HTTP response arrives.
    this.sockets.set(session.id,null);
    let grant;try{grant=await this.api(`/api/live/sessions/${session.id}/socket`,{});}catch(e){this.sockets.delete(session.id);throw e;}
    const ws=new WebSocket(grant.websocketUrl);this.sockets.set(session.id,ws);
    ws.onmessage=e=>{try{const m=JSON.parse(e.data);const json=m.state?.stateJson||m.changes?.stateJson||m.stateJson;if(json)this.onSession(JSON.parse(json),false);}catch{}};
    ws.onclose=()=>{this.sockets.delete(session.id);if(this.active?.id===session.id)setTimeout(()=>this.subscribe(session).catch(()=>{}),1500);};
  }
  async startReplay(clipId,criteria){
    if(this.active)throw Error('Stop the current live capture first');
    const session=await this.api('/api/live/sessions',{clipId,criteria});
    await this.begin(session,null);return session;
  }
  async startCapture(stream,task,criteria){
    if(this.active)throw Error('Stop the current live capture first');
    const session=await this.api('/api/live/sessions',{task,criteria});
    await this.begin(session,stream);return session;
  }
  async begin(session,stream){
    const source=document.createElement('video');source.muted=true;source.playsInline=true;source.style.cssText='position:fixed;width:2px;height:2px;left:-100px;top:0';document.body.append(source);
    if(stream)source.srcObject=stream;else source.src=session.videoUrl;
    const active={id:session.id,source,stream,seq:0,busy:false,started:performance.now(),lastSeconds:-1};this.active=active;
    try{
      await source.play();
      active.preview=stream||source.captureStream();
      this.onSession(session,true);await this.subscribe(session);
      const visible=$('#video');visible.srcObject=active.preview;visible.muted=true;visible.controls=false;await visible.play().catch(()=>{});
      source.onended=()=>void this.stop('video_ended').catch(e=>this.toast(e.message));
      await this.captureFrame();
      active.timer=setInterval(()=>{
        if(!stream&&(source.ended||(Number.isFinite(source.duration)&&source.currentTime>=source.duration-.04)))void this.stop('video_ended').catch(e=>this.toast(e.message));
        else void this.captureFrame();
      },1000);
      active.limit=setTimeout(()=>void this.stop('user_stopped'),600000);
    }catch(e){await this.stop('user_stopped');throw e;}
  }
  async captureFrame(force=false){
    const a=this.active;if(!a||a.busy||(!a.source.videoWidth)||(!force&&a.stopping))return;
    const seconds=a.pendingFrame?.seconds??(a.stream?(performance.now()-a.started)/1000:a.source.currentTime);
    if(!force&&Math.abs(seconds-a.lastSeconds)<.1)return;
    a.busy=true;
    try{
      if(!a.pendingFrame){
        const canvas=document.createElement('canvas');const ratio=Math.min(960/a.source.videoWidth,540/a.source.videoHeight,1);
        canvas.width=Math.round(a.source.videoWidth*ratio);canvas.height=Math.round(a.source.videoHeight*ratio);canvas.getContext('2d').drawImage(a.source,0,0,canvas.width,canvas.height);
        const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.82));if(!blob)throw Error('Could not capture a video frame');
        a.pendingFrame={blob,seconds};
      }
      // A lost response retries the exact same bytes and sequence number.
      const res=await fetch(`/api/live/sessions/${a.id}/frames?seq=${a.seq}&seconds=${seconds.toFixed(3)}`,{method:'POST',headers:{'Content-Type':'image/jpeg'},body:a.pendingFrame.blob,signal:AbortSignal.timeout(10000)});
      if(!res.ok)throw Error((await res.json()).error);a.seq++;a.lastSeconds=seconds;a.pendingFrame=null;
    }catch(e){this.toast(`Live frame: ${e.message}`);}finally{a.busy=false;}
  }
  async stop(reason='user_stopped'){
    const a=this.active;if(!a||a.stopping)return;a.stopping=true;clearInterval(a.timer);clearTimeout(a.limit);
    // Let a submitted frame finish, then append a final frame before sealing the actor.
    while(a.busy)await new Promise(r=>setTimeout(r,40));
    await this.captureFrame(true);a.source.pause();a.source.remove();this.active=null;
    const s=await this.api(`/api/live/sessions/${a.id}/finish`,{reason});
    this.onSession(s,false);return s;
  }
  render(session){
    void this.subscribe(session).catch(()=>{});
    $('#scene-label').textContent=`${session.sourceKind==='public_replay'?'PUBLIC REPLAY':'BROWSER CAPTURE'} / LIVE REVIEW`;
    $('#task-heading').textContent=session.task;$('#run-status').textContent=session.status==='live'?'LIVE':session.status.toUpperCase();
    const video=$('#video'),active=this.active?.id===session.id;
    video.removeAttribute('poster');video.dataset.live=String(!!active);
    if(active){if(video.srcObject!==this.active.preview){video.srcObject=this.active.preview;video.play().catch(()=>{});}video.controls=false;$('#video-empty').hidden=true;}
    else if(session.videoUrl){if(video.dataset.source!==session.videoUrl||video.srcObject){video.srcObject=null;video.src=session.videoUrl;video.dataset.source=session.videoUrl;}video.controls=true;video.muted=false;$('#video-empty').hidden=true;}
    else{video.srcObject=null;video.removeAttribute('src');video.load();$('#video-empty').hidden=false;$('#video-empty').innerHTML='<p>Browser capture finished. Its recording is being saved in the Saved tab.</p>';}
    const last=session.frames.at(-1),review=session.reviews.at(-1),observation=session.observations.at(-1)?.observation;
    $('#video-origin').textContent=`${session.frames.length} frames received${last?` · through ${fmt(last.seconds)}`:''} · ${session.sourceKind==='public_replay'?'Public video replay, not a live robot':'User-selected browser capture'}`;
    $('#download-links').innerHTML=`${session.recordingJobId?`<a href="/?run=${session.recordingJobId}">Saved recording ↗</a>`:''}<a href="/api/live/sessions/${session.id}/export">Live report JSON ↓</a>`;
    $('#evidence-heading').textContent='Live evidence & agent handoff';$('#frame-label').textContent=this.sockets.get(session.id)?.readyState===WebSocket.OPEN?'State delivered by Terse WebSocket':'Connecting live updates · HTTP recovery active';
    const busy=session.lease?'Observer / reviewer working':session.status==='live'?'Watching for new frames':session.status==='finishing'?'Finishing final review':'Review complete';
    $('#evidence-body').innerHTML=`<div class="live-summary"><span class="live-dot ${session.status==='live'?'pulsing':''}"></span><strong>${esc(busy)}</strong><span>${review?`Last review covered ${fmt(review.observedThrough)} · ${(review.totalLatencyMs/1000).toFixed(1)}s processing`:session.frames.length?'First review begins after four frames':'Waiting for video frames'}</span></div>${session.lastError?`<p class="error-message">${esc(session.lastError)}</p>`:''}
      <div class="agent-lanes"><div><p class="eyebrow">OBSERVER · ${observation?`DRAFT THROUGH ${fmt(session.observations.at(-1).observedThrough)}`:'COLLECTING'}</p><p>${esc(observation?.summary||'Collecting visual evidence…')}</p></div><div><p class="eyebrow">REVIEWER · ${review?`REVIEWED THROUGH ${fmt(review.observedThrough)}`:'WAITING'}</p><p>${esc(review?.summary||'Waiting for the observer’s message via Agent Relay…')}</p></div></div>
      <div class="frames">${session.frames.slice(-12).map(f=>`<button class="frame" data-live-time="${f.seconds}"><img src="/live-media/${session.id}/frames/${f.file}" alt="Frame at ${f.seconds.toFixed(1)} seconds"><span>${fmt(f.seconds)}</span></button>`).join('')}</div>
      <div class="section-heading"><h2>Agent Relay messages</h2><span class="muted">Durable delivery receipts</span></div><ul class="timeline relay-timeline">${session.messages.map(m=>`<li><time>${new Date(m.at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'})}</time><div><b>${esc(m.from.replace('bruno-',''))} → ${esc(m.to.replace('bruno-',''))}</b><p>${esc(m.text)}</p><small>Message ${esc(m.id)}${m.deliveryId?' · received':''}</small></div></li>`).join('')||'<li><span>Messages appear when the first observation is ready.</span></li>'}</ul>
      <div class="section-heading"><h2>Reviewed observations</h2></div>${[...session.reviews].reverse().map(r=>`<article class="criterion"><div class="criterion-heading"><strong>Through ${fmt(r.observedThrough)}</strong><span class="status-chip">${esc(r.verdict.replaceAll('_',' '))}</span></div><p>${esc(r.summary)}</p><div class="evidence-links">${r.evidence.map(e=>`<button class="evidence-link" data-live-time="${e.seconds}">${fmt(e.seconds)} · ${esc(e.observation)}</button>`).join('')}</div></article>`).join('')}`;
    $('#inspector').innerHTML=`<p class="eyebrow">REAL-TIME VISUAL REVIEW</p><div class="verdict ${review?.verdict||''}">${esc((review?.verdict||'Watching').replaceAll('_',' '))}</div><p class="fineprint">Provisional judgments update as evidence arrives. Live review samples frames; it does not control the robot.</p>${active?'<button id="stop-live" class="primary">Stop live review</button>':''}<div class="divider"></div><div class="facts"><span>Session state</span><strong>Terse Durable Actor</strong><span>Agent communication</span><strong>Agent Relay</strong><span>Capture cadence</span><strong>About 1 frame / second</strong><span>Analysis</span><strong>Rolling frame windows</strong><span>Evidence reviewed</span><strong>${review?fmt(review.observedThrough):'Waiting'}</strong><span>Publisher score</span><strong>Withheld</strong></div><div class="divider"></div><p class="eyebrow">SUCCESS CRITERIA</p>${session.criteria.map(c=>`<p>${esc(c)}</p>`).join('')}<div class="divider"></div><p class="eyebrow">REVIEWER NOTES</p><ul class="limitations">${(review?.concerns||['Samples may miss brief events.','Occluded outcomes remain uncertain.']).map(c=>`<li>${esc(c)}</li>`).join('')}</ul><p class="fineprint">Closing the page stops capture. Received frames and agent findings remain in the durable session.</p>`;
    const stop=$('#stop-live');if(stop)stop.onclick=()=>{if(this.active?.stream&&$('#stop-record')&&!$('#recording-banner').hidden)$('#stop-record').click();else void this.stop('user_stopped').catch(e=>this.toast(e.message));};
    document.querySelectorAll('[data-live-time]').forEach(el=>el.onclick=()=>{if(active)return this.toast('Stop live review to seek through saved evidence.');if(session.videoUrl){const end=Number.isFinite(video.duration)?Math.max(0,video.duration-.05):Infinity;video.currentTime=Math.min(Number(el.dataset.liveTime),end);video.play().catch(()=>{});}});
  }
}
