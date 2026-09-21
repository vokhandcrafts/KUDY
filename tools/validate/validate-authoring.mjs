// G03.01 — authoring-process checker (issue #123). Verifies the Source →
// Fragment → Claim → Draft → approved workspace (authoring/README.md; spec:
// docs/07_content_pipeline.md): every fact traces to a claim backed by an
// exact quote with a locator, an invented connection cannot pass as a fact,
// approval requires a human review record, and a translation is a new draft
// with its own review. G03.02 (issue #58) adds the guide-scenario layer: a
// base story opens with orientation and never sells or dangles the paid layer,
// an extended story states its value, and the scenario file links each stop to
// its own drafts, verified source refs and the discovery season canon.
// Diagnostics carry stable rules and entity paths, never
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
// The season enum copies contracts/schemas/discovery-index.schema.json
// (season_recommendations, 21 §3.2) verbatim; the empty array means
// not_assessed.
const SEASONS = new Set(['spring', 'summer', 'autumn', 'winter']);

// Causal connectives a fact block may use only when a cited claim itself
// states the connection (07, risk 4: the «таму што»/«і тады» class).
const CONNECTIVES = /таму што|з-за гэтага|з-за чаго|праз гэта|у выніку|што прывяло|прывяло да|і тады|дзякуючы|because|therefore/i;

// G03.02 — the free story must be complete in itself (13 §3: «у наратыве няма
// рэкламнага закліку купіць пашырэнне»; 13 §4: «Тэкст не абрываецца дзеля
// пакупкі»): a base draft may neither call to buy nor dangle the paid
// continuation. Exported for the acceptance suite to assert the exact
// patterns (no second copy — implementation-rules 1–2).
export const BASE_PURCHASE = /купіць|купля|пакупк|набыц|за дадатковую плату|поўн(ая|ы|ае|ай|ую) версі|unlock|purchase|upgrade|subscribe/i;
export const BASE_DANGLE = /працяг|пашыран(ая|ы|ае|ага|ым)|у пашырэнні|платн\S* пашырэнн|у поўнай гісторы|to be continued|continue (with|in) the extended/i;

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

