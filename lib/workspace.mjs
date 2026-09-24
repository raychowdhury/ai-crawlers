import {createPlanPdf} from './plan-pdf.mjs';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {safeFetch,publicUrl} from './safe-fetch.mjs';
import {createAuditGate} from './audit-gate.mjs';
import {ConnectionError,connectGithub,prepareGithubPlan,submitGithubPlan,recoverGithubPlan} from './connections/github.mjs';

export const providers=[
  {id:'github',name:'GitHub',status:'available',description:'Review exact changes, then create a draft pull request. You choose when to merge.',fixes:['Static HTML noindex','Verified sitemap reference']},
  {id:'wordpress',name:'WordPress',status:'developer-handoff',description:'Download a plan for your WordPress administrator. The plugin connection is not available in this release.',fixes:[]},
  {id:'shopify',name:'Shopify',status:'developer-handoff',description:'Download a plan for your store developer. A Shopify app connection is not available in this release.',fixes:[]},
  {id:'other',name:'Other website',status:'developer-handoff',description:'Use the developer plan with your hosting provider or website team.',fixes:[]}
];
const cookieName='crawler_workspace', ttl=30*60*1000, anonymousTtl=2*60*1000;
const secret=()=>randomBytes(32).toString('hex');
function equal(a,b){return typeof a==='string' && Buffer.byteLength(a)===Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a),Buffer.from(b));}
export function publicState(session){
  const plan=session.plan;
  return {csrf:session.csrf,expiresAt:session.connection?session.expiresAt:Math.min(session.expiresAt,session.lastSeen+anonymousTtl),providers,connection:session.connection?{provider:'github',repository:session.connection.repository,base:session.connection.base}:null,
    audit:session.audit||null,plan:plan?{...plan}:null,history:session.history};
}
async function body(req){
  if(!(req.headers['content-type']||'').startsWith('application/json'))throw new ConnectionError('JSON request required.',415);
  let size=0,raw='';
  const timer=setTimeout(()=>req.destroy(),10000);
  try {for await(const chunk of req){size+=chunk.length;if(size>16000)throw new ConnectionError('Request too large.',413);raw+=chunk;}return JSON.parse(raw||'{}');}
  catch(error){if(error instanceof ConnectionError)throw error;throw new ConnectionError('Invalid or incomplete request.');}
  finally{clearTimeout(timer);}
}
export function createWorkspace({origin,audit,acquireAudit,connect=connectGithub,prepare=prepareGithubPlan,submit=submitGithubPlan,recover=recoverGithubPlan,fetchPublic=safeFetch,now=Date.now}={}) {
  const acquireExport=createAuditGate({maxActive:2,perClient:10,globalLimit:30,now});
  const sessions=new Map(), acquire=createAuditGate({maxActive:8,perClient:40,globalLimit:100,now});
  const expired=s=>s.expiresAt<=now()||(!s.connection&&s.lastSeen+anonymousTtl<=now());
  const cleanup=()=>{for(const [key,s] of sessions)if(!s.busy&&expired(s)) {s.connection=null;s.plan=null;sessions.delete(key);}};
  // Anonymous visitors cannot occupy the reserved connection capacity.
  function makeRoom(source){
    const anonymous=[...sessions].filter(([,s])=>!s.connection);
    const own=anonymous.filter(([,s])=>s.source===source);
    const candidates=own.length>=8?own:anonymous.length>=128||sessions.size>=256?anonymous:[];
    if(candidates.length){
      const oldest=candidates.filter(([,s])=>!s.busy).sort((a,b)=>a[1].lastSeen-b[1].lastSeen)[0];
      if(!oldest)throw new ConnectionError('Workspace busy. Try again shortly.',429);
      sessions.delete(oldest[0]);
    }
    if(sessions.size>=256)throw new ConnectionError('Workspace busy. Try again shortly.',429);
  }
  const timer=setInterval(cleanup,60000);timer.unref();
  const configured=origin && new URL(origin).origin===origin && (origin.startsWith('https://') || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin));
  function respond(res,status,data){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(data));}
  return async function handle(req,res){
    const route=new URL(req.url,'http://local').pathname;
    if(!route.startsWith('/api/workspace'))return false;
    if(!configured){respond(res,503,{error:'Set APP_ORIGIN to this app’s exact HTTPS origin before enabling connections.'});return true;}
    if(req.headers['sec-fetch-site']==='cross-site'){respond(res,403,{error:'Cross-site access is not allowed.'});return true;}
    let release;
    try {
      if(req.method!=='GET' && req.method!=='POST')throw new ConnectionError('Method not allowed.',405);
      cleanup();
      const id=(req.headers.cookie||'').split(';').map(c=>c.trim()).find(c=>c.startsWith(cookieName+'='))?.slice(cookieName.length+1);
      let session=sessions.get(id);
      if(session&&expired(session))session=undefined;
      if(req.method==='GET' && route==='/api/workspace'){
        if(!session){
          release=acquire(req.socket.remoteAddress||'unknown');if(!release)throw new ConnectionError('Too many sessions. Try again shortly.',429);
          makeRoom(req.socket.remoteAddress||'unknown');
          const id=secret();session={csrf:secret(),expiresAt:now()+ttl,lastSeen:now(),source:req.socket.remoteAddress||'unknown',connection:null,plan:null,history:[],busy:false};sessions.set(id,session);
          res.setHeader('set-cookie',`${cookieName}=${id}; HttpOnly; SameSite=Strict; Path=/api/workspace; Max-Age=${ttl/1000}${origin.startsWith('https://')?'; Secure':''}`);
        }
        session.lastSeen=now();
        respond(res,200,publicState(session));return true;
      }
      if(!session)throw new ConnectionError('Session expired. Reload and reconnect your repository.',401);
      if(req.method!=='POST')throw new ConnectionError('Not found.',404);
      if(req.headers.origin!==origin || !equal(req.headers['x-csrf-token'],session.csrf))throw new ConnectionError('Request verification failed. Reload the page.',403);
      if(session.busy)throw new ConnectionError('An operation is already running. Please wait.',409);
      release=acquire(req.socket.remoteAddress||'unknown');if(!release)throw new ConnectionError('Too many requests. Try again shortly.',429);
      session.lastSeen=now();session.busy=true;
      try {
        const input=await body(req);
        if(!input||typeof input!=='object'||Array.isArray(input))throw new ConnectionError('Invalid request.');
        if(route==='/api/workspace/export') {
          if(!session.audit)throw new ConnectionError('Run an audit before exporting a plan.');
          if(!['developer','wordpress','shopify','other'].includes(input.platform))throw new ConnectionError('Unsupported plan platform.');
          const done=acquireExport(req.socket.remoteAddress||'unknown');
          if(!done)throw new ConnectionError('PDF export busy. Try again shortly.',429);
          try{
            const pdf=await createPlanPdf({audit:session.audit,plan:session.plan},input.platform);
            res.writeHead(200,{'content-type':'application/pdf','content-disposition':'attachment; filename="website-discovery-plan.pdf"','cache-control':'no-store'});
            res.end(pdf);
          }finally{done();}
          return true;
        } else if(route==='/api/workspace/connect') {
          if(input.provider!=='github')throw new ConnectionError('This platform currently supports developer handoff only.');
          const connection=await connect(input);session.connection=connection;session.plan=null;
          session.history.unshift({at:new Date(now()).toISOString(),message:`Connected ${connection.repository}. No files changed.`});
        } else if(route==='/api/workspace/disconnect') {
          session.connection=null;session.plan=null;session.history=[];
        } else if(route==='/api/workspace/audit') {
          publicUrl(input.url);
          const done=acquireAudit();if(!done)throw new ConnectionError('The audit service is busy. Try again shortly.',429);
          try {session.audit=await audit(input.url);session.plan=null;} finally{done();}
        } else if(route==='/api/workspace/plan') {
          if(!session.connection||!session.audit)throw new ConnectionError('Run an audit and connect a repository first.');
          if(input.confirmMapping!==true)throw new ConnectionError('Confirm that this repository and file serve the audited website.');
          if(session.plan && ['applying','uncertain'].includes(session.plan.status))throw new ConnectionError('Resolve the pending change before preparing another plan.');
          if(input.kind==='remove-noindex'){
            if(!session.audit.page.noindex)throw new ConnectionError('The audited page has no detected noindex directive.');
            if(/\bnoindex\b/i.test(session.audit.page.xRobotsTag||''))throw new ConnectionError('The noindex response header needs a hosting or developer change.');
          } else if(input.kind==='sitemap-reference') {
            const sitemap=publicUrl(input.sitemapUrl);
            if(sitemap.origin!==new URL(session.audit.page.finalUrl).origin)throw new ConnectionError('Choose a sitemap on the audited website’s final origin.');
            const result=await fetchPublic(sitemap.href);
            if(new URL(result.finalUrl).origin!==sitemap.origin || result.response.status!==200)throw new ConnectionError('The sitemap must be reachable on the same website.');
            const xml=await result.response.text();
            if(!/<(?:urlset|sitemapindex)(?:\s|>)/i.test(xml)||/<html\b/i.test(xml))throw new ConnectionError('The address did not return a recognizable XML sitemap.');
          } else throw new ConnectionError('This fix needs developer review.');
          session.plan={...await prepare(session.connection,input),expiresAt:now()+15*60*1000,website:session.audit.input};
        } else if(route==='/api/workspace/approve') {
          const plan=session.plan;
          if(!session.connection||!plan||plan.id!==input.planId)throw new ConnectionError('Plan not found.',404);
          if(input.approve!==true)throw new ConnectionError('Explicit approval is required.');
          if(plan.status==='submitted'){respond(res,200,publicState(session));return true;}
          if(plan.status!=='ready')throw new ConnectionError('Check this change’s status before taking another action.',409);
          if(plan.expiresAt<=now())throw new ConnectionError('This plan expired. Prepare and review a fresh plan.',409);
          plan.status='applying';
          try {plan.pull=await submit(session.connection,plan);plan.status='submitted';session.history.unshift({at:new Date(now()).toISOString(),message:`Draft pull request created for ${plan.path}. Awaiting review and merge.`,url:plan.pull.url});}
          catch(error){plan.status='uncertain';plan.problem='The operation did not complete cleanly. Check GitHub before retrying; a branch or pull request may already exist.';throw error;}
        } else if(route==='/api/workspace/status') {
          if(!session.connection||!session.plan)throw new ConnectionError('No change to check.');
          const pull=await recover(session.connection,session.plan);
          if(pull){session.plan.pull={...pull,branchVerified:session.plan.pull?.branchVerified||false};session.plan.status='submitted';}
          else session.plan.problem='No pull request was found. Inspect the proposed branch on GitHub; do not assume no files were written.';
        } else throw new ConnectionError('Not found.',404);
        session.history=session.history.slice(0,20);
        respond(res,200,publicState(session));
      } finally {session.busy=false;}
    } catch(error){respond(res,error instanceof ConnectionError?error.status:400,{error:error instanceof ConnectionError?error.message:'Unable to complete the request. Check the inputs and try again.'});}
    finally{release?.();}
    return true;
  };
}
