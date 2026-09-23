import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCampaign } from './campaign.mjs';
import { campaignYaml } from './testkit.mjs';

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
  const cases = [
    [{ depth: 'depth: 0' }, 'campaign.fence.depth'],
    [{ depth: 'depth: two' }, 'campaign.fence.depth'],
    [{ delay_s: 'delay_s: [5]' }, 'campaign.fence.delay_s'],
    [{ delay_s: 'delay_s: [5, 2]' }, 'campaign.fence.delay_s'],
    // An element-level failure carries the tuple index: campaign.fence.delay_s.0.
    [{ delay_s: 'delay_s: [-1, 5]' }, 'campaign.fence.delay_s'],
    [{ extra_domains: 'extra_domains: wiki.example' }, 'campaign.fence.extra_domains'],
  ];
  for (const [override, field] of cases) {
    const parsed = parseCampaign(campaignYaml(override));
    assert.equal(parsed.ok, false, `expected rejection: ${field}`);
    assert.ok(
      parsed.diagnostics.some((line) => line.startsWith(field)),
      `${field}: ${parsed.diagnostics.join('\n')}`
    );
  }
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
