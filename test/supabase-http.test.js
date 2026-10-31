import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createSupabaseRemote} from '../lib/supabase.js';

test('Supabase transport uploads small files and chunked videos before saving a review',async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'reality-check-http-'));
  const calls=[];let uploadedBytes=0;let origin;
  const server=createServer(async(req,res)=>{
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    const body=Buffer.concat(chunks);calls.push({method:req.method,url:req.url,bytes:body.length});
    assert.equal(req.headers.apikey,'sb_secret_test');
    if(req.url==='/storage/v1/upload/resumable'&&req.method==='POST'){
      uploadedBytes+=body.length;
      res.writeHead(201,{'Location':`${origin}/storage/v1/upload/resumable/test-upload`,'Tus-Resumable':'1.0.0','Upload-Offset':String(uploadedBytes)}).end();return;
    }
    if(req.url==='/storage/v1/upload/resumable/test-upload'&&req.method==='PATCH'){
      assert.equal(Number(req.headers['upload-offset']),uploadedBytes);uploadedBytes+=body.length;
      res.writeHead(204,{'Tus-Resumable':'1.0.0','Upload-Offset':String(uploadedBytes)}).end();return;
    }
    res.setHeader('Content-Type','application/json');
    if(req.url.startsWith('/rest/v1/bruno_runs?'))res.end('[]');
    else if(req.url==='/storage/v1/bucket/bruno-evidence')res.end(JSON.stringify({id:'bruno-evidence',public:false}));
    else if(req.url.startsWith('/storage/v1/object/'))res.end(JSON.stringify({Key:'small.jpg'}));
    else if(req.url==='/rest/v1/rpc/bruno_archive_run'){
      assert.equal(JSON.parse(body).payload.task,'Fold the dress');res.end('null');
    }else{res.statusCode=404;res.end('{}');}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  origin=`http://127.0.0.1:${server.address().port}`;
  t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});});
  // Direct config permits a local HTTP fixture; production env validation requires HTTPS.
  const remote=createSupabaseRemote({url:origin,key:'sb_secret_test'});
  await remote.ready();
  const small=path.join(dir,'small.jpg');await writeFile(small,Buffer.alloc(1024));
  await remote.upload({path:'small.jpg',bytes:1024,contentType:'image/jpeg'},small);
  const size=6*1024*1024+1024;
  const large=path.join(dir,'large.mp4');await writeFile(large,Buffer.alloc(size));
  await remote.upload({path:'large.mp4',bytes:size,contentType:'video/mp4'},large);
  await remote.save({task:'Fold the dress'});
  assert.equal(uploadedBytes,size);
  assert.ok(calls.some(c=>c.method==='PATCH'));
  assert.equal(calls.at(-1).url,'/rest/v1/rpc/bruno_archive_run');
  assert.ok(calls.filter(c=>c.url.includes('/upload/resumable')).every(c=>c.bytes<=6*1024*1024));
});
