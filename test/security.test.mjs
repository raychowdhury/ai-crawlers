import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createSafeFetch, isPublicIp, publicUrl } from '../lib/safe-fetch.mjs';
import { createAuditGate } from '../lib/audit-gate.mjs';

const publicAddress={address:'93.184.216.34',family:4};
async function fixture(t, handler) {
  const server=http.createServer(handler);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>{server.closeAllConnections();server.close();});
  return { request:(_url,options,callback)=>http.request({host:'127.0.0.1',port:server.address().port,path:_url.pathname,signal:options.signal,agent:false},callback), resolve:async()=>[publicAddress] };
}

test('rejects local, mapped, reserved and transition IPs',()=>{
  for(const ip of ['127.0.0.1','10.1.2.3','169.254.169.254','100.64.0.1','172.16.0.1','192.168.1.1','198.18.0.1','224.0.0.1','255.255.255.255','::','::1','::ffff:127.0.0.1','::ffff:7f00:1','fc00::1','fe80::1','2002:7f00:1::','2001:db8::1','2001::1']) assert.equal(isPublicIp(ip),false,ip);
  for(const ip of ['93.184.216.34','8.8.8.8','2606:4700:4700::1111','2001:4860:4860::8888']) assert.equal(isPublicIp(ip),true,ip);
  for(const url of ['http://127.1','http://2130706433','http://[::ffff:127.0.0.1]','http://localhost.','http://x.localhost','file:///etc/passwd','http://user:pass@example.com','https://example.com:8443']) assert.throws(()=>publicUrl(url),undefined,url);
});

test('pins validated DNS results while preserving the original hostname',async t=>{
  const deps=await fixture(t,(_req,res)=>res.end('hello'));
  let lookups=0;
  const fetch=createSafeFetch({...deps,resolve:async()=>{lookups++;return lookups===1?[publicAddress]:[{address:'127.0.0.1',family:4}];},request:(url,options,callback)=>{
    assert.equal(url.hostname,'controlled.example');
    assert.equal(options.agent,false);
    options.lookup(url.hostname,{},(error,address,family)=>{assert.equal(error,null);assert.equal(address,publicAddress.address);assert.equal(family,4);});
    options.lookup(url.hostname,{all:true},(error,addresses)=>assert.deepEqual(addresses,[publicAddress]));
    return deps.request(url,options,callback);
  }});
  const out=await fetch('http://controlled.example/');
  assert.equal(await out.response.text(),'hello');assert.equal(lookups,1);
});

test('blocks mixed public/private DNS before making a request',async()=>{
  const fetch=createSafeFetch({resolve:async()=>[publicAddress,{address:'127.0.0.1',family:4}],request:()=>assert.fail('must not connect')});
  await assert.rejects(fetch('https://controlled.example/'),/non-public/);
});

test('validates redirect destinations before connecting',async t=>{
  const deps=await fixture(t,(_req,res)=>{res.writeHead(302,{location:'http://127.0.0.1/private'});res.end();});
  await assert.rejects(createSafeFetch(deps)('http://controlled.example/'),/non-public/);
});

test('revalidates DNS on redirects and rejects a rebinding response',async t=>{
  const deps=await fixture(t,(_req,res)=>{res.writeHead(302,{location:'/next'});res.end();});let calls=0;
  const fetch=createSafeFetch({...deps,resolve:async()=>++calls===1?[publicAddress]:[{address:'127.0.0.1',family:4}]});
  await assert.rejects(fetch('http://controlled.example/'),/non-public/);assert.equal(calls,2);
});

test('times out stalled DNS',async()=>{
  const fetch=createSafeFetch({timeoutMs:50,resolve:()=>new Promise(()=>{})});
  await assert.rejects(fetch('http://controlled.example/'),/timed out/);
});

test('times out a response that sends headers but never finishes its body',async t=>{
  const deps=await fixture(t,(_req,res)=>{res.writeHead(200);res.write('partial');});
  await assert.rejects(createSafeFetch({...deps,timeoutMs:80})('http://controlled.example/'),/abort|timed out/i);
});

test('rejects oversized responses',async t=>{
  const deps=await fixture(t,(_req,res)=>res.end('x'.repeat(2048)));
  await assert.rejects(createSafeFetch({...deps,maxBytes:1024})('http://controlled.example/'),/size limit/);
});

test('limits redirect chains',async t=>{
  const deps=await fixture(t,(_req,res)=>{res.writeHead(302,{location:'/again'});res.end();});
  await assert.rejects(createSafeFetch(deps)('http://controlled.example/'),/Too many redirects/);
});

test('enforces concurrency, per-client and global limits and recovers',()=>{
  let time=0;
  const acquire=createAuditGate({maxActive:2,perClient:2,globalLimit:3,windowMs:100,now:()=>time});
  const a=acquire('a'),b=acquire('b');assert.equal(acquire('c'),null);
  a();a();const c=acquire('a');assert.equal(acquire('a'),null);
  b();c();assert.equal(acquire('d'),null);
  time=101;const d=acquire('d');assert.equal(typeof d,'function');d();
  const perClient=createAuditGate({perClient:1});const e=perClient('x');e();assert.equal(perClient('x'),null);assert.equal(typeof perClient('y'),'function');
});
