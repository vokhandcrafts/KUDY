import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Existing handoffs predate the review rule; validate new entries without
// retroactively editing unrelated historical human actions (#844).
const ENFORCED_FROM = "2026-10-22";

function mergeEntriesWithoutLabelCleanup(markdown) {
  const entries = markdown.split(/^### /m).slice(1);
  const missing = [];

  for (const entry of entries) {
    const header = entry.split("\n", 1)[0];
    const date = /^(\d{4}-\d{2}-\d{2})(?=\s|$)/u.exec(header)?.[1];
    if (date && date < ENFORCED_FROM) continue;

    // A linked merge handoff must say how its running issue status is cleared.
    if (!/\bPR:/u.test(entry) || !/\bIssue:/u.test(entry)) continue;
    if (!/мерж/iu.test(entry)) continue;

    // A malformed header must not silently exclude a new linked merge handoff.
    if (!/^\d{4}-\d{2}-\d{2} — \S/u.test(header)) {
      missing.push(header);
      continue;
    }

    const hasCleanup = /(?:знімі|зняць|прыбяры)/iu.test(entry)
      && /`agent:running`/u.test(entry);
    if (!hasCleanup) missing.push(header);
  }
  return missing;
}

const example = (date, action) => `### ${date} — змержы PR
Што зрабіць: ${action}
PR: https://github.com/vokhandcrafts/KUDY/pull/999 · Issue: https://github.com/vokhandcrafts/KUDY/issues/998
`;

test("new linked PR merge actions name the agent:running removal", () => {
  const humanActions = readFileSync(new URL("../../docs/human-actions.md", import.meta.url), "utf8");
  assert.deepEqual(mergeEntriesWithoutLabelCleanup(humanActions), []);
});

test("the guard fails when the removal instruction is reverted", () => {
  const withoutRemoval = example("2026-10-23", "Правер CI і змержы PR.");
  assert.deepEqual(
    mergeEntriesWithoutLabelCleanup(withoutRemoval),
    ["2026-10-23 — змержы PR"],
  );
});

test("the guard accepts explicit cleanup and ignores historical completed entries", () => {
  const withRemoval = example(
    "2026-10-23",
    "Змержы PR і пасля мержу знімі `agent:running` са звязанага issue.",
  );
  assert.deepEqual(mergeEntriesWithoutLabelCleanup(withRemoval), []);
  const wrappedRemoval = example(
    "2026-10-23",
    "Змержы PR і пасля мержу знімі\n`agent:running` са звязанага issue.",
  );
  assert.deepEqual(mergeEntriesWithoutLabelCleanup(wrappedRemoval), []);

  const removeInfinitive = example(
    "2026-10-23",
    "Пасля мержу трэба зняць `agent:running` са звязанага issue.",
  );
  assert.deepEqual(mergeEntriesWithoutLabelCleanup(removeInfinitive), []);

  const malformedHeader = example(
    "2026-10-24",
    "Правер CI і змержы PR.",
  ).replace("2026-10-24 — ", "2026-10-24 ");
  assert.deepEqual(
    mergeEntriesWithoutLabelCleanup(malformedHeader),
    ["2026-10-24 змержы PR"],
  );

  const missingPrMarker = example("2026-10-23", "Змержы PR.")
    .replace("PR:", "URL:");
  const missingIssueMarker = example("2026-10-23", "Змержы PR.")
    .replace("Issue:", "Ticket:");
  assert.deepEqual(mergeEntriesWithoutLabelCleanup(missingPrMarker), []);
  assert.deepEqual(mergeEntriesWithoutLabelCleanup(missingIssueMarker), []);

  assert.deepEqual(
    mergeEntriesWithoutLabelCleanup(example("2026-10-20", "Змержы PR.")),
    [],
  );
  assert.deepEqual(mergeEntriesWithoutLabelCleanup("# Ручныя дзеянні\n"), []);
});

test("the missing-label-removal finding is retained in must-flag review rules", () => {
  const mustFlag = readFileSync(new URL("../../docs/review-must-flag.md", import.meta.url), "utf8");
  assert.match(mustFlag, /- key: missing-label-removal-note\b/u);
});
