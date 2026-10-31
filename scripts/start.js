import {spawn} from 'node:child_process';
import {openSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {actors} from '../integrations/generated/index.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const env={...process.env,PATH:`${path.join(root,'node_modules','.bin')}:${process.env.PATH}`};
mkdirSync(path.join(root,'artifacts'),{recursive:true});
let runtime=null,app=null,closing=false;
function stop(){if(closing)return;closing=true;app?.kill('SIGTERM');runtime?.kill('SIGTERM');setTimeout(()=>process.exit(0),800).unref();}
process.on('SIGTERM',stop);process.on('SIGINT',stop);
let running=false;
try{await actors.SessionDirectory.get('bruno-live-sessions').list();running=true;}catch{}
if(!running){
  const log=openSync(path.join(root,'artifacts','terse.log'),'a');
  runtime=spawn(path.join(root,'node_modules','.bin','bun'),[path.join(root,'node_modules','durable-actors','bin','durable-actors.js'),'dev','--port','7100','--no-watch'],{cwd:path.join(root,'integrations','terse'),env,stdio:['ignore',log,log]});
  runtime.on('exit',code=>{if(!closing){console.error(`Terse stopped (${code}); see artifacts/terse.log`);stop();}});
  const deadline=Date.now()+120000;
  while(Date.now()<deadline&&!closing){try{await actors.SessionDirectory.get('bruno-live-sessions').list();running=true;break;}catch{await new Promise(r=>setTimeout(r,700));}}
  if(!running){console.error('Terse did not become ready. Check artifacts/terse.log.');stop();process.exitCode=1;}
}
if(running&&!closing){
  console.log('Terse Durable Actors ready on localhost:7100.');
  app=spawn(process.execPath,['--env-file-if-exists=.env.local','server.js'],{cwd:root,env,stdio:'inherit'});
  app.on('exit',code=>{if(!closing){process.exitCode=code||0;stop();}});
}
