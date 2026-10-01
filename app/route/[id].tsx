// G06.01.b (issue #314) — the guide preview surface (RouteDetail, 09 §6.5):
// the published metadata (languages per availability, the recommended route
// time, open vs locked stops — locked rows show name, place, announce and
// lock only, NAV5) and the one main button whose meaning follows the real
// package facts, Download → Start. Every decision comes from the preview
// controller; a disabled action states its reason (11 §7); the purchase is
// never triggered from the preview (NAV6, D06). Back returns to the surface
// the preview was opened from (NAV9) — expo-router's stack pop, with the
// recorded source kept in the controller state.
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import ClockIcon from "lucide-react-native/icons/clock";
import LockIcon from "lucide-react-native/icons/lock";
import MapPinIcon from "lucide-react-native/icons/map-pin";

import {
  offerStrings,
} from "../../controllers/commerce/commerceController";
import {
  previewReasonText,
  previewStrings,
} from "../../controllers/catalog/previewController";
import { usePreviewController } from "../../controllers/catalog/usePreviewController";
import { useStoreState } from "../../controllers/useControllerStore";
import { BackButton } from "../../components/back-button";
import { CanonIcon } from "../../components/canon-icon";
import { tokens } from "../../components/design-tokens";
import { AccessBadge, LocalesLine, StateBanner } from "../../components/guide-card";
import { LoadingIndicator } from "../../components/loading-indicator";
import {
  ModalDialog,
  ModalDialogAccept,
  ModalDialogCancel,
} from "../../components/modal-dialog";
import { PressableSurface } from "../../components/pressable-surface";
import { ScaledText } from "../../components/scaled-text";
import { screenStyles } from "../../components/screen-styles";
import { uiStrings } from "../../components/ui-strings";
import { UpgradeOffer } from "../../components/upgrade-offer";
import { WalkButton } from "../../components/walk-button";
import { useServices } from "../_layout";

const styles = StyleSheet.create({
  // G06.10.b: the interface text renders the UI family (canon §3, Golos
  // Text); the strong styles take the named 600 face. While the faces load
  // (and in tests without them) the unknown family names fall back to the
  // system font — weights and sizes hold.
  // G06.05 (AC4): the download banner's named retry and the storage exit —
  // a failed download is never a dead end.
  downloadRetry: {
    alignSelf: "flex-start",
    borderColor: tokens.colorAccent,
    borderRadius: tokens.radiusBase,
    borderWidth: 1,
    marginTop: tokens.spaceS,
    paddingHorizontal: tokens.spaceM,
    paddingVertical: tokens.spaceS,
  },
  downloadRetryLabel: {
    color: tokens.colorAccent,
    fontFamily: tokens.fontFamilyUi,
    fontSize: tokens.fontBaseSize,
  },
  summary: {
    color: tokens.colorMuted,
    fontFamily: tokens.fontFamilyUi,
    fontSize: tokens.fontBaseSize,
    marginBottom: tokens.spaceM,
  },
  fact: {
    color: tokens.colorInk,
    fontFamily: tokens.fontFamilyUi,
    fontSize: tokens.fontBaseSize,
    marginTop: tokens.spaceS,
  },
  // G06.10.c (issue #403): the wrapped facts own the row's spacing — the
  // icon (canon tokens, deep import) sits beside the fact text, and the row
  // is the one accessibility element announcing the fact once.
  factRow: {
    alignItems: "center",
    columnGap: tokens.spaceS,
    flexDirection: "row",
    marginTop: tokens.spaceS,
  },
  factRowLabel: {
    color: tokens.colorInk,
    fontFamily: tokens.fontFamilyUi,
    fontSize: tokens.fontBaseSize,
  },
  stops: {
    marginTop: tokens.spaceM,
  },
  stopRow: {
    backgroundColor: tokens.colorCard,
    borderColor: tokens.colorLine,
    borderRadius: tokens.radiusBase,
    borderWidth: 1,
    marginBottom: tokens.spaceS,
    padding: tokens.spaceM,
  },
  stopName: {
    color: tokens.colorInk,
    fontFamily: tokens.fontFamilyUiStrong,
    fontSize: tokens.fontBaseSize,
    fontWeight: tokens.fontWeightStrong,
  },
  stopPlace: {
    color: tokens.colorMuted,
    fontFamily: tokens.fontFamilyUi,
    fontSize: 12,
    marginTop: 2,
  },
  stopAnnounce: {
    color: tokens.colorInk,
    fontFamily: tokens.fontFamilyUi,
    fontSize: tokens.fontBaseSize,
    marginTop: tokens.spaceS,
  },
  lockBadge: {
    alignSelf: "flex-start",
    backgroundColor: tokens.colorBadgePaid,
    borderRadius: tokens.radiusPill,
    marginTop: tokens.spaceS,
    overflow: "hidden",
    paddingHorizontal: tokens.spaceS,
    paddingVertical: 2,
  },
  mainButton: {
    alignItems: "center",
    backgroundColor: tokens.colorAccent,
    borderRadius: tokens.radiusBase,
    marginTop: tokens.spaceM,
    padding: tokens.spaceM,
  },
  mainButtonDisabled: {
    opacity: 0.5,
  },
  mainButtonLabel: {
    color: tokens.colorAccentInk,
    fontFamily: tokens.fontFamilyUiStrong,
    fontSize: tokens.fontBaseSize,
    fontWeight: tokens.fontWeightStrong,
  },
  buttonReason: {
    color: tokens.colorInk,
    fontFamily: tokens.fontFamilyUi,
    fontSize: tokens.fontBaseSize,
    marginTop: tokens.spaceS,
  },
  buttonDetail: {
    color: tokens.colorMuted,
    fontFamily: tokens.fontFamilyUi,
    fontSize: 12,
    marginTop: 2,
  },
  unavailable: {
    color: tokens.colorMuted,
    fontFamily: tokens.fontFamilyUi,
    fontSize: tokens.fontBaseSize,
  },
  confirmText: {
    color: tokens.colorInk,
    fontFamily: tokens.fontFamilyUi,
    fontSize: tokens.fontBaseSize,
    marginBottom: tokens.spaceM,
  },
  // G08.05: the §8 state line after the store leg finished — «Куплена ·
  // трэба загрузіць», the muted honest fact under the description.
  purchasedPending: {
    color: tokens.colorMuted,
    fontSize: tokens.fontBaseSize,
    marginBottom: tokens.spaceM,
    marginTop: tokens.spaceS,
  },
});

