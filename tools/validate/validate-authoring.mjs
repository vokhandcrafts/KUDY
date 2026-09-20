// G03.01 — authoring-process checker (issue #123). Verifies the Source →
// Fragment → Claim → Draft → approved workspace (authoring/README.md; spec:
// docs/07_content_pipeline.md): every fact traces to a claim backed by an
// exact quote with a locator, an invented connection cannot pass as a fact,
// approval requires a human review record, and a translation is a new draft
// with its own review. Diagnostics carry stable rules and entity paths, never
// file content — the same leak boundary as validate-package.mjs.
// review.{by, at, decision} is the story-schema canon copied verbatim
// (contracts/schemas/story.schema.json, 09 §3); id syntax copies
// contracts/schemas/identifier.schema.json verbatim; the mark vocabulary and
// the block kinds are authoring-local, documented in authoring/README.md.

import fs from 'node:fs';

import { diag, readJson } from './validate-package.mjs';

const RIGHTS = new Set(['public_domain', 'licensed', 'research_only', 'author_own']);
const KINDS = new Set(['orientation', 'fact', 'artistic']);
const TIERS = new Set(['base', 'extended']);
const DECISIONS = new Set(['pending', 'approved', 'rejected']);
const MARKS = new Set(['ok', 'rejected']);
const ID = /^[a-z0-9._-]{1,64}$/;
const DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

// Causal connectives a fact block may use only when a cited claim itself
// states the connection (07, risk 4: the «таму што»/«і тады» class).
const CONNECTIVES = /таму што|з-за гэтага|з-за чаго|праз гэта|у выніку|што прывяло|прывяло да|і тады|дзякуючы|because|therefore/i;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isId(value) {
  return typeof value === 'string' && ID.test(value);
}

function isText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isDateOrNull(value) {
  return value === null || (typeof value === 'string' && DATE.test(value));
}

// Every element is validated before any cross-reference resolution, so corrupt
// input (null elements, wrong types) answers with diagnostics and the walk
// never throws.
function readList(dir, rel, errors) {
  const list = readJson(dir, rel, errors);
  if (!Array.isArray(list)) {
    if (list !== null) diag(errors, 'error', 'invalid-shape', rel);
    return [];
  }
  list.forEach((entry, i) => {
    if (!isPlainObject(entry)) diag(errors, 'error', 'invalid-shape', `${rel}[${i}]`);
  });
  return list.filter((entry) => isPlainObject(entry));
}

function indexById(dir, rel, idField, errors, onEntry) {
  const byId = new Map();
  for (const [i, entry] of readList(dir, rel, errors).entries()) {
    const at = `${rel}[${i}]`;
    if (!isId(entry[idField])) {
      diag(errors, 'error', 'invalid-shape', `${at}#${idField}`);
      continue;
    }
    if (byId.has(entry[idField])) diag(errors, 'error', 'duplicate-id', `${at}#${idField}#${entry[idField]}`);
    else byId.set(entry[idField], entry);
    if (onEntry) onEntry(entry, at);
  }
  return byId;
}

function checkSources(dir, errors) {
  return indexById(dir, 'sources.json', 'source_id', errors, (source, at) => {
    if (!isText(source.title) || !isText(source.ref)) diag(errors, 'error', 'invalid-shape', `${at}`);
    if (typeof source.year !== 'number') diag(errors, 'error', 'invalid-value', `${at}#year`);
    if (!RIGHTS.has(source.rights)) diag(errors, 'error', 'invalid-value', `${at}#rights`);
    if (source.note !== undefined && source.note !== null && !isText(source.note)) {
      diag(errors, 'error', 'invalid-shape', `${at}#note`);
    }
  });
}

function checkFragments(dir, errors, sourceIds) {
  return indexById(dir, 'fragments.json', 'fragment_id', errors, (fragment, at) => {
    if (!isId(fragment.source_id)) diag(errors, 'error', 'invalid-shape', `${at}#source_id`);
    else if (!sourceIds.has(fragment.source_id)) diag(errors, 'error', 'unknown-source-ref', `${at}#source_id#${fragment.source_id}`);
    if (
      !isPlainObject(fragment.locator) ||
      (typeof fragment.locator.page !== 'number' && typeof fragment.locator.paragraph !== 'number')
    ) {
      diag(errors, 'error', 'missing-locator', `${at}#locator`);
    }
    if (!isText(fragment.quote)) diag(errors, 'error', 'missing-quote', `${at}#quote`);
  });
}

