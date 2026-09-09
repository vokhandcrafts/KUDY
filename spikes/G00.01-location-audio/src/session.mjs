const MAX_ACCURACY_M = 40;
const MAX_FIX_AGE_MS = 15_000;
const DWELL_MS = 6_000;

export function createSession(points) {
  let state = 'idle';
  let locationOwner = null;
  let playing = null;
  let version = null;
  let autoplaySuspended = false;
  let analyticsConsent = false;
  let candidate = null;
  let candidateSince = null;
  const heard = new Set();
  const autoFired = new Set();
  const events = [];

  function acquireLocation(owner) {
    if (locationOwner && locationOwner !== owner) {
      throw new Error(`location already owned by ${locationOwner}`);
    }
    locationOwner = owner;
  }

  function releaseLocation() {
    locationOwner = null;
    candidate = null;
    candidateSince = null;
  }

  function play(pointId, source) {
    if (!points.some((point) => point.id === pointId)) throw new Error('unknown point');
    playing = pointId;
    autoplaySuspended = false;
    events.push({ type: 'play', stopId: pointId, source });
  }

  return {
    acquireLocation,
    start(input) {
      if (!input.packageReady) throw new Error('Start requires a fully verified package');
      if (state !== 'idle') throw new Error('session already started');
      state = 'active';
      version = input.version;
      acquireLocation('guide-session');
      events.push({ type: 'start', version });
    },
    pause() {
      if (state !== 'active') return;
      state = 'paused';
      playing = null;
      autoplaySuspended = true;
      releaseLocation();
      events.push({ type: 'pause' });
    },
    resume() {
      if (state !== 'paused') return;
      state = 'active';
      autoplaySuspended = false;
      acquireLocation('guide-session');
      events.push({ type: 'resume', version });
    },
    end() {
      state = 'finished';
      playing = null;
      autoplaySuspended = true;
      releaseLocation();
      events.push({ type: 'end' });
    },
    manualPlay(pointId) {
      play(pointId, 'manual');
    },
    locationUnavailable(reason) {
      releaseLocation();
      events.push({ type: 'location-unavailable', reason });
    },
    locationFix(fix) {
      if (state !== 'active' || !locationOwner || autoplaySuspended) return;
      if (fix.accuracyM > MAX_ACCURACY_M || fix.ageMs > MAX_FIX_AGE_MS) {
        candidate = null;
        candidateSince = null;
        events.push({ type: 'fix-rejected', reason: fix.accuracyM > MAX_ACCURACY_M ? 'accuracy' : 'stale' });
        return;
      }
      const nearest = points
        .map((point) => ({ point, distance: Math.hypot(fix.x - point.x, fix.y - point.y) }))
        .filter(({ point, distance }) => distance <= point.radiusM && !heard.has(point.id) && !autoFired.has(point.id))
        .sort((a, b) => a.distance - b.distance || a.point.id.localeCompare(b.point.id))[0]?.point;
      if (!nearest) {
        candidate = null;
        candidateSince = null;
        return;
      }
      if (candidate !== nearest.id) {
        candidate = nearest.id;
        candidateSince = fix.nowMs;
        return;
      }
      if (fix.nowMs - candidateSince >= DWELL_MS && !playing) {
        autoFired.add(nearest.id);
        play(nearest.id, 'gps');
      }
    },
    interrupt() {
      if (!playing) return;
      playing = null;
      autoplaySuspended = true;
      events.push({ type: 'interrupted' });
    },
    focusRegained() {
      events.push({ type: 'focus-regained-no-autoplay' });
    },
    audioFinished() {
      if (!playing) return;
      heard.add(playing);
      events.push({ type: 'finished', stopId: playing });
      playing = null;
    },
    r07Hint() {
      events.push({ type: 'r07-silent' });
    },
    setAnalyticsConsent(value) {
      analyticsConsent = value;
    },
    snapshot() {
      return {
        state, locationOwner, playing, version, autoplaySuspended,
        heard: [...heard].sort(), autoFired: [...autoFired].sort(), playerCount: 1,
      };
    },
    diagnostics() {
      return {
        events: events.map(({ type, stopId, source, reason }) => ({ type, stopId, source, reason })),
        serverPayloads: analyticsConsent ? events.filter((event) => event.type !== 'fix-rejected') : [],
      };
    },
  };
}