export default function RoutePreview() {
  const { id, from } = useLocalSearchParams<{ id: string; from?: string }>();
  const router = useRouter();
  const services = useServices();
  const routeId = typeof id === "string" && id.length > 0 ? id : "";
  const controller = usePreviewController(routeId ? services.preview : undefined, routeId);
  // G08.05 (issue #292): the commerce controller per opened route (the
  // preview idiom). Absent without the commerce port — the preview renders
  // no offer, the fail-closed rule of every optional service member.
  const commerceStore = useMemo(
    () => (routeId && services.commerce ? services.commerce.create(routeId) : undefined),
    [services.commerce, routeId],
  );
  const commerce = useStoreState(commerceStore);
  const ostrings = offerStrings(services.locale);
  useEffect(() => {
    // NAV9: the opening records its source surface; an unrecognized value
    // records nothing (no unvalidated echo, 21 §3.2).
    controller?.recordSource(typeof from === "string" ? from : null);
  }, [controller, from]);

  // UX 02 (issue #348): the frame's top inset — the content starts below the
  // status bar and the notch with the native header off (AC4). A hook —
  // before the early returns.
  const insets = useSafeAreaInsets();
  // G06.05 (issue #280, AC1): the surface and the button's words in the
  // display locale (the button's codes live in the controller).
  const strings = uiStrings(services.locale);
  const pstrings = previewStrings(services.locale);
  // G08.05: the load fact the offer derivation consumes — the access kind
  // and the route document's product_id_route. Called per surface change;
  // the derivation is idempotent.
  const readyPreview = controller?.surface.kind === "ready" ? controller.surface.preview : null;
  useEffect(() => {
    if (commerce && readyPreview) {
      commerce.sync({ access: readyPreview.access, productId: readyPreview.productId });
    }
  }, [commerce, readyPreview]);
  const formatDuration = (
    estimated: { min_minutes: number; max_minutes: number } | null,
    durationMin: number | null,
  ): string | null => {
    if (estimated) return strings.durationRange(estimated.min_minutes, estimated.max_minutes);
    if (durationMin !== null) return strings.durationMinutes(durationMin);
    return null;
  };

  if (!controller) {
    return (
      <View
        style={[screenStyles.screen, { paddingTop: insets.top + tokens.spaceL }]}
        testID="screen-Route preview"
      >
        {/* UX 02 (issue #348): even the unavailable state keeps the frame —
            with the native header off there is no other way back (AC2). */}
        <BackButton label={strings.back} testID="btn-preview-back" />
        <ScaledText style={styles.unavailable}>{strings.catalogUnavailable}</ScaledText>
      </View>
    );
  }
  // Start hands over to the Run surface (the run controller's G06.02 home):
  // the controller gates the §4.1 dialog; the handover itself is navigation.
  const handleMainButton = async () => {
    if (controller.button.action === "download") {
      await controller.download();
      return;
    }
    const outcome = await controller.start();
    if (outcome === "handover") router.push(`/run/${routeId}`);
  };
  const state = controller;
  return (
    <View style={[screenStyles.screen, { paddingTop: insets.top + tokens.spaceL }]} testID="screen-Route preview">
      {/* UX 02 (issue #348): the back sits in the frame above the scroll —
          reachable while the stops list is scrolled (AC2). */}
      <BackButton label={strings.back} testID="btn-preview-back" />
      {/* UX 01 (issue #347): the surface scrolls — every stop and the main
          button stay reachable beyond the fold; the §4.1 overlay stays above. */}
      <ScrollView testID="scroll-preview">
        <WalkButton walk={services.walk} locale={services.locale} />
        {state.surface.kind === "loading" ? <LoadingIndicator text={strings.loading} /> : null}
        {state.surface.kind === "unavailable" ? (
          <View testID="preview-unavailable">
            <ScaledText style={styles.unavailable}>{strings.previewUnavailable}</ScaledText>
            {/* G06.05 (AC1): the named code renders its word; an unknown
                diagnostic renders as-is — honest, never invented. */}
            <ScaledText style={styles.buttonDetail}>
              {previewReasonText(state.surface.reason, pstrings)}
            </ScaledText>
          </View>
        ) : null}
        {state.surface.kind === "ready" ? (
          <View>
            <ScaledText style={screenStyles.title}>{state.surface.preview.title}</ScaledText>
            {state.surface.preview.summary ? (
              <ScaledText style={styles.summary}>{state.surface.preview.summary}</ScaledText>
            ) : null}
            <AccessBadge access={state.surface.preview.access} locale={services.locale} />
            <LocalesLine
              textLocales={state.surface.preview.textLocales}
              audioLocales={state.surface.preview.audioLocales}
              localesKnown={state.surface.preview.localesKnown}
              testID="preview-locales"
              locale={services.locale}
            />
            {formatDuration(state.surface.preview.estimatedDuration, state.surface.preview.durationMin) ? (
              // G06.10.c (issue #403): the first icon application — the
              // metadata row. The row is one accessibility element carrying
              // the fact once; the icon's own required label satisfies the
              // §9 contract if it ever renders outside the row. The row's
              // label lifts null to undefined: RN's accessibilityLabel takes
              // no null — the ternary above guarantees a string here.
              <View
                accessible={true}
                accessibilityLabel={formatDuration(state.surface.preview.estimatedDuration, state.surface.preview.durationMin) ?? undefined}
                style={styles.factRow}
                testID="preview-duration"
              >
                <CanonIcon glyph={ClockIcon} label={strings.durationLabel} />
                {/* The fact text carries its own testID: the row is the one
                    accessibility element (G06.10.c), the font contract of
                    G06.10.b reads the text inside it. */}
                <ScaledText style={styles.factRowLabel} testID="preview-duration-text">
                  {formatDuration(state.surface.preview.estimatedDuration, state.surface.preview.durationMin)}
                </ScaledText>
              </View>
            ) : null}
            {state.surface.preview.stops ? (
              <View
                accessible={true}
                accessibilityLabel={strings.stopsCount(state.surface.preview.stops.length)}
                style={styles.factRow}
                testID="preview-counts"
              >
                <CanonIcon glyph={MapPinIcon} label={strings.stopsLabel} />
                <ScaledText style={styles.factRowLabel} testID="preview-counts-text">
                  {strings.stopsCount(state.surface.preview.stops.length)}
                </ScaledText>
              </View>
            ) : null}
            {state.surface.preview.baseSizeBytes !== null ? (
              <ScaledText style={styles.fact} testID="preview-size">
                {strings.sizeMb(Math.max(1, Math.round(state.surface.preview.baseSizeBytes / 1048576)))}
              </ScaledText>
            ) : null}
            {state.surface.preview.access === "paid" && state.surface.preview.freeStopCount !== null ? (
              <ScaledText style={styles.fact} testID="preview-free-stop-count">
                {strings.freeStopsCount(state.surface.preview.freeStopCount)}
              </ScaledText>
            ) : null}
            {state.surface.degraded ? (
              <StateBanner
                tone="notice"
                reason={strings.degradedData}
                detail={state.surface.degraded}
                testID="preview-banner"
              />
            ) : null}
            {state.downloadError ? (
              // G06.05 (AC4/AC5): the named failure — reason, muted detail,
              // the named retry and, for insufficient-space, the honest exit
              // to the storage surface. Never a dead end; the banner is a
              // live region like every other state banner.
              <View testID="download-error">
                <StateBanner
                  tone="error"
                  reason={state.downloadError}
                  detail={state.downloadDetail ?? undefined}
                  testID="download-error-banner"
                />
                <PressableSurface
                  accessibilityRole="button"
                  accessibilityLabel={pstrings.retry}
                  disabled={state.busy}
                  onPress={() => void handleMainButton()}
                  style={styles.downloadRetry}
                  shelf="line"
                  testID="btn-download-retry"
                >
                  <ScaledText style={styles.downloadRetryLabel}>{pstrings.retry}</ScaledText>
                </PressableSurface>
                {state.downloadStorageExit ? (
                  <PressableSurface
                    accessibilityRole="button"
                    accessibilityLabel={pstrings.storageExit}
                    onPress={() => router.push("/my")}
                    style={styles.downloadRetry}
                    shelf="line"
                    testID="btn-download-storage"
                  >
                    <ScaledText style={styles.downloadRetryLabel}>{pstrings.storageExit}</ScaledText>
                  </PressableSurface>
                ) : null}
              </View>
            ) : null}
            {commerce?.offer === "offered" ? (
              // G08.05 (AC1): the quiet offer at the bottom of the
              // description (11 C26) — available before the first listen,
              // never rendered on the Run surface. The card buys nothing
              // (D06/NAV6): the Buy press inside is the separate explicit
              // action, and the layout callback is the impression fact
              // (AC3), never the mount alone.
              <UpgradeOffer
                title={ostrings.offerTitle}
                body={ostrings.offerBody}
                buyLabel={ostrings.buy}
                dismissLabel={ostrings.dismiss}
                busy={commerce.busy}
                onBuy={() => void commerce.buy()}
                onDismiss={() => commerce.dismiss()}
                onRendered={() => commerce.markRendered()}
              />
            ) : null}
            {commerce?.offer === "paid" ? (
              // G08.05: the `11` §8 verbatim state after the store leg —
              // «Куплена · трэба загрузіць», the honest store fact; the
              // server grant still decides the right (09 §5.1).
              <ScaledText style={styles.purchasedPending} testID="preview-purchased-pending">
                {ostrings.purchasedPending}
              </ScaledText>
            ) : null}
            {state.surface.preview.stops ? (
              <View style={styles.stops} testID="preview-stops">
                {state.surface.preview.stops.map((stop) => (
                  <View key={stop.stopId} style={styles.stopRow} testID={`stop-${stop.stopId}`}>
                    <ScaledText style={styles.stopName}>
                      {stop.name ?? strings.stopNumber(stop.position + 1)}
                    </ScaledText>
                    {/* UX 05 (issue #351): the place's human title from the
                        catalog, never the raw place id — with no published
                        title the line is hidden, nothing is invented. */}
                    {stop.placeName ? <ScaledText style={styles.stopPlace}>{stop.placeName}</ScaledText> : null}
                    {stop.announce ? <ScaledText style={styles.stopAnnounce}>{stop.announce}</ScaledText> : null}
                    {stop.locked ? (
                      // G06.05 (AC1) + G06.10 (issue #432): the badge renders
                      // the Lucide lock — the emoji glyph is gone from the
                      // markup; the screen reader still gets the word, never
                      // the glyph alone (the factRow idiom: the row is the
                      // one accessibility element, the icon's own required
                      // label covers a rendering outside the row).
                      <View
                        accessible={true}
                        accessibilityLabel={strings.locked}
                        style={styles.lockBadge}
                        testID={`stop-locked-${stop.stopId}`}
                      >
                        <CanonIcon glyph={LockIcon} label={strings.locked} />
                      </View>
                    ) : null}
                  </View>
                ))}
              </View>
            ) : null}
            <PressableSurface
              accessibilityRole="button"
              accessibilityLabel={pstrings.label[state.button.label]}
              accessibilityState={{ disabled: !state.button.enabled || state.busy }}
              onPress={() => void handleMainButton()}
              disabled={!state.button.enabled || state.busy}
              style={[styles.mainButton, (!state.button.enabled || state.busy) && styles.mainButtonDisabled]}
              // G06.10.d (issue #404): the one main action of the screen is
              // the clay primary — the accent shelf; the dip rides the
              // shared wrapper (a disabled press never dips).
              shelf="accent"
              testID={state.button.action === "download" ? "btn-download" : "btn-start"}
            >
              <ScaledText style={styles.mainButtonLabel}>{pstrings.label[state.button.label]}</ScaledText>
            </PressableSurface>
            {state.button.reason ? (
              <ScaledText style={styles.buttonReason} testID="button-reason">
                {previewReasonText(state.button.reason, pstrings)}
              </ScaledText>
            ) : null}
            {state.button.detail ? (
              <ScaledText style={styles.buttonDetail} testID="button-detail">
                {pstrings.detail(state.button.detail)}
              </ScaledText>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
      {state.confirm ? (
        // UX 06 (issue #352) AC1: a real modal — TalkBack reads only the
        // dialog, and the system Back closes it in place: the shell's
        // onRequestClose runs the controller's cancel, so no navigation
        // happens and no walk starts.
        <ModalDialog onRequestClose={state.cancelConfirm} testID="confirm-dialog">
          <ScaledText style={styles.confirmText}>
            {strings.switchConfirm(state.confirm.liveTitle, state.confirm.candidateTitle)}
          </ScaledText>
          <ModalDialogAccept
            label={strings.switchAccept}
            onPress={() => {
              // The confirmed §4.1 switch (NAV8): the flag rides the route
              // params — the run surface starts through the switch-guide
              // transaction (the live walk finishes in the same commit the
              // new row inserts), the dialog state itself carries no write.
              state.confirmHandover();
              router.push(`/run/${routeId}?confirmedSwitch=1`);
            }}
            testID="btn-confirm-start"
          />
          {/* UX 06 (issue #352) AC2: «Скасаваць» is an active action with
              its own outline style — the disabled-looking dimmed copy of
              the main button is gone. */}
          <ModalDialogCancel
            label={strings.cancel}
            onPress={() => state.cancelConfirm()}
            testID="btn-confirm-cancel"
          />
        </ModalDialog>
      ) : null}
      {commerce?.attempt.kind === "error" ? (
        // G08.05 (AC2, 11 C28): «Памылка пакупкі пакідае абодва выхады —
        // Try again і Continue free — і не губляе кропку». A real modal
        // like the §4.1 dialog (UX 06); both exits render for every error
        // and the system Back runs Continue free.
        <ModalDialog onRequestClose={commerce.continueFree} testID="purchase-error-dialog">
          <ScaledText style={styles.confirmText}>{ostrings.errorTitle}</ScaledText>
          <ScaledText style={styles.confirmText}>{ostrings.errorBody}</ScaledText>
          <ModalDialogAccept
            label={ostrings.tryAgain}
            onPress={() => void commerce.tryAgain()}
            testID="btn-purchase-retry"
          />
          <ModalDialogCancel
            label={ostrings.continueFree}
            onPress={commerce.continueFree}
            testID="btn-purchase-continue-free"
          />
        </ModalDialog>
      ) : null}
    </View>
  );
}
