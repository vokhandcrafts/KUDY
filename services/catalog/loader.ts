// G06.01.a (issue #313) — the origin-binding adapter for the catalog loader
// port: relative published paths resolve against the configured public origin
// (21 §3.3 — the client fetches only that origin). fetch is global in the
// app runtime and in Node ≥ 22, so one adapter serves the device build and a
// local test server.
export function createOriginCatalogLoader(origin: string): (relPath: string) => Promise<string> {
  const base = origin.endsWith('/') ? origin.slice(0, -1) : origin;
  return async (relPath) => {
    const response = await fetch(`${base}/${relPath}`);
    if (!response.ok) {
      throw new Error(`catalog-loader-${response.status}`);
    }
    return response.text();
  };
}
