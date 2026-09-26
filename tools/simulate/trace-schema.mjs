// G05.06.a — the trace document schema and its validator (09 §11 «Трэйс —
// просты JSON»). A corrupt trace yields named diagnostics, never a crash and
// never a partial run (AC3): the replay starts only on a fully valid document.
//
// Trace document shape:
//   route:  { routeId, version, locale, tier: ['base'|'extended', …] }
//   stops:  [{ stopId, lat, lng, radius, storyBaseId?, storyExtendedId? }]
//   config: { dwellMs?, audio: { defaultDurationMs?, stories?: {id: ms} } }  (optional)
//   events: ordered by non-decreasing `at`; one of
//     GpsFix               { at, lat, lng, accuracy }
//     AppBackground        { at }
//     AppForeground        { at }
//     UserCommand          { at, command: { action, …fields } }
//     AccuracyDegradation  { at, untilAt, accuracy }
//     TimestampJump        { at, deltaMs }
//     SignalGap            { at, untilAt }
//     IncomingCall         { at }
//     CallEnded            { at }
//
// The injectors are trace directives, not engine facts: they corrupt what the
// OS boundary reports (worse accuracy, shifted timestamps, a fix outage) or
// introduce a device event (the call), and the production stack reacts exactly
// as it would on a phone.

export const USER_COMMAND_ACTIONS = [
  'Start',
  'PlayStop',
  'PlayStory',
  'Pause',
  'Resume',
  'End',
  'PauseAudio',
  'ResumeAudio',
  'GuideResume',
  'PlayMoment',
];

const EVENT_TYPES = new Set([
  'GpsFix',
  'AppBackground',
  'AppForeground',
  'UserCommand',
  'AccuracyDegradation',
  'TimestampJump',
  'SignalGap',
  'IncomingCall',
  'CallEnded',
]);

const PER_EVENT_FIELDS = {
  GpsFix: ['lat', 'lng', 'accuracy'],
  AccuracyDegradation: ['untilAt', 'accuracy'],
  TimestampJump: ['deltaMs'],
  SignalGap: ['untilAt'],
  UserCommand: ['command'],
};

