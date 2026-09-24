// G05.02.c — the app-config extraction (AC2/AC3): the explanation strings of
// the two permission questions and the Android foreground-service
// notification text live in app.json `expo.extra`. This module is the
// single reader of that shape: the adapter factory calls it with
// `Constants.expoConfig`, the composition root will hand the explanations to
// the service through its deps (G05.05). A missing or malformed entry is a
// broken app config, not a default: the factory fails fast with a named
// error (implementation-rules 3/14) — the adapter never invents strings.
export interface LocationExtras {
  locationExplanations: { foreground: string; background: string };
  locationForegroundService: { notificationTitle: string; notificationBody: string };
}

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

export function locationExtrasFromConfig(config: unknown): LocationExtras {
  // `config` is the expo config slice (`Constants.expoConfig`, app.json's
  // `expo` object); its extra data lives under `extra` (singular — the key
  // the Expo config schema accepts, expo-doctor guards it).
  const extras = (config as { extra?: unknown } | undefined)?.extra;
  const explanations = (extras as Record<string, unknown> | undefined)?.locationExplanations;
  const service = (extras as Record<string, unknown> | undefined)?.locationForegroundService;
  const explanationsShape = explanations as Record<string, unknown> | undefined;
  const serviceShape = service as Record<string, unknown> | undefined;
  if (!isNonEmptyString(explanationsShape?.foreground)) {
    throw new Error('location adapter: app.json expo.extra.locationExplanations.foreground is missing or empty');
  }
  if (!isNonEmptyString(explanationsShape?.background)) {
    throw new Error('location adapter: app.json expo.extra.locationExplanations.background is missing or empty');
  }
  if (!isNonEmptyString(serviceShape?.notificationTitle)) {
    throw new Error('location adapter: app.json expo.extra.locationForegroundService.notificationTitle is missing or empty');
  }
  if (!isNonEmptyString(serviceShape?.notificationBody)) {
    throw new Error('location adapter: app.json expo.extra.locationForegroundService.notificationBody is missing or empty');
  }
  return {
    locationExplanations: { foreground: explanationsShape.foreground, background: explanationsShape.background },
    locationForegroundService: {
      notificationTitle: serviceShape.notificationTitle,
      notificationBody: serviceShape.notificationBody,
    },
  };
}
