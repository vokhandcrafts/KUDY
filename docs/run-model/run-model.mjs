// Documentation model; not the application engine or a platform adapter.
// Narration progress follows the accepted ADR variant A
// (docs/architecture/decisions/G01.01-narration-progress.md §4):
// heard is keyed by story_id, auto_fired by stop_id, and a stop's primary
// story is derived (base when present, else the paid-only extended story);
// an unlock never rewrites it.

const storiesOf = stop => [stop.storyBaseId, stop.storyExtendedId].filter(Boolean);
const primaryOf = stop => stop && (stop.storyBaseId ?? stop.storyExtendedId);
const findStop = (s, id) => s.stops.find(stop => stop.id === id);
const tierOf = (stop, storyId) => (stop.storyExtendedId === storyId ? 'extended' : 'base');
const storyAccessible = (s, storyId) => {
  const stop = s.stops.find(st => storiesOf(st).includes(storyId));
  return !!stop && s.accessibleStopIds.includes(stop.id)
    && s.tierAvailable.includes(tierOf(stop, storyId));
};

export function start(sessionId, routeStops, { version = 'v1', accessibleStopIds,
  tierAvailable = ['base'] } = {}) {
  // Fixture shorthand: a plain string stop has one base story with the same id.
  const stops = routeStops.map(stop => typeof stop === 'string'
    ? { id: stop, storyBaseId: stop }
    : { id: stop.id, storyBaseId: stop.storyBaseId, storyExtendedId: stop.storyExtendedId });
  return { sessionId, version, stops,
    accessibleStopIds: stops.map(stop => stop.id)
      .filter(id => !accessibleStopIds || accessibleStopIds.includes(id)),
    tierAvailable: [...tierAvailable],
    state: 'Active', heard: [], autoFired: [],
    playing: null, queued: null, suspended: false,
    sequence: 0, fix: null, commands: [] };
}

export function status(s, id) {
  const stop = findStop(s, id);
  if (!stop || !storyAccessible(s, primaryOf(stop))) return 'locked';
  if (s.playing?.stopId === id) return 'playing';
  if (s.heard.includes(primaryOf(stop))) return 'played';
  return s.autoFired.includes(id) ? 'available' : 'pending';
}

export function missed(s) {
  // Legacy helper name: optional discoveries ("Яшчэ можна адкрыць"), never failures.
  // Unit is the story: locked stories are excluded; an unheard additional story
  // is listed even when the stop marker already says played.
  const out = [];
  for (const stop of s.stops)
    for (const storyId of storiesOf(stop))
      if (storyAccessible(s, storyId) && !s.heard.includes(storyId) && !out.includes(storyId))
        out.push(storyId);
  return out;
}

