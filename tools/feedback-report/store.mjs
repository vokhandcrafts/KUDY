// G16.04 — the saved private report store (docs/architecture/21 §6): saved
// exports live as local files under the agent-session scratch area, which
// the repository git-ignores (.scratch/) — a report of private feedback is
// never a committable artifact. Each file carries its computation time and
// data period; after any device-delete or retention sweep the runbook
// (docs/runbooks/feedback.md) mandates removing and re-creating saved
// exports, which this store's list/remove operations exist for.
import fs from 'node:fs';
import path from 'node:path';

const diagnostic = (code, field, detail) => ({ code, field, detail });

/** A saved-file name is generated or listed output — never a path. */
function safeExportName(name) {
  if (typeof name !== 'string' || name === '' || name.includes('/') || name.includes('\\') || name.includes('..')) {
    return null;
  }
  return name;
}

function timestampSlug(iso) {
  return iso.replace(/:/g, '-');
}

/** Writes one export document; answers `{ok, file}` or `{ok: false, diagnostics}`. */
export function saveFeedbackExport(dir, doc) {
  if (typeof doc?.computed_at !== 'string' || doc.computed_at === '') {
    return { ok: false, diagnostics: [diagnostic('store-computed-at-missing', 'doc.computed_at', 'the export carries its computation time')] };
  }
  const file = `feedback-report-${timestampSlug(doc.computed_at)}.json`;
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, file), `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
  } catch (error) {
    return { ok: false, diagnostics: [diagnostic('store-write-failed', file, error.message)] };
  }
  return { ok: true, file };
}

/** Lists saved exports newest last; a directory that does not exist yet is an empty list. */
export function listSavedExports(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => {
      try {
        const doc = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
        return {
          file: name,
          computed_at: typeof doc.computed_at === 'string' ? doc.computed_at : null,
          period: doc.period ?? null,
          aggregate_count: Array.isArray(doc.aggregates) ? doc.aggregates.length : null,
        };
      } catch {
        return { file: name, computed_at: null, period: null, aggregate_count: null };
      }
    });
}

/** Removes saved exports by name or all of them; unknown names answer as `missing`. */
export function removeSavedExports(dir, { names = [], all = false } = {}) {
  const removed = [];
  const missing = [];
  const diagnostics = [];
  const targets = all ? listSavedExports(dir).map((entry) => entry.file) : names;
  for (const name of targets) {
    const safe = safeExportName(name);
    if (safe === null) {
      diagnostics.push(diagnostic('store-name-unsafe', String(name), 'not a plain file name'));
      continue;
    }
    const file = path.join(dir, safe);
    if (!fs.existsSync(file)) {
      missing.push(safe);
      continue;
    }
    fs.rmSync(file);
    removed.push(safe);
  }
  if (diagnostics.length > 0) return { ok: false, removed, missing, diagnostics };
  return { ok: true, removed, missing, diagnostics };
}
