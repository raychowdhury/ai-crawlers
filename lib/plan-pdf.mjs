import {Worker} from 'node:worker_threads';
import {planReport} from '../public/plan-report.js';

export function createPlanPdf(state,platform='developer'){
 const html=planReport(state,platform);
 if(Buffer.byteLength(html)>128000)throw new Error('Plan too large to export.');
 return new Promise((resolve,reject)=>{
  const worker=new Worker(new URL('./plan-pdf-worker.mjs',import.meta.url),{workerData:html,execArgv:[],resourceLimits:{maxOldGenerationSizeMb:96,maxYoungGenerationSizeMb:16}});
  let settled=false;
  const finish=(error,result)=>{
   if(settled)return;settled=true;clearTimeout(timer);
   void worker.terminate().finally(()=>error?reject(error):resolve(Buffer.from(result)));
  };
  const timer=setTimeout(()=>finish(new Error('PDF export exceeded its time limit.')),5000);
  worker.once('message',result=>finish(null,result));
  worker.once('error',()=>finish(new Error('PDF export failed.')));
  worker.once('exit',()=>finish(new Error('PDF export ended before completion.')));
 });
}
