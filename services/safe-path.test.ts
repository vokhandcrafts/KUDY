// Direct acceptance suite for the shared safe-unit idiom (issue #338): the
// checks moved out of contentRepo/inventory.ts must keep every rejection, and
// the node-free absoluteness rule must hold on every platform — a drive
// absolute «C:/…» path is never a safe rel path. Each negative fixture
// isolates exactly one violation (implementation-rules 14).
import assert from 'node:assert/strict';
import test from 'node:test';

import { isSafeRel, isSafeSegment } from './safe-path.ts';

test('isSafeSegment accepts plain single segments and rejects the documented violations', () => {
  assert.equal(isSafeSegment('base'), true);
  assert.equal(isSafeSegment('grodno-2024'), true);
  assert.equal(isSafeSegment(''), false, 'empty');
  assert.equal(isSafeSegment(null), false, 'not a string');
  assert.equal(isSafeSegment(7), false, 'not a string');
  assert.equal(isSafeSegment('.'), false, 'dot');
  assert.equal(isSafeSegment('..'), false, 'traversal');
  assert.equal(isSafeSegment('a/b'), false, 'posix separator');
  assert.equal(isSafeSegment('a\\b'), false, 'windows separator');
  assert.equal(isSafeSegment('a\0b'), false, 'NUL');
  assert.equal(isSafeSegment('/abs'), false, 'posix absolute');
});

test('isSafeRel accepts multi-segment rel paths and rejects the documented violations', () => {
  assert.equal(isSafeRel('be/base/stops.json'), true);
  assert.equal(isSafeRel('be/base/audio/01.mp3'), true);
  assert.equal(isSafeRel(''), false, 'empty');
  assert.equal(isSafeRel(null), false, 'not a string');
  assert.equal(isSafeRel('..'), false, 'traversal');
  assert.equal(isSafeRel('../victim.txt'), false, 'leading traversal');
  assert.equal(isSafeRel('a/../b'), false, 'inner traversal');
  assert.equal(isSafeRel('a//b'), false, 'empty segment');
  assert.equal(isSafeRel('a\\b'), false, 'windows separator');
  assert.equal(isSafeRel('a\0b'), false, 'NUL');
  assert.equal(isSafeRel('/abs/path'), false, 'posix absolute');
});

test('isSafeRel rejects drive-absolute paths on every platform (issue #338)', () => {
  assert.equal(isSafeRel('C:/victim.txt'), false, 'drive absolute');
  assert.equal(isSafeSegment('C:x'), true, 'drive-relative without a separator stays a safe segment');
});
