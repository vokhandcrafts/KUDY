# G06.08 screen package — states, responsive and accessibility

Consumer contract for the UI agents that build the production screens
(G06.01+ for G06 rows, G07, G08). Every state name below is copied verbatim
from its canonical source; sources are anchored per section. Visual values are
deliberately NOT specified here: the design-token source does not exist until
G06.06/G06.07 finish, so the prototype's `styles.css` carries a marked-draft
palette that those tasks supersede.

Screen inventory follows `docs/architecture/09_technical_architecture.md` §6.5
(`Explore`, `RouteDetail` preview, `Run` panel, `Map` = Побач, `MyKUDY`) plus
the navigation contract `docs/11_run_interaction.md` §16 and the acceptance
scenarios `docs/20_discovery_and_feedback.md` §11 (D01–D07, F01–F04, L01–L02).

## Shared rules (all screens)

- **Back is navigation, not a command** (11 §16.2): it never finishes a session,
  never stops audio, never opens the rating form. Every preview opening records
  its **surface-source**; Back returns there. The rating form is a temporary
  surface: no stack entry, Back/«Прапусціць» return to the source (11 §16.7).
- **Прагулка button** is available on every surface of §16 and returns to Run
  with the panel in the position it was left in; audio keeps sounding (NAV7).
- **Empty rubrics do not render** (11 §16.1, NAV2): a section with no published
  content shows nothing anywhere — no placeholder cards, no test guides.
- **Honest degradation** (11 §7): GPS/network/storage failures keep the same
  surface and show a named state; critical messages are never mascot-only.
- **Accessibility floor** (G06.05): BE/EN UI strings, screen-reader labels on
  every icon-only control, big-text mode (≥ 1.2× base size), reduced-motion
  variant (no transitions, no auto-pan), transcripts for every audible story,
  reachable 1–5 scale without public average (R09, 20 §7).

## Explore (горад)

- States: content (D01 — real city content visible with no selections and no
  permissions), empty city (NAV3: named city + honest «not published yet»;
  Побач and My KUDY still work), offline banner «папярэдні валідны кэш»
  (21 §3.3: last valid cache, never a crash), catalog/index hash mismatch →
  same cached fallback.
- Selector «Чым заняцца»: time limit, themes, optional season. Results never
  replace the city or request language silently (20 §3, D04).
- Responsive: single column < 821 px; two-pane ≥ 821 px (selector beside cards).
- Owns: G06.01 (with G06.08 constraints), content rules R01/15 §R08.

## Guides (рубрыка)

- One card per guide in `editorial_order` order; a single guide shows exactly
  one card here and may show the same card on Explore (D02, NAV1).
- Empty state cannot exist (rubric hidden, NAV2).

## Guide preview (RouteDetail)

- Cover, promise, duration range (`estimated_duration`), distance, languages
  per fact (`availability.text_locales` / `audio_locales`), free/paid badge,
  `free_stop_count` for paid (09 §3; 21 §3.2).
- **One main button whose meaning changes**: `Download → Start` (09 §6.5).
  Paid: the tap opens purchase — it never buys, never starts Run, never
  reveals private content (D06); Start exists only after purchase + package
  verification (11 §16.4).
- **L01**: a locale with text but without audio never enables a Start that
  promises audio in that locale; the availability line shows the fact.
- Stop list: unlocked stops show name + story roles; locked stops show name,
  place, short announcement and lock only — full text/transcript/media absent
  from the free package and from any network request (NAV5, N7).
- Start with a live/paused session → the single confirm dialog (11 §4.1, NAV8):
  «Завяршыць “A” і пачаць “B”?» with Завяршыць і пачаць / Скасаваць; Cancel
  returns to the preview with zero session mutation.
- Responsive: stops collapse to a list < 821 px, two columns ≥ 821 px.

## Place card

- Public projection only; explicit «ацаніць месца» entry with the was-here
  confirmation (20 §7). Own rating form is the temporary surface (F01: skip
  records nothing, blocks nothing).
- Owns: G16.03 form shell, G15.03 card rules.

## Collection card (падборка)

- Description, members, `mixed` badge when any paid member; **no Start, no
  buy, no audio** — `audio_locales` is always `[]` (21 §3.2, NAV11). Member tap
  opens the member's own card; Back from a member returns to the collection.
- `overlap_note` is shown when a guide and its start place are both members.
- A selection never mutates the active/paused session, its version, progress
  or audio (D07, 11 §16.5).

## Discovery result

