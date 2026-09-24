import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {parseRobots,robotsDecision,matchRobotsRule} from '../lib/robots.mjs';

test('prefix, wildcard, anchors and literal regex characters retain their meaning',()=>{
 for(const [pattern,path,expected] of [['/','/about',true],['/private','/private/page',true],['/private$','/private/page',false],['/private$','/private',true],['/*.pdf$','/a.pdf',true],['/*.pdf$','/a.pdf?x',false],['/*/a','/x/y/a',true],['/a?b','/axb',false],['/a?b','/a?b',true],['','/',false],['/a**b$','/ab',true]])assert.equal(matchRobotsRule(pattern,path),expected,pattern);
});
test('specific agents, merged groups, longest match and allow ties work',()=>{
 const parsed=parseRobots('User-agent: *\nDisallow: /\nUser-agent: GPTBot\nDisallow: /private\nAllow: /private/open\nUser-agent: GPTBot\nAllow: /private\n');
 assert.equal(robotsDecision(parsed,'bingbot','/').allowed,false);
 assert.equal(robotsDecision(parsed,'GPTBot','/private').allowed,true);
 assert.equal(robotsDecision(parsed,'GPTBot','/private/open').allowed,true);
});
test('adversarial wildcard rule finishes under an isolated process deadline',()=>{
 const result=spawnSync(process.execPath,['--input-type=module','-e',`import {matchRobotsRule} from './lib/robots.mjs'; if(matchRobotsRule('/'+'*a'.repeat(30)+'z','/'+'a'.repeat(80)+'b')!==false)process.exit(1);`],{timeout:1500,encoding:'utf8'});
 assert.equal(result.error,undefined);assert.equal(result.status,0);
});
test('pattern, parsing and aggregate work limits return unknown rather than allowed',()=>{
 for(const text of ['x'.repeat(500001),'\n'.repeat(5001),'User-agent: *\nDisallow: /'+'x'.repeat(1025),'User-agent: *\n'+'Disallow: /a\n'.repeat(1001)])assert.equal(robotsDecision(parseRobots(text),'GPTBot').allowed,null);
 const parsed=parseRobots('User-agent: *\n'+'Disallow: /abc*xyz\n'.repeat(1000));
 assert.equal(robotsDecision(parsed,'GPTBot','/'+'a'.repeat(4095)).allowed,null);
 assert.equal(robotsDecision({groups:[],error:'Fetch failed'},'GPTBot').allowed,null);
});
