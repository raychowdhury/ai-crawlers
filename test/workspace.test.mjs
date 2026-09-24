import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {connectGithub,prepareGithubPlan,submitGithubPlan,permittedPath,makeGithubClient,ConnectionError} from '../lib/connections/github.mjs';
import {createWorkspace} from '../lib/workspace.mjs';

const token='github_pat_TEST_ONLY_1234567890';
const connection={provider:'github',repository:'owner/site',base:'main',token};
function githubFixture(content='<html><head><meta name="robots" content="noindex, nofollow"></head></html>'){
 const calls=[],files=new Map([['main',content],['base-sha',content]]);let head='base-sha';
 const client=async(path,{method='GET',body}={})=>{
  calls.push({path,method,body});
  if(path==='/repos/owner/site')return {full_name:'owner/site',default_branch:'main',permissions:{push:true}};
  if(path.includes('/git/ref/heads/'))return {object:{sha:head}};
  if(path.endsWith('/git/refs')){files.set(body.ref.replace('refs/heads/',''),files.get('main'));return {};}
  if(path.includes('/contents/')){
   if(method==='PUT'){assert.equal(body.sha,'file-sha');files.set(body.branch,Buffer.from(body.content,'base64').toString());return {};}
   const ref=new URL(path,'https://api.github.com').searchParams.get('ref');
   if(!files.has(ref))throw new ConnectionError('File not found',404);
   const text=files.get(ref);return {type:'file',encoding:'base64',size:Buffer.byteLength(text),content:Buffer.from(text).toString('base64'),sha:'file-sha'};
  }
  if(path.endsWith('/pulls')&&method==='POST'){assert.equal(body.draft,true);return {number:1,html_url:'https://github.com/owner/site/pull/1',state:'open',merged_at:null};}
  throw new Error('Unexpected fixture request: '+path);
 };
 return {client,calls,files,setHead:value=>head=value};
}

test('noindex fix changes real head metadata, preserves scripts, comments and other directives',async()=>{
 const original=`<!doctype html><html><head><!-- <meta name="robots" content="noindex"> --><script>const example='<meta name="robots" content="noindex">';</script><meta name="robots" content="noindex, nofollow"><meta name="googlebot" content="noindex"></head><body>Keep me</body></html>`;
 const fixture=githubFixture(original);
 const plan=await prepareGithubPlan(connection,{kind:'remove-noindex',path:'public/index.html'},{client:fixture.client});
 assert.equal(plan.after,original.replace('<meta name="robots" content="noindex, nofollow">','<meta name="robots" content="nofollow">'));
 assert.ok(fixture.calls.every(c=>c.method==='GET'));
});

test('rejects unsupported files, templates and misleading data-name attributes',async()=>{
 for(const path of ['../index.html','.github/workflows/a.html','public//a.html','public/../a.html','/index.html','package.json'])assert.throws(()=>permittedPath(path,'remove-noindex'));
 for(const content of ['<head><meta data-name="robots" content="noindex"></head>','<head><script>let x=\'<meta name="robots" content="noindex">\';</script></head>','<head>{{ value }}<meta name="robots" content="noindex"></head>']) {
  await assert.rejects(prepareGithubPlan(connection,{kind:'remove-noindex',path:'index.html'},{client:githubFixture(content).client}));
 }
});

test('sitemap change preserves all crawler permissions and rejects duplicate lines',async()=>{
 const fixture=githubFixture('User-agent: GPTBot\nDisallow: /\n');
 const input={kind:'sitemap-reference',path:'public/robots.txt',sitemapUrl:'https://example.com/sitemap.xml'};
 const plan=await prepareGithubPlan(connection,input,{client:fixture.client});
 assert.equal(plan.after,'User-agent: GPTBot\nDisallow: /\nSitemap: https://example.com/sitemap.xml\n');
 await assert.rejects(prepareGithubPlan(connection,input,{client:githubFixture(plan.after).client}),/already present/);
});

test('approved plan creates only its branch and exact file, verifies it, then opens a draft PR',async()=>{
 const fixture=githubFixture();const plan=await prepareGithubPlan(connection,{kind:'remove-noindex',path:'index.html'},{client:fixture.client});
 const result=await submitGithubPlan(connection,plan,{client:fixture.client});
 assert.equal(result.branchVerified,true);assert.equal(result.url,'https://github.com/owner/site/pull/1');
 const writes=fixture.calls.filter(c=>c.method!=='GET');assert.equal(writes.length,3);
 assert.equal(writes[0].body.ref,`refs/heads/${plan.branch}`);
 assert.equal(writes[1].body.branch,plan.branch);assert.equal(writes[2].body.base,'main');assert.equal(writes[2].body.draft,true);
 assert.ok(fixture.files.get('main').includes('noindex'));
});

