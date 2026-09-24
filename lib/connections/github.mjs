import { randomBytes } from 'node:crypto';
import { parse } from 'parse5';

export class ConnectionError extends Error {
  constructor(message, status=400) { super(message); this.status=status; }
}
const encodePath = path => path.split('/').map(encodeURIComponent).join('/');
export function repositoryName(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/.test(value)) throw new ConnectionError('Enter a repository as owner/repository.');
  return value;
}
export function permittedPath(value, kind) {
  if (typeof value !== 'string' || value.length>240 || !/^[A-Za-z0-9_./-]+$/.test(value) || value.split('/').some(p=>!p || p==='.' || p==='..' || p.startsWith('.'))) throw new ConnectionError('Choose a plain website file path without hidden folders or traversal.');
  if (kind==='sitemap-reference' && !/^(?:(?:public|static)\/)?robots\.txt$/.test(value)) throw new ConnectionError('This fix supports robots.txt, public/robots.txt or static/robots.txt.');
  if (kind==='remove-noindex' && !value.endsWith('.html')) throw new ConnectionError('Automatic noindex fixes currently support static .html files only.');
  return value;
}
export function makeGithubClient(token, fetchImpl=fetch) {
  return async (path, {method='GET', body}={}) => {
    if (!path.startsWith('/repos/')) throw new ConnectionError('Unsupported GitHub operation.');
    let response;
    try {
      response=await fetchImpl('https://api.github.com'+path, {method,redirect:'error',signal:AbortSignal.timeout(15000),headers:{accept:'application/vnd.github+json',authorization:`Bearer ${token}`,'x-github-api-version':'2022-11-28','user-agent':'AI-Crawler-Checker','content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
    } catch { throw new ConnectionError('GitHub did not respond. Check the change status before retrying.',502); }
    if (!response.ok) {
      const messages={401:'GitHub rejected this token. Check its value and expiration.',403:'GitHub access was denied or rate limited. Check the selected repository permissions.',404:'Repository or file not found. Check the name, path and token access.',409:'The repository changed. Create a fresh plan.',422:'GitHub could not create this change. Check the branch and repository settings.'};
      throw new ConnectionError(messages[response.status]||'GitHub could not complete the request.',response.status===404?404:502);
    }
    return response.status===204?null:response.json();
  };
}
export async function connectGithub({token,repository}, fetchImpl) {
  repository=repositoryName(repository);
  if (typeof token!=='string' || !token.startsWith('github_pat_') || token.length<20 || token.length>512 || /\s/.test(token)) throw new ConnectionError('Enter a valid, repository-scoped GitHub token.');
  const client=makeGithubClient(token,fetchImpl), repo=await client(`/repos/${repository}`);
  if (repo.archived || repo.disabled || !repo.default_branch) throw new ConnectionError('Choose an active repository with an existing default branch.');
  if (repo.permissions?.push===false) throw new ConnectionError('This account cannot propose repository changes.');
  return {provider:'github',repository:repositoryName(repo.full_name),base:repo.default_branch,token};
}
export async function readGithubFile(connection,path,{client=makeGithubClient(connection.token),ref=connection.base,allowMissing=false}={}) {
  try {
    const file=await client(`/repos/${connection.repository}/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`);
    if (Array.isArray(file)||file.type!=='file'||file.encoding!=='base64'||file.size>100000) throw new ConnectionError('Choose a regular website text file smaller than 100 KB.');
    const bytes=Buffer.from(file.content,'base64');
    const content=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
    if (content.includes('\0')) throw new ConnectionError('Binary files cannot be edited.');
    return {sha:file.sha,content};
  } catch(error) { if (allowMissing && error.status===404) return {sha:null,content:''}; throw error; }
}
export async function prepareGithubPlan(connection,{kind,path,sitemapUrl}, {client=makeGithubClient(connection.token)}={}) {
  if (!['sitemap-reference','remove-noindex'].includes(kind)) throw new ConnectionError('This fix needs developer review.');
  path=permittedPath(path,kind);
  const base=await client(`/repos/${connection.repository}/git/ref/heads/${encodeURIComponent(connection.base)}`);
  const file=await readGithubFile(connection,path,{client,ref:base.object.sha,allowMissing:kind==='sitemap-reference'});
  let after=file.content;
  if (kind==='sitemap-reference') {
    const parsed=new URL(sitemapUrl);
    if (!['https:','http:'].includes(parsed.protocol)||/[\r\n]/.test(sitemapUrl)) throw new ConnectionError('Invalid sitemap URL.');
    if (file.content.split(/\r?\n/).some(line=>line.replace(/#.*$/,'').trim()===`Sitemap: ${sitemapUrl}`)) throw new ConnectionError('This sitemap reference is already present.');
    after+=(after && !after.endsWith('\n')?'\n':'')+`Sitemap: ${sitemapUrl}\n`;
  } else {
    if (/<%|<\?|{{|{%/.test(file.content)) throw new ConnectionError('Template files need developer review. Choose a static HTML file.');
    const document=parse(file.content,{sourceCodeLocationInfo:true});
    const edits=[];
    function walk(node) {
      if (node.tagName==='meta' && node.parentNode?.tagName==='head' &&
          node.attrs.some(a=>a.name==='name' && a.value.toLowerCase()==='robots')) {
        const content=node.attrs.find(a=>a.name==='content');
        const location=node.sourceCodeLocation?.attrs?.content;
        const tokens=content?.value.split(/[,\s]+/).filter(Boolean)||[];
        if (location && tokens.some(t=>t.toLowerCase()==='noindex')) {
          const value=tokens.filter(t=>t.toLowerCase()!=='noindex').join(', ') || 'index';
          const escaped=value.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
          edits.push({start:location.startOffset,end:location.endOffset,text:`content="${escaped}"`});
        }
      }
      for (const child of node.childNodes||[]) walk(child);
    }
    walk(document);
    if (!edits.length) throw new ConnectionError('No supported robots noindex tag was found in the HTML head. A developer should inspect templates, headers or plugin settings.');
    for (const edit of edits.sort((a,b)=>b.start-a.start)) after=after.slice(0,edit.start)+edit.text+after.slice(edit.end);
  }
  const id=randomBytes(16).toString('hex');
  return {id,provider:'github',repository:connection.repository,base:connection.base,baseSha:base.object.sha,path,fileSha:file.sha,before:file.content,after,kind,branch:`crawler-fixes/${id}`,status:'ready',createdAt:Date.now(),title:kind==='sitemap-reference'?'Reference the verified sitemap in robots.txt':'Remove an approved static-page noindex directive'};
}
export async function submitGithubPlan(connection,plan,{client=makeGithubClient(connection.token)}={}) {
  if (plan.repository!==connection.repository) throw new ConnectionError('The connected repository has changed.');
  const prefix=`/repos/${connection.repository}`;
  const base=await client(`${prefix}/git/ref/heads/${encodeURIComponent(plan.base)}`);
  if (base.object.sha!==plan.baseSha) throw new ConnectionError('The default branch changed. Create and review a fresh plan.',409);
  await client(`${prefix}/git/refs`,{method:'POST',body:{ref:`refs/heads/${plan.branch}`,sha:plan.baseSha}});
  await client(`${prefix}/contents/${encodePath(plan.path)}`,{method:'PUT',body:{message:plan.title,content:Buffer.from(plan.after).toString('base64'),branch:plan.branch,...(plan.fileSha?{sha:plan.fileSha}:{})}});
  const verified=await readGithubFile(connection,plan.path,{client,ref:plan.branch});
  if (verified.content!==plan.after) throw new ConnectionError('The proposed branch did not match the approved change. Do not merge it.',502);
  const pull=await client(`${prefix}/pulls`,{method:'POST',body:{title:plan.title,head:plan.branch,base:plan.base,draft:true,body:`This draft proposes one owner-approved website change in \`${plan.path}\`.\n\nThe proposed file was read back and matched the approved content. This is not deployment or live-site verification. Review the diff and repository checks before merging.\n\nThe previous version remains on the base branch. To discard this proposal, close the pull request without merging. After merge, use your repository's revert workflow.\n\nNo AI ranking or citation outcome is guaranteed.`}});
  if (!/^https:\/\/github\.com\//.test(pull.html_url)) throw new ConnectionError('GitHub returned an unexpected pull request address.',502);
  return {number:pull.number,url:pull.html_url,state:pull.state,merged:Boolean(pull.merged_at),branchVerified:true};
}
export async function recoverGithubPlan(connection,plan,{client=makeGithubClient(connection.token)}={}) {
  const owner=connection.repository.split('/')[0];
  const pulls=await client(`/repos/${connection.repository}/pulls?state=all&head=${encodeURIComponent(owner+':'+plan.branch)}&base=${encodeURIComponent(plan.base)}`);
  const pull=pulls.find(p=>p.head?.ref===plan.branch);
  return pull?{number:pull.number,url:pull.html_url,state:pull.state,merged:Boolean(pull.merged_at),branchVerified:false}:null;
}
