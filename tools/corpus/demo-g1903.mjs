// G19.03 demo harness (issue #460) — deterministic, synthetic, no network.
// Drives the real store and backup modules over a scratch directory and
// prints only stable lines (id prefixes, rule names, counts) so the demo
// output stays byte-identical between runs. Real sources and private paths
// never appear here: every id is a hash of a literal string.
import fs from 'node:fs';
import { createHash } from 'node:crypto';

import { CorpusDiagnostic } from './extract.mjs';
import { backupCorpus, restoreCorpus } from './backup.mjs';
import { closeCorpus, listLibraryPackages, openCorpus, registerPackage, saveCase, storeModelResult } from './store.mjs';
import { makeSyntheticLibrary } from './fixtures/packages.mjs';

const scratch = '.scratch/g1903-demo';
const rule = (operation) => {
  try {
    operation();
  } catch (error) {
    if (error instanceof CorpusDiagnostic) return error.rule;
    return error.name ?? 'error';
  }
  return 'no-diagnostic';
};

fs.rmSync(scratch, { recursive: true, force: true });
fs.mkdirSync(scratch, { recursive: true });

// 1) Registration is idempotent; foreign keys reject orphans; a second write
//    session answers db-busy while the first holds the write lock.
const library = makeSyntheticLibrary({ after() {} }, { seed: 'demo' });
const store = openCorpus(`${scratch}/corpus.db`);
const [pkg] = listLibraryPackages(library.root);
const first = registerPackage(store, pkg);
const second = registerPackage(store, pkg);
console.log(`registration: first=${first.alreadyRegistered} second=${second.alreadyRegistered}`);

const foreign = { ...pkg, document: { ...pkg.document, fragments: pkg.document.fragments.map((fragment) => ({ ...fragment, revision_id: shaPrefix('foreign-revision') })) } };
console.log(`orphan rule: ${rule(() => registerPackage(store, foreign))}`);

const secondStore = openCorpus(`${scratch}/corpus.db`);
store.db.exec('BEGIN IMMEDIATE');
console.log(`busy rule: ${rule(() => registerPackage(secondStore, pkg))}`);
store.db.exec('ROLLBACK');
closeCorpus(secondStore);

// 2) A machine result lands; the backup captures it and the files; the
//    restore reproduces the annotations in a fresh root; a tampered backup
//    refuses to materialize anything.
storeModelResult(store, {
  article_id: library.articleId,
  revision_id: library.revisionId,
  run_id: 'run-demo',
  vocabulary_version: 'gdansk-v1',
  entities: [{ entity_id: 'ent-demo', kind: 'place', name: 'Дэма', matching_status: 'unmatched' }],
  mentions: [{ kind: 'place', fragment_id: library.fragmentId, start: 0, end: 5, mention_type: 'depicted', proposed_entity_id: 'ent-demo' }],
  time_references: [],
  place_references: [],
  topic_assignments: [],
  hooks: [],
  context_needs: [],
});
saveCase(store, {
  case_id: 'case-demo',
  question: 'Дэма-пытанне?',
  filters: {},
  candidates: [{ candidate_id: 'cand-demo', fragment_ids: [library.fragmentId] }],
  selected: [{ fragment_id: library.fragmentId, revision_id: library.revisionId }],
});
const backup = backupCorpus(store, { libraryRoot: library.root, outDir: `${scratch}/backup` });
console.log(`backup files: ${backup.files}`);
closeCorpus(store);

const restored = restoreCorpus({ backupDir: `${scratch}/backup`, newLibraryRoot: `${scratch}/restored` });
const reopened = openCorpus(restored.dbPath);
const count = (sql) => Number(reopened.db.prepare(sql).get().n);
console.log(
  `restore: results=${count('SELECT COUNT(*) AS n FROM model_results')} media=${count('SELECT COUNT(*) AS n FROM extraction_media')} cases=${count('SELECT COUNT(*) AS n FROM cases')}`
);
closeCorpus(reopened);

fs.appendFileSync(`${scratch}/backup/articles/${library.articleId}/revisions/${library.revisionId}/extractions/${pkg.extractorVersion}/text.md`, 'tampered');
console.log(`corrupt rule: ${rule(() => restoreCorpus({ backupDir: `${scratch}/backup`, newLibraryRoot: `${scratch}/never` }))}`);
console.log(`corrupt target created: ${fs.existsSync(`${scratch}/never`)}`);

fs.rmSync(scratch, { recursive: true, force: true });

function shaPrefix(seed) {
  // Deterministic 64-hex id from a literal seed (the same shape the
  // synthetic fixtures use).
  return createHash('sha256').update(seed).digest('hex');
}
