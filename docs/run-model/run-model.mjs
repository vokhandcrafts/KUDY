// Documentation model; not the application engine or a platform adapter.
export function start(sessionId, stopIds, { version = 'v1', accessibleIds = stopIds } = {}) {
  return { sessionId, version, stopIds: [...stopIds],
    accessibleIds: stopIds.filter(id => accessibleIds.includes(id)), state: 'Active', heard: [],
    autoFired: [], playing: null, queued: null, suspended: false,
    sequence: 0, fix: null, commands: [] };
}

export function status(s, id) {
  if (!s.accessibleIds.includes(id)) return 'locked';
  if (s.playing?.stopId === id) return 'playing';
  if (s.heard.includes(id)) return 'played';
  return s.autoFired.includes(id) ? 'available' : 'pending';
}

export function missed(s) {
  // Legacy helper name: these are optional discoveries, never failures.
  return s.accessibleIds.filter(id => !s.heard.includes(id));
}

export function step(previous, event, now) {
  const s = structuredClone(previous);
  s.commands = [];
  const emit = (type, payload = {}) => s.commands.push({ type, ...payload });
  const add = (list, id) => { if (!list.includes(id)) list.push(id); };
  const eligible = id => s.accessibleIds.includes(id)
    && !s.autoFired.includes(id) && !s.heard.includes(id);
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
  const playStop = (id, automatic) => {
    stopAudio();
    if (automatic) add(s.autoFired, id);
    s.playing = { stopId: id, playId: ++s.sequence };
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
      if (event.version === s.version && Array.isArray(event.stopIds)
          && event.stopIds.every(id => s.stopIds.includes(id))) {
        for (const id of event.stopIds) add(s.accessibleIds, id);
      }
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
    case 'UserSelectedStop':
      if (s.state === 'Active' && s.accessibleIds.includes(event.stopId)) {
        s.suspended = false;
        playStop(event.stopId, false);
      }
      break;
    case 'DwellCompleted': {
      // Inactive/invalid input must not consume an automatic opportunity.
      if (s.state !== 'Active' || !eligible(event.stopId) || !located(event, 1)) break;
      if (s.suspended) {
        add(s.autoFired, event.stopId);
      } else if (s.playing) {
        // Repeated delivery of one candidate is not a replacement candidate.
        if (s.queued?.stopId !== event.stopId) {
          retireQueue();
          s.queued = { stopId: event.stopId, radius: event.radius };
        }
      } else {
        playStop(event.stopId, true);
      }
      break;
    }
    case 'AudioFinished': {
      if (event.sessionId !== s.sessionId || !s.playing
          || event.playId !== s.playing.playId) break;
      add(s.heard, s.playing.stopId);
      s.playing = null;
      const queued = s.queued;
      if (queued && s.state === 'Active' && !s.suspended
          && eligible(queued.stopId) && located(queued, 2)) {
        s.queued = null;
        playStop(queued.stopId, true);
      } else {
        retireQueue();
      }
      break;
    }
  }
  return s;
}
