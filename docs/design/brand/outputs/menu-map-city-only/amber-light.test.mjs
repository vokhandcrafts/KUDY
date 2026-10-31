import {test} from 'node:test';
import assert from 'node:assert/strict';
import {amberMotion,lightThreads} from './amber-light.mjs';
const timing={chargeMs:650,crestMs:350,revealMs:850,settleMs:450};
test('the amber overlay and filaments are off before and after the bounded effect',()=>{
  for(const ms of [-1,2300,9000]){const f=amberMotion(ms,timing);assert.equal(f.light,0);assert.equal(f.veil,0);assert.ok(lightThreads(f.progress,f.light).every(p=>p.opacity===0));}
  assert.equal(amberMotion(-1,timing).radius,0);assert.equal(amberMotion(2300,timing).radius,1000);
});
test('warm overlay fades independently while light values stay finite',()=>{
  assert.ok(amberMotion(325,timing).veil>0);
  assert.equal(amberMotion(800,timing).veil,.94);
  assert.ok(amberMotion(1400,timing).veil<amberMotion(1100,timing).veil);
  for(let ms=0;ms<=2300;ms+=10){const f=amberMotion(ms,timing);for(const v of [f.light,f.veil,f.progress])assert.ok(Number.isFinite(v)&&v>=0&&v<=1);}
});
test('three thin threads drift slowly and disappear without a loop',()=>{
  const a=lightThreads(.4,1),b=lightThreads(.5,1);assert.equal(a.length,3);
  a.forEach((p,i)=>{assert.ok(p.width<=3);assert.ok(Math.abs(p.x-b[i].x)<3);assert.ok(Math.abs(p.y-b[i].y)<3);assert.ok(Math.abs(p.offset-b[i].offset)<=30);assert.ok(p.opacity>0&&p.opacity<=1);assert.ok(!p.d.includes('NaN'));});
});
