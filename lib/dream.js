import { createWriteStream } from 'node:fs';
import { rename, rm } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const PLAYGROUND = 'https://dreamlabs.ai/playground/';
export function allowedMediaUrl(value) {
  const u = new URL(value);
  const host = u.hostname.toLowerCase();
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443') ||
      !(host === 'dreamlabs.ai' || host.endsWith('.dreamlabs.ai') || host === 'd2j0mgmh1d77qi.cloudfront.net')) {
    throw new Error('Use a Dream Labs public video URL, or upload a downloaded video.');
  }
  return u.href;
}

export async function publicFetch(url, options = {}) {
  let target = allowedMediaUrl(url);
  for (let n = 0; n < 5; n++) {
    const res = await fetch(target, { ...options, redirect: 'manual', signal: options.signal || AbortSignal.timeout(30000) });
    if ([301,302,303,307,308].includes(res.status)) {
      const next = res.headers.get('location'); await res.body?.cancel();
      if (!next) throw new Error('Video redirect has no destination');
      target = allowedMediaUrl(new URL(next, target).href); continue;
    }
    if (!res.ok) { await res.body?.cancel(); throw new Error(`Dream Labs returned HTTP ${res.status}`); }
    return res;
  }
  throw new Error('Too many video redirects');
}

export function normalizeCatalog(manifest) {
  if (!Array.isArray(manifest.clips)) throw new Error('Public clip list is unavailable');
  // Match the website's Best runs gallery: its dedicated list takes priority;
  // older manifests fall back to clips with a rounded publisher score of 100%.
  const best=Array.isArray(manifest.best)&&manifest.best.length?manifest.best:manifest.clips.filter(c=>Math.round(c.score*100)===100);
  const normalize=(rows,collection)=>rows.filter(c => c.src && c.prompt && Number.isInteger(c.idx)).map(c => ({
    id: `dream-${collection}-${c.idx}`, sourceClipId:`dream-${collection}-${c.idx}`, collection,index:c.idx,
    task: String(c.prompt), scene: String(c.scene || (collection==='best'?'Best runs':'Public run')),
    videoUrl: allowedMediaUrl(new URL(c.download || c.hd || c.src, PLAYGROUND).href),
    previewUrl: allowedMediaUrl(new URL(c.src, PLAYGROUND).href),
    posterUrl: c.poster ? allowedMediaUrl(new URL(c.poster, PLAYGROUND).href) : null,
    providerScore: typeof c.score === 'number' ? c.score : null,
    providerSeconds: typeof c.seconds === 'number' ? c.seconds : null,
    sourceUrl: collection==='best'?`${PLAYGROUND}?clip=best${c.idx}`:PLAYGROUND, origin: collection==='best'?'Dream Labs Best runs':'Dream Labs public gallery',
    cohort: 'Selected public clips; not a representative benchmark',
  }));
  const sorted=best.map((clip,i)=>({clip,i})).sort((a,b)=>String(b.clip.added||'').localeCompare(String(a.clip.added||''))||a.i-b.i).map(r=>r.clip);
  return [...normalize(sorted,'best'),...normalize(manifest.clips,'public')];
}

export function replayUrl(clip){return clip.collection==='best'?clip.previewUrl:clip.videoUrl;}
export function replayMatches(job,clip,url){
  const sameClip=job.sourceClipId?job.sourceClipId===clip.id:job.index===clip.index&&(job.collection||'public')===(clip.collection||'public');
  return sameClip&&job.videoUrl===url;
}

export async function fetchCatalog() {
  const res = await publicFetch(`${PLAYGROUND}clips/manifest.json`);
  return normalizeCatalog(await res.json());
}

export async function downloadVideo(url, destination, onProgress = () => {}) {
  const part = destination + '.part';
  const res = await publicFetch(url, { signal: AbortSignal.timeout(240000) });
  const max = 512 * 1024 * 1024, total = Number(res.headers.get('content-length')) || 0;
  if (total > max) { await res.body?.cancel(); throw new Error('Video exceeds the 512 MB limit'); }
  let bytes = 0, last = 0;
  const limit = new Transform({ transform(chunk, _, cb) {
    bytes += chunk.length;
    if (bytes > max) return cb(new Error('Video exceeds the 512 MB limit'));
    if (Date.now() - last > 750) { onProgress(bytes, total); last = Date.now(); }
    cb(null, chunk);
  }});
  try {
    await pipeline(Readable.fromWeb(res.body), limit, createWriteStream(part, { flags: 'w' }));
    await rename(part, destination); onProgress(bytes, total); return bytes;
  } catch (err) { await rm(part, { force: true }); throw err; }
}
