// G07.02 (issue #282) — the place detail surface (Journey 3: «месца або
// Moment → прэв'ю»): the place's facts line, its moment teasers with the
// explicit Play (ADR G01.02 — the ONE player; the ownership decisions are
// the moment controller's, this screen only renders their outcomes and named
// refusals) and the guide link that opens the guide's PREVIEW, never Start
// (criterion 2; the locked protection is the preview screen's own gating —
// criterion 3). Back returns to Побач; the playback context survives
// navigation — the one app-level moment controller owns it (criterion 4).
// State rendering only: every decision lives in the controllers (19 §4.2);
// the physical playback fact arrives through the binding's read (09 §6.3,
// the run surface's `playback` idiom), never a services import.
import { Link, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  placeDetailStrings,
  placeRefusalText,
  type MomentFact,
} from "../../controllers/place/placeDetailController";
import type { MomentPlayBinding, MomentPlayOutcome } from "../../controllers/moment/momentPlayController";
import { useStoreState } from "../../controllers/useControllerStore";
import { useServices, useUiLocale } from "../_layout";
import { AccessBadge } from "../../components/guide-card";
import { BackButton } from "../../components/back-button";
import { uiStrings } from "../../components/ui-strings";
import { LoadingIndicator } from "../../components/loading-indicator";
import { PressableSurface } from "../../components/pressable-surface";
import { ScaledText } from "../../components/scaled-text";
import { screenStyles } from "../../components/screen-styles";
import { tokens } from "../../components/design-tokens";

const styles = StyleSheet.create({
  // G06.10.b: the interface text renders the UI family (canon §3, Golos
  // Text); the strong styles take the named 600 face. While the faces load
  // (and in tests without them) the unknown family names fall back to the
  // system font — weights and sizes hold.
  summary: {
    color: tokens.colorMuted,
    fontFamily: tokens.fontFamilyUi,
    fontSize: tokens.fontBaseSize,
    marginBottom: tokens.spaceS,
  },
  facts: {
    color: tokens.colorMuted,
    fontFamily: tokens.fontFamilyUi,
    fontSize: tokens.fontBaseSize,
    marginBottom: tokens.spaceM,
  },
  note: {
    color: tokens.colorMuted,
    fontFamily: tokens.fontFamilyUi,
    fontSize: tokens.fontBaseSize,
    marginBottom: tokens.spaceM,
  },
  refusal: {
    color: tokens.colorInk,
    fontFamily: tokens.fontFamilyUi,
    fontSize: tokens.fontBaseSize,
    marginBottom: tokens.spaceM,
  },
  card: {
    backgroundColor: tokens.colorCard,
    borderColor: tokens.colorLine,
    borderRadius: tokens.radiusBase,
    borderWidth: 1,
    padding: tokens.spaceM,
    marginBottom: tokens.spaceM,
  },
  cardLabel: {
    color: tokens.colorInk,
    fontFamily: tokens.fontFamilyUiStrong,
    fontSize: tokens.fontBaseSize,
    fontWeight: tokens.fontWeightStrong,
    marginBottom: tokens.spaceS,
  },
  cardBody: {
    color: tokens.colorMuted,
    fontFamily: tokens.fontFamilyUi,
    fontSize: tokens.fontBaseSize,
    marginBottom: tokens.spaceS,
  },
  live: {
    color: tokens.colorInk,
    fontFamily: tokens.fontFamilyUi,
    fontSize: tokens.fontBaseSize,
    marginBottom: tokens.spaceS,
  },
  link: {
    color: tokens.colorInk,
    fontFamily: tokens.fontFamilyUiStrong,
    fontSize: tokens.fontBaseSize,
    fontWeight: tokens.fontWeightStrong,
    marginTop: tokens.spaceS,
  },
  playButton: {
    alignSelf: "flex-start",
    backgroundColor: tokens.colorCard,
    borderColor: tokens.colorLine,
    borderRadius: tokens.radiusBase,
    borderWidth: 1,
    paddingHorizontal: tokens.spaceM,
    paddingVertical: tokens.spaceS,
  },
  playText: {
    color: tokens.colorInk,
    fontFamily: tokens.fontFamilyUiStrong,
    fontSize: tokens.fontBaseSize,
    fontWeight: tokens.fontWeightStrong,
  },
});

