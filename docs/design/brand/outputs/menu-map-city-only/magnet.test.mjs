import {test} from 'node:test';
import assert from 'node:assert/strict';
import {findMagnet, joinGroups} from './magnet.mjs';

const setup=()=>{
  const left={id:'left',dx:30,dy:20,members:new Set(['one'])};
  const right={id:'right',dx:35,dy:25,members:new Set(['two'])};
  const actors=new Map([['one',{group:left}],['two',{group:right}]]);
  return {left,right,actors,groups:new Set([left,right]),joints:[{a:'one',b:'two'}]};
};
test('only the correct relative side inside the capture radius attracts',()=>{
  const {left,right,actors,joints}=setup();
  assert.equal(findMagnet(left,actors,joints,10)?.other,right);
  assert.equal(findMagnet(left,actors,[],10),undefined);
  right.dx=-35;
  assert.equal(findMagnet(left,actors,joints,10),undefined);
  right.dx=30;right.dy=31;
  assert.equal(findMagnet(left,actors,joints,10),undefined);
});
test('joining retains the exact source offset and all member identities',()=>{
  const {left,right,actors,groups}=setup();
  joinGroups(left,right,actors,groups);
  assert.deepEqual([left.dx,left.dy],[35,25]);
  assert.equal(actors.get('one').group,actors.get('two').group);
  assert.deepEqual([...left.members],['one','two']);
  assert.equal(groups.size,1);
  assert.equal(findMagnet(left,actors,[{a:'one',b:'two'}],10),undefined);
});
