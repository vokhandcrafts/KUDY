// G07.05 — the accepted hint numbers reach the app from the one canonical
// machine-readable file (ADR G07.04 §3: no second place carries the numbers,
// R07 forbids inventing them per call site). Node-side loader: reads
// contracts/hints/guide-hints.values.v1.json and validates it through the
// contract's own checker before anyone sees a number. The controller consumes
// the typed shape only (type-only import — erased from the RN bundle), so the
// device wiring may pass the same document without this module.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkGuideHintValues } from '../contracts/hints/guide-hints.mjs';

export interface GuideHintValues {
  readonly guide_hints_values_version: number;
  readonly proximity_radius_m: number;
  readonly accepted_accuracy_m: number;
  readonly fix_freshness_s: number;
  readonly dwell_s: number;
  readonly foreground_cooldown_s: number;
}

export class ConfigError extends Error {
  rule: string;

  constructor(rule: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ConfigError';
    this.rule = rule;
  }
}

// The canonical file next to this module's repo root; the argument is the
// tests' seam (a fixture path), production reads the shipped contract file.
export function loadGuideHintValues(path?: string): GuideHintValues {
  const file =
    path ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'contracts', 'hints', 'guide-hints.values.v1.json');
  let doc: unknown;
  try {
    doc = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new ConfigError('hint-values-unreadable', `the canonical hint values file is unreadable: ${file}`, {
      cause: error,
    });
  }
  const verdict = checkGuideHintValues(doc);
  if (!verdict.ok) {
    const reasons = (verdict.errors as ReadonlyArray<{ rule: string; path: string }>)
      .map((entry) => `${entry.rule} at ${entry.path}`)
      .join('; ');
    throw new ConfigError('hint-values-invalid', `the canonical hint values file failed its contract: ${reasons}`);
  }
  return doc as GuideHintValues;
}