// Named diagnostics with the offending index — one per violation, the whole
// list reported (implementation-rules 14). `ok: false` means the document
// cannot run at all (route/stops broken); event-level diagnostics also set ok
// to false: the replay rejects the whole trace rather than running a partial
// one under a silent repair.
export function parseTrace(doc) {
  const diagnostics = [];
  const bad = (code, message, index = null) => diagnostics.push({ code, message, index });

  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
    return { ok: false, diagnostics: [{ code: 'bad-document', message: 'the trace must be a JSON object', index: null }] };
  }

  const route = doc.route;
  if (typeof route !== 'object' || route === null) bad('missing-field', 'route is required');
  else {
    for (const field of ['routeId', 'version', 'locale']) {
      if (typeof route[field] !== 'string' || route[field].length === 0) {
        bad('missing-field', `route.${field} must be a non-empty string`);
      }
    }
    if (!Array.isArray(route.tier) || route.tier.length === 0) {
      bad('missing-field', 'route.tier must list at least one verified layer');
    } else if (!route.tier.every((t) => t === 'base' || t === 'extended')) {
      bad('bad-value', 'route.tier accepts only "base" and "extended"');
    }
  }

  const stops = doc.stops;
  const stopIds = new Set();
  if (!Array.isArray(stops) || stops.length === 0) {
    bad('missing-field', 'stops must be a non-empty array');
  } else {
    for (const [index, stop] of stops.entries()) {
      const where = `stops[${String(index)}]`;
      if (typeof stop !== 'object' || stop === null) {
        bad('bad-value', `${where} must be an object`, index);
        continue;
      }
      if (typeof stop.stopId !== 'string' || stop.stopId.length === 0) {
        bad('missing-field', `${where}.stopId must be a non-empty string`, index);
      } else if (stopIds.has(stop.stopId)) {
        bad('duplicate-stop', `${where}: stopId '${stop.stopId}' appears twice`, index);
      } else {
        stopIds.add(stop.stopId);
      }
      for (const field of ['lat', 'lng', 'radius']) {
        if (typeof stop[field] !== 'number' || !Number.isFinite(stop[field])) {
          bad('missing-field', `${where}.${field} must be a finite number`, index);
        }
      }
      if (Number.isFinite(stop.radius) && stop.radius <= 0) {
        bad('bad-value', `${where}.radius must be positive`, index);
      }
      if (Number.isFinite(stop.lat) && (stop.lat < -90 || stop.lat > 90)) {
        bad('bad-value', `${where}.lat must be within [-90, 90]`, index);
      }
      const hasStory =
        (typeof stop.storyBaseId === 'string' && stop.storyBaseId.length > 0) ||
        (typeof stop.storyExtendedId === 'string' && stop.storyExtendedId.length > 0);
      if (!hasStory) bad('missing-field', `${where} carries no story (storyBaseId or storyExtendedId)`, index);
    }
  }

  const config = doc.config ?? {};
  if (typeof config !== 'object' || config === null) bad('bad-value', 'config must be an object when present');
  else {
    if (config.dwellMs !== undefined && (!Number.isFinite(config.dwellMs) || config.dwellMs < 0)) {
      bad('bad-value', 'config.dwellMs must be a non-negative finite number');
    }
    if (config.audio !== undefined) {
      if (typeof config.audio !== 'object' || config.audio === null) {
        bad('bad-value', 'config.audio must be an object when present');
      } else {
        if (
          config.audio.defaultDurationMs !== undefined &&
          (!Number.isFinite(config.audio.defaultDurationMs) || config.audio.defaultDurationMs <= 0)
        ) {
          bad('bad-value', 'config.audio.defaultDurationMs must be a positive finite number');
        }
        if (config.audio.stories !== undefined) {
          if (typeof config.audio.stories !== 'object' || config.audio.stories === null) {
            bad('bad-value', 'config.audio.stories must be an object when present');
          } else {
            for (const [storyId, ms] of Object.entries(config.audio.stories)) {
              if (!Number.isFinite(ms) || ms <= 0) {
                bad('bad-value', `config.audio.stories['${storyId}'] must be a positive finite number`);
              }
            }
          }
        }
      }
    }
  }

  const events = doc.events;
  if (!Array.isArray(events)) {
    bad('missing-field', 'events must be an array');
  } else {
    let previousAt = null;
    for (const [index, event] of events.entries()) {
      const where = `events[${String(index)}]`;
      if (typeof event !== 'object' || event === null || !EVENT_TYPES.has(event.type)) {
        bad('unknown-event', `${where}: unknown trace event type '${String(event?.type)}'`, index);
        continue;
      }
      if (typeof event.at !== 'number' || !Number.isFinite(event.at)) {
        bad('missing-field', `${where}.at must be a finite number`, index);
        continue;
      }
      if (previousAt !== null && event.at < previousAt) {
        bad('non-monotonic-time', `${where}: at ${String(event.at)} goes back before ${String(previousAt)}`, index);
      }
      previousAt = event.at;
      for (const field of PER_EVENT_FIELDS[event.type] ?? []) {
        const value = field === 'command' ? event.command : event[field];
        if (value === undefined) bad('missing-field', `${where}.${field} is required for ${event.type}`, index);
      }
      if (event.type === 'GpsFix') {
        for (const field of ['lat', 'lng', 'accuracy']) {
          if (event[field] !== undefined && (typeof event[field] !== 'number' || !Number.isFinite(event[field]))) {
            bad('bad-value', `${where}.${field} must be a finite number`, index);
          }
        }
        if (Number.isFinite(event.accuracy) && event.accuracy < 0) {
          bad('bad-value', `${where}.accuracy must be non-negative`, index);
        }
      }
      if (event.type === 'UserCommand') {
        const command = event.command;
        if (command !== undefined && (typeof command !== 'object' || command === null)) {
          bad('bad-value', `${where}.command must be an object`, index);
        } else if (typeof command === 'object' && command !== null) {
          if (!USER_COMMAND_ACTIONS.includes(command.action)) {
            bad('unknown-action', `${where}: unknown user command action '${String(command.action)}'`, index);
          }
          for (const field of ['stopId', 'storyId', 'momentId']) {
            if (command[field] !== undefined && (typeof command[field] !== 'string' || command[field].length === 0)) {
              bad('bad-value', `${where}.command.${field} must be a non-empty string`, index);
            }
          }
          const needs = {
            PlayStop: ['stopId'],
            PlayStory: ['stopId', 'storyId'],
            PlayMoment: ['momentId', 'storyId'],
          }[command.action];
          if (needs !== undefined) {
            for (const field of needs) {
              if (typeof command[field] !== 'string' || command[field].length === 0) {
                bad('missing-field', `${where}.command.${field} is required for ${command.action}`, index);
              }
            }
          }
        }
      }
      if (event.type === 'AccuracyDegradation' || event.type === 'SignalGap') {
        if (event.untilAt !== undefined && Number.isFinite(event.at) && Number.isFinite(event.untilAt) && event.untilAt < event.at) {
          bad('bad-value', `${where}.untilAt must not precede at`, index);
        }
      }
      if (event.type === 'AccuracyDegradation' && Number.isFinite(event.accuracy) && event.accuracy <= 0) {
        bad('bad-value', `${where}.accuracy must be positive`, index);
      }
      if (event.type === 'TimestampJump' && event.deltaMs !== undefined && Number.isFinite(event.deltaMs) && event.deltaMs === 0) {
        bad('bad-value', `${where}.deltaMs must not be zero`, index);
      }
    }
  }

  return { ok: diagnostics.length === 0, diagnostics };
}
