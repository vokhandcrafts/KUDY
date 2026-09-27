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
import { Link, useRouter, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  placeDetailStrings,
  type MomentFact,
} from "../../controllers/place/placeDetailController";
import type { MomentPlayBinding, MomentPlayOutcome } from "../../controllers/moment/momentPlayController";
import { useStoreState } from "../../controllers/useControllerStore";
import { useServices } from "../_layout";
import { AccessBadge } from "../../components/guide-card";
import { tokens } from "../../components/design-tokens";

const styles = StyleSheet.create({
  screen: {
    backgroundColor: tokens.colorPaper,
    flex: 1,
    padding: tokens.spaceL,
  },
  back: {
    color: tokens.colorMuted,
    fontSize: tokens.fontBaseSize,
    marginBottom: tokens.spaceM,
  },
  title: {
    color: tokens.colorInk,
    fontSize: 18,
    fontWeight: tokens.fontWeightStrong,
    marginBottom: tokens.spaceS,
  },
  summary: {
    color: tokens.colorMuted,
    fontSize: tokens.fontBaseSize,
    marginBottom: tokens.spaceS,
  },
  facts: {
    color: tokens.colorMuted,
    fontSize: tokens.fontBaseSize,
    marginBottom: tokens.spaceM,
  },
  note: {
    color: tokens.colorMuted,
    fontSize: tokens.fontBaseSize,
    marginBottom: tokens.spaceM,
  },
  refusal: {
    color: tokens.colorInk,
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
    fontSize: tokens.fontBaseSize,
    fontWeight: tokens.fontWeightStrong,
    marginBottom: tokens.spaceS,
  },
  cardBody: {
    color: tokens.colorMuted,
    fontSize: tokens.fontBaseSize,
    marginBottom: tokens.spaceS,
  },
  live: {
    color: tokens.colorInk,
    fontSize: tokens.fontBaseSize,
    marginBottom: tokens.spaceS,
  },
  link: {
    color: tokens.colorInk,
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
      <Text style={styles.cardLabel}>{strings.teaserLabel}</Text>
      {moment.teaserText !== null ? <Text style={styles.cardBody}>{moment.teaserText}</Text> : null}
      {live !== null ? (
        <Text style={styles.live} testID={`place-moment-live-${moment.momentId}`}>
          {live === "paused" ? strings.paused : strings.nowPlaying}
        </Text>
      ) : null}
      {refusal !== null ? (
        <Text style={styles.refusal} testID={`place-moment-refusal-${moment.momentId}`}>
          {refusal}
        </Text>
      ) : null}
      {live === "paused" ? (
        <Pressable
          style={styles.playButton}
          accessibilityRole="button"
          accessibilityLabel={strings.resumeLabel}
          accessibilityHint={strings.playHint}
          testID={`place-moment-resume-${moment.momentId}`}
          onPress={() => momentPlay.resume()}
        >
          <Text style={styles.playText}>{strings.resumeLabel}</Text>
        </Pressable>
      ) : (
        <Pressable
          style={styles.playButton}
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
          <Text style={styles.playText}>{live === null ? strings.playLabel : strings.stopLabel}</Text>
        </Pressable>
      )}
      <Link href={`/route/${moment.routeId}`} asChild>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={strings.guideLink}
          accessibilityHint={strings.guideLinkHint}
          testID={`place-moment-guide-${moment.momentId}`}
        >
          <Text style={styles.link}>{strings.guideLink}</Text>
        </Pressable>
      </Link>
    </View>
  );
}

export default function PlaceDetail() {
  const services = useServices();
  const router = useRouter();
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
  // fact itself is re-read per render through the binding.
  useStoreState(momentPlay?.store);
  const strings = placeDetailStrings("be");
  const facts = state !== null && state.kind === "ready" ? state.facts : null;
  const title = facts?.title ?? placeId;
  return (
    <View style={styles.screen} testID="screen-Place detail">
      <Pressable onPress={() => router.back()} testID="btn-place-back">
        <Text style={styles.back}>{strings.back}</Text>
      </Pressable>
      <Text style={styles.title}>{title}</Text>
      {state === null ? (
        <Text style={styles.note} testID="place-unavailable">
          {strings.unavailable}
        </Text>
      ) : state.kind === "loading" ? (
        <Text style={styles.note} testID="place-loading">
          {strings.loading}
        </Text>
      ) : state.kind === "error" ? (
        <Text style={styles.note} testID="place-error">
          {strings.error}
        </Text>
      ) : (
        <>
          {facts === null ? (
            <Text style={styles.note} testID="place-nofacts">
              {strings.noFacts}
            </Text>
          ) : (
            <>
              {facts.summary !== null ? <Text style={styles.summary}>{facts.summary}</Text> : null}
              <View style={{ marginBottom: tokens.spaceM }}>
                <AccessBadge access={facts.access} />
              </View>
              <Text style={styles.facts}>
                {strings.textLabel}: {facts.text_locales.length > 0 ? facts.text_locales.join(", ") : "—"};{" "}
                {strings.audioLabel}: {facts.audio_locales.length > 0 ? facts.audio_locales.join(", ") : "—"}
              </Text>
            </>
          )}
          {state.moments.length === 0 ? (
            <Text style={styles.note} testID="place-moments-empty">
              {strings.empty}
            </Text>
          ) : momentPlay === null ? (
            <Text style={styles.note} testID="place-no-play">
              {strings.unavailable}
            </Text>
          ) : (
            state.moments.map((moment) => (
              <MomentCard key={moment.momentId} moment={moment} momentPlay={momentPlay} strings={strings} />
            ))
          )}
        </>
      )}
    </View>
  );
}
