const $=s=>document.querySelector(s); const form=$('#form'), results=$('#results'), loading=$('#loading');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const status=(ok,na=false)=>ok===null?'<span class="status warn">● Unknown</span>':na?'<span class="status warn">N/A</span>':ok?'<span class="status ok">● Allowed</span>':'<span class="status bad">● Blocked</span>';
let currentReport = null;
form.addEventListener('submit', async e => {
 e.preventDefault();
 const button = form.querySelector('button');
 if (button.disabled) return;
 let url = $('#url').value.trim();
 if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = 'https://' + url;
 $('#url').value = url;
 button.disabled = true;
 button.textContent = 'Auditing…';
 form.setAttribute('aria-busy', 'true');
 results.classList.add('hidden');
 loading.classList.remove('hidden');
 try {
  const r = await fetch('/api/check', {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({url})});
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || 'Audit failed');
  currentReport = d;
  render(d);
 } catch (err) {
  currentReport = null;
  results.innerHTML = `<div class="error" role="alert"><strong>Unable to complete the audit</strong><p>${esc(err.message)}</p><small>Check the website address and try again.</small></div>`;
  results.classList.remove('hidden');
 } finally {
  loading.classList.add('hidden');
  button.disabled = false;
  button.innerHTML = 'Run audit <span>→</span>';
  form.removeAttribute('aria-busy');
 }
});
results.addEventListener('click', e => {
 if (!e.target.closest('#download-report') || !currentReport) return;
 const blob = new Blob([JSON.stringify(currentReport, null, 2)], {type:'application/json'});
 const url = URL.createObjectURL(blob);
 const link = document.createElement('a');
 link.href = url;
 link.download = `crawler-audit-${new URL(currentReport.input).hostname}.json`;
 link.click();
 setTimeout(() => URL.revokeObjectURL(url), 1000);
});
function render(d){const scoreClass=d.score>=80?'ok':d.score>=60?'warn':'bad';
 const bots=d.bots.map(b=>`<div class="bot"><div class="bot-name"><strong>${esc(b.name)}</strong><small>${esc(b.company)} · ${esc(b.kind)}</small><small class="rule">${esc(b.robotsReason)}</small></div>${status(b.robotsAllowed)}<span class="http status ${b.httpAccessible===true?'ok':b.httpAccessible===false?'bad':'warn'}">${b.httpAccessible===null?'Policy only':b.httpAccessible?`HTTP ${b.httpStatus}`:b.httpStatus?`HTTP ${b.httpStatus}`:'Fetch failed'}</span></div>`).join('');
 const findings=d.findings.map(f=>`<div class="finding ${f.severity==='ok'?'ok':f.severity==='medium'?'warn':'bad'}"><strong><span class="dot"></span>${esc(f.title)}</strong><p>${esc(f.detail)}</p></div>`).join('');
 const metaNo=d.page.noindex; const siteOk=d.sitemaps.some(s=>s.ok);
 results.innerHTML=`<div class="report-heading"><div><p class="eyebrow">AUDIT REPORT</p><span>Checked ${esc(new Date(d.auditedAt).toLocaleString())}</span></div><button id="download-report" class="secondary">Download report ↓</button></div><div class="summary"><div class="score"><div class="num ${scoreClass}">${d.score}<span>/100</span></div><small>AI crawl readiness</small></div><div class="overview card"><h2>${esc(d.page.title||new URL(d.input).hostname)}</h2><div class="url">${esc(d.page.finalUrl||d.input)}</div><div class="pills"><span class="pill">Page ${d.page.status||'—'}</span><span class="pill ${d.robots.status===200?'ok':'warn'}">robots.txt ${d.robots.status||'—'}</span><span class="pill ${metaNo?'bad':d.page.metadataComplete===false?'warn':d.page.status>=200&&d.page.status<300?'ok':'warn'}">${metaNo?'noindex detected':d.page.metadataComplete===false?'Metadata unknown':d.page.status>=200&&d.page.status<300?'No noindex detected':'Indexability unknown'}</span><span class="pill ${siteOk?'ok':'warn'}">${siteOk?'Sitemap found':'No sitemap'}</span><span class="pill ${d.page.jsonLdBlocks?'ok':'warn'}">${d.page.jsonLdBlocks===null?'JSON-LD unknown':`${d.page.jsonLdBlocks} JSON-LD block${d.page.jsonLdBlocks===1?'':'s'}`}</span></div></div></div>
 <div class="fix-next"><div><p class="eyebrow">YOUR NEXT STEP</p><h2>Turn these findings into a fix plan.</h2><p>Get a practical plan, save a PDF, or review a supported GitHub fix.</p><small>You review and approve repository changes before they are submitted.</small></div><a class="fix-link" href="/workspace?url=${encodeURIComponent(d.input)}">${d.findings.some(f=>f.severity!=='ok')?'Fix these issues':'View my action plan'} <span aria-hidden="true">→</span></a></div>
 <div class="grid"><div><div class="card"><h3>Crawler access</h3><div class="table-labels"><span>Crawler</span><span>robots.txt</span><span>Live request</span></div>${bots}</div></div><div><div class="card"><h3>Priority findings</h3>${findings}</div><div class="card"><h3>Technical details</h3><div class="detail-row"><span>Redirects</span><strong>${d.page.redirects}</strong></div><div class="detail-row"><span>X-Robots-Tag</span><code>${esc(d.page.xRobotsTag||'none')}</code></div><div class="detail-row"><span>Meta robots</span><code>${esc(d.page.metaRobots.map(x=>x.content).join(' | ')||'none')}</code></div><div class="detail-row"><span>Sitemap URLs</span><strong>${d.sitemaps.filter(s=>s.ok).length}/${d.sitemaps.length}</strong></div></div></div></div><p class="report-note">${esc(d.disclaimer)} The score is a heuristic, not a prediction of search visibility.</p>`;
 results.classList.remove('hidden'); results.scrollIntoView({behavior:'smooth',block:'start'});
}
