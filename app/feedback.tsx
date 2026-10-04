// G16.03 (issue #74) — the voluntary private rating form route (the G06.08
// prototype's feedback-form surface): one route serves both questions — the
// guide's whole experience and the place's physical worth (20 §7). The
// target arrives bound in the route params (the ended session's pinned
// version/locale or the opened place card's content identity) and is never
// re-read from a catalog here; the form opens without a preselected star,
// the Send is the one explicit action beside the versioned disclosure, and
// the delivery line keeps the §5.4 distinction the person must see (saved on
// the device is not sent). State rendering only: every decision lives in the
// feedback controller (19 §4.2).
import { useLocalSearchParams } from "expo-router";
import { useEffect, useMemo } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  feedbackDeliveryWord,
  feedbackStrings,
  reasonsFor,
  useFeedbackState,
} from "../controllers/useFeedbackController";
import { useServices, useUiLocale } from "./_layout";
import { BackButton } from "../components/back-button";
import { tokens } from "../components/design-tokens";
import { PressableSurface } from "../components/pressable-surface";
import { ScaledText } from "../components/scaled-text";
import { screenStyles } from "../components/screen-styles";
import { uiStrings } from "../components/ui-strings";

const styles = StyleSheet.create({
  hint: {
    color: tokens.colorMuted,
    fontFamily: tokens.fontFamilyUi,
    fontSize: tokens.fontBaseSize,
    marginBottom: tokens.spaceM,
  },
  factsLine: {
    color: tokens.colorMuted,
    fontFamily: tokens.fontFamilyUi,
    fontSize: 12,
    marginBottom: tokens.spaceM,
  },
  delivery: {
    color: tokens.colorInk,
    fontFamily: tokens.fontFamilyUiStrong,
    fontSize: tokens.fontBaseSize,
    fontWeight: tokens.fontWeightStrong,
    marginBottom: tokens.spaceM,
  },
  diagnostic: {
    color: tokens.colorMuted,
    fontFamily: tokens.fontFamilyUi,
    fontSize: 12,
    marginBottom: tokens.spaceM,
  },
  section: {
    color: tokens.colorMuted,
    fontFamily: tokens.fontFamilyUiStrong,
    fontSize: tokens.fontBaseSize,
    fontWeight: tokens.fontWeightStrong,
    marginBottom: tokens.spaceS,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: tokens.spaceS,
    marginBottom: tokens.spaceM,
  },
  chip: {
    borderColor: tokens.colorLine,
    borderRadius: tokens.radiusBase,
    borderWidth: 1,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: tokens.spaceM,
    paddingVertical: tokens.spaceS,
  },
  chipSelected: {
    borderColor: tokens.colorAccent,
  },
  chipLabel: {
    color: tokens.colorMuted,
    fontFamily: tokens.fontFamilyUi,
    fontSize: tokens.fontBaseSize,
  },
  chipLabelSelected: {
    color: tokens.colorAccent,
    fontFamily: tokens.fontFamilyUiStrong,
    fontWeight: tokens.fontWeightStrong,
  },
  action: {
    alignSelf: "flex-start",
    backgroundColor: tokens.colorAccent,
    borderRadius: tokens.radiusBase,
    marginBottom: tokens.spaceS,
    marginTop: tokens.spaceM,
    paddingHorizontal: tokens.spaceL,
    paddingVertical: tokens.spaceM,
  },
  actionLabel: {
    color: tokens.colorAccentInk,
    fontFamily: tokens.fontFamilyUiStrong,
    fontSize: tokens.fontBaseSize,
    fontWeight: tokens.fontWeightStrong,
  },
  quietAction: {
    alignSelf: "flex-start",
    backgroundColor: tokens.colorCard,
    borderColor: tokens.colorLine,
    borderRadius: tokens.radiusBase,
    borderWidth: 1,
    marginBottom: tokens.spaceS,
    paddingHorizontal: tokens.spaceM,
    paddingVertical: tokens.spaceS,
  },
  quietLabel: {
    color: tokens.colorInk,
    fontFamily: tokens.fontFamilyUiStrong,
    fontSize: tokens.fontBaseSize,
    fontWeight: tokens.fontWeightStrong,
  },
});

