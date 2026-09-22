// Fixture for the tools/arch-surface test (G18.03): TypeScript-only export
// forms plus a multi-line `import type … from` on a resolvable specifier.
// Never executed; scanned by arch-surface.mjs.
import type {
  Stats,
} from 'node:fs';

export const ALPHA_VERSION = '1.0.0';

export interface AlphaShape {
  name: string;
}

export type AlphaKind = 'plain' | 'wild';

export const enum AlphaMode {
  Plain = 'plain',
}

export function renderAlpha(kind: AlphaKind, stat?: Stats): string {
  return kind + AlphaMode.Plain + (stat ? stat.size : 0);
}
