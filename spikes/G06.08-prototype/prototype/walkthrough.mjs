// Deterministic headless walkthrough of the G06.08 prototype contracts.
// The walk-session semantics come from the normative model
// (docs/run-model/run-model.mjs) — this file drives it through the issue #61
// criterion-1 flow and prints stable lines; discovery comes from the real
// selector (core/discovery/selectDiscovery.ts) over the accepted fixture copy.
// Nothing here mutates repository files; the output must be byte-identical
// between runs (implementation rule 11).
import { start, step, status, missed } from '../../../docs/run-model/run-model.mjs';
import { selectDiscovery } from '../../../core/discovery/selectDiscovery.ts';
import { hintEligible } from './ui-rules.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const city = JSON.parse(readFileSync(path.join(here, '../data/synthetic-city.json'), 'utf8'));
const index = JSON.parse(readFileSync(path.join(here, '../data/discovery-index.json'), 'utf8'));

const lines = [];
const say = (line) => lines.push(line);
const modelStops = (guide) => guide.stops.map((s) => ({
  id: s.id, storyBaseId: s.stories.find((st) => st.role === 'primary' && st.tier === 'base')?.id,
  storyExtendedId: s.stories.find((st) => st.tier === 'extended')?.id,
}));
const title = (guide, stopId) => guide.stops.find((s) => s.id === stopId).title.be;
const FREE = city.guides[0];

// ── Criterion 1: Start → manual Play → pause → upgrade → return from Moment
// → other-guide hint (R07) → End, on the accepted model ─────────────────────
export function runWalk() {
  const t0 = 1_000_000;
  let s = start('sess-demo-1', modelStops(FREE),
    { routeId: FREE.route_id, version: FREE.version, locale: 'be',
      accessibleStopIds: ['stop-1', 'stop-2'], tierAvailable: ['base'] });
  say(`1 Start route-free-1 v1 be: Active, accessible=[stop-1,stop-2], stop-3 ${status(s, 'stop-3')} (paid-only, base only verified)`);

  const fix = (t, stopId, radius) =>
    ({ at: t, accuracy: radius / 2, distances: Object.fromEntries(FREE.stops.map((st) => [st.id, st.id === stopId ? radius / 2 : 10_000])) });
  s = step(s, { type: 'LocationAccepted', fix: fix(t0, 'stop-1', 40) }, t0);
  s = step(s, { type: 'DwellCompleted', stopId: 'stop-1', radius: 40 }, t0);
  const stPlaying = s;
  say(`2 DwellCompleted stop-1: playing={${s.playing.owner},${title(FREE, s.playing.stopId)},playId=${s.playing.playId}}, marker=${status(s, 'stop-1')}, commands=${s.commands.map((c) => c.type).join('|')}`);

  const pauseToken = s.commands.find((c) => c.type === 'PlayStory').token;
  s = step(s, { type: 'UserPausedAudio' }, t0 + 1000);
  const stPaused = s;
  const offsetKept = s.playing.paused === true && s.playing.playId === pauseToken.seq;
  s = step(s, { type: 'ResumeAudio', token: pauseToken }, t0 + 2000);
  say(`3 UserPausedAudio→ResumeAudio: live pause kept token playId=${pauseToken.seq} (${offsetKept}), suspended=${s.suspended}, heard=${s.heard.length}`);

  s = step(s, { type: 'LocationAccepted', fix: fix(t0 + 2500, 'stop-2', 40) }, t0 + 2500);
  s = step(s, { type: 'DwellCompleted', stopId: 'stop-2', radius: 40 }, t0 + 2500);
  say(`4 DwellCompleted stop-2 while playing: queued=${JSON.stringify(s.queued)}, marker stop-2=${status(s, 'stop-2')} (still pending, auto_fired untouched)`);

  s = step(s, { type: 'PlayMoment', momentId: 'moment-m1', storyId: 'story-moment-1', token: { kind: 'moment', ref: 'moment-m1', seq: 1 } }, t0 + 3000);
  const stSuspended = s;
  const queueRetired = s.autoFired.includes('stop-2');
  s = step(s, { type: 'MomentFinished', token: { kind: 'moment', ref: 'moment-m1', seq: 1 } }, t0 + 7000);
  say(`5 PlayMoment moment-m1: guide stopped by command, queue retired to auto_fired (${queueRetired}), suspended=${s.suspended}; MomentFinished: heard=${JSON.stringify(s.heard)} (moment never credits guide)`);

  s = step(s, { type: 'GuideResume' }, t0 + 7500);
  const stIdle = s;
  say(`6 «Працягнуць гід»: suspended=${s.suspended}, playing=${JSON.stringify(s.playing)} (automation back, nothing sounds by itself)`);

  s = step(s, { type: 'UserSelectedStop', stopId: 'stop-2' }, t0 + 8000);
  s = step(s, { type: 'AudioFinished', sessionId: 'sess-demo-1', playId: s.playing.playId, storyId: s.playing.storyId }, t0 + 9000);
  say(`7 Manual Play stop-2 → finished: heard=${JSON.stringify(s.heard)}, marker=${status(s, 'stop-2')}`);

  s = step(s, { type: 'AccessReady', issuer: 'services/download', routeId: 'route-free-1', version: 'v1', locale: 'be', stopIds: ['stop-3'], tiers: ['extended'] }, t0 + 61_000);
  say(`8 AccessReady extended (upgrade): stop-3 ${status(s, 'stop-3')} now unlocked, heard/auto_fired untouched=${s.heard.length}/${s.autoFired.length}, no Play issued=${!s.playing}`);

  s = step(s, { type: 'UserSelectedStory', stopId: 'stop-1', storyId: 'story-free-1-ext' }, t0 + 62_000);
  const extToken = s.commands.find((c) => c.type === 'PlayStory').token;
  s = step(s, { type: 'FocusLoss' }, t0 + 62_500);
  s = step(s, { type: 'FocusRegain' }, t0 + 112_500);
  s = step(s, { type: 'ResumeAudio', token: extToken }, t0 + 113_000);
  s = step(s, { type: 'AudioFinished', sessionId: 'sess-demo-1', playId: extToken.seq, storyId: 'story-free-1-ext' }, t0 + 114_000);
  say(`9 Extended stop-1 with a phone call: FocusLoss→FocusRegain (+50s) keeps the live pause, ResumeAudio resumes the same token, finished → heard=${JSON.stringify(s.heard)}, marker stop-1=${status(s, 'stop-1')}`);

  s = step(s, { type: 'Pause' }, t0 + 120_000);
  const paused = s.state;
  say(`10 Pause walk: state=${paused}, playing=${JSON.stringify(s.playing)}, commands=${s.commands.map((c) => c.type).join('|')}`);
  s = step(s, { type: 'Resume' }, t0 + 121_000);
  say(`11 Resume walk: state=${s.state}`);

  s = step(s, { type: 'End' }, t0 + 122_000);
  say(`12 End: state=${s.state}, «Яшчэ можна адкрыць»=${JSON.stringify(missed(s))} (unit story, locked excluded)`);

  // R07 hint and NAV8 switch dialog are UI-layer rules (11 §15/§16.2); the
  // model intentionally does not cover them — the prototype shows them with
  // session state read-only. The quiet-hint predicate itself is computed here
  // from the shared ui-rules module so the exclusion of every busy player
  // state is checkable (implementation rule 1).
  const other = city.guides[1];
  say(`13 R07 quiet hint target: ${other.route_id} ${other.access}, one factual show per session (UI-tracked), tap opens preview only — model untouched`);
  say(`14 R07 eligibility predicate (ui-rules): playing=${hintEligible(stPlaying)}, paused=${hintEligible(stPaused)}, suspended=${hintEligible(stSuspended)}, idle=${hintEligible(stIdle)} (false everywhere but idle Active)`);
  return lines;
}