export default function FeedbackForm() {
  const params = useLocalSearchParams<{
    kind?: string;
    id?: string;
    version?: string;
    locale?: string;
  }>();
  const services = useServices();
  // G14.04.d (issue #305): the words read the switchable display locale —
  // a switch re-renders them in place. The rated target's content locale is
  // a different fact (the facts line) and never follows this switch.
  const uiLocale = useUiLocale();
  const strings = feedbackStrings(uiLocale);
  const chrome = uiStrings(uiLocale);
  const feedback = services.feedback?.controller ?? null;
  const state = useFeedbackState(feedback);
  const form = state?.form ?? { kind: "closed" };

  // The route params arrive as a fresh object per render — the memo keys on
  // the primitive values, so the parse below runs per real param change,
  // not per render (an unkeyed memo here re-opened the form forever).
  const paramsKey = `${typeof params.kind === "string" ? params.kind : ""}|${typeof params.id === "string" ? params.id : ""}|${
    typeof params.version === "string" ? params.version : ""
  }|${typeof params.locale === "string" ? params.locale : ""}`;
  // The route's target params are untrusted input: the controller's
  // parseTarget runs the repository's closed patterns (kind, id, version,
  // locale) — a failing triple renders the honest incomplete-link state,
  // never a guess (implementation-rules 14). Pure per render.
  const target = useMemo(
    () => (feedback !== null ? feedback.getState().parseTarget(params) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [feedback, paramsKey],
  );
  useEffect(() => {
    if (feedback === null || target === null) return;
    feedback.getState().openForm(target);
    return () => feedback.getState().closeForm();
  }, [feedback, target]);

  const insets = useSafeAreaInsets();
  const open = feedback !== null && target !== null && form.kind === "open" ? form : null;
  return (
    <View style={[screenStyles.screen, { paddingTop: insets.top + tokens.spaceL }]} testID="screen-Feedback">
      <BackButton label={chrome.back} testID="btn-feedback-back" />
      {feedback === null ? (
        <ScaledText style={styles.hint} testID="feedback-unavailable">
          {strings.unavailable}
        </ScaledText>
      ) : target === null ? (
        <ScaledText style={styles.hint} testID="feedback-invalid">
          {strings.invalidTarget}
        </ScaledText>
      ) : open === null ? null : (
        <ScrollView testID="scroll-feedback">
          <ScaledText style={screenStyles.title} testID="feedback-title">
            {open.target.kind === "guide" ? strings.formTitleGuide : strings.formTitlePlace}
          </ScaledText>
          <ScaledText style={styles.factsLine} testID="feedback-target-line">
            {strings.targetLine(open.target.version, open.target.locale)}
          </ScaledText>
          {/* The honest delivery state of `21` §5.4 — saved on the device is
              a different line from sent, a queued delete says so. */}
          {open.delivery.kind !== "none" ? (
            <ScaledText style={styles.delivery} testID="feedback-delivery">
              {feedbackDeliveryWord(open.delivery, strings)}
            </ScaledText>
          ) : null}
          {open.error !== null ? (
            <ScaledText style={styles.diagnostic} testID="feedback-error">
              {open.error}
            </ScaledText>
          ) : null}
          <ScaledText style={styles.hint}>{strings.scaleHint}</ScaledText>
          <View style={styles.chipRow}>
            {[1, 2, 3, 4, 5].map((value) => {
              const selected = open.score === value;
              return (
                <PressableSurface
                  key={value}
                  accessibilityRole="button"
                  accessibilityLabel={strings.starLabel(value)}
                  accessibilityState={{ selected, disabled: open.busy }}
                  disabled={open.busy}
                  onPress={() => feedback?.getState().setScore(value)}
                  style={[styles.chip, selected ? styles.chipSelected : null]}
                  testID={`feedback-star-${value}`}
                >
                  <ScaledText style={[styles.chipLabel, selected ? styles.chipLabelSelected : null]}>
                    {strings.starLabel(value)}
                  </ScaledText>
                </PressableSurface>
              );
            })}
          </View>
          <ScaledText style={styles.section}>{strings.reasonsTitle}</ScaledText>
          <View style={styles.chipRow}>
            {reasonsFor(open.target.kind).map((code) => {
              const selected = open.reasons.includes(code);
              const full = open.reasons.length >= 3 && !selected;
              return (
                <PressableSurface
                  key={code}
                  accessibilityRole="button"
                  accessibilityLabel={strings.reasonText[code] ?? code}
                  accessibilityState={{ selected, disabled: open.busy || full }}
                  disabled={open.busy || full}
                  onPress={() => feedback?.getState().toggleReason(code)}
                  style={[styles.chip, selected ? styles.chipSelected : null]}
                  testID={`feedback-reason-${code}`}
                >
                  <ScaledText style={[styles.chipLabel, selected ? styles.chipLabelSelected : null]}>
                    {strings.reasonText[code] ?? code}
                  </ScaledText>
                </PressableSurface>
              );
            })}
          </View>
          {/* The versioned purpose disclosure (21 §6): who sees the rating,
              that it is never public, and the analytics separation — the Send
              below is the one explicit action the disclosure belongs to. */}
          <ScaledText style={styles.section} testID="feedback-disclosure">
            {strings.disclosureTitle}
          </ScaledText>
          <ScaledText style={styles.hint} testID="feedback-disclosure-body">
            {strings.disclosureBody}
          </ScaledText>
          <ScaledText style={styles.hint} testID="feedback-disclosure-analytics">
            {strings.disclosureAnalytics}
          </ScaledText>
          {open.delivery.kind === "conflict" ? (
            <PressableSurface
              accessibilityRole="button"
              accessibilityLabel={strings.resolveConflict}
              disabled={open.busy}
              onPress={() => void feedback?.getState().resolveConflict()}
              style={styles.quietAction}
              testID="btn-feedback-resolve"
            >
              <ScaledText style={styles.quietLabel}>{strings.resolveConflict}</ScaledText>
            </PressableSurface>
          ) : null}
          {/* Send without a star stays disabled: no default value exists
              (20 §7), and the action_required reconfirmation rides the same
              explicit press (sendNow re-arms the same mutation id). */}
          <PressableSurface
            accessibilityRole="button"
            accessibilityLabel={strings.send}
            accessibilityState={{ disabled: open.score === null || open.busy }}
            disabled={open.score === null || open.busy}
            onPress={() => void feedback?.getState().send()}
            style={[styles.action, open.score === null || open.busy ? styles.quietAction : null]}
            testID="btn-feedback-send"
          >
            <ScaledText style={[styles.actionLabel, open.score === null || open.busy ? styles.chipLabel : null]}>
              {open.busy ? chrome.loading : strings.send}
            </ScaledText>
          </PressableSurface>
          {open.delivery.kind !== "none" ? (
            <PressableSurface
              accessibilityRole="button"
              accessibilityLabel={strings.deleteButton}
              disabled={open.busy}
              onPress={() => void feedback?.getState().remove()}
              style={styles.quietAction}
              testID="btn-feedback-delete"
            >
              <ScaledText style={styles.quietLabel}>{strings.deleteButton}</ScaledText>
            </PressableSurface>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}
