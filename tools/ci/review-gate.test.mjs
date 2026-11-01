import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { evaluateAgentReview, evaluatePrReviewGate } from './review-gate.mjs';

const repo = 'vokhandcrafts/KUDY';
const prNumber = 956;
const headSha = 'a'.repeat(40);
const sourcePr = `https://github.com/${repo}/pull/${prNumber}`;
const voka = (findings = []) => ({ agent: 'Voka', headSha, findings });
const judge = (findings = []) => ({ agent: 'Judge', headSha, findings });
const finding = (key, severity, issue) => ({ key, severity, ...(issue ? { issue } : {}) });
const issue = (number, labels) => ({
  url: `https://github.com/${repo}/issues/${number}`,
  sourcePr,
  labels,
});
const run = (reviews) => evaluatePrReviewGate({ repo, prNumber, headSha, reviews });

test('no unresolved findings passes with both agents on the current HEAD', () => {
  const result = run([voka(), judge()]);
  assert.equal(result.verdict, 'PASS');
  assert.equal(result.tracking, 'COMPLETE');
  assert.equal(result.reviewWorkflowReady, true);
});

test('up to two medium findings and any number of low findings pass by severity', () => {
  const findings = [finding('m1', 'MEDIUM'), finding('m2', 'MEDIUM')];
  for (let i = 0; i < 20; i += 1) findings.push(finding(`low-${i}`, 'LOW'));
  const result = run([voka(findings), judge()]);
  assert.equal(result.verdict, 'PASS');
  assert.equal(result.counts.MEDIUM, 2);
  assert.equal(result.counts.LOW, 20);
  assert.equal(result.tracking, 'INCOMPLETE');
  assert.equal(result.reviewWorkflowReady, false);
});

test('three distinct medium findings block, even across separate reviewers', () => {
  const result = run([
    voka([finding('a', 'MEDIUM'), finding('b', 'MEDIUM')]),
    judge([finding('c', 'MEDIUM')]),
  ]);
  assert.equal(result.agentVerdicts.Voka, 'PASS');
  assert.equal(result.agentVerdicts.Judge, 'PASS');
  assert.equal(result.verdict, 'FAIL');
  assert.equal(result.counts.MEDIUM, 3);
});

test('one high or one critical always blocks', () => {
  for (const severity of ['HIGH', 'CRITICAL']) {
    assert.equal(run([voka([finding('one', severity)]), judge()]).verdict, 'FAIL');
    assert.equal(run([voka(), judge([finding('one', severity)])]).verdict, 'FAIL');
  }
});

test('the same root cause from both reviewers is counted once with higher severity', () => {
  const result = run([
    voka([finding('shared', 'MEDIUM'), finding('only-voka', 'MEDIUM')]),
    judge([finding('shared', 'LOW')]),
  ]);
  assert.equal(result.verdict, 'PASS');
  assert.equal(result.counts.MEDIUM, 2);
  assert.equal(result.counts.LOW, 0);
});

test('stale or missing independent review can never produce a green gate', () => {
  assert.equal(run([voka()]).verdict, 'PENDING');
  assert.equal(run([voka(), { ...judge(), headSha: 'b'.repeat(40) }]).verdict, 'PENDING');
});

test('an unresolved finding needs a real labeled Issue tied to the original PR', () => {
  const missing = run([voka([finding('debt', 'LOW')]), judge()]);
  assert.equal(missing.verdict, 'PASS');
  assert.deepEqual(missing.missingIssueKeys, ['debt']);
  assert.equal(missing.reviewWorkflowReady, false);

  const wrongLabel = run([
    voka([finding('debt', 'LOW', issue(1001, ['judge-finding']))]),
    judge(),
  ]);
  assert.deepEqual(wrongLabel.missingIssueKeys, ['debt']);

  const wrongPr = {
    ...issue(1001, ['voka-finding']),
    sourcePr: `https://github.com/${repo}/pull/999`,
  };
  assert.equal(run([voka([finding('debt', 'LOW', wrongPr)]), judge()]).tracking, 'INCOMPLETE');

  const correct = run([
    voka([finding('debt', 'LOW', issue(1001, ['voka-finding']))]),
    judge(),
  ]);
  assert.equal(correct.tracking, 'COMPLETE');
  assert.equal(correct.reviewWorkflowReady, true);
});

test('a shared finding needs both Voka and Judge labels on its single Issue', () => {
  const oneLabel = run([
    voka([finding('shared', 'MEDIUM', issue(2001, ['voka-finding']))]),
    judge([finding('shared', 'MEDIUM', issue(2001, ['voka-finding']))]),
  ]);
  assert.equal(oneLabel.verdict, 'PASS');
  assert.deepEqual(oneLabel.missingIssueKeys, ['shared']);

  const twoLabels = issue(2001, ['voka-finding', 'judge-finding']);
  const both = run([
    voka([finding('shared', 'MEDIUM', twoLabels)]),
    judge([finding('shared', 'MEDIUM', twoLabels)]),
  ]);
  assert.equal(both.tracking, 'COMPLETE');
  assert.equal(both.counts.MEDIUM, 1);
});

test('resolved debt does not block and cannot require a fresh Issue', () => {
  const result = run([
    voka([{ ...finding('fixed', 'HIGH'), resolved: true }]),
    judge(),
  ]);
  assert.equal(result.verdict, 'PASS');
  assert.equal(result.tracking, 'COMPLETE');
});

test('invalid severity, empty root key and duplicate reviewer reports are rejected', () => {
  assert.throws(() => evaluateAgentReview([finding('bad', 'BLOCKER')]), /unknown severity/);
  assert.throws(() => evaluateAgentReview([finding('', 'LOW')]), /non-empty/);
  assert.throws(() => run([voka(), voka(), judge()]), /at most one report/);
});

test('the mandatory docs keep the current review contract visible to agents', () => {
  const policy = readFileSync('docs/agent-rules/review-gate.md', 'utf8');
  const codeReview = readFileSync('docs/agent-rules/code-review.md', 'utf8');
  const workflow = readFileSync('docs/agent-rules/issue-workflow.md', 'utf8');
  assert.match(policy, /At least 3 distinct MEDIUM/);
  assert.match(policy, /At least 1 HIGH/);
  assert.match(policy, /At least 1 CRITICAL/);
  assert.match(policy, /voka-finding/);
  assert.match(policy, /judge-finding/);
  assert.match(policy, /Source PR:/);
  assert.match(codeReview, /review-gate\.md/);
  assert.match(workflow, /review-gate\.md/);
});
