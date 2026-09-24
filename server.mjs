import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { publicUrl, safeFetch } from './lib/safe-fetch.mjs';
import { createAuditGate } from './lib/audit-gate.mjs';
import { createWorkspace } from './lib/workspace.mjs';
import { parseRobots, robotsDecision } from './lib/robots.mjs';

const PORT = Number(process.env.PORT || 3000);
const PUBLIC = new URL('./public/', import.meta.url).pathname;
const MAX_BYTES = 1_500_000;
const acquireAudit = createAuditGate();

const BOTS = [
  { id: 'oai-searchbot', name: 'OAI-SearchBot', company: 'OpenAI', token: 'OAI-SearchBot', ua: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot', kind: 'search' },
  { id: 'gptbot', name: 'GPTBot', company: 'OpenAI', token: 'GPTBot', ua: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.1; +https://openai.com/gptbot', kind: 'training' },
  { id: 'chatgpt-user', name: 'ChatGPT-User', company: 'OpenAI', token: 'ChatGPT-User', ua: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot', kind: 'user-fetch' },
  { id: 'googlebot', name: 'Googlebot', company: 'Google', token: 'Googlebot', ua: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', kind: 'search' },
  { id: 'google-extended', name: 'Google-Extended', company: 'Google', token: 'Google-Extended', ua: null, kind: 'ai-control' },
  { id: 'bingbot', name: 'bingbot', company: 'Microsoft', token: 'bingbot', ua: 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)', kind: 'search' },
  { id: 'claudebot', name: 'ClaudeBot', company: 'Anthropic', token: 'ClaudeBot', ua: 'ClaudeBot/1.0', kind: 'ai' },
  { id: 'claude-searchbot', name: 'Claude-SearchBot', company: 'Anthropic', token: 'Claude-SearchBot', ua: 'Claude-SearchBot/1.0', kind: 'search' },
  { id: 'perplexitybot', name: 'PerplexityBot', company: 'Perplexity', token: 'PerplexityBot', ua: 'Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)', kind: 'search' }
];

function json(res, code, body) {
  const payload = JSON.stringify(body);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(payload) });
  res.end(payload);
}

async function readLimited(response) {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks = []; let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) { reader.cancel(); break; }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks.map(v => Buffer.from(v))));
}

