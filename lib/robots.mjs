const MAX_TEXT=500_000, MAX_LINES=5000, MAX_RULES=1000, MAX_PATTERN=1024, MAX_PATH=4096, MAX_WORK=500_000;
const unknown=reason=>({allowed:null,reason});

export function parseRobots(text){
  if(text.length>MAX_TEXT)return {groups:[],sitemaps:[],error:'robots.txt exceeds the parsing size limit'};
  const lines=text.split(/\r?\n/);
  if(lines.length>MAX_LINES)return {groups:[],sitemaps:[],error:'robots.txt exceeds the line limit'};
  const groups=[],sitemaps=[];let agents=[],rules=[],count=0;
  const flush=()=>{if(agents.length)groups.push({agents,rules});agents=[];rules=[];};
  for(const raw of lines){
    const line=raw.replace(/#.*$/,'').trim(),i=line.indexOf(':');if(i<0)continue;
    const key=line.slice(0,i).trim().toLowerCase(),value=line.slice(i+1).trim();
    if(key==='user-agent'){if(rules.length)flush();agents.push(value.toLowerCase());}
    else if((key==='allow'||key==='disallow')&&agents.length){
      if(++count>MAX_RULES||value.length>MAX_PATTERN)return {groups:[],sitemaps:[],error:'robots.txt exceeds the rule limit'};
      rules.push({type:key,path:value});
    }else if(key==='sitemap'&&sitemaps.length<20)sitemaps.push(value);
  }
  flush();return {groups,sitemaps};
}

// Dynamic programming instead of regex backtracking. The shared budget bounds
// total character comparisons for a crawler decision, across all matching rules.
export function matchRobotsRule(pattern,path,budget={remaining:MAX_WORK}){
  if(!pattern)return false;
  if(pattern.length>MAX_PATTERN||path.length>MAX_PATH)return null;
  const anchored=pattern.endsWith('$');if(anchored)pattern=pattern.slice(0,-1);
  const work=pattern.length*(path.length+1);
  if(work>budget.remaining)return null;
  budget.remaining-=work;
  let previous=new Uint8Array(path.length+1);previous[0]=1;
  for(let i=0;i<pattern.length;i++){
    const char=pattern[i];
    const next=new Uint8Array(path.length+1);
    if(char==='*'){
      next[0]=previous[0];
      for(let j=1;j<=path.length;j++)next[j]=previous[j]||next[j-1];
    }else{
      for(let j=1;j<=path.length;j++)next[j]=previous[j-1]&&char===path[j-1]?1:0;
    }
    previous=next;
  }
  return anchored?Boolean(previous[path.length]):previous.some(Boolean);
}

export function robotsDecision(parsed,token,path='/'){
  if(parsed.error)return unknown(parsed.error);
  if(path.length>MAX_PATH)return unknown('URL path exceeds the robots matching limit');
  let groups=parsed.groups.filter(g=>g.agents.includes(token.toLowerCase()));
  if(!groups.length)groups=parsed.groups.filter(g=>g.agents.includes('*'));
  const budget={remaining:MAX_WORK};let winner=null,specificity=-1;
  for(const group of groups)for(const rule of group.rules){
    const matched=matchRobotsRule(rule.path,path,budget);
    if(matched===null)return unknown('robots.txt exceeds the matching work limit');
    if(matched){
      const length=rule.path.replace(/\*|\$/g,'').length;
      if(length>specificity||(length===specificity&&rule.type==='allow')){winner=rule;specificity=length;}
    }
  }
  if(!winner)return {allowed:true,reason:groups.length?'No rule matches this path':'No matching robots.txt rule'};
  return {allowed:winner.type==='allow',reason:`${winner.type==='allow'?'Allowed':'Blocked'} by ${winner.type}: ${winner.path}`};
}
