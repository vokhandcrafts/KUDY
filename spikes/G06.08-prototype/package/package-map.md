# G06.08 package map — layouts, assets and states tied to backlog rows

Criterion 4 of the issue: «макеты, ассеты і станы прывязаныя да задач
G06/G07/G08». This map is the index a UI agent uses to find what a backlog row
consumes from this package. Row wording is quoted from
`docs/16_delivery_backlog.md` §G06/G07/G08; state names come from
`package/screens.md` and are not redefined here.

## Layouts (per screen, see screens.md for the state lists)

| Layout / artifact in this package | Consumed by |
|---|---|
| Explore: content, empty city (NAV3), offline cache banner, selector «Чым заняцца» | G06.01 (Горад → Гіды → прэв'ю), G15.03 (selector UI) |
| Guides rubric: one card per guide, hidden-when-empty (NAV1/NAV2) | G06.01 |
| Guide preview: availability per fact, one Download→Start button, locked-stop preview (NAV5), paid preview (D06), NAV8 switch dialog, L01 language rule | G06.01, G08.05 (purchase-disabled honesty), G13.03 (locked preview reading) |
| Place card + own-rating entry | G16.03 (форма), G15.03 |
| Collection card: members, mixed badge, overlap_note, no audio (NAV11) | G15.03 (карткі і пераходы G06.08) |
| Discovery result: exact alone, zero + alternatives with differences (D04), reasons, offline cache | G15.03, G15.04 (скразная прыёмка падбору) |
| Побач/Map: Moments with explicit Play, manual review without position | G07.01 (адкрыцці ў Побач), G07.02 |
| Run: map markers (`locked/playing/played/available/pending`), Peek/Half/Full panel, transcript-on-inspected, «Зараз грае» row | G06.02 (карта), G06.03 (Peek/Half/Full), G06.04 (паўза/завяршэнне/вяртанне) |
| Run extras: autoplay promise ×1, «Працягнуць гід» row, R07 quiet hint, denied/offline/storage states, big-text and reduced-motion variants | G06.05 (дасяжнасць і чэсныя станы збояў), G07.03 (Moments пры актыўным Run), G07.04/G07.05 (R07 кантракт і паказ), G08.05 (спакойныя прапановы) |
| End screen: «Яшчэ можна адкрыць» (unit story), one non-modal rating invitation | G06.04, G16.03 (запрашэнне), G11.01 (D01–L02 прыёмка) |
| My KUDY: history rows, downloads, language switch (L02), my ratings with `draft/pending/sending/sent/conflict/action_required` | G16.01 (сховішча і API), G16.02 (чарга), G16.03 (edit/delete), G16.04 (справаздача), G04.01 (durable радкі) |
| Feedback form: target header, 1–5 no default, locked reason lists, max 3, CAS conflict honesty | G16.01–G16.04 |

## Assets

The prototype ships **no production assets**: stories, coordinates, names and
images in `data/synthetic-city.json` are synthetic demo material; the discovery
offers are the accepted fixture copy (`fixtures/discovery-contract/index-valid.json`
→ `data/discovery-index.json`). UI agents must keep consuming real published
content through the G02/G03 pipeline; nothing here is a content source.

Audio is simulated with a countdown clock — no audio files, no player adapters
(G00.01/G05.03 own the real audio focus work). Map is positioned dots, not a
MapLibre surface (G00.02 owns the map spike).

## States (canonical homes)

| State family | Canonical source | Demonstrated by |
|---|---|---|
| `locked/playing/played/available/pending` markers, `heard`/`auto_fired` semantics | ADR G01.01 §4.2/§4.5 | prototype Run screen + walkthrough lines 1–9 |
| owner `guide`/`moment`, live pause, 10-min focus threshold, «Працягнуць гід» | ADR G01.02 §3.4–§3.7 | walkthrough lines 3–6, Run panel controls |
| session `Active/Paused/Ended`, immutable `version/locale`, history rows | ADR G01.03 §3.1 | walkthrough lines 10–12, My KUDY table |
| discovery exact/alternatives/`differences`, `DiscoveryIndexV1` fields | doc 21 §3–§4 | discovery screen + walkthrough D03–D07 |
| feedback `draft→pending→sending→sent`, `conflict`, `action_required`, CAS | doc 21 §5 | feedback form + walkthrough F01–F04 |
| D01–D07, F01–F04, L01–L02 acceptance scenarios | doc 20 §11 | walkthrough + screens.md per-screen notes |
| NAV1–NAV11 navigation checks | doc 11 §16.9 | preview/collection/end screens |
| C1–C35 run-interaction criteria | doc 11 §12 | state engine = `docs/run-model/run-model.mjs` |

## Boundaries

- The prototype does not implement production screens; it demonstrates the
  contracts so G06.01+ and G07/G08 tasks can be built against reviewed UX.
- Engine semantics are consumed from `docs/run-model/run-model.mjs`, never
  re-implemented; selection is computed by `core/discovery/selectDiscovery.ts`
  at prepare time (`scripts/prepare-data.mjs`), never re-implemented in the UI.
- Design tokens in `prototype/styles.css` are marked DRAFT and are superseded
  by G06.06 (screen schemes) and G06.07 (visual direction).
  - 2026-09-25: superseded — the visual canon is `docs/design/visual-language.md`
    (G06.07, #180); every draft `:root` token maps to a canon token there, the
    guard is `test/design-tokens.test.mjs`.