- Exact matches alone (one honest result is enough — D02/D04, 21 §4 rule 7).
- Zero exact: honest message + explicit **alternatives** with their
  `differences`; city and request language never swap silently (D04, NAV4).
- Every card carries its reasons (`editorial`, `theme_match`, `within_time`,
  `season_recommended`) and the paid badge (D06).
- Offline: last valid cache with a visible banner; no cache → ordinary city
  page without the selection (21 §3.3).
- Owns: G15.03 (controller/UI), G15.04 (end-to-end).

## Побач (Map, вольная прагулка)

- Moments teasers with **explicit Play only** (P02, ADR G01.02 §3.6.6: no
  automatic moment cards mid-guide); a Moment without a session plays on the
  same single player with a moment token and mutates no session state (§3.8).
- Manual review of places when there is no position; a radius entry never
  starts audio by itself (G07.01).
- Owns: G07.01/G07.02, moments list G07.03.

## Run

- Map as a background mode (not a tab) + one panel in three positions
  Peek/Half/Full (09 §6.5, 11 §3.2). Markers per ADR G01.01 §4.5, unit = stop:
  `locked` / `playing` / `played` / `available` / `pending`; a tap on a marker
  opens a preview, never audio.
- Peek player bar: now-playing line (owner `guide` or `moment`), live-pause
  indicator, pause/resume/stop, session menu (Прыпыніць прагулку, Завяршыць,
  Змяніць гіда). Paused walk shows «Прагулка прыпынена» + single «Працягнуць»
  (11 §4.2).
- Half: the **inspected** card — transcript always belongs to inspected, not to
  now-playing; a «Зараз грае: …» row with a tap-back appears when inspected ≠
  playing (11 §3.2). Additional (extended) story plays only via explicit
  UserSelectedStory after unlock; locked additional shows announcement + lock.
- Full: full transcript; «далей» scrolls content, never commands the player.
- Autoplay promise shown exactly once after Start (11 §5): «Гісторыі будуць
  запускацца самі, калі вы падыдзеце да кропкі.» — then quiet.
- Suspended automation (after Play Moment / manual stop / focus loss): visible
  «Працягнуць гід» row — the single way back; nothing sounds by itself
  (ADR G01.02 §3.6, C19).
- R07 quiet hint (11 §15, G07.04): a small non-audio card for ANOTHER guide;
  hidden during audio/pause/commercial dialog; one factual show per session
  per guide; tap → preview only, session state read-only.
- Session pause stops guide audio and releases GPS/geofences/wakelock while a
  Moment keeps sounding (ADR G01.02 §3.4); End behaves the same and shows the
  finish screen. Finished never reactivates; a repeat walk is a new session.
- Denied GPS state: named notice, autoplay off, manual Play works; storage
  full and download-failed states keep the same surface with a manual exit
  (G06.05).
- Responsive: < 821 px map above panel; ≥ 821 px map beside panel. Reduced
  motion disables person-dot transitions.
- Owns: G06.02 (map), G06.03 (panel), G06.04 (pause/end/My KUDY flows),
  G06.05 (fair failure states), G07.03/G07.05 (moments/hints in Run).

## End (завяршэнне)

- «Яшчэ можна адкрыць» — unit is `story_id`, locked excluded, possibilities
  never framed as failures (ADR G01.01 §4.6).
- Optional non-modal rating invitation, max once per session, never during
  audio (11 §16.7); skip records nothing and blocks nothing (F01).

## My KUDY

- Walk history: one immutable row per session (`state` active/paused/finished,
  session locale, heard count); old rows are never deleted or rewritten
  (ADR G01.03 §3.1).
- Downloads/storage management lives here, not in long-press (09 §6.5).
- Interface language switch persists explicitly (L02: a new UI language never
  replaces the locale of an active Run; the session row shows its locale).
- My ratings: single current rating per (device, target kind/id/version,
  locale); edit replaces, delete removes from the report; states shown verbatim
  from 21 §5.4: `draft → pending → sending → sent`, failure → `pending`,
  409 → `conflict`, 401/422 → `action_required`; deletion waiting for the
  network says so (F03).
- Owns: G16.02/G16.03/G16.04, G04.04 history persistence.

## Feedback form (temporary surface)

- Target header names the addressee and purpose (guide = the whole experience
  vs place = the physical place; never aggregated — F02, 21 §5.1).
- Score 1–5 with no default; locked reason lists per kind, max 3 unique; the
  locale recorded is the language of the actually used content.
- Save keeps a local draft; Send goes through the states above; a conflict is
  shown honestly, never retried blindly (F03).
- Delivery states and empty/error variants are owned by G16.01/G16.04.
