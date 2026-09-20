// G03.01 — review-report renderer (issue #123): the author's view of a draft
// (docs/07_content_pipeline.md, review step). For every block it prints the
// narration text next to each cited claim with its exact quote, locator and
// source rights — the «факт побач з цытатай» view. Output is deterministic
// (entity order, no timestamps), so the committed report can be sync-guarded
// by tests. Human-facing labels are Belarusian per documentation-language.md.

import fs from 'node:fs';

import { validateAuthoring } from './validate-authoring.mjs';

const KIND_LABELS = {
  orientation: 'orientation — увага, без фактаў',
  fact: 'fact — факт',
  artistic: 'artistic — аўтарская асацыяцыя, не факт',
};

function readJson(path) {
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

function locatorText(locator) {
  const parts = [];
  if (locator && typeof locator.volume === 'string') parts.push(`том ${locator.volume}`);
  if (locator && typeof locator.page === 'number') parts.push(`ст. ${locator.page}`);
  if (locator && typeof locator.paragraph === 'number') parts.push(`абзац ${locator.paragraph}`);
  return parts.join(', ');
}

function sourceLine(sources, sourceId) {
  const source = sources.find((entry) => entry.source_id === sourceId);
  if (!source) return `${sourceId} (крыніца не знойдзена)`;
  return `${sourceId} — ${source.title} (${source.rights}, ${source.year})`;
}

function markText(claim) {
  if (claim.mark === 'ok') return `ok — ${claim.mark_by}, ${claim.mark_at}`;
  if (claim.mark === 'rejected') return 'rejected — адхілена аўтарам';
  return 'не адзначана';
}

export function renderReviewReport(dir, draftId) {
  // The checker is the parse authority: if the workspace no longer validates,
  // the report is not rendered from half-parsed data.
  const check = validateAuthoring(dir);
  if (!check.ok) {
    throw new Error(`прастора не праходзіць праверку (${check.errors[0]?.rule ?? 'невядома'}); запусціце validate-authoring перад аглядам`);
  }

  const sources = readJson(`${dir}/sources.json`);
  const fragments = readJson(`${dir}/fragments.json`);
  const claims = readJson(`${dir}/claims.json`);
  const drafts = fs
    .readdirSync(`${dir}/drafts`)
    .sort()
    .filter((name) => name.endsWith('.json'))
    .map((name) => readJson(`${dir}/drafts/${name}`));
  const draft = drafts.find((entry) => entry.draft_id === draftId);
  if (!draft) return null;

  const fragmentsById = new Map(fragments.map((fragment) => [fragment.fragment_id, fragment]));
  const claimsById = new Map(claims.map((claim) => [claim.claim_id, claim]));
  const decision = draft.review?.decision ?? '—';

  const out = [];
  out.push(`# Аўтарскі агляд: ${draft.title ?? draft.draft_id}`);
  out.push('');
  out.push(`- Драфт: ${draft.draft_id} (мова ${draft.locale ?? '—'}, tier ${draft.tier ?? '—'})`);
  out.push(`- Рашэнне рэвю: ${decision}${decision === 'pending' ? ' — чакае аўтара' : ''}`);
  if (draft.source_draft_id) out.push(`- Пераклад драфта: ${draft.source_draft_id} (рэвю — паўторнае, асабіае)`);
  out.push(`- Крыніцы (${sources.length}):`);
  for (const source of sources) {
    out.push(`  - ${sourceLine(sources, source.source_id)}`);
    if (source.ref) out.push(`    ${source.ref}`);
  }
  out.push('');
  out.push('## Блокі');
  out.push('');
  for (const block of Array.isArray(draft.blocks) ? draft.blocks : []) {
    out.push(`### ${block.block_id} — ${KIND_LABELS[block.kind] ?? block.kind}`);
    out.push('');
    out.push(`> ${block.text ?? ''}`);
    out.push('');
    for (const claimId of Array.isArray(block.claims) ? block.claims : []) {
      const claim = claimsById.get(claimId);
      if (!claim) {
        out.push(`- [${claimId}] (цвярджэнне не знойдзена)`);
        continue;
      }
      out.push(`- [${claimId}] ${claim.text}`);
      out.push(`  - Адзнака аўтара: ${markText(claim)}`);
      for (const fragmentId of Array.isArray(claim.support) ? claim.support : []) {
        const fragment = fragmentsById.get(fragmentId);
        if (!fragment) {
          out.push(`  - Фрагмент ${fragmentId}: не знойдзены`);
          continue;
        }
        out.push(`  - Цытата: „${fragment.quote}“`);
        out.push(`  - Локатар: ${locatorText(fragment.locator)} — ${sourceLine(sources, fragment.source_id)}`);
      }
    }
    out.push('');
  }
  const unmarked = claims.filter((claim) => claim.mark === null).length;
  out.push('## Што зрабіць аўтару');
  out.push('');
  out.push(
    unmarked > 0
      ? `Адзначце ў claims.json кожнае цвярджэнне (mark: ok / rejected, з mark_by і mark_at): чакаюць ${unmarked}.`
      : 'Усе цвярджэнні адзначаныя. Рашэнне — у review драфта (approved / rejected).'
  );
  out.push('');
  return out.join('\n');
}

export function main(argv) {
  const inFlag = argv.indexOf('--in');
  const draftFlag = argv.indexOf('--draft');
  if (inFlag === -1 || !argv[inFlag + 1] || draftFlag === -1 || !argv[draftFlag + 1]) {
    console.error('выкарыстанне: node authoring-review-report.mjs --in <прастора> --draft <draft_id>');
    return 2;
  }
  const report = renderReviewReport(argv[inFlag + 1], argv[draftFlag + 1]);
  if (report === null) {
    console.error(`драфт не знойдзены: ${argv[draftFlag + 1]}`);
    return 1;
  }
  console.log(report);
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith('authoring-review-report.mjs')) {
  process.exit(main(process.argv));
}
