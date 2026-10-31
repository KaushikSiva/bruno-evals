import {AgentRelay} from '@agent-relay/sdk';
import {mkdir,readFile,writeFile,chmod} from 'node:fs/promises';
import path from 'node:path';

async function bounded(promise,label){
  let timer;
  try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(`Agent Relay ${label} timed out; saved work will retry`)),30000);})]);}
  finally{clearTimeout(timer);}
}

export async function connectRelay(dataDir,handlers){
  const dir=path.join(dataDir,'integrations'),file=path.join(dir,'relay.json');await mkdir(dir,{recursive:true});
  let config;try{config=JSON.parse(await readFile(file,'utf8'));}catch{}
  const relay=config?new AgentRelay({workspaceKey:config.workspaceKey}):await AgentRelay.createWorkspace({name:'Bruno robot video evaluations'});
  config??={workspaceKey:relay.workspaceKey,agents:{}};
  const save=async()=>{await writeFile(file,JSON.stringify(config),{mode:0o600});await chmod(file,0o600);};await save();
  const clients={};
  for(const role of ['observer','reviewer']){
    const name=`bruno-${role}`;
    clients[role]=await bounded(config.agents[name]?relay.workspace.reconnect({apiToken:config.agents[name].token}):relay.workspace.register({name,type:'agent'}),'connect');
    config.agents[name]={token:clients[role].token,id:clients[role].id,name};await save();
  }
  const controller=new AbortController(),active=new Set();
  const status={connected:true,transport:'Agent Relay durable inbox + WebSocket',agents:Object.values(clients).map(c=>({id:c.id,name:c.name})),lastMessageAt:null,error:null};
  const ack=(role,id)=>bounded(clients[role].inbox.ack({inboxItemId:id}),'acknowledgment');
  async function handle(role,item){
    if(active.has(item.id))return;active.add(item.id);
    try{
      const sender=role==='observer'?'reviewer':'observer';
      if(item.message.from.id!==clients[sender].id){await ack(role,item.id);return;}
      let payload;try{payload=JSON.parse(item.message.text);}catch{await ack(role,item.id);return;}
      if(!['review_requested','review_completed'].includes(payload.kind)){await ack(role,item.id);return;}
      await handlers[role](payload,{id:item.message.id,deliveryId:item.id,from:clients[sender].name,to:clients[role].name,at:item.message.createdAt||new Date().toISOString(),text:payload.text||payload.kind});
      await ack(role,item.id);status.lastMessageAt=new Date().toISOString();status.error=null;
    }catch(e){status.error=e.status?`Relay handler HTTP ${e.status}`:e.message;handlers.error?.(e);}
    finally{active.delete(item.id);}
  }
  // Live WebSocket delivery, plus durable inbox polling for missed/reconnected events.
  for(const role of ['observer','reviewer'])void(async()=>{
    try{for await(const item of clients[role].inbox.subscribe({agentName:clients[role].name,signal:controller.signal}))void handle(role,item);}
    catch(e){status.error=e.message;handlers.error?.(e);}
  })();
  let polling=false;
  const poll=setInterval(async()=>{
    if(polling)return;polling=true;
    try{await Promise.all(['observer','reviewer'].map(async role=>{const inbox=await bounded(clients[role].inbox.list({limit:30,agentName:clients[role].name}),'inbox');for(const item of inbox.items)void handle(role,item);}));}
    catch(e){status.error=e.message;}finally{polling=false;}
  },3000);
  return {status,
    async send(role,payload,key){
      const other=role==='observer'?'reviewer':'observer';
      const result=await bounded(clients[role].sendMessage({to:`@${clients[other].name}`,text:JSON.stringify(payload),idempotencyKey:key}),'message');
      status.lastMessageAt=new Date().toISOString();
      return {id:result.messageId,from:clients[role].name,to:clients[other].name,at:result.createdAt||new Date().toISOString(),text:payload.text||payload.kind};
    },
    async close(){clearInterval(poll);controller.abort();status.connected=false;await relay.events.disconnect();}
  };
}
