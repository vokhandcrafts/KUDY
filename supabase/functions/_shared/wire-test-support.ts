// G20.01 — shared test support for the wire-handler suites (the test-db.ts
// precedent): the console-error capture the redacted-diagnostic checks use,
// and the canonical valid wire event both suites insert. Test-only — the
// production modules never import this.
export const ISO_AT = '2026-10-01T00:00:00.000Z';

export function wireEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    event_id: '55555555-5555-4555-8555-000000000001',
    type: 'app_open',
    at: ISO_AT,
    schema_version: 1,
    payload: {},
    ...overrides,
  };
}

/** Runs the handler with console.error captured; restores it even on failure. */
export async function captureConsoleError<T>(run: () => Promise<T>): Promise<{ result: T; lines: string[] }> {
  const lines: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    lines.push(args.map((item) => String(item)).join(' '));
  };
  try {
    return { result: await run(), lines };
  } finally {
    console.error = original;
  }
}
