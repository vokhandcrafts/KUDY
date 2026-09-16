// Documentation model; not the application engine or a platform adapter.
// Narration progress follows the accepted ADR variant A
// (docs/architecture/decisions/G01.01-narration-progress.md §4):
// heard is keyed by story_id, auto_fired by stop_id, and a stop's primary
// story is derived (base when present, else the paid-only extended story);
// an unlock never rewrites it.
// Session identity and the AccessReady trust boundary follow the accepted
// contract (docs/architecture/decisions/G01.03-session-access.md §3): the
// grant event carries the full identity (route, version, locale, issuer),
// the pinned version never changes until End, and a mismatched event is
// ignored without mutating any field.
// Audio ownership follows the accepted contract
// (docs/architecture/decisions/G01.02-audio-ownership.md §3): the owner is
// `guide` or `moment`, every launch carries a play token, every callback is
// tagged with that token and is ignored entirely when it does not match the
// current physical launch, a manual pause or a focus loss is a live pause
// (same token, offset kept), the 10-minute FocusRegain threshold closes the
// launch, and an explicit Moment play never credits guide progress.

const storiesOf = stop => [stop.storyBaseId, stop.storyExtendedId].filter(Boolean);
const primaryOf = stop => stop && (stop.storyBaseId ?? stop.storyExtendedId);
const findStop = (s, id) => s.stops.find(stop => stop.id === id);
const tierOf = (stop, storyId) => (stop.storyExtendedId === storyId ? 'extended' : 'base');
const storyAccessible = (s, storyId) => {
  const stop = s.stops.find(st => storiesOf(st).includes(storyId));
  return !!stop && s.accessibleStopIds.includes(stop.id)
    && s.tierAvailable.includes(tierOf(stop, storyId));
};
// ADR G01.02 §3.2: a moment launch needs no session and no durable zone —
// the process-wide monotonic counter lives in the controller that mints
// moment tokens; the model only validates the shape it is handed.
const isMomentLaunch = launch => !!launch && typeof launch === 'object'
  && typeof launch.momentId === 'string' && launch.momentId.length > 0
  && typeof launch.storyId === 'string' && launch.storyId.length > 0
  && Number.isInteger(launch.seq) && launch.seq > 0;

export function start(sessionId, routeStops, { routeId = 'route-1', version = 'v1',
  locale = 'be', accessibleStopIds, tierAvailable = ['base'], playingNow } = {}) {
  // Fixture defaults for routeId/locale are a convenience of synthetic tests,
  // not app rules; AccessReady events must still carry the full identity.
  const stops = routeStops.map(stop => typeof stop === 'string'
    ? { id: stop, storyBaseId: stop }
    : { id: stop.id, storyBaseId: stop.storyBaseId, storyExtendedId: stop.storyExtendedId });
  // ADR §3.3/§3.6: readiness is verified before the Start transaction, so the
  // model refuses a session whose package claims no verified layer, an unknown
  // layer, or accessibility for stops outside the pinned package. Partial
  // downloads and hash mismatches never reach this point (G04/G05 own disk).
  if (!Array.isArray(tierAvailable) || tierAvailable.length === 0
      || !tierAvailable.every(t => t === 'base' || t === 'extended')) {
    throw new RangeError('start requires at least one verified layer: base|extended');
  }
  const accessible = stops.map(stop => stop.id)
    .filter(id => !accessibleStopIds || accessibleStopIds.includes(id));
  if (accessibleStopIds && accessible.length !== accessibleStopIds.length) {
    throw new RangeError('accessibleStopIds must reference stops of the pinned package');
  }
  // ADR G01.02 §3.3: Start never stops a sounding moment and never mints a
  // guide launch for it — the controller injects the actual player state
  // (the moment variant) into the fresh session; autoplay then waits for
  // the player to become free. Only a moment can hold the player here:
  // guide playback without a live session is exactly the moment owner.
  if (playingNow !== undefined && !isMomentLaunch(playingNow)) {
    throw new RangeError('playingNow must be a moment launch: { momentId, storyId, seq: positive integer }');
  }
  return { sessionId, routeId, version, locale, stops,
    // `tier` is the informational start record of verified layers (ADR §3.1);
    // runtime availability lives in tierAvailable and only grows via AccessReady.
    tier: [...tierAvailable],
    accessibleStopIds: accessible,
    tierAvailable: [...tierAvailable],
    state: 'Active', heard: [], autoFired: [],
    playing: playingNow
      ? { owner: 'moment', momentId: playingNow.momentId,
        storyId: playingNow.storyId, seq: playingNow.seq, paused: false }
      : null,
    queued: null, suspended: false, focusLostAt: null,
    playSeq: 0, fix: null, commands: [] };
}

