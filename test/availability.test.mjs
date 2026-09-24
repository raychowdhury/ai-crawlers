import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import net from 'node:net';

async function start(t,env={}){
 const child=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'0',...env},stdio:['ignore','pipe','pipe']});
 t.after(()=>child.kill());let errors='';child.stderr.on('data',c=>errors+=c);
 const address=await new Promise((ok,fail)=>{child.stdout.once('data',c=>ok(String(c).trim().match(/http:\/\/localhost:(\d+)/)?.[1]));child.once('exit',()=>fail(new Error(errors)));child.once('error',fail);});
 return {child,address};
}
async function raw(port,target){
 return new Promise((ok,fail)=>{
  const socket=net.connect(Number(port),'127.0.0.1',()=>socket.write(`GET ${target} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`));let response='';
  socket.setTimeout(1500,()=>socket.destroy(new Error('Response timeout')));socket.on('data',c=>response+=c);socket.on('end',()=>ok(response));socket.on('error',fail);
 });
}
test('malformed targets return 400 and the same server keeps serving',async t=>{
 const {child,address}=await start(t);
 for(const target of ['//[','//attacker.example/path','/\\attacker.example/path']){
  assert.match(await raw(address,target),/^HTTP\/1.1 400/);
  assert.equal(child.exitCode,null);assert.equal((await fetch(`http://localhost:${address}/`)).status,200);
 }
});
test('normalized paths cannot bypass the production workspace gate',async t=>{
 const {address}=await start(t,{NODE_ENV:'production',ENABLE_FIX_WORKSPACE:'false'});
 assert.match(await raw(address,'/other/../workspace'),/^HTTP\/1.1 404/);
});

test('browser security headers cover pages, API errors and malformed targets',async t=>{
 const {address}=await start(t);
 for(const path of ['/','/missing','/api/check']){
  const response=await fetch(`http://localhost:${address}${path}`);
  assert.match(response.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  assert.match(response.headers.get('content-security-policy'),/script-src 'self'/);
  assert.equal(response.headers.get('x-content-type-options'),'nosniff');
  assert.equal(response.headers.get('x-frame-options'),'DENY');
  assert.equal(response.headers.get('referrer-policy'),'no-referrer');
  assert.equal(response.headers.get('strict-transport-security'),'max-age=31536000');
 }
 assert.match(await raw(address,'//['),/content-security-policy:/i);
});
