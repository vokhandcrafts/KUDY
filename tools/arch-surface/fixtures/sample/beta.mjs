// Fixture for the tools/arch-surface test (G18.03): import/export forms whose
// specifiers are deliberately fake (`fake-*`) — the printer reads the text and
// never resolves modules. Never executed.
import { helper } from './nonexistent-local.mjs';
import { upValue } from '../escaping-import.mjs';
import pick from 'fake-bare-pkg';
import 'fake-side-effect-pkg';

export * from './nonexistent-local.mjs';

export * as nsBundle from 'fake-ns-pkg';

export default function bootstrap() {
  return helper + upValue + pick;
}

export { privateName as renamedName, plainName };

const privateName = 'x';
const plainName = 'y';
