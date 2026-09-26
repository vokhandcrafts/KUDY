// G05.06.a — the replay: a validated trace document drives the PRODUCTION run
// stack — the real LocationService and AudioService over the deterministic
// ports, the real RunOrchestrator (which itself runs acceptFix and step) —
// and renders the report (09 §11: «Сімулятар імпартуе прадакшн-функцыі;
// сімулятар, які перапісвае логіку, не тэстуе нічога»).
//
// AC1 anchor: the three production modules the acceptance names are imported
// here. RunOrchestrator is the composition the replay drives; acceptFix and
// step are the pipeline and reducer entrypoints its dispatch path executes —
// they are re-exported so the wiring is explicit and test-guarded (a copy
// that replaced either would be a second engine, which the task forbids).
import { acceptFix } from '../../core/pipeline/pipeline.ts';
import { step, defaultEngineConfig } from '../../core/engine/reducer.ts';
import { RunOrchestrator } from '../../controllers/run/runOrchestrator.ts';
import { LocationService } from '../../services/location/service.ts';
import { AudioService } from '../../services/audio/service.ts';
import { DeterministicClock } from './clock.mjs';
import { SimLocationPort, SimAudioPort } from './ports.mjs';
import { SimulationObserver, buildReport } from './report.mjs';

export { acceptFix, step };

const DEFAULT_DWELL_MS = 6000;
const DEFAULT_AUDIO_DURATION_MS = 30000;

