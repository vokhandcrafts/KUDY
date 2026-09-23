import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCampaign } from './campaign.mjs';
import { campaignYaml } from './testkit.mjs';

// One assert per case: the campaign must be rejected and at least one
// diagnostic must name the offending field (prefix match — element-level
// failures carry a tuple index, e.g. campaign.fence.delay_s.0).
function expectRejections(cases) {
  for (const [override, field] of cases) {
    const parsed = parseCampaign(campaignYaml(override));
    assert.equal(parsed.ok, false, `expected rejection: ${field}`);
    assert.ok(
      parsed.diagnostics.some((line) => line.startsWith(field)),
      `${field}: ${parsed.diagnostics.join('\n')}`
    );
  }
}

test('valid campaign parses; defaults fill topics, extra_domains, youtube', () => {
  const parsed = parseCampaign(campaignYaml());
  assert.ok(parsed.ok, parsed.diagnostics?.join('\n'));
  assert.equal(parsed.campaign.city, 'gdansk');
  assert.deepEqual(parsed.campaign.fence, { depth: 3, extra_domains: [], delay_s: [2, 5] });
  assert.deepEqual(parsed.campaign.topics, ['history']);
  assert.deepEqual(parsed.campaign.youtube, ['dQw4w9WgXcQ']);
});

test('AC1: missing city is rejected with a diagnostic naming the field', () => {
  const parsed = parseCampaign(campaignYaml({ city: null }));
  assert.equal(parsed.ok, false);
  assert.ok(
    parsed.diagnostics.some((line) => line.startsWith('campaign.city:')),
    parsed.diagnostics.join('\n')
  );
});

test('AC1: invalid fence values are rejected naming the offending field', () => {
  expectRejections([
    [{ depth: 'depth: 0' }, 'campaign.fence.depth'],
    [{ depth: 'depth: two' }, 'campaign.fence.depth'],
    [{ delay_s: 'delay_s: [5]' }, 'campaign.fence.delay_s'],
    [{ delay_s: 'delay_s: [5, 2]' }, 'campaign.fence.delay_s'],
    // An element-level failure carries the tuple index: campaign.fence.delay_s.0.
    [{ delay_s: 'delay_s: [-1, 5]' }, 'campaign.fence.delay_s'],
    [{ extra_domains: 'extra_domains: wiki.example' }, 'campaign.fence.extra_domains'],
    [{ fence: null }, 'campaign.fence'],
    [{ fence: 'fence:', depth: null, extra_domains: null, delay_s: null }, 'campaign.fence'],
  ]);
});

test('invalid seeds are rejected naming the field', () => {
  expectRejections([
    [{ seeds: null }, 'campaign.seeds'],
    [{ seeds: 'seeds: []' }, 'campaign.seeds'],
    [{ seeds: 'seeds:\n  - not-a-url' }, 'campaign.seeds'],
    [{ seeds: 'seeds: gdansk.example' }, 'campaign.seeds'],
  ]);
});

test('invalid topics are rejected naming the field', () => {
  expectRejections([
    [{ topics: 'topics: not-a-list' }, 'campaign.topics'],
    [{ topics: 'topics: [null]' }, 'campaign.topics'],
    [{ topics: 'topics: ["a", 3]' }, 'campaign.topics'],
  ]);
});

test('youtube ids outside the 11-char video-id shape are rejected naming the field', () => {
  const parsed = parseCampaign(campaignYaml({ youtube: 'youtube:\n  - short-id' }));
  assert.equal(parsed.ok, false);
  assert.ok(parsed.diagnostics.some((line) => line.startsWith('campaign.youtube.')));
});

test('unknown keys are rejected naming the field (typo protection)', () => {
  const parsed = parseCampaign(campaignYaml() + 'cit: gdansk\n');
  assert.equal(parsed.ok, false);
  assert.ok(
    parsed.diagnostics.some((line) => line.startsWith('campaign') && line.includes('"cit"')),
    parsed.diagnostics.join('\n')
  );
});

test('corrupt YAML answers with a diagnostic, not a thrown error', () => {
  const parsed = parseCampaign('fence: [a: b\n\t- }');
  assert.equal(parsed.ok, false);
  assert.ok(parsed.diagnostics[0].startsWith('campaign YAML:'), parsed.diagnostics.join('\n'));
});

test('empty and non-mapping inputs are rejected with diagnostics', () => {
  for (const source of ['', '- a\n- b\n']) {
    const parsed = parseCampaign(source);
    assert.equal(parsed.ok, false);
    assert.ok(parsed.diagnostics.length > 0);
  }
});
