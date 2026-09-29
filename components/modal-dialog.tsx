// UX 06 (issue #352) — the one shared modal shell for the app's dialogs: a
// transparent RN Modal makes the dialog truly modal — TalkBack reads only
// the dialog (the surface behind sits in another native window) and the
// system Back runs onRequestClose, no navigation of its own. The shell owns
// the overlay, the card (visual-language §4: radius 10, max width 400) and
// the two actions; the surfaces own the words. Lives in components/, not
// app/: expo-router treats every app/ file as a route (issue #339).
import type { ReactNode } from "react";
import { Modal, StyleSheet, View } from "react-native";

import { PressableSurface } from "./pressable-surface";
import { ScaledText } from "./scaled-text";
import { tokens } from "./design-tokens";

// 40% ink alpha — a derived shade of color.ink (#22262b), see the file head
// of pressable-surface.tsx: new colors stay out of the surface layer.
const OVERLAY_COLOR = "rgba(34, 38, 43, 0.4)";

const styles = StyleSheet.create({
  overlay: {
    backgroundColor: OVERLAY_COLOR,
    flex: 1,
    justifyContent: "center",
    padding: tokens.spaceL,
  },
  card: {
    alignSelf: "center",
    backgroundColor: tokens.colorCard,
    borderColor: tokens.colorLine,
    borderRadius: tokens.radiusBase,
    borderWidth: 1,
    maxWidth: tokens.dialogMaxWidth,
    padding: tokens.spaceL,
    width: "100%",
  },
  accept: {
    alignItems: "center",
    backgroundColor: tokens.colorAccent,
    borderRadius: tokens.radiusBase,
    marginBottom: tokens.spaceS,
    padding: tokens.spaceM,
  },
  acceptLabel: {
    color: tokens.colorAccentInk,
    fontSize: tokens.fontBaseSize,
  },
  // UX 06 (issue #352) AC2: «Скасаваць» is an active action with its own
  // outline style — never the disabled-looking dimmed copy of the accept.
  cancel: {
    alignItems: "center",
    borderColor: tokens.colorAccent,
    borderRadius: tokens.radiusBase,
    borderWidth: 1,
    marginBottom: tokens.spaceS,
    padding: tokens.spaceM,
  },
  cancelLabel: {
    color: tokens.colorAccent,
    fontSize: tokens.fontBaseSize,
  },
});

export function ModalDialog({
  onRequestClose,
  children,
  testID,
}: {
  onRequestClose: () => void;
  children: ReactNode;
  testID: string;
}) {
  return (
    // The animation stays "none" — the reduced-motion contract of G06.05
    // (AC2): the app's dialogs never animate, so the OS reduce-motion
    // setting has nothing to turn off (test/components pin this; adding
    // motion here must come with an AccessibilityInfo gate).
    <Modal animationType="none" onRequestClose={onRequestClose} testID={testID} transparent>
      <View style={styles.overlay}>
        <View accessibilityViewIsModal={true} style={styles.card}>
          {children}
        </View>
      </View>
    </Modal>
  );
}

export function ModalDialogAccept({
  label,
  onPress,
  testID,
}: {
  label: string;
  onPress: () => void;
  testID: string;
}) {
  return (
    <PressableSurface accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={styles.accept} testID={testID}>
      <ScaledText style={styles.acceptLabel}>{label}</ScaledText>
    </PressableSurface>
  );
}

export function ModalDialogCancel({
  label,
  onPress,
  testID,
}: {
  label: string;
  onPress: () => void;
  testID: string;
}) {
  return (
    <PressableSurface accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={styles.cancel} testID={testID}>
      <ScaledText style={styles.cancelLabel}>{label}</ScaledText>
    </PressableSurface>
  );
}
