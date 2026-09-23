import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { lookup } from 'node:dns/promises';
import net from 'node:net';

const PORT = Number(process.env.PORT || 3000);
const PUBLIC = new URL('./public/', import.meta.url).pathname;
const MAX_BYTES = 1_500_000;
const MAX_REDIRECTS = 5;

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

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a,b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (net.isIPv6(ip)) {
    const s = ip.toLowerCase();
    return s === '::1' || s === '::' || s.startsWith('fc') || s.startsWith('fd') || s.startsWith('fe8') || s.startsWith('fe9') || s.startsWith('fea') || s.startsWith('feb');
  }
  return true;
}

async function assertPublicUrl(input) {
  let url;
  try { url = new URL(input); } catch { throw new Error('Enter a valid URL, for example https://example.com'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only http:// and https:// URLs are supported.');
  if (url.username || url.password) throw new Error('URLs with credentials are not allowed.');
  if (['localhost', 'localhost.localdomain'].includes(url.hostname.toLowerCase())) throw new Error('Localhost/private network targets are not allowed.');
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(a => isPrivateIp(a.address))) throw new Error('Private or non-public network targets are not allowed.');
  return url;
}

async function safeFetch(input, options = {}, redirects = 0) {
  if (redirects > MAX_REDIRECTS) throw new Error('Too many redirects.');
  const url = await assertPublicUrl(input);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  try {
    const response = await fetch(url, { ...options, redirect: 'manual', signal: controller.signal, headers: { 'accept': 'text/html,text/plain,application/xhtml+xml,*/*;q=0.8', ...(options.headers || {}) } });
    if ([301,302,303,307,308].includes(response.status)) {
      const loc = response.headers.get('location');
      if (!loc) return { response, finalUrl: url.href, redirects };
      const next = new URL(loc, url);
      return safeFetch(next.href, options, redirects + 1);
    }
    return { response, finalUrl: url.href, redirects };
  } finally { clearTimeout(timer); }
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

function parseRobots(text) {
  const groups = [];
  let agents = [], rules = [], sitemaps = [], groupStarted = false;
  const flush = () => { if (agents.length) groups.push({ agents: [...agents], rules: [...rules] }); agents=[]; rules=[]; groupStarted=false; };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const i = line.indexOf(':'); if (i < 0) continue;
    const key = line.slice(0,i).trim().toLowerCase(); const value = line.slice(i+1).trim();
    if (key === 'user-agent') {
      if (groupStarted && rules.length) flush();
      agents.push(value.toLowerCase()); groupStarted = true;
    } else if ((key === 'allow' || key === 'disallow') && agents.length) {
      rules.push({ type: key, path: value });
    } else if (key === 'sitemap') sitemaps.push(value);
  }
  flush();
  return { groups, sitemaps };
}

function ruleToRegex(path) {
  if (!path) return null;
  const end = path.endsWith('$');
  let p = end ? path.slice(0,-1) : path;
  const esc = p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp('^' + esc + (end ? '$' : ''));
}

function robotsDecision(parsed, token, pathname='/') {
  const t = token.toLowerCase();
  let matches = parsed.groups.filter(g => g.agents.includes(t));
  if (!matches.length) matches = parsed.groups.filter(g => g.agents.includes('*'));
  if (!matches.length) return { allowed: true, reason: 'No matching robots.txt rule' };
  const candidates=[];
  for (const g of matches) for (const r of g.rules) {
    if (r.type === 'disallow' && r.path === '') continue;
    const rx = ruleToRegex(r.path); if (rx && rx.test(pathname)) candidates.push(r);
  }
  if (!candidates.length) return { allowed: true, reason: 'No rule matches this path' };
  candidates.sort((a,b) => b.path.replace(/\*|\$/g,'').length - a.path.replace(/\*|\$/g,'').length || (a.type === 'allow' ? -1 : 1));
  const winner = candidates[0];
  return { allowed: winner.type === 'allow', reason: `${winner.type === 'allow' ? 'Allowed' : 'Blocked'} by ${winner.type}: ${winner.path}` };
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
  const start = await assertPublicUrl(input);
  const targetPath = start.pathname || '/';
  const origin = start.origin;
  let robotsStatus=null, robotsText='', robotsError=null;
  try {
    const { response } = await safeFetch(new URL('/robots.txt', origin).href, { headers: { 'user-agent': 'AI-Crawler-Checker/1.0' } });
    robotsStatus=response.status; robotsText=await readLimited(response);
  } catch(e) { robotsError=e.message; }
  const parsed = parseRobots(robotsText);

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
  score -= coreBots.filter(b => !b.robotsAllowed).length * 8;
  score -= coreBots.filter(b => b.httpAccessible === false).length * 5;
  if (!sitemapResults.some(s=>s.ok)) score-=6;
  if (!meta.jsonLd) score-=6;
  score=Math.max(0, Math.min(100, score));

  const findings=[];
  if (metaNoindex || headerNoindex) findings.push({severity:'critical',title:'Page is marked noindex',detail:'Search engines may be instructed not to index this page.'});
  for (const b of coreBots.filter(b=>!b.robotsAllowed)) findings.push({severity:'high',title:`${b.name} is blocked by robots.txt`,detail:b.robotsReason});
  for (const b of coreBots.filter(b=>b.robotsAllowed && b.httpAccessible===false)) findings.push({severity:'high',title:`${b.name} could not fetch the page`,detail:b.error || `HTTP ${b.httpStatus}`});
  if (!sitemapResults.some(s=>s.ok)) findings.push({severity:'medium',title:'No working sitemap found',detail:'Add a sitemap.xml and reference it in robots.txt.'});
  if (!meta.jsonLd) findings.push({severity:'medium',title:'No JSON-LD structured data detected',detail:'Add Organization or LocalBusiness schema where appropriate.'});
  if (!findings.length) findings.push({severity:'ok',title:'No major crawler/indexability blockers detected',detail:'Crawler access still does not guarantee indexing or inclusion in AI answers.'});

  return { auditedAt:new Date().toISOString(), input:start.href, origin, page:{status:pageStatus,finalUrl:pageFinalUrl,redirects,error:pageError,title:meta.title,contentType:pageHeaders['content-type'],xRobotsTag:pageHeaders['x-robots-tag'],metaRobots:meta.metaRobots,jsonLdBlocks:meta.jsonLd,noindex:metaNoindex||headerNoindex}, robots:{status:robotsStatus,error:robotsError,found:Boolean(robotsText),sitemaps:parsed.sitemaps}, sitemaps:sitemapResults, bots:botResults, score, findings, disclaimer:'This is an external diagnostic. User-Agent simulation can detect many blocks, but it cannot prove how a provider will index, rank, train on, or cite a site.' };
}

async function serveStatic(req,res){
  let p=new URL(req.url,'http://x').pathname; if(p==='/')p='/index.html';
  const file=join(PUBLIC,p.replace(/^\/+/,''));
  if(!file.startsWith(PUBLIC)) return json(res,403,{error:'Forbidden'});
  try{
    const data=await readFile(file);
    const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml'};
    res.writeHead(200,{'content-type':types[extname(file)]||'application/octet-stream'}); res.end(data);
  }catch{json(res,404,{error:'Not found'});}
}

const server=http.createServer(async(req,res)=>{
  if(req.method==='POST' && req.url==='/api/check'){
    let raw=''; req.on('data',c=>{raw+=c;if(raw.length>10000)req.destroy();});
    req.on('end',async()=>{try{const {url}=JSON.parse(raw||'{}'); if(!url)return json(res,400,{error:'URL is required'}); json(res,200,await audit(url));}catch(e){json(res,400,{error:e.message||'Audit failed'});}}); return;
  }
  serveStatic(req,res);
});
server.listen(PORT,()=>console.log(`AI Crawler Checker running at http://localhost:${PORT}`));
