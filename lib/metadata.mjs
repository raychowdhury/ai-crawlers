import {Worker} from 'node:worker_threads';
const unknown=error=>({metaRobots:[],jsonLd:null,title:null,complete:false,error});

// Parsing untrusted HTML never runs on the HTTP event loop. Both time and memory
// are bounded; callers must distinguish an incomplete parse from absent metadata.
export async function extractMeta(html,{timeoutMs=1000}={}) {
  if(typeof html!=='string'||Buffer.byteLength(html)>1_500_000)return unknown('HTML exceeds the metadata parsing size limit');
  return new Promise(resolve=>{
    let worker,timer,settled=false;
    const finish=result=>{if(settled)return;settled=true;clearTimeout(timer);if(worker)void worker.terminate();resolve(result);};
    try{
      worker=new Worker(new URL('./metadata-worker.mjs',import.meta.url),{workerData:html,execArgv:[],resourceLimits:{maxOldGenerationSizeMb:48,maxYoungGenerationSizeMb:8,stackSizeMb:2}});
      timer=setTimeout(()=>finish(unknown('HTML metadata parsing exceeded the time limit')),timeoutMs);
      worker.once('message',finish);
      worker.once('error',()=>finish(unknown('HTML metadata parsing exceeded its resource budget or failed')));
      worker.once('exit',()=>finish(unknown('HTML metadata parsing ended before completion')));
    }catch{finish(unknown('HTML metadata parser could not start'));}
  });
}
