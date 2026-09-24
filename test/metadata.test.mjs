import test from 'node:test';
import assert from 'node:assert/strict';
import {extractMeta} from '../lib/metadata.mjs';

test('HTML metadata respects comments, scripts, attribute order and unquoted values',async()=>{
 const result=await extractMeta(`<html><head><title>A &amp; B</title><!-- <meta name=robots content=noindex> --><script>const fake='<meta name=robots content=noindex>';</script><meta content="nofollow" name=robots><script type="application/ld+json">{}</script></head></html>`);
 assert.equal(result.complete,true);assert.equal(result.title,'A & B');
 assert.deepEqual(result.metaRobots,[{name:'robots',content:'nofollow'}]);assert.equal(result.jsonLd,1);
});
test('malformed HTML does not block the server event loop',async()=>{
 let ticked=false;
 const timer=setTimeout(()=>{ticked=true;},20);
 const start=Date.now();
 const result=await extractMeta('<meta '.repeat(100000));
 clearTimeout(timer);
 assert.equal(ticked,true);assert.ok(Date.now()-start<3000);
 assert.equal(typeof result.complete,'boolean');
});
test('parser timeout and input budgets return unknown, not clean metadata',async()=>{
 for(const result of [await extractMeta('<title>hello</title>',{timeoutMs:1}),await extractMeta('a'.repeat(1500001)),await extractMeta('<meta name=robots content=noindex>'.repeat(101))]){
  assert.equal(result.complete,false);assert.equal(result.jsonLd,null);assert.ok(result.error);
 }
});