test('stale base stops submission before any write',async()=>{
 const fixture=githubFixture();const plan=await prepareGithubPlan(connection,{kind:'remove-noindex',path:'index.html'},{client:fixture.client});fixture.setHead('new-head');
 await assert.rejects(submitGithubPlan(connection,plan,{client:fixture.client}),/changed/);
 assert.ok(fixture.calls.every(c=>c.method==='GET'));
});

test('GitHub credentials go only to the fixed API host, redirects are rejected and errors are sanitized',async()=>{
 const client=makeGithubClient(token,async(url,options)=>{
  assert.equal(new URL(url).origin,'https://api.github.com');assert.equal(options.redirect,'error');assert.equal(options.headers.authorization,`Bearer ${token}`);
  return new Response(JSON.stringify({message:token}),{status:403});
 });
 await assert.rejects(client('/repos/owner/site'),error=>!error.message.includes(token)&&/denied/.test(error.message));
 await assert.rejects(client('https://attacker.example'),/Unsupported/);
});

async function workspaceFixture(t,{submitError=false}={}){
 const github=githubFixture('User-agent: *\nDisallow: /private\n');let submissions=0,clock=Date.now();
 let handler;
 const server=http.createServer((req,res)=>handler(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());
 const origin=`http://127.0.0.1:${server.address().port}`;
 handler=createWorkspace({origin,now:()=>clock,acquireAudit:()=>()=>{},
  audit:async url=>({input:url,auditedAt:new Date(clock).toISOString(),page:{noindex:false,finalUrl:url,xRobotsTag:null},findings:[],sitemaps:[]}),
  connect:async input=>{assert.equal(input.token,token);return connection;},
  prepare:(connection,input)=>prepareGithubPlan(connection,input,{client:github.client}),
  submit:async(connection,plan)=>{submissions++;if(submitError)throw new Error('secret provider response');return submitGithubPlan(connection,plan,{client:github.client});},
  recover:async()=>null,
  fetchPublic:async url=>({finalUrl:url,response:new Response('<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>',{status:200})})});
 let response=await fetch(origin+'/api/workspace'),state=await response.json();const cookie=response.headers.get('set-cookie').split(';')[0];
 const post=async(path,data,{csrf=state.csrf,requestOrigin=origin,sessionCookie=cookie}={})=>{
  const response=await fetch(origin+'/api/workspace'+path,{method:'POST',headers:{'content-type':'application/json',origin:requestOrigin,cookie:sessionCookie,'x-csrf-token':csrf},body:JSON.stringify(data)});
  return {status:response.status,data:await response.json()};
 };
 const ready=async()=>{await post('/connect',{provider:'github',token,repository:'owner/site'});await post('/audit',{url:'https://example.com/'});return post('/plan',{kind:'sitemap-reference',path:'public/robots.txt',sitemapUrl:'https://example.com/sitemap.xml',confirmMapping:true});};
 return {origin,cookie,state,post,ready,github,submissions:()=>submissions,setClock:value=>clock=value};
}

test('workspace rejects cross-origin mutations, invalid CSRF, unsupported providers and unauthenticated approval',async t=>{
 const f=await workspaceFixture(t);
 assert.equal((await f.post('/connect',{provider:'github'},{requestOrigin:'https://attacker.example'})).status,403);
 assert.equal((await f.post('/connect',{provider:'github'},{csrf:'wrong'})).status,403);
 assert.equal((await f.post('/connect',{provider:'wordpress',token})).status,400);
 assert.equal((await f.post('/approve',{approve:true},{sessionCookie:''})).status,401);
});

test('workspace keeps tokens private and requires explicit plan approval; repeated submission is idempotent',async t=>{
 const f=await workspaceFixture(t);const ready=await f.ready();assert.equal(ready.status,200);
 assert.ok(!JSON.stringify(ready.data).includes(token));assert.equal(ready.data.plan.status,'ready');
 const id=ready.data.plan.id;
 assert.equal((await f.post('/approve',{planId:id})).status,400);assert.equal(f.submissions(),0);
 const applied=await f.post('/approve',{planId:id,approve:true});assert.equal(applied.status,200);assert.equal(applied.data.plan.status,'submitted');
 assert.equal((await f.post('/approve',{planId:id,approve:true})).status,200);assert.equal(f.submissions(),1);
 assert.equal((await f.post('/disconnect',{})).data.connection,null);
});

test('approval cannot access another session plan',async t=>{
 const f=await workspaceFixture(t),ready=await f.ready();
 const other=await fetch(f.origin+'/api/workspace');const state=await other.json(),cookie=other.headers.get('set-cookie').split(';')[0];
 assert.equal((await f.post('/approve',{planId:ready.data.plan.id,approve:true},{sessionCookie:cookie,csrf:state.csrf})).status,404);
 assert.equal(f.submissions(),0);
});

test('ambiguous submission cannot be repeated blindly',async t=>{
 const f=await workspaceFixture(t,{submitError:true}),ready=await f.ready(),input={planId:ready.data.plan.id,approve:true};
 assert.equal((await f.post('/approve',input)).status,400);
 assert.equal((await f.post('/approve',input)).status,409);assert.equal(f.submissions(),1);
});

test('expired plans cannot be approved',async t=>{
 const f=await workspaceFixture(t),ready=await f.ready();f.setClock(ready.data.plan.expiresAt+1);
 assert.equal((await f.post('/approve',{planId:ready.data.plan.id,approve:true})).status,409);assert.equal(f.submissions(),0);
});

test('plan requires confirmed mapping and a same-origin verified sitemap',async t=>{
 const f=await workspaceFixture(t);await f.ready();
 const base={kind:'sitemap-reference',path:'public/robots.txt',sitemapUrl:'https://example.com/sitemap.xml'};
 assert.equal((await f.post('/plan',base)).status,400);
 assert.equal((await f.post('/plan',{...base,confirmMapping:true,sitemapUrl:'https://attacker.example/sitemap.xml'})).status,400);
});

test('connection rejects broad classic tokens and archived repositories',async()=>{
 await assert.rejects(connectGithub({token:'ghp_this_is_a_classic_token_12345',repository:'owner/site'}),/repository-scoped/);
 await assert.rejects(connectGithub({token,repository:'owner/site'},async()=>new Response(JSON.stringify({full_name:'owner/site',archived:true,default_branch:'main'}),{status:200})),/active repository/);
 const connected=await connectGithub({token,repository:'owner/site'},async()=>new Response(JSON.stringify({full_name:'owner/site',default_branch:'main',permissions:{push:true}}),{status:200}));
 assert.equal(connected.repository,'owner/site');
});

test('failed branch readback never opens a pull request',async()=>{
 const f=githubFixture();const plan=await prepareGithubPlan(connection,{kind:'remove-noindex',path:'index.html'},{client:f.client});
 const client=async(path,options)=>{
  if(path.includes('/contents/') && path.includes(encodeURIComponent(plan.branch)))return {type:'file',encoding:'base64',size:5,content:Buffer.from('wrong').toString('base64'),sha:'x'};
  return f.client(path,options);
 };
 await assert.rejects(submitGithubPlan(connection,plan,{client}),/did not match/);
 assert.ok(!f.calls.some(c=>c.path.endsWith('/pulls')));
});

test('anonymous session churn evicts old anonymous sessions but preserves connected owners',async t=>{
 const f=await workspaceFixture(t);
 assert.equal((await f.post('/connect',{provider:'github',token,repository:'owner/site'})).status,200);
 let first;
 for(let i=0;i<12;i++){
  const response=await fetch(f.origin+'/api/workspace');
  assert.equal(response.status,200);
  if(!i)first={cookie:response.headers.get('set-cookie').split(';')[0],csrf:(await response.json()).csrf};
 }
 assert.equal((await f.post('/disconnect',{}, {sessionCookie:first.cookie,csrf:first.csrf})).status,401);
 const owner=await fetch(f.origin+'/api/workspace',{headers:{cookie:f.cookie}});
 assert.equal((await owner.json()).connection.repository,'owner/site');
 assert.equal((await f.post('/disconnect',{})).status,200);
});

test('unconnected sessions expire after two idle minutes while connected owners remain',async t=>{
 const f=await workspaceFixture(t);
 const response=await fetch(f.origin+'/api/workspace');
 const cookie=response.headers.get('set-cookie').split(';')[0],state=await response.json();
 await f.post('/connect',{provider:'github',token,repository:'owner/site'});
 f.setClock(Date.now()+121000);
 assert.equal((await f.post('/disconnect',{}, {sessionCookie:cookie,csrf:state.csrf})).status,401);
 assert.equal((await f.post('/disconnect',{})).status,200);
});
