import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CityPuzzle} from './model.ts';
import {nativeLayout} from '../native-layout.ts';
import {joinGroups} from '../magnet.mjs';
const puzzle=()=>new CityPuzzle(360,()=>.5);
const anchor=(m,id)=>{const p=m.pieces.get(id),a=nativeLayout.pieces.find(p=>p.id===id);return {x:125+a.x+p.group.dx+a.width/2,y:320+a.y+p.group.dy+a.height/2};};
test('idle time, holding and release never magnetize nearby pieces',()=>{
  const m=puzzle(),a=m.pieces.get('nearby'),b=m.pieces.get('guides');
  b.group.dx=a.group.dx+2;b.group.dy=a.group.dy+2;
  m.advance(100000);assert.equal(m.groups.size,5);
  m.completeNow();assert.equal(m.phase,'scattered');assert.equal(m.groups.size,5);
  const point=anchor(m,'guides');assert.equal(m.begin(point,100000)?.id,'guides');
  m.hold(100400);assert.equal(m.move(point,100500).kind,'none');
  assert.equal(m.release(100600).kind,'none');assert.equal(m.groups.size,5);
});
test('only real held movement can snap and never emits a section press',()=>{
  const m=puzzle(),a=m.pieces.get('nearby'),b=m.pieces.get('guides');
  b.group.dx=a.group.dx+20;b.group.dy=a.group.dy;
  const point=anchor(m,'guides');m.begin(point,0);m.hold(301);
  assert.equal(m.move({x:point.x-1,y:point.y},320).kind,'snap');
  assert.equal(m.groups.size,4);assert.equal(a.group,b.group);
  assert.equal(m.release(350).kind,'none');
});
test('early movement cancels tap; cancellation restores a group',()=>{
  const m=puzzle(),p=anchor(m,'guides'),before={...m.pieces.get('guides').group};
  m.begin(p,0);m.move({x:p.x+100,y:p.y},20);assert.equal(m.release(50).kind,'none');
  m.begin(p,100);m.hold(450);m.move({x:p.x+120,y:p.y},470);m.cancel();
  const g=m.pieces.get('guides').group;assert.equal(g.dx,before.dx);assert.equal(g.dy,before.dy);
});
test('tap returns a stable menu ID; a revealed scene point has no section ID',()=>{
  const m=puzzle();for(const p of nativeLayout.pieces){const pt=anchor(m,p.id);m.begin(pt,0);assert.deepEqual(m.release(50),{kind:'select',id:p.id});}
  const first=[...m.groups][0];for(const group of [...m.groups].slice(1))joinGroups(first,group,m.pieces,m.groups);
  m.completeNow();const point={x:125+650,y:320+210};
  assert.equal(m.begin(point,0).passive,true);assert.equal(m.release(50).kind,'passive');
});
test('only the final user snap starts transformation, which can finish safely',()=>{
  const m=puzzle(),first=m.pieces.get('nearby').group;
  for(const group of [...m.groups])if(!group.members.has('kudy')&&group!==first)joinGroups(first,group,m.pieces,m.groups);
  const last=m.pieces.get('kudy');last.group.dx=first.dx+20;last.group.dy=first.dy;
  const p=anchor(m,'kudy');m.begin(p,100);m.hold(401);
  assert.equal(m.move({x:p.x-1,y:p.y},420).complete,true);
  for(const [offset,phase] of [[0,'assembling'],[410,'charging'],[1100,'crest'],[1450,'revealing'],[2300,'settling'],[2900,'complete']]){m.advance(420+offset);assert.equal(m.phase,phase);}
  assert.equal(m.radius,1000);assert.equal(m.light,0);
  assert.deepEqual(m.position('guides'),{x:125+469,y:320+361});
});
