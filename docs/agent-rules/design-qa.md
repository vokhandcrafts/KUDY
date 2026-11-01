# Design-QA review policy — DQ-05

Run a design-QA review **on request** and **before closing any task that changes the interface**. Run it in an agent session, **not in CI**, with **no model API key** or external screenshot service. It does not approve visual baselines. DQ-07 benchmarking and DQ-11 image checks are outside this policy.

## Inputs and accepted sources

1. Record the PR/base diff, changed surfaces, head SHA, and exact source commit. Re-read changed references before reporting.
2. Use [visual-language.md](../design/visual-language.md) and its machine token block as canon. Read [screens-and-transitions.md](../design/screens-and-transitions.md) for changed screen behavior. In [brand/decisions.md](../design/brand/decisions.md), **only explicitly accepted** rows constitute rules. Accepted portions of the brand brief require a traceable owner acceptance record. Drafts, mockups, proposals, and unmerged changes are **not** rules.
3. Read [exceptions.md](../design-qa/exceptions.md) and available owner verdicts/ledger. A missing ledger is NOT-VERIFIED, not automatic approval.
4. If available, inspect the visual:check approved baseline, current screenshot, diff PNG, manifest (device/API/theme/font scale/locale/fixture/commit), accessibility tree dump, and source code for invisible touch padding such as hitSlop. Compare only equivalent captures. Do not fabricate artifacts or measurements.
5. For changed images, record known asset provenance and refer dedicated image verification to DQ-11; any unperformed check is NOT-VERIFIED.

## First pass

- Compare changed colors and fonts against approved tokens and roles: Golos for UI, Alegreya for guide/story titles, Caveat only for dragon speech. Check paper-grain exclusions (Run panel, maps, dense text), approved component states, and icon-only screen-reader labels.
- Disabled buttons: per [visual-language.md §5](../design/visual-language.md), text contrast must be **at least 4.5:1** and border contrast **at least 3:1** against the actual surface. Plain opacity reduction is not a substitute; the unavailable reason must remain visible. Distinguish token-based checks from measured rendered pixels.
- Examine text clipping and tap geometry with a valid UI tree plus source evidence. A 48 dp target remains **OPINION** until an accepted owner decision adds it to canon (design-QA spec §12). The UI dump does not include hitSlop; a small visible rectangle alone cannot justify a RULE.
- Screenshot mismatches without a violated accepted rule are DIFF, never RULE. Changes to approved baselines require owner review.
- Respect DT-4 light cartography, DT-6 light splash and light/dark disabled-token distinctions from the exception register.
- Story states: per the [design-QA spec §6.2](../specifications/design-qa/2026-10-30-design-qa-system.md) canon («Што правярае сам») — «Кожная гісторыя (стан) мае здымак; новы стан не з'яўляецца без запісу ў каноне»: every story (state) has a capture, and a new state does not appear without a canon entry. A state without a capture is **NOT-VERIFIED**; a new state without a canon entry is reported for owner review.

## Finding classes

| Class | Evidence and meaning | Disposition |
|---|---|---|
| RULE | Exact accepted source/section or decision ID **and** concrete measured evidence or reproducible artifact showing its violation | Blocks design-QA green |
| DIFF | Approved baseline + current + difference PNG paths, equivalent capture context, changed region and threshold | Requires owner verdict; not automatically blocking as a RULE |
| OPINION | Noncanonical design or accessibility suggestion, with reason and explicit nonblocking status | **At most 3 per report** |
| NOT-VERIFIED | Exact scope and missing proof: device, iOS, TalkBack, approved baseline, tool or build | Never count as pass or failure |

A RULE without either a cited **accepted** rule or evidence must be dropped or reclassified as a nonblocking suggestion where useful. A green token test is not proof of pixel-level contrast. Do not treat absent images as no differences.

## Mandatory refuting second pass

For **each proposed RULE**, independently try to falsify it before publication:

1. Reopen the cited canon at the recorded commit; verify that the text was accepted, still applies to the changed surface, and is not a proposal or draft.
2. Inspect exceptions and previous owner verdicts, particularly DT-4, DT-6, disabled/muted differences and hitSlop.
3. Recheck the measurement and artifact provenance. Confirm actual behavior in the affected production path; mocks alone cannot prove device behavior.
4. Consider an alternative legitimate interpretation. If doubt remains, **drop the RULE** and record the rejected candidate and why it failed in the second-pass section.

Never promote OPINION to RULE to bypass a pending owner decision. Never turn inaccessible evidence into a green verdict.

## Required report

Start with:
- Verdict: RULE_BLOCKED / OWNER_DIFF_REVIEW / NO_VERIFIED_RULE / INSUFFICIENT_EVIDENCE
- Counts: RULE N · DIFF N · OPINION N · NOT-VERIFIED N (surviving findings only)
- Scope: PR number, base/head SHA, changed UI surfaces
- Sources: SHA for canon, decision register and exceptions; reference sections
- Environment: device/API/theme/font/locale/fixture, or NOT-VERIFIED

Then give a DIFF table with columns **surface/state | approved baseline | current PNG | difference PNG | region/threshold | owner verdict**. If no approved matching baseline exists, leave the table empty and record NOT-VERIFIED.

For each finding use this format:

    [RULE] surface / state / theme / font / locale
    Accepted rule: file §section or accepted decision ID
    Evidence: artifact/command and observed measurement
    Expected: canonical measurable condition
    Reproduce: executable check or source of evidence

    [DIFF] surface; three artifact links; observed region; owner verdict pending
    [OPINION] suggestion; reason not in canon
    [NOT-VERIFIED] scope; missing input; what evidence is needed

Close with a **second-pass rejected candidates** section citing the contradicting source for each dropped candidate, and precise owner questions when actually needed. Cap OPINION at three, count missing-device checks openly, and never invent approval of a new baseline.

## Exit

The requested reviewer returns the report. A UI task records its design-QA report **before** being closed; unresolved accepted-rule violations cannot receive a green design-QA outcome. A DIFF awaits owner review; OPINION never blocks. Run no model reviewer in GitHub Actions, set no model API key, and never silently update baselines or another agent's outputs.