function checkClaims(dir, errors, fragmentIds) {
  return indexById(dir, 'claims.json', 'claim_id', errors, (claim, at) => {
    if (!isText(claim.text)) diag(errors, 'error', 'invalid-shape', `${at}#text`);
    if (!Array.isArray(claim.support) || claim.support.length === 0) {
      diag(errors, 'error', 'invalid-shape', `${at}#support`);
    } else {
      claim.support.forEach((fragmentId, j) => {
        if (!isId(fragmentId)) diag(errors, 'error', 'invalid-shape', `${at}#support[${j}]`);
        else if (!fragmentIds.has(fragmentId)) diag(errors, 'error', 'unknown-fragment-ref', `${at}#support[${j}]#${fragmentId}`);
      });
    }
    if (claim.mark !== null && !MARKS.has(claim.mark)) diag(errors, 'error', 'invalid-value', `${at}#mark`);
    if (!isDateOrNull(claim.mark_at)) diag(errors, 'error', 'invalid-value', `${at}#mark_at`);
    if (MARKS.has(claim.mark) && (!isText(claim.mark_by) || claim.mark_at === null)) {
      diag(errors, 'error', 'mark-without-reviewer', `${at}#mark`);
    }
  });
}

function checkBlocks(draft, at, errors, claimById) {
  if (!Array.isArray(draft.blocks)) {
    diag(errors, 'error', 'invalid-shape', `${at}#blocks`);
    return;
  }
  const blockIds = new Set();
  for (const [i, block] of draft.blocks.entries()) {
    const where = `${at}#blocks[${i}]`;
    if (!isPlainObject(block)) {
      diag(errors, 'error', 'invalid-shape', where);
      continue;
    }
    if (!isId(block.block_id)) diag(errors, 'error', 'invalid-shape', `${where}#block_id`);
    else if (blockIds.has(block.block_id)) diag(errors, 'error', 'duplicate-id', `${where}#block_id#${block.block_id}`);
    else blockIds.add(block.block_id);
    if (!KINDS.has(block.kind)) diag(errors, 'error', 'invalid-value', `${where}#kind`);
    if (!isText(block.text)) diag(errors, 'error', 'invalid-shape', `${where}#text`);

    const hasClaims = Array.isArray(block.claims) && block.claims.length > 0;
    if (block.kind === 'fact' && !hasClaims) diag(errors, 'error', 'fact-without-claim', `${where}#claims`);
    if (block.kind !== 'fact' && hasClaims) diag(errors, 'error', 'claims-on-non-fact-block', `${where}#claims`);

    const cited = [];
    if (hasClaims) {
      block.claims.forEach((claimId, j) => {
        if (!isId(claimId)) diag(errors, 'error', 'invalid-shape', `${where}#claims[${j}]`);
        else if (!claimById.has(claimId)) diag(errors, 'error', 'unknown-claim-ref', `${where}#claims[${j}]#${claimId}`);
        else cited.push(claimId);
      });
    }
    checkCitedClaims(draft, block, where, cited, errors, claimById);
  }
}

function checkCitedClaims(draft, block, where, cited, errors, claimById) {
  const decision = isPlainObject(draft.review) ? draft.review.decision : null;
  for (const claimId of cited) {
    const claim = claimById.get(claimId);
    if (claim.mark === 'rejected') diag(errors, 'error', 'rejected-claim-cited', `${where}#claims#${claimId}`);
    if (decision === 'approved' && claim.mark === null) {
      diag(errors, 'error', 'unmarked-claim-in-approved', `${where}#claims#${claimId}`);
    }
  }
  if (block.kind === 'fact' && CONNECTIVES.test(block.text)) {
    const backed = cited.some((claimId) => CONNECTIVES.test(claimById.get(claimId).text));
    if (!backed) diag(errors, 'error', 'unbacked-connection', `${where}#text`);
  }
}

