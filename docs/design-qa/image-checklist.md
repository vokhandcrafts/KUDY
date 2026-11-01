# Image checklist — generated illustrations, icons and dragon images (DQ-11)

Every generated image gets the same checks, and a draft is never mistaken for an
accepted asset (design-QA spec [§1.3, §5, §6.2](../specifications/design-qa/2026-10-30-design-qa-system.md)).
This checklist is the dedicated image verification that
[design-QA policy](../agent-rules/design-qa.md) refers changed images to. It runs
in an agent session when an image is added or changed; accepted assets
([#429](https://github.com/vokhandcrafts/KUDY/issues/429) icon package) are
re-checked, never re-drawn.

## 1. Technical script

```sh
node tools/design/image-check.mjs <image...> [--provenance <file>]
```

Reports per image: format, dimensions, alpha channel, file size, SHA-256, and
the provenance status with its decision link. Exit code is 0 only when every
image passes; failures print named findings (`[checksum]`, `[status]`,
`[checksum-mismatch]`, `[decision]`, `[format]`, `[provenance-missing]`,
`[provenance-json]`, `[image]`).

The provenance file (`provenance.json` next to the image, or `--provenance`)
must contain:

| Field | Requirement |
|---|---|
| `status` | exactly `draft` or `accepted` — the script fails otherwise |
| `decision` | non-empty link: the owner decision (issue comment or `decisions.md` row) for `accepted`; the review context the draft awaits for `draft` |
| `files` | map `filename → SHA-256` of the image bytes; the script fails when the image's checksum is missing or stale |
| `rights` | where the usage-rights record lives (canon §3 precedent, §6 rule) |

`assets/kudy-icon/provenance.json` is the accepted-package record
(`app-icon-copper-framed-v1`); `test/fixtures/image-check/provenance.json` is
the committed draft example. A recorded checksum holds only for byte-identical
files — `assets/kudy-icon/**` is pinned `-text` in `.gitattributes` for this.

## 2. Agent checks (per image)

| # | Check | Accepted source | Evidence |
|---|---|---|---|
| 1 | Dragon anatomy: exactly two legs and two wings; no arms, hands or separate forelegs | Owner instruction of 2026-10-21, recorded in the accepted design-QA spec (§1.3, §6.2) and [issue #921](https://github.com/vokhandcrafts/KUDY/issues/921). The canon/AGENTS.md entry is still pending (spec §1.3) — until it lands, cite the spec and #921 | The agent's own limb count on the image; an unsure count goes to the owner (spec §6.3) |
| 2 | No text baked into the image | [Issue #921](https://github.com/vokhandcrafts/KUDY/issues/921); canon [§3](../design/visual-language.md) — captions are runtime overlays (the splash KUDY label appears after the dragon movement, owner decision 2026-10-28), never part of the art | Visual inspection of the full image area |
| 3 | Palette roles only from accepted canon values | [visual-language.md](../design/visual-language.md) machine block; [decisions.md](../design/brand/decisions.md) accepted rows only — B04.1–B04.3 are proposals, not rules; canon §10 for new values. The #429 package palette belongs to that accepted asset (canon §3) | Dominant colors listed against canon tokens and proposals |
| 4 | Status `draft`/`accepted` with a decision link | Spec §1.3 «Чарнавікі — не зацверджаны дызайн» and §5; provenance `status` + `decision` fields | `provenance.json` of the image + script pass |
| 5 | Provenance and rights record | Canon §3 (record-rights precedent), §6 («Любы новы асет дракона трапляе ў канон разам з запісам права на выкарыстанне»); spec §5 (checksum in provenance), §6.1 item 4 | `provenance.json` (`rights` field) + script pass |

A draft is referenced nowhere as an accepted asset; directories under
`docs/design/brand/outputs/` and `docs/design/brand/references/` hold drafts
(A1/B2 — «эскізы для параўнання, не гатовыя асеты») until an owner decision
accepts them. Generating new images and changing accepted assets are out of
scope of any check run.

## 3. Findings

- A script failure is a technical finding with the script output as evidence;
  checksum and status enforcement are hard rules (spec §5: «тэхнічныя праверкі
  (памер, празрыстасць, сума)»).
- Agent-check violations cite their accepted source and evidence per
  [design-QA policy](../agent-rules/design-qa.md) finding classes; a palette
  remark without a cited accepted rule stays `OPINION`.
- `NOT-VERIFIED` is recorded openly, never as a pass: likeness to the figurine
  is **always `NOT-VERIFIED` for the agent** — the figurine photos are not in
  the repository (spec §3, [atlas-brief.md](../design/brand/atlas-brief.md)
  «Рэферэнсы»), and only the owner decides the likeness (spec §6.3,
  [#921](https://github.com/vokhandcrafts/KUDY/issues/921) criterion 4).