// The card's live state from the ONE player's computed fact (09 §6.3): any
// owner counts — the controller's own launch, a routed takeover or a
// session-mirrored moment of the same moment_id.
function momentLiveState(
  playback: ReturnType<MomentPlayBinding["playback"]> | null,
  momentId: string,
): "playing" | "paused" | null {
  if (playback === null) return null;
  if (playback.kind !== "playing" && playback.kind !== "paused") return null;
  const token = playback.token;
  if (token === null || token.kind !== "moment" || token.ref !== momentId) return null;
  return playback.kind;
}

function MomentCard({
  moment,
  momentPlay,
  strings,
}: {
  moment: MomentFact;
  momentPlay: MomentPlayBinding;
  strings: ReturnType<typeof placeDetailStrings>;
}) {
  // The refusal note is this card's local UI state: the outcome's named
  // reason, never a second copy of the player's truth.
  const [refusal, setRefusal] = useState<string | null>(null);
  const live = momentLiveState(momentPlay.playback(), moment.momentId);
  return (
    <View style={styles.card} testID={`place-moment-${moment.momentId}`}>
      <ScaledText style={styles.cardLabel}>{strings.teaserLabel}</ScaledText>
      {moment.teaserText !== null ? <ScaledText style={styles.cardBody}>{moment.teaserText}</ScaledText> : null}
      {live !== null ? (
        <ScaledText style={styles.live} testID={`place-moment-live-${moment.momentId}`}>
          {live === "paused" ? strings.paused : strings.nowPlaying}
        </ScaledText>
      ) : null}
      {refusal !== null ? (
        // G06.05 (AC4/AC5): the named refusal — the reason and the way out in
        // words, a raw diagnostic code never shows alone.
        <ScaledText style={styles.refusal} testID={`place-moment-refusal-${moment.momentId}`}>
          {placeRefusalText(refusal, strings)}
        </ScaledText>
      ) : null}
      {live === "paused" ? (
        <PressableSurface
          style={styles.playButton}
          hitSlop={{ top: 4, bottom: 4 }}
          accessibilityRole="button"
          accessibilityLabel={strings.resumeLabel}
          accessibilityHint={strings.playHint}
          testID={`place-moment-resume-${moment.momentId}`}
          onPress={() => momentPlay.resume()}
        >
          <ScaledText style={styles.playText}>{strings.resumeLabel}</ScaledText>
        </PressableSurface>
      ) : (
        <PressableSurface
          style={styles.playButton}
          hitSlop={{ top: 4, bottom: 4 }}
          accessibilityRole="button"
          accessibilityLabel={strings.playLabel}
          accessibilityHint={strings.playHint}
          testID={`place-moment-play-${moment.momentId}`}
          onPress={() => {
            if (live === "playing") {
              momentPlay.stop();
              setRefusal(null);
              return;
            }
            const outcome: MomentPlayOutcome = momentPlay.play({
              momentId: moment.momentId,
              storyId: moment.storyId,
              path: moment.audioPath,
            });
            setRefusal("refused" in outcome ? outcome.refused : null);
          }}
        >
          <ScaledText style={styles.playText}>{live === null ? strings.playLabel : strings.stopLabel}</ScaledText>
        </PressableSurface>
      )}
      <Link href={`/route/${moment.routeId}`} asChild>
        <PressableSurface
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={strings.guideLink}
          accessibilityHint={strings.guideLinkHint}
          testID={`place-moment-guide-${moment.momentId}`}
        >
          <ScaledText style={styles.link}>{strings.guideLink}</ScaledText>
        </PressableSurface>
      </Link>
    </View>
  );
}

