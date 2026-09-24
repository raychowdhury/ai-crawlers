import {parentPort,workerData} from 'node:worker_threads';
import {parse} from 'parse5';

const document=parse(workerData),stack=[document],metaRobots=[];
let nodes=0,jsonLd=0,title=null;
while(stack.length){
  const node=stack.pop();
  if(++nodes>20000)throw new Error('Node budget exceeded');
  const attribute=name=>node.attrs?.find(a=>a.name===name)?.value;
  if(node.tagName==='meta'){
    const name=attribute('name')?.toLowerCase(),content=attribute('content');
    if(name&&content&&(name==='robots'||name.includes('bot'))){
      if(metaRobots.length>=100||content.length>4096||name.length>128)throw new Error('Metadata budget exceeded');
      metaRobots.push({name,content});
    }
  }
  if(node.tagName==='script'&&attribute('type')?.toLowerCase()==='application/ld+json')jsonLd++;
  if(node.tagName==='title'&&title===null)title=(node.childNodes||[]).map(c=>c.value||'').join('').replace(/\s+/g,' ').trim().slice(0,512)||null;
  for(let i=(node.childNodes?.length||0)-1;i>=0;i--)stack.push(node.childNodes[i]);
}
parentPort.postMessage({metaRobots,jsonLd,title,complete:true,error:null});
