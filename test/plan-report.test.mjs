import test from 'node:test';
import assert from 'node:assert/strict';
import {parse} from 'parse5';
import {planReport} from '../public/plan-report.js';
test('PDF view escapes website evidence and never includes session credentials',()=>{
 const injection='<img src=x onerror=alert(1)>';
 const state={csrf:'CSRF_SECRET',connection:{token:'TOKEN_SECRET'},audit:{input:'https://example.com/',auditedAt:'2026-09-24',score:75,findings:[{severity:'medium',title:injection,detail:'</p><script>alert(1)</script>'}]}};
 const html=planReport(state);
 assert.ok(!html.includes('CSRF_SECRET')&&!html.includes('TOKEN_SECRET'));
 const stack=[parse(html)];
 while(stack.length){const node=stack.pop();assert.ok(!['script','img','iframe'].includes(node.tagName));stack.push(...(node.childNodes||[]));}
 assert.match(html,/&lt;img/);assert.match(html,/untrusted content/);
});
test('plan export provides ordered actions, verification and truthful draft status',()=>{
 const html=planReport({audit:{input:'https://example.com',auditedAt:'2026-09-24',score:60,findings:[{severity:'medium',title:'No working sitemap found',detail:'Missing'},{severity:'critical',title:'Page is marked noindex',detail:'Found'}]},plan:{title:'Remove noindex',repository:'owner/site',path:'index.html',status:'ready'}},'wordpress');
 assert.ok(html.indexOf('Page is marked noindex')<html.indexOf('No working sitemap found'));
 assert.match(html,/WordPress administrator/);assert.match(html,/Next step:/);assert.match(html,/Verify:/);
 assert.match(html,/not approval/);assert.match(html,/expire after 15 minutes/);
 assert.throws(()=>planReport({}),/Run an audit/);
});

test('PDF generator rejects oversized reports before starting a worker',async()=>{
 const {createPlanPdf}=await import('../lib/plan-pdf.mjs');
 assert.throws(()=>createPlanPdf({audit:{input:'https://example.com',findings:[{title:'test',detail:'x'.repeat(128000)}]}}),/too large/);
});
