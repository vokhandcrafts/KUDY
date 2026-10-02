// G20.01 — the single redacted server-diagnostic channel for the device and
// events internal failure paths (spec N1: «Унутраныя адмовы device/events
// трапляюць у серверны журнал адзін раз з назвай аперацыі і бяспечнай
// прычынай»). One line per failure, `operation` + `reason` and nothing else:
// callers pass fixed literals only — never error.message, request bodies,
// bearer headers, SQL parameters or connection URLs — so nothing
// user-controlled can reach the log line. Ordinary client denials (auth,
// validation, the 429 limit) never call this.
export function logServerDiagnostic(operation: string, reason: string): void {
  console.error(JSON.stringify({ operation, reason }));
}