export function validateAuthoring(dir) {
  const errors = [];
  const warnings = [];

  const sourceIds = new Set(checkSources(dir, errors).keys());
  const fragmentIds = new Set(checkFragments(dir, errors, sourceIds).keys());
  const claimById = checkClaims(dir, errors, fragmentIds);

  const draftsDir = `${dir}/drafts`;
  let names;
  try {
    names = fs.readdirSync(draftsDir).sort().filter((name) => name.endsWith('.json'));
  } catch {
    diag(errors, 'error', 'missing-file', 'drafts/');
    names = [];
  }

  const drafts = [];
  const draftIds = new Set();
  for (const name of names) {
    const draft = readJson(dir, `drafts/${name}`, errors);
    if (!isPlainObject(draft)) {
      if (draft !== null) diag(errors, 'error', 'invalid-shape', `drafts/${name}`);
      continue;
    }
    drafts.push({ name, draft });
    if (isId(draft.draft_id)) draftIds.add(draft.draft_id);
  }

  for (const { name, draft } of drafts) {
    const at = `drafts/${name}`;
    if (!isId(draft.draft_id)) diag(errors, 'error', 'invalid-shape', `${at}#draft_id`);
    else if (`${draft.draft_id}.json` !== name) diag(errors, 'error', 'draft-id-mismatch', `${at}#draft_id`);
    if (!isText(draft.locale)) diag(errors, 'error', 'invalid-shape', `${at}#locale`);
    if (!TIERS.has(draft.tier)) diag(errors, 'error', 'invalid-value', `${at}#tier`);
    if (!isText(draft.title)) diag(errors, 'error', 'invalid-shape', `${at}#title`);
    if (draft.source_draft_id !== null && draft.source_draft_id !== undefined) {
      if (!isId(draft.source_draft_id) || draft.source_draft_id === draft.draft_id) {
        diag(errors, 'error', 'invalid-value', `${at}#source_draft_id`);
      }
    }
    const review = draft.review;
    if (!isPlainObject(review)) {
      diag(errors, 'error', 'invalid-shape', `${at}#review`);
    } else {
      if (!DECISIONS.has(review.decision)) diag(errors, 'error', 'invalid-value', `${at}#review#decision`);
      if (!isDateOrNull(review.at)) diag(errors, 'error', 'invalid-value', `${at}#review#at`);
      if (review.decision === 'approved' && (!isText(review.by) || review.at === null)) {
        diag(errors, 'error', 'approval-without-reviewer', `${at}#review`);
      }
    }
    checkBlocks(draft, at, errors, claimById);
  }

  // Translation rule (07: «пераклад — новы Draft … review паўторны»): a
  // translation points at its source draft and, once approved, carries its own
  // review record — never a copy of the source draft's.
  for (const { name, draft } of drafts) {
    if (draft.source_draft_id === null || draft.source_draft_id === undefined) continue;
    if (!draftIds.has(draft.source_draft_id)) {
      diag(errors, 'error', 'unknown-draft-ref', `drafts/${name}#source_draft_id#${draft.source_draft_id}`);
      continue;
    }
    const source = drafts.find((entry) => entry.draft.draft_id === draft.source_draft_id)?.draft;
    const review = draft.review;
    if (
      isPlainObject(source) &&
      isPlainObject(review) &&
      review.decision === 'approved' &&
      isText(review.by) &&
      review.by === source.review?.by &&
      review.at === source.review?.at
    ) {
      diag(errors, 'error', 'translation-copied-review', `drafts/${name}#review`);
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

export function main(argv) {
  const inFlag = argv.indexOf('--in');
  if (inFlag === -1 || !argv[inFlag + 1]) {
    console.error('выкарыстанне: node validate-authoring.mjs --in <прастора>');
    return 2;
  }
  const result = validateAuthoring(argv[inFlag + 1]);
  console.log(JSON.stringify(result));
  return result.ok ? 0 : 1;
}

if (process.argv[1] && process.argv[1].endsWith('validate-authoring.mjs')) {
  process.exit(main(process.argv));
}