export function status(s, id) {
  const stop = findStop(s, id);
  if (!stop || !storyAccessible(s, primaryOf(stop))) return 'locked';
  // A live pause keeps the launch (ADR G01.02 §3.4), but the marker follows
  // the audible state: a paused replay of an already heard story stays `played`.
  if (s.playing && !s.playing.paused && s.playing.owner === 'guide'
      && s.playing.stopId === id) return 'playing';
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
    // ADR G01.02 §3.2: stopping is a command over the current token; the
    // token of a stopped launch is dead from here on.
    if (s.playing) emit('StopAudio', { token: tokenOf(s.playing) });
    s.playing = null;
    s.focusLostAt = null;
  };
  // ADR G01.02 §3.2: the guide token IS the accepted (session_id, play_id)
  // pair; the moment token carries the controller's moment_id and its
  // process-wide counter. Field spelling here is camelCase by model
  // convention — one mapping point to the ADR's snake_case (README §межы).
  const tokenOf = launch => launch.owner === 'guide'
    ? { kind: 'guide', ref: s.sessionId, seq: launch.playId }
    : { kind: 'moment', ref: launch.momentId, seq: launch.seq };
  // Single rejection rule (ADR G01.02 §3.5): a callback tagged with a token
  // that does not match the current physical launch is ignored entirely.
  const tokenMatches = token => !!s.playing && !!token
    && ['kind', 'ref', 'seq'].every(key => token[key] === tokenOf(s.playing)[key]);
  const momentLaunchOf = event => {
    const token = event.token;
    return !!token && token.kind === 'moment' && token.ref === event.momentId
      && isMomentLaunch({ momentId: event.momentId, storyId: event.storyId, seq: token.seq })
      ? { momentId: event.momentId, storyId: event.storyId, seq: token.seq }
      : null;
  };
  const retireQueue = () => {
    if (s.queued) add(s.autoFired, s.queued.stopId);
    s.queued = null;
  };
  const playStory = (stopId, storyId, automatic) => {
    stopAudio();
    if (automatic) add(s.autoFired, stopId);
    // playSeq is write-through before the audio command (ADR §3.1): a late
    // callback of a previous launch can never collide with this playId.
    s.playing = { owner: 'guide', stopId, storyId, playId: ++s.playSeq, paused: false };
    emit('PlayStory', { sessionId: s.sessionId, ...s.playing, token: tokenOf(s.playing) });
  };
  const playMoment = launch => {
    // ADR G01.02 §3.6: an explicit Moment play takes the single player,
    // stops the guide by command (never finished), retires the queue to
    // auto_fired and suspends automation until «Працягнуць гід».
    stopAudio();
    retireQueue();
    s.suspended = true;
    s.playing = { owner: 'moment', ...launch, paused: false };
    emit('PlayMoment', { momentId: launch.momentId, storyId: launch.storyId,
      token: tokenOf(s.playing) });
  };

  // The physical player outlives any single session (ADR G01.02 §3.4/§3.8):
  // after End only the tagged callbacks of the still-current launch reach the
  // model; every session-lifecycle event is ignored without mutating a field.
  const playerEvent = ['AudioFinished', 'AudioFailed', 'MomentFinished',
    'UserPausedAudio', 'UserStoppedAudio', 'FocusLoss', 'FocusRegain', 'ResumeAudio']
    .includes(event.type);
  if (s.state === 'Ended' && !playerEvent) return s;
  switch (event.type) {
    case 'PlayMoment': {
      // Trusted controller input (ADR G01.02 §3.2): the event carries the
      // minted moment token; a malformed launch is refused, not guessed.
      const launch = momentLaunchOf(event);
      if (launch) playMoment(launch);
      break;
    }
    case 'LocationAccepted':
      s.fix = structuredClone(event.fix);
      break;
    case 'AccessReady':
      // Trusted event ONLY from services/download after server grant, complete
      // per-file sha256 verification and atomic activation (ADR G01.03 §3.5).
      // The whole identity must match the pinned session: route, version,
      // locale and the download issuer. A mismatched or foreign-issued event
      // is ignored entirely — no field mutates, files stay under their own
      // package key for a session that pins that version later.
      if (event.issuer !== 'services/download'
          || event.routeId !== s.routeId
          || event.version !== s.version
          || event.locale !== s.locale) break;
      if (!applyAccess(s, event)) break;
      break;
    case 'Pause':
    case 'End':
      // ADR G01.02 §3.4/§3.8: session pause and End stop guide audio and
      // release walk resources; a moment launch is not session property — it
      // keeps sounding and its resume never restores the session.
      if (!s.playing || s.playing.owner === 'guide') stopAudio();
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
      // ADR G01.02 §3.4/§3.7: a manual pause is a live pause — the same token
      // and offset live on and no threshold applies; automation stays
      // suspended until an explicit human action.
      if (s.playing) s.playing.paused = true;
      s.suspended = true;
      break;
    case 'UserStoppedAudio':
      // ADR G01.02 §3.4: a manual stop closes the launch; the stop returns to
      // its computed status and automation stays suspended.
      stopAudio();
      s.suspended = true;
      break;
    case 'FocusLoss':
      // ADR G01.02 §3.4: a focus loss is a physical interruption, not
      // finished — the launch survives as a live pause and focus_lost_at arms
      // the single 10-minute threshold for every owner.
      if (s.playing) s.playing.paused = true;
      s.focusLostAt = now;
      s.suspended = true;
      break;
    case 'FocusRegain':
      // ADR G01.02 §3.4/§3.7: nothing sounds by itself. Within 10 minutes the
      // launch stays a live pause (Resume continues it); past the threshold
      // the launch is closed — a later listen is a fresh launch, new token.
      if (s.playing && s.focusLostAt !== null && now - s.focusLostAt > 600_000) {
        s.playing = null;
      }
      s.focusLostAt = null;
      break;
    case 'ResumeAudio':
      // ADR G01.02 §3.5: accepted only for the live pause of the current
      // token; a stale or closed token is a refused command, not a resume.
      // A guide resume removes the suspension; a moment resume never touches
      // the session flag that only «Працягнуць гід» clears after Play Moment.
      if (!s.playing || !s.playing.paused || !tokenMatches(event.token)) break;
      s.playing.paused = false;
      if (s.playing.owner === 'guide') s.suspended = false;
      emit('ResumeAudio', { token: tokenOf(s.playing) });
      break;
    case 'MomentFinished':
      // ADR G01.02 §3.5: accepting the current moment token only frees the
      // player — a moment launch never credits guide history, never starts
      // the queue and never restores guide automation.
      if (s.playing?.owner !== 'moment' || !tokenMatches(event.token)) break;
      s.playing = null;
      break;
    case 'AudioFailed':
      // ADR G01.02 §3.5 (story_play_failed): a launch that never sounded is
      // not heard and does not start the queue; automation suspends — the
      // next sound never starts by itself after a failure.
      if (!tokenMatches(event.token)) break;
      s.playing = null;
      s.focusLostAt = null;
      s.suspended = true;
      break;
    case 'GuideResume':
      // ADR G01.02 §3.6.4: «Працягнуць гід» is the single way back to guide
      // automation; it sounds nothing by itself — the next trigger runs the
      // general conditions, and the displaced stop is already in auto_fired.
      s.suspended = false;
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
      // Late callback rules (ADR G01.02 §3.5, G01.01 §4.11): the guide token
      // IS the accepted (session_id, play_id) pair — a completion of another
      // session or an earlier launch is ignored entirely; a story named by
      // the event — including an empty or null one — must be the one playing.
      if (!s.playing || s.playing.owner !== 'guide'
          || event.sessionId !== s.sessionId
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