// One replay of a trace document that parseTrace() accepted. Returns the
// byte-stable report string; `exit` is 1 when a segment was still playing at
// the end (stuck_playing, 09 §11) and 0 otherwise.
export function simulate(doc, { name }) {
  const dwellMs = doc.config?.dwellMs ?? DEFAULT_DWELL_MS;
  const defaultDurationMs = doc.config?.audio?.defaultDurationMs ?? DEFAULT_AUDIO_DURATION_MS;
  const perStory = doc.config?.audio?.stories ?? {};
  const durationFor = (path) => {
    const storyId = path.slice(path.lastIndexOf('/') + 1).replace(/\.m4a$/, '');
    return perStory[storyId] ?? defaultDurationMs;
  };

  const radiusByStopId = new Map(doc.stops.map((stop) => [stop.stopId, stop.radius]));
  const route = {
    routeId: doc.route.routeId,
    version: doc.route.version,
    locale: doc.route.locale,
    tier: [...doc.route.tier],
  };
  const stops = doc.stops.map((stop) => ({
    stopId: stop.stopId,
    lat: stop.lat,
    lng: stop.lng,
    radius: stop.radius,
    ...(stop.storyBaseId === undefined ? {} : { storyBaseId: stop.storyBaseId }),
    ...(stop.storyExtendedId === undefined ? {} : { storyExtendedId: stop.storyExtendedId }),
  }));

  const firstAtMs = doc.events.length === 0 ? 0 : doc.events[0].at;
  const clock = new DeterministicClock(firstAtMs);
  const locationPort = new SimLocationPort();
  const location = new LocationService({
    port: locationPort,
    clock,
    permissions: { foreground: 'simulated foreground permission', background: 'simulated background permission' },
  });
  const audioPort = new SimAudioPort(clock, durationFor);
  const audio = new AudioService({ createPort: () => audioPort });
  const observer = new SimulationObserver(clock, radiusByStopId);
  const orchestrator = new RunOrchestrator({
    location,
    audio,
    clock,
    engineConfig: defaultEngineConfig,
    pipelineConfig: { dwellMs },
    route,
    stops,
    onCommitted: (before, after) => observer.onCommitted(before, after),
  });

  const diagnostics = [];
  const counters = {
    fixesDelivered: 0,
    fixesDroppedBySignalGap: 0,
    fixesWithoutSubscription: 0,
    backgroundEvents: 0,
    startCount: 0,
  };
  // The injector state (09 §11 «інжэктары збояў»): windows of degraded
  // accuracy and signal outage, and the running timestamp shift applied to
  // every later fix.
  const injectors = { accuracy: [], gaps: [], shiftMs: 0 };

  const deliverFix = (event) => {
    for (const gap of injectors.gaps) {
      if (event.at >= gap.at && event.at < gap.untilAt) {
        counters.fixesDroppedBySignalGap += 1;
        return;
      }
    }
    const accuracyWindows = injectors.accuracy.filter((w) => event.at >= w.at && event.at < w.untilAt);
    const accuracy = accuracyWindows.reduce((worst, w) => Math.max(worst, w.accuracy), event.accuracy);
    const fix = { lat: event.lat, lng: event.lng, accuracy, at: event.at + injectors.shiftMs };
    observer.source = 'auto';
    if (locationPort.deliverFix(fix)) counters.fixesDelivered += 1;
    else counters.fixesWithoutSubscription += 1;
  };

  const applyCommand = (event, index) => {
    const command = event.command;
    const before = orchestrator.state;
    observer.source = 'manual';
    try {
      switch (command.action) {
        case 'Start': {
          counters.startCount += 1;
          const sessionId = command.sessionId ?? `sim-${String(counters.startCount)}`;
          orchestrator.start(sessionId, command.accessibleStopIds, [...doc.route.tier]);
          break;
        }
        case 'PlayStop':
          orchestrator.selectStop(command.stopId);
          break;
        case 'PlayStory':
          orchestrator.selectStory(command.stopId, command.storyId);
          break;
        case 'Pause':
          orchestrator.pauseSession();
          break;
        case 'Resume':
          orchestrator.resumeSession();
          break;
        case 'End':
          orchestrator.end();
          break;
        case 'PauseAudio':
          orchestrator.pauseAudio();
          break;
        case 'ResumeAudio': {
          const state = orchestrator.state;
          const playing = state.phase === 'Idle' ? null : state.playing;
          if (playing?.owner === 'guide') {
            orchestrator.resumeAudio({ kind: 'guide', ref: state.sessionId, seq: playing.playId });
          }
          break;
        }
        case 'GuideResume':
          orchestrator.guideResume();
          break;
        case 'PlayMoment':
          orchestrator.playMoment(command.momentId, command.storyId);
          break;
        default:
          diagnostics.push({
            code: 'unknown-action',
            message: `events[${String(index)}]: unhandled command action '${String(command.action)}'`,
            index,
          });
      }
    } catch (error) {
      // The engine's refusals (e.g. a bad Start payload) are production
      // RangeErrors: they become named diagnostics, the replay continues.
      diagnostics.push({ code: 'runtime', message: `events[${String(index)}]: ${error.message}`, index });
    }
    observer.recordCommand(event.at, command, before, orchestrator.state);
  };

  for (const [index, event] of doc.events.entries()) {
    // Everything due before the next trace event fires first, attributed to
    // the queue drain (deferred plays, watchdog resubscribes).
    observer.source = 'deferred';
    clock.drainUntil(event.at);
    try {
      switch (event.type) {
        case 'GpsFix':
          deliverFix(event, index);
          break;
        case 'TimestampJump':
          injectors.shiftMs += event.deltaMs;
          break;
        case 'AccuracyDegradation':
          injectors.accuracy.push({ at: event.at, untilAt: event.untilAt, accuracy: event.accuracy });
          break;
        case 'SignalGap':
          injectors.gaps.push({ at: event.at, untilAt: event.untilAt });
          break;
        case 'IncomingCall':
          observer.source = 'deferred';
          audioPort.emitFocus('focus-loss');
          break;
        case 'CallEnded':
          observer.source = 'deferred';
          audioPort.emitFocus('focus-regain');
          break;
        case 'AppBackground':
        case 'AppForeground':
          // Recorded only (the report counts them): the app-lifecycle wiring
          // into location/audio modes belongs to the device adapters, which
          // the simulator deliberately does not re-implement.
          counters.backgroundEvents += 1;
          break;
        case 'UserCommand':
          applyCommand(event, index);
          break;
        default:
          break; // parseTrace rejects unknown types before the replay starts
      }
    } catch (error) {
      diagnostics.push({ code: 'runtime', message: `events[${String(index)}]: ${error.message}`, index });
    }
  }

  // A segment still sounding at the end of the trace is the one condition
  // 09 §11 calls an error: the run completes, the report flags it, exit 1.
  const finalState = orchestrator.state;
  const stuck = finalState.phase !== 'Idle' && finalState.playing !== null;
  const report = buildReport({ name, doc, clock, observer, orchestrator, counters, diagnostics });
  return { report, exit: stuck ? 1 : 0 };
}
