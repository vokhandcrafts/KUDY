import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStaticServer } from '../../../tools/serve-static.mjs';

// Serves the repository root read-only: the prototype imports the normative
// run model (docs/run-model/run-model.mjs) and the accepted discovery fixture
// copy across spike boundaries, and duplicating either would drift (rule 2).
const root = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const server = createStaticServer(root);
server.listen(4174, '127.0.0.1', () => console.log('g06.08 prototype: http://127.0.0.1:4174/spikes/G06.08-prototype/prototype/'));
