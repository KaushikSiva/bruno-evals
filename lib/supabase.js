import {createClient} from '@supabase/supabase-js';
import {Upload} from 'tus-js-client';
import {createReadStream} from 'node:fs';
import {readFile} from 'node:fs/promises';

export const ARCHIVE_BUCKET = 'bruno-evidence';

export function supabaseConfig(env = process.env) {
  const url = env.SUPABASE_URL?.trim(), key = (env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY)?.trim();
  if (!url && !key) return null;
  if (!url || !key) throw Error('Set SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local.');
  let parsed;
  try { parsed = new URL(url); } catch { throw Error('Invalid SUPABASE_URL.'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash || !['', '/'].includes(parsed.pathname)) {
    throw Error('SUPABASE_URL must be an HTTPS project origin.');
  }
  let role;
  try { role = JSON.parse(Buffer.from(key.split('.')[1], 'base64url')).role; } catch {}
  if (!key.startsWith('sb_secret_') && role !== 'service_role') {
    throw Error('Supabase needs a server secret key or legacy service_role key, not a publishable key.');
  }
  return {url:parsed.origin, key};
}

// Do not expose provider response bodies: they can contain credentials or URLs.
function check(result, operation) {
  if (result.error) {
    const code = String(result.error.statusCode || result.error.status || result.error.code || 'request').replace(/[^A-Za-z0-9_-]/g, '').slice(0,30);
    throw Error(`Supabase ${operation} failed (${code}). Check credentials, migration, and Storage limits.`);
  }
  return result.data;
}

export function createSupabaseRemote(config) {
  if (!config) return null;
  const {url, key} = config;
  const client = createClient(url, key, {
    auth:{persistSession:false, autoRefreshToken:false, detectSessionInUrl:false},
    global:{fetch:(input, init = {})=>fetch(input, {...init,
      signal:AbortSignal.any([AbortSignal.timeout(60000), ...(init.signal ? [init.signal] : [])])})},
  });
  return {
    scope:`${url}/${ARCHIVE_BUCKET}`,
    async ready() {
      check(await client.from('bruno_runs').select('id').limit(1), 'database check');
      const bucket = check(await client.storage.getBucket(ARCHIVE_BUCKET), 'bucket check');
      if (bucket.public) throw Error('The bruno-evidence bucket must be private.');
    },
    async upload(asset, file) {
      if (asset.bytes <= 6 * 1024 * 1024) {
        check(await client.storage.from(ARCHIVE_BUCKET).upload(asset.path, await readFile(file),
          {contentType:asset.contentType, upsert:true, cacheControl:'3600'}), 'upload');
        return;
      }
      // TUS chunks large video uploads rather than buffering a whole video in RAM.
      const endpoint = new URL(url);
      if (/^[a-z0-9-]+\.supabase\.co$/.test(endpoint.hostname)) endpoint.hostname = endpoint.hostname.replace('.supabase.co', '.storage.supabase.co');
      endpoint.pathname = '/storage/v1/upload/resumable';
      const stream = createReadStream(file);
      try {
        await new Promise((resolve, reject)=>{
          const upload = new Upload(stream, {
            endpoint:endpoint.href, uploadSize:asset.bytes, chunkSize:6 * 1024 * 1024,
            headers:{apikey:key, ...(key.startsWith('sb_secret_') ? {} : {authorization:`Bearer ${key}`}), 'x-upsert':'true'},
            metadata:{bucketName:ARCHIVE_BUCKET, objectName:asset.path, contentType:asset.contentType, cacheControl:'3600'},
            retryDelays:[0, 1000, 3000],
            storeFingerprintForResuming:false, uploadDataDuringCreation:true,
            onError:()=>reject(Error('Supabase video upload failed. The archive will retry.')),
            onSuccess:resolve,
          });
          // Bound the operation even when a network connection stops making progress.
          const timer = setTimeout(()=>{void upload.abort(); reject(Error('Supabase video upload timed out. The archive will retry.'));}, 300000);
          const finish = upload.options.onSuccess, fail = upload.options.onError;
          upload.options.onSuccess = ()=>{clearTimeout(timer); finish();};
          upload.options.onError = error=>{clearTimeout(timer); fail(error);};
          upload.start();
        });
      } finally { stream.destroy(); }
    },
    async save(row) { check(await client.rpc('bruno_archive_run', {payload:row}), 'save'); },
    async list(offset = 0, limit = 50) {
      return check(await client.from('bruno_runs').select('kind,id,task,status,verdict,created_at,source_updated_at,archived_at')
        .order('created_at', {ascending:false}).order('id').range(offset, offset + limit - 1), 'list');
    },
    async get(kind, id) {
      const row = check(await client.from('bruno_runs').select('*').eq('kind',kind).eq('id',id).maybeSingle(), 'read');
      if (!row) return null;
      // Sign only paths stored in this row, never an arbitrary browser-supplied path.
      if (row.assets.length) {
        const signed = check(await client.storage.from(ARCHIVE_BUCKET).createSignedUrls(row.assets.map(a=>a.path), 300), 'signed URLs');
        row.assets = row.assets.map((asset, i)=>({...asset, url:signed[i]?.signedUrl || null}));
      }
      return {...row, urlExpiresIn:300};
    },
  };
}
