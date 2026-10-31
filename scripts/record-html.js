import { chromium } from 'playwright';
import { parseArgs } from 'node:util';
import { mkdir, readFile, rename, rm } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const {values}=parseArgs({options:{url:{type:'string'},file:{type:'string'},seconds:{type:'string',default:'15'},task:{type:'string'},out:{type:'string',default:'artifacts/html-recording.webm'},server:{type:'string',default:'http://127.0.0.1:5190'},headful:{type:'boolean',default:false},'save-only':{type:'boolean',default:false}}});
if((!values.url&&!values.file)||(values.url&&values.file)||!values.task)throw Error('Use --url URL OR --file page.html, plus --task "original task". Optional: --seconds 30 --headful --save-only');
const seconds=Number(values.seconds);if(!Number.isFinite(seconds)||seconds<1||seconds>600)throw Error('Record between 1 and 600 seconds');
const output=path.resolve(values.out),dir=path.join(path.dirname(output),`.capture-${Date.now()}`);await mkdir(dir,{recursive:true});
const browser=await chromium.launch({headless:!values.headful});
try{
  const context=await browser.newContext({viewport:{width:1440,height:900},recordVideo:{dir,size:{width:1440,height:900}}});
  const page=await context.newPage();
  await page.goto(values.file?pathToFileURL(path.resolve(values.file)).href:values.url,{waitUntil:'domcontentloaded',timeout:60000});
  console.log(`Recording rendered HTML for ${seconds} seconds…`);
  await page.waitForTimeout(seconds*1000);
  const recording=page.video();await context.close();await recording.saveAs(output);await rm(dir,{recursive:true,force:true});
  console.log(`Saved ${output}`);
  if(!values['save-only']){
    const form=new FormData();form.append('video',new Blob([await readFile(output)],{type:'video/webm'}),path.basename(output));form.append('task',values.task);form.append('captureKind','browser_recording');form.append('sourceUrl',values.url||'Local HTML');
    const res=await fetch(`${values.server}/api/jobs/upload`,{method:'POST',body:form});const data=await res.json();if(!res.ok)throw Error(data.error);console.log(`Background evaluation queued: ${data.id}`);
  }
}finally{await browser.close();}
