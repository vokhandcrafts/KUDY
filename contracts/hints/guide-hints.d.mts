// Type surface of the contract's values checker for the TS side (the loader
// in services/config.ts is its only consumer). The implementation and its
// rules live in guide-hints.mjs — this file declares, it does not restate.
export interface GuideHintValueDiagnostic {
  rule: string;
  path: string;
}

export function checkGuideHintValues(doc: unknown): { ok: boolean; errors: GuideHintValueDiagnostic[] };
