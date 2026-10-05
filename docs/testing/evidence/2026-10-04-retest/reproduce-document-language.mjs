import { expectedDocumentLocale } from '../../../../web/lib/content/exported-language.ts';
import { win32 } from 'node:path';

const paths = ['en/app.html', win32.join('en', 'app.html')];
const results = paths.map(path => ({ path, expected: 'en', actual: expectedDocumentLocale(path) }));
console.log(JSON.stringify(results, null, 2));
process.exitCode = results.some(result => result.actual !== result.expected) ? 1 : 0;
