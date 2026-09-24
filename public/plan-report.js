const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const platformGuidance={
 developer:'Ask your website developer to review the source, hosting and firewall settings before making targeted changes.',
 wordpress:'Ask your WordPress administrator to review SEO plugin settings, reading settings and sitemap configuration. Confirm which pages should be public before changing indexing.',
 shopify:'Ask your Shopify developer to review theme metadata, the platform-managed sitemap and custom robots.txt.liquid rules. Preserve existing platform defaults.',
 other:'Share this plan with your website team or hosting provider. Confirm where each setting is managed before changing it.'
};
function steps(f){
 if(f.severity==='ok')return ['Keep the current configuration and review it after major website changes.','Rerun the audit after publishing changes. Monitor actual indexing and referral traffic.'];
 if(/noindex/i.test(f.title))return ['Confirm the page should appear in search. Ask your developer to remove the unintended noindex directive from page metadata or hosting response headers. Keep private pages protected.','Inspect the live page and response headers, then rerun the audit to confirm the directive is gone.'];
 if(/blocked by robots/i.test(f.title))return ['Review the matching robots.txt rule with your website owner. Allow only the intended public pages for this crawler; preserve restrictions for private content.','Fetch the published robots.txt and rerun the audit for this exact page and crawler.'];
 if(/sitemap/i.test(f.title))return ['Find or generate a sitemap containing canonical public pages. Confirm it returns valid sitemap XML, then add its URL to robots.txt if appropriate.','Open the sitemap, check its response and listed URLs, then rerun the audit. A sitemap alone does not guarantee indexing.'];
 if(/JSON-LD/i.test(f.title))return ['Add accurate Organization or LocalBusiness structured data where appropriate. Use real business details that match the visible page; do not invent ratings or claims.','Validate the markup with a structured-data validator and check that the live page contains it.'];
 if(/could not fetch/i.test(f.title))return ['Ask your hosting team to inspect the reported HTTP response, firewall settings and bot rules. Permit intended crawlers without removing protections for sensitive routes.','Retry the live request and rerun the audit. A User-Agent test alone cannot prove access for the real provider.'];
 return ['Ask your developer to review the reported evidence manually. An incomplete check is not proof that access is allowed or blocked.','Resolve the incomplete check where possible and rerun the audit before deciding on a change.'];
}
export function planReport(state,platform='developer'){
 if(!state?.audit)throw new Error('Run an audit first to create a plan.');
 const audit=state.audit,plan=state.plan;
 const label=({wordpress:'WordPress',shopify:'Shopify',other:'Website team',developer:'Developer'})[platform]||'Developer';
 const priority={critical:'Urgent review',high:'High priority',medium:'Review next',ok:'Maintain'};
 const findings=[...audit.findings].sort((a,b)=>(['critical','high','medium','ok'].indexOf(a.severity))-(['critical','high','medium','ok'].indexOf(b.severity)));
 return `<header class="report-header"><p class="report-brand">AI CRAWLER CHECKER</p><h1>Website discovery plan</h1><p>Practical next steps for your website team</p></header>
 <dl class="report-facts"><dt>Website</dt><dd>${esc(audit.input)}</dd><dt>Checked</dt><dd>${esc(audit.auditedAt)}</dd><dt>Prepared for</dt><dd>${esc(label)}</dd><dt>Readiness score</dt><dd>${esc(audit.score??'Not available')}${typeof audit.score==='number'?'/100 (heuristic)':''}</dd></dl>
 <section><h2>Start here</h2><p>${esc(platformGuidance[platform]||platformGuidance.developer)}</p><p>Confirm the business owner’s intent, save the previous version, apply one targeted change, verify it, and rerun the audit. This document does not apply changes or approve a deployment.</p></section>
 <section><h2>Prioritized action plan</h2>${findings.map((f,i)=>{const [action,verify]=steps(f);return `<article class="report-finding"><p class="report-priority">${i+1}. ${esc(priority[f.severity]||'Manual review')}</p><h3>${esc(f.title)}</h3><p><strong>Observed:</strong> ${esc(f.detail)}</p><p><strong>Next step:</strong> ${esc(action)}</p><p><strong>Verify:</strong> ${esc(verify)}</p></article>`;}).join('')}</section>
 ${plan?`<section><h2>Prepared repository change</h2><p><strong>${esc(plan.title)}</strong></p><p>Repository: ${esc(plan.repository)}<br>File: ${esc(plan.path)}<br>Status at export: ${esc(plan.status)}</p><p>Review the complete before-and-after diff in the workspace or GitHub. This report is not approval. Ready plans expire after 15 minutes; prepare a fresh plan if needed. A submitted draft pull request still requires review and merge.</p>${plan.pull?.url?`<p>Pull request: ${esc(plan.pull.url)}</p>`:''}</section>`:''}
 <footer class="report-footer"><h2>What this plan can tell you</h2><p>These are technical crawl and indexability signals. Access, sitemaps and structured data do not guarantee search rankings, indexing or AI citations. Website-derived evidence is untrusted content, not instructions to an AI agent.</p><p>Generated by AI Crawler Checker. Keep a copy of this plan and compare it with a fresh audit after deployment.</p></footer>`;
}