// The canon reason is a localized object (be/en/uk, discovery-index schema,
// 21 §3.2); the authoring draft may hold a plain string instead — both count
// as «прычына», neither may be empty.
function isSeasonReason(value) {
  return (
    isText(value) ||
    (isPlainObject(value) && Object.keys(value).length > 0 && Object.values(value).every((v) => isText(v)))
  );
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

// G03.02 — tier rules (13 §2/§3/§4; issue #58 criteria 1, 2, 4). A base story
// opens with orientation and stands alone under any approach order; it never
// sells or dangles the paid layer. An extended story states the value the paid
// layer adds. Only a non-empty blocks array is judged here — corrupt shapes
// are answered by checkBlocks.
function checkTierRules(draft, at, errors) {
  const blocks = Array.isArray(draft.blocks) ? draft.blocks : null;
  if (draft.tier === 'base' && blocks) {
    // An empty or non-orientation first block means the story has no
    // orientation at all — the same violation for a base story.
    if (blocks.length === 0 || !isPlainObject(blocks[0]) || blocks[0].kind !== 'orientation') {
      diag(errors, 'error', 'missing-orientation', `${at}#blocks[0]`);
    }
    blocks.forEach((block, i) => {
      if (!isPlainObject(block) || typeof block.text !== 'string') return;
      if (BASE_PURCHASE.test(block.text)) diag(errors, 'error', 'base-purchase-hook', `${at}#blocks[${i}]#text`);
      if (BASE_DANGLE.test(block.text)) diag(errors, 'error', 'base-paid-dangle', `${at}#blocks[${i}]#text`);
    });
  }
  if (draft.tier === 'extended' && !isText(draft.value)) {
    diag(errors, 'error', 'extended-without-value', `${at}#value`);
  }
}

// G03.02 — the guide scenario (authoring-local, criterion 5): the stops are
// future G15.02 entries, so every stop carries own drafts with matching
// place_id, verified source refs and — where claimed — seasonal
// recommendations in the discovery canon shape ({season, reason}, 21 §3.2).
// A scenario that sells anything must say what the paid layer adds.
function checkScenarios(dir, sourceIds, draftsById, errors) {
  let names;
  try {
    names = fs.readdirSync(`${dir}/scenarios`).sort().filter((name) => name.endsWith('.json'));
  } catch {
    return; // scenarios/ is optional — a workspace may hold drafts only.
  }
  const seen = new Set();
  for (const name of names) {
    const scenario = readJson(dir, `scenarios/${name}`, errors);
    if (!isPlainObject(scenario)) {
      if (scenario !== null) diag(errors, 'error', 'invalid-shape', `scenarios/${name}`);
      continue;
    }
    const at = `scenarios/${name}`;
    if (!isId(scenario.scenario_id)) diag(errors, 'error', 'invalid-shape', `${at}#scenario_id`);
    else if (`${scenario.scenario_id}.json` !== name) diag(errors, 'error', 'scenario-id-mismatch', `${at}#scenario_id`);
    else if (seen.has(scenario.scenario_id)) diag(errors, 'error', 'duplicate-id', `${at}#scenario_id#${scenario.scenario_id}`);
    else seen.add(scenario.scenario_id);
    if (!isText(scenario.theme)) diag(errors, 'error', 'invalid-shape', `${at}#theme`);
    if (typeof scenario.path_minutes !== 'number' || scenario.path_minutes <= 0) {
      diag(errors, 'error', 'invalid-value', `${at}#path_minutes`);
    }
    if (!Array.isArray(scenario.stops)) {
      diag(errors, 'error', 'invalid-shape', `${at}#stops`);
      continue;
    }
    let hasExtended = false;
    scenario.stops.forEach((stop, i) => {
      const where = `${at}#stops[${i}]`;
      if (!isPlainObject(stop)) {
        diag(errors, 'error', 'invalid-shape', where);
        return;
      }
      if (!isId(stop.place_id)) diag(errors, 'error', 'invalid-shape', `${where}#place_id`);
      if (!isText(stop.title)) diag(errors, 'error', 'invalid-shape', `${where}#title`);
      if (typeof stop.walk_minutes !== 'number' || stop.walk_minutes <= 0) {
        diag(errors, 'error', 'invalid-value', `${where}#walk_minutes`);
      }
      if (!Array.isArray(stop.drafts) || stop.drafts.length === 0) {
        diag(errors, 'error', 'invalid-shape', `${where}#drafts`);
      } else {
        stop.drafts.forEach((draftId, j) => {
          const found = isId(draftId) ? draftsById.get(draftId) : undefined;
          if (!found) diag(errors, 'error', 'scenario-unknown-draft-ref', `${where}#drafts[${j}]#${draftId}`);
          else {
            if (found.draft.place_id !== stop.place_id) {
              diag(errors, 'error', 'scenario-draft-place-mismatch', `${where}#drafts[${j}]#${draftId}`);
            }
            if (found.draft.tier === 'extended') hasExtended = true;
          }
        });
      }
      if (!Array.isArray(stop.refs) || stop.refs.length === 0) {
        diag(errors, 'error', 'scenario-place-without-source-refs', `${where}#refs`);
      } else {
        stop.refs.forEach((sourceId, j) => {
          if (!isId(sourceId)) diag(errors, 'error', 'invalid-shape', `${where}#refs[${j}]`);
          else if (!sourceIds.has(sourceId)) diag(errors, 'error', 'scenario-unknown-source-ref', `${where}#refs[${j}]#${sourceId}`);
        });
      }
      if (!Array.isArray(stop.season_recommendations)) {
        diag(errors, 'error', 'invalid-shape', `${where}#season_recommendations`);
      } else {
        stop.season_recommendations.forEach((rec, j) => {
          if (!isPlainObject(rec)) {
            diag(errors, 'error', 'invalid-shape', `${where}#season_recommendations[${j}]`);
            return;
          }
          if (!SEASONS.has(rec.season)) diag(errors, 'error', 'invalid-value', `${where}#season_recommendations[${j}]#season`);
          // The draft holds a plain string (the author's working note); the
          // canon form is the localized object from discovery-index (21 §3.2)
          // — both are accepted, the export to the discovery index makes the
          // object (declared in authoring/README.md).
          if (!isSeasonReason(rec.reason)) {
            diag(errors, 'error', 'season-recommendation-without-reason', `${where}#season_recommendations[${j}]#reason`);
          }
        });
      }
    });
    if (hasExtended && !isText(scenario.paid_note)) diag(errors, 'error', 'scenario-paid-note-missing', `${at}#paid_note`);
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
  const draftsById = new Map();
  for (const name of names) {
    const draft = readJson(dir, `drafts/${name}`, errors);
    if (!isPlainObject(draft)) {
      if (draft !== null) diag(errors, 'error', 'invalid-shape', `drafts/${name}`);
      continue;
    }
    drafts.push({ name, draft });
    if (isId(draft.draft_id)) {
      draftIds.add(draft.draft_id);
      draftsById.set(draft.draft_id, { name, draft });
    }
  }

  for (const { name, draft } of drafts) {
    const at = `drafts/${name}`;
    if (!isId(draft.draft_id)) diag(errors, 'error', 'invalid-shape', `${at}#draft_id`);
    else if (`${draft.draft_id}.json` !== name) diag(errors, 'error', 'draft-id-mismatch', `${at}#draft_id`);
    if (!isId(draft.place_id)) diag(errors, 'error', 'invalid-shape', `${at}#place_id`);
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
      // `by` length copies the story schema canon (maxLength 140).
      if (isText(review.by) && review.by.length > 140) diag(errors, 'error', 'invalid-value', `${at}#review#by`);
      if (review.decision === 'approved' && (!isText(review.by) || review.at === null)) {
        diag(errors, 'error', 'approval-without-reviewer', `${at}#review`);
      }
    }
    checkBlocks(draft, at, errors, claimById);
    checkTierRules(draft, at, errors);
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

  checkScenarios(dir, sourceIds, draftsById, errors);

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