// ── Discovery D01–D07 through the real selector over the accepted fixture ───
export function runDiscovery() {
  const out = [];
  const say2 = (line) => out.push(line);
  const ids = (r) => r.exact.map((m) => m.offer_id).join(',');
  const diff = (r, id) => { const m = r.alternatives.find((x) => x.offer_id === id); return m ? m.differences.join('+') : 'absent'; };

  const at60 = selectDiscovery(index, { city_id: 'city-a', content_locale: 'be', max_minutes: 60, theme_ids: ['theme-history'] });
  say2(`D03@60: exact=[${ids(at60)}] (paid 45–75 excluded), b1=${diff(at60, 'offer-b1-guide')}`);
  const at120 = selectDiscovery(index, { city_id: 'city-a', content_locale: 'be', max_minutes: 120, theme_ids: ['theme-history'] });
  say2(`D03@120: exact=[${ids(at120)}], first=${at120.exact[0].reasons.join('+')}`);
  const none = selectDiscovery(index, { city_id: 'city-a', content_locale: 'be', max_minutes: 15, theme_ids: ['theme-sea'] });
  say2(`D04 zero exact (theme-sea @15): exact=[${ids(none)}], alternatives=${none.alternatives.map((m) => `${m.offer_id}(${m.differences.join('+')})`).join(', ') || 'none'}`);
  const autumn = selectDiscovery(index, { city_id: 'city-a', content_locale: 'be', max_minutes: 60, theme_ids: ['theme-history'], preferred_season: 'autumn' });
  say2(`D05 autumn: exact=[${ids(autumn)}] (h1 has the season reason, a1/g1 stay labeled)`);
  const b1 = index.offers.find((o) => o.offer_id === 'offer-b1-guide');
  say2(`D06 paid marking: b1 access=${b1.access}; tap opens preview, never buys/starts/unlocks private`);
  const f1 = index.collections.find((c) => c.collection_id === 'collection-f1');
  say2(`D07/D02 paths: collection-f1 members=[${f1.members.map((m) => m.kind).join('+')}] open their own cards, no Start/audio; guide-route-a1 preview is one shared card from rubric, collection and hint`);
  const uk = b1.availability;
  say2(`L01 availability: text=${uk.text_locales.join(',')} audio=${uk.audio_locales.join(',')} → uk text without uk audio gives no Start promising ukrainian audio`);
  return out;
}

// ── F01–F04: feedback is a client state machine (21 §5.4); server is G16.01 ──
export function runFeedback() {
  const flow = ['draft', 'pending', 'sending', 'sent'];
  const off = ['draft', 'pending', 'conflict', 'action_required'];
  return [
    `F02 targets: guide {kind:guide,route_id,version,locale} vs place {kind:place,place_id,content_version,locale} — separate keys, never aggregated`,
    `F02 form: score 1–5 no default, max 3 unique reasons; guide=[interesting_stories, clear_delivery, too_long, hard_to_navigate, audio_problem, description_mismatch], place=[worth_visiting, description_mismatch, hard_to_reach, access_problem]`,
    `F03 online: ${flow.join(' → ')}; offline restart: draft kept, ${off.join(' → ')} resolves via CAS revision`,
    `F01 skip: no record, nothing blocked; edit replaces (same target key), delete leaves tombstone, report shows count+version+language`,
  ];
}

export function runAll() {
  return [...runWalk(), ...runDiscovery(), ...runFeedback()];
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  for (const line of runAll()) console.log(line);
}