function extractMeta(html) {
  const metaRobots=[];
  for (const m of html.matchAll(/<meta\s+[^>]*>/gi)) {
    const tag=m[0];
    const name=(tag.match(/name\s*=\s*["']?([^"'\s>]+)/i)||[])[1]?.toLowerCase();
    const content=(tag.match(/content\s*=\s*["']([^"']*)["']/i)||[])[1] || (tag.match(/content\s*=\s*([^\s>]+)/i)||[])[1];
    if (name && content && (name === 'robots' || name.includes('bot'))) metaRobots.push({name,content});
  }
  const jsonLd = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].length;
  const title=(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)||[])[1]?.replace(/\s+/g,' ').trim() || null;
  return { metaRobots, jsonLd, title };
}

async function checkBot(rootUrl, path, bot, robotsParsed) {
  const robots = robotsDecision(robotsParsed, bot.token, path || '/');
  if (!bot.ua) return { ...bot, robotsAllowed: robots.allowed, robotsReason: robots.reason, httpStatus: null, httpAccessible: null, note: 'Policy token only; no dedicated request User-Agent.' };
  try {
    const { response, finalUrl } = await safeFetch(rootUrl, { method: 'GET', headers: { 'user-agent': bot.ua } });
    return { ...bot, robotsAllowed: robots.allowed, robotsReason: robots.reason, httpStatus: response.status, httpAccessible: response.status >= 200 && response.status < 400, finalUrl };
  } catch (e) {
    return { ...bot, robotsAllowed: robots.allowed, robotsReason: robots.reason, httpStatus: null, httpAccessible: false, error: e.name === 'AbortError' ? 'Request timed out' : e.message };
  }
}

async function audit(input) {
  const start = publicUrl(input);
  const targetPath = start.pathname + start.search;
  const origin = start.origin;
  let robotsStatus=null, robotsText='', robotsError=null;
  try {
    const { response } = await safeFetch(new URL('/robots.txt', origin).href, { headers: { 'user-agent': 'AI-Crawler-Checker/1.0' } });
    robotsStatus=response.status; robotsText=await readLimited(response);
  } catch(e) { robotsError=e.message; }
  const parsed = parseRobots(robotsText);
  if(robotsError || robotsStatus>=500 || robotsStatus===429)parsed.error='robots.txt could not be evaluated reliably';

  let pageStatus=null, pageHtml='', pageHeaders={}, pageFinalUrl=start.href, pageError=null, redirects=0;
  try {
    const out = await safeFetch(start.href, { headers: { 'user-agent': 'Mozilla/5.0 AI-Crawler-Checker/1.0' } });
    pageStatus=out.response.status; pageFinalUrl=out.finalUrl; redirects=out.redirects;
    pageHeaders={ 'x-robots-tag': out.response.headers.get('x-robots-tag'), 'content-type': out.response.headers.get('content-type') };
    pageHtml=await readLimited(out.response);
  } catch(e) { pageError=e.name==='AbortError' ? 'Request timed out' : e.message; }

  const meta=extractMeta(pageHtml);
  const xRobots=(pageHeaders['x-robots-tag']||'').toLowerCase();
  const metaNoindex=meta.metaRobots.some(m => /(^|[,\s])noindex([,\s]|$)/i.test(m.content));
  const headerNoindex=/(^|[,\s])noindex([,\s]|$)/i.test(xRobots);
  const sitemapCandidates = [...new Set([...parsed.sitemaps, new URL('/sitemap.xml', origin).href])].slice(0,5);
  const sitemapResults=[];
  for (const s of sitemapCandidates) {
    try { const { response } = await safeFetch(s, { headers: { 'user-agent':'AI-Crawler-Checker/1.0' }}); sitemapResults.push({url:s,status:response.status,ok:response.status>=200&&response.status<400}); }
    catch(e){ sitemapResults.push({url:s,status:null,ok:false,error:e.message}); }
  }
  const botResults = await Promise.all(BOTS.map(b => checkBot(start.href, targetPath, b, parsed)));

  const coreBots = botResults.filter(b => ['oai-searchbot','googlebot','bingbot','claude-searchbot','perplexitybot'].includes(b.id));
  let score=100;
  if (!(pageStatus>=200&&pageStatus<400)) score-=25;
  if (metaNoindex || headerNoindex) score-=30;
  score -= coreBots.filter(b => b.robotsAllowed === false).length * 8;
  score -= coreBots.filter(b => b.httpAccessible === false).length * 5;
  if (!sitemapResults.some(s=>s.ok)) score-=6;
  if (!meta.jsonLd) score-=6;
  score=Math.max(0, Math.min(100, score));
  if(coreBots.some(b=>b.robotsAllowed===null))score=Math.min(score,79);

  const findings=[];
  if(coreBots.some(b=>b.robotsAllowed===null))findings.push({severity:'medium',title:'Crawler policy could not be determined',detail:parsed.error||'The robots rules exceeded the safe matching budget. Review robots.txt manually.'});
  if (metaNoindex || headerNoindex) findings.push({severity:'critical',title:'Page is marked noindex',detail:'Search engines may be instructed not to index this page.'});
  for (const b of coreBots.filter(b=>b.robotsAllowed === false)) findings.push({severity:'high',title:`${b.name} is blocked by robots.txt`,detail:b.robotsReason});
  for (const b of coreBots.filter(b=>b.robotsAllowed && b.httpAccessible===false)) findings.push({severity:'high',title:`${b.name} could not fetch the page`,detail:b.error || `HTTP ${b.httpStatus}`});
  if (!sitemapResults.some(s=>s.ok)) findings.push({severity:'medium',title:'No working sitemap found',detail:'Add a sitemap.xml and reference it in robots.txt.'});
  if (!meta.jsonLd) findings.push({severity:'medium',title:'No JSON-LD structured data detected',detail:'Add Organization or LocalBusiness schema where appropriate.'});
  if (!findings.length) findings.push({severity:'ok',title:'No major crawler/indexability blockers detected',detail:'Crawler access still does not guarantee indexing or inclusion in AI answers.'});

  return { auditedAt:new Date().toISOString(), input:start.href, origin, page:{status:pageStatus,finalUrl:pageFinalUrl,redirects,error:pageError,title:meta.title,contentType:pageHeaders['content-type'],xRobotsTag:pageHeaders['x-robots-tag'],metaRobots:meta.metaRobots,jsonLdBlocks:meta.jsonLd,noindex:metaNoindex||headerNoindex}, robots:{status:robotsStatus,error:robotsError,found:Boolean(robotsText),sitemaps:parsed.sitemaps}, sitemaps:sitemapResults, bots:botResults, score, findings, disclaimer:'This is an external diagnostic. User-Agent simulation can detect many blocks, but it cannot prove how a provider will index, rank, train on, or cite a site.' };
}

async function serveStatic(req,res,requestUrl){
  let p=requestUrl.pathname;
  if(p==='/' && requestUrl.searchParams.get('prototype')==='fix-plan' && process.env.NODE_ENV!=='production') p='/fix-plan-prototype.html';
  else if(p==='/')p='/index.html';
  if(p==='/workspace')p='/workspace.html';
  if(process.env.NODE_ENV==='production' && p.includes('fix-plan-prototype')) return json(res,404,{error:'Not found'});
  const file=join(PUBLIC,p.replace(/^\/+/,''));
  if(!file.startsWith(PUBLIC)) return json(res,403,{error:'Forbidden'});
  try{
    const data=await readFile(file);
    const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml'};
    res.writeHead(200,{'content-type':types[extname(file)]||'application/octet-stream'}); res.end(data);
  }catch{json(res,404,{error:'Not found'});}
}

const workspaceEnabled=process.env.NODE_ENV!=='production'||process.env.ENABLE_FIX_WORKSPACE==='true';
const workspace=createWorkspace({origin:process.env.APP_ORIGIN||(process.env.NODE_ENV!=='production'?`http://localhost:${PORT}`:null),audit,acquireAudit:()=>acquireAudit('workspace')});
async function handleRequest(req,res){
  let requestUrl;
  try{
    if(!req.url.startsWith('/')||req.url.startsWith('//')||req.url.includes('\\'))throw new Error('Invalid target');
    requestUrl=new URL(req.url,'http://local');
    if(requestUrl.origin!=='http://local')throw new Error('Invalid target');
  }catch{return json(res,400,{error:'Invalid request target'});}
  // Use the same normalized path for routing, authorization and static files.
  req.url=requestUrl.pathname+requestUrl.search;
  const pathname=requestUrl.pathname;
  if(pathname.startsWith('/api/workspace')){
    if(!workspaceEnabled)return json(res,404,{error:'Not found'});
    await workspace(req,res);return;
  }
  if(pathname.startsWith('/workspace') && !workspaceEnabled)return json(res,404,{error:'Not found'});
  if(pathname.startsWith('/workspace')){
    res.setHeader('content-security-policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    res.setHeader('referrer-policy','no-referrer');
    res.setHeader('cache-control','no-store');
    res.setHeader('x-content-type-options','nosniff');
  }
  if(req.method==='POST' && req.url==='/api/check'){
    const release = acquireAudit(req.socket.remoteAddress || 'unknown');
    if (!release) { res.setHeader('retry-after','60'); return json(res,429,{error:'Too many audits. Please try again in a minute.'}); }
    let raw='', bytes=0, rejected=false;
    const bodyTimer=setTimeout(()=>{ rejected=true; release(); json(res,408,{error:'Request timed out'}); req.destroy(); },10000);
    req.on('error',()=>{clearTimeout(bodyTimer);release();});
    req.on('aborted',()=>{clearTimeout(bodyTimer);release();});
    req.on('data',c=>{
      bytes+=c.length;
      if(bytes>10000 && !rejected){rejected=true;clearTimeout(bodyTimer);release();json(res,413,{error:'Request body too large'});req.destroy();}
      if(!rejected) raw+=c;
    });
    req.on('end',async()=>{
      clearTimeout(bodyTimer);
      if(rejected)return;
      try { const {url}=JSON.parse(raw||'{}'); if(typeof url!=='string'||!url) return json(res,400,{error:'URL is required'}); json(res,200,await audit(url)); }
      catch(e){json(res,400,{error:e.message||'Audit failed'});}
      finally{release();}
    }); return;
  }
  await serveStatic(req,res,requestUrl);
}
const server=http.createServer((req,res)=>{
  handleRequest(req,res).catch(()=>{
    if(res.destroyed||res.writableEnded)return;
    if(res.headersSent){res.destroy();return;}
    json(res,500,{error:'Request could not be completed'});
  });
});
server.listen(PORT,()=>console.log(`AI Crawler Checker running at http://localhost:${server.address().port}`));