export default function PlaceDetail() {
  const services = useServices();
  // G14.04.d (issue #305): the words read the switchable display locale —
  // a switch re-renders them in place, no restart.
  const locale = useUiLocale();
  const params = useLocalSearchParams<{ id: string }>();
  const placeId = typeof params.id === "string" ? params.id : "";
  // One binding per open (the Nearby surface's pattern); the moment play
  // binding is the app-level singleton — the playback survives navigation.
  const binding = useMemo(
    () => (placeId !== "" && services.place ? services.place.create(placeId) : null),
    [services.place, placeId],
  );
  const state = useStoreState(binding?.store);
  const momentPlay = services.moment ?? null;
  // Subscribed so the cards re-render on launch/focus changes; the physical
  // fact itself is re-read per render through the binding. G06.05 (AC4/AC5):
  // the play failure is a named state now — the note with the way out
  // renders beside the cards, not a silent revert to idle.
  const momentState = useStoreState(momentPlay?.store);
  const playFailure = momentState !== null && momentState.kind === "failed" ? momentState : null;
  // G06.05 (issue #280, AC1): the display locale, not a hard-code.
  const strings = placeDetailStrings(locale);
  // G06.10 (issue #432): the back word is the shared chrome catalog's — the
  // place dictionary holds no copy of it (one back image, one dictionary).
  const back = uiStrings(locale).back;
  // UX 02 (issue #348): the frame's top inset — the content starts below the
  // status bar and the notch with the native header off (AC4).
  const insets = useSafeAreaInsets();
  const facts = state !== null && state.kind === "ready" ? state.facts : null;
  const title = facts?.title ?? placeId;
  return (
    <View style={[screenStyles.screen, { paddingTop: insets.top + tokens.spaceL }]} testID="screen-Place detail">
      {/* UX 02 (issue #348): the back sits in the frame above the scroll —
          reachable while the moment cards are scrolled (AC2). */}
      <BackButton label={back} testID="btn-place-back" />
      {/* UX 01 (issue #347): the detail scrolls — the last moment card is
          reachable beyond the fold. */}
      <ScrollView testID="scroll-place">
        <ScaledText style={screenStyles.title}>{title}</ScaledText>
        {state === null ? (
          <ScaledText style={styles.note} testID="place-unavailable">
            {strings.unavailable}
          </ScaledText>
        ) : state.kind === "loading" ? (
          <LoadingIndicator testID="place-loading" text={strings.loading} />
        ) : state.kind === "error" ? (
          <ScaledText style={styles.note} testID="place-error">
            {strings.error}
          </ScaledText>
        ) : (
          <>
            {facts === null ? (
              <ScaledText style={styles.note} testID="place-nofacts">
                {strings.noFacts}
              </ScaledText>
            ) : (
              <>
                {facts.summary !== null ? <ScaledText style={styles.summary}>{facts.summary}</ScaledText> : null}
                <View style={{ marginBottom: tokens.spaceM }}>
                  <AccessBadge access={facts.access} locale={locale} />
                </View>
                <ScaledText style={styles.facts}>
                  {strings.textLabel}: {facts.text_locales.length > 0 ? facts.text_locales.join(", ") : "—"};{" "}
                  {strings.audioLabel}: {facts.audio_locales.length > 0 ? facts.audio_locales.join(", ") : "—"}
                </ScaledText>
              </>
            )}
            {/* G06.05 (AC4/AC5): the play failure is named, announced, and its
                exit is the play button itself — the note says so, nothing is
                silently swallowed. */}
            {playFailure !== null && momentPlay !== null ? (
              <View testID="place-play-failed" accessibilityLiveRegion="polite">
                <ScaledText style={styles.refusal}>{strings.playFailed}</ScaledText>
                <ScaledText style={styles.note}>{strings.playFailedHint}</ScaledText>
              </View>
            ) : null}
            {state.moments.length === 0 ? (
              <ScaledText style={styles.note} testID="place-moments-empty">
                {strings.empty}
              </ScaledText>
            ) : momentPlay === null ? (
              <ScaledText style={styles.note} testID="place-no-play">
                {strings.unavailable}
              </ScaledText>
            ) : (
              state.moments.map((moment) => (
                <MomentCard key={moment.momentId} moment={moment} momentPlay={momentPlay} strings={strings} />
              ))
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}