export function step(previous, event, now) {
  const s = structuredClone(previous);
  s.commands = [];
  const emit = (type, payload = {}) => s.commands.push({ type, ...payload });
  const add = (list, id) => { if (!list.includes(id)) list.push(id); };
  // Automatic attempts target the primary story only (ADR §4.3, §4.8).
  const eligible = id => {
    const primary = primaryOf(findStop(s, id));
    return !!primary && storyAccessible(s, primary)
      && !s.autoFired.includes(id) && !s.heard.includes(primary);
  };
  const located = (candidate, multiplier) => {
    const f = s.fix;
    return f && Number.isFinite(f.at) && f.at <= now && now - f.at <= 30_000
      && Number.isFinite(f.accuracy) && f.accuracy >= 0
      && Number.isFinite(candidate.radius) && candidate.radius > 0
      && f.accuracy <= candidate.radius
      && Number.isFinite(f.distances[candidate.stopId])
      && f.distances[candidate.stopId] >= 0
      && f.distances[candidate.stopId] <= multiplier * candidate.radius;
  };
  const stopAudio = () => {
    if (s.playing) emit('StopAudio');
    s.playing = null;
  };
  const retireQueue = () => {
    if (s.queued) add(s.autoFired, s.queued.stopId);
    s.queued = null;
  };
  const playStory = (stopId, storyId, automatic) => {
    stopAudio();
    if (automatic) add(s.autoFired, stopId);
    s.playing = { stopId, storyId, playId: ++s.sequence };
    emit('PlayStory', { sessionId: s.sessionId, ...s.playing });
  };

  // Ended sessions ignore even late events from their own last playback.
  if (s.state === 'Ended') return s;
  switch (event.type) {
    case 'LocationAccepted':
      s.fix = structuredClone(event.fix);
      break;
    case 'AccessReady':
      // Trusted adapter event AFTER server grant and complete verified download.
      // PurchaseSucceeded and arbitrary client claims cannot open content here.
      // stopIds grant stops; tiers unlock content layers. Both atomic: any
      // unknown stop or bogus tier rejects the whole event (ADR §4.2).
      if (event.version !== s.version) break;
      if (!applyAccess(s, event)) break;
      break;
    case 'Pause':
    case 'End':
      stopAudio();
      retireQueue();
      s.suspended = true;
      s.state = event.type === 'End' ? 'Ended' : 'Paused';
      emit('ClearGeofences');
      emit('UnsubscribeLocation');
      emit('ReleaseWakelock');
      break;
    case 'Resume':
      if (s.state === 'Paused') {
        s.state = 'Active';
        s.suspended = false;
        emit('SetGeofenceWindow');
      }
      break;
    case 'UserPausedAudio':
    case 'FocusLoss':
      stopAudio();
      s.suspended = true;
      break;
    case 'UserSelectedStop': {
      // Manual play of the primary story; never proximity-bound (ADR §4.3).
      const stop = findStop(s, event.stopId);
      if (s.state === 'Active' && storyAccessible(s, primaryOf(stop))) {
        s.suspended = false;
        playStory(event.stopId, primaryOf(stop), false);
      }
      break;
    }
    case 'UserSelectedStory': {
      // Manual play of a named story of this stop (primary or additional).
      const stop = findStop(s, event.stopId);
      const known = stop && storiesOf(stop).includes(event.storyId);
      if (s.state === 'Active' && known && storyAccessible(s, event.storyId)) {
        s.suspended = false;
        playStory(event.stopId, event.storyId, false);
      }
      break;
    }
    case 'DwellCompleted': {
      // Inactive/invalid input must not consume an automatic opportunity.
      if (s.state !== 'Active' || !eligible(event.stopId) || !located(event, 1)) break;
      if (s.suspended) {
        add(s.autoFired, event.stopId);
      } else if (s.playing) {
        // Repeated delivery of one candidate is not a replacement candidate.
        if (s.queued?.stopId !== event.stopId) {
          retireQueue();
          s.queued = { stopId: event.stopId, radius: event.radius, at: now };
        }
      } else {
        playStory(event.stopId, primaryOf(findStop(s, event.stopId)), true);
      }
      break;
    }
    case 'AudioFinished': {
      // Late callback rules (ADR §4.11): the session/play pair must match the
      // current playback; a story named by the event — including an empty or
      // null one — must be the one actually playing.
      if (event.sessionId !== s.sessionId || !s.playing
          || event.playId !== s.playing.playId
          || ('storyId' in event && event.storyId !== s.playing.storyId)) break;
      add(s.heard, s.playing.storyId);
      s.playing = null;
      const queued = s.queued;
      if (queued && s.state === 'Active' && !s.suspended
          && eligible(queued.stopId) && located(queued, 2)) {
        s.queued = null;
        playStory(queued.stopId, primaryOf(findStop(s, queued.stopId)), true);
      } else {
        retireQueue();
      }
      break;
    }
  }
  return s;
}

function applyAccess(s, event) {
  const stopIds = event.stopIds ?? [];
  const tiers = event.tiers ?? (event.tier ? [event.tier] : []);
  if (!Array.isArray(stopIds) || !Array.isArray(tiers)
      || !stopIds.every(id => findStop(s, id))
      || !tiers.every(t => t === 'base' || t === 'extended')
      || (!stopIds.length && !tiers.length)) return false;
  for (const id of stopIds) if (!s.accessibleStopIds.includes(id)) s.accessibleStopIds.push(id);
  for (const t of tiers) if (!s.tierAvailable.includes(t)) s.tierAvailable.push(t);
  return true;
}
