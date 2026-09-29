// G06.05 (issue #280) — the dialog shell's a11y contract: the two actions
// are buttons with their labels, the card is the modal view, and the dialog
// never animates (the reduced-motion support of AC2 — nothing to turn off).
// Restoring an animated transition turns the animation test red
// (implementation-rules 1).
import { describe, expect, test } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { Modal } from "react-native";

import { ModalDialog, ModalDialogAccept, ModalDialogCancel } from "./modal-dialog";

describe("ModalDialog a11y (G06.05)", () => {
  test("the dialog never animates — the reduced-motion contract stays pinned", () => {
    const { UNSAFE_getByType } = render(
      <ModalDialog onRequestClose={() => {}} testID="dialog">
        <ModalDialogAccept label="Так" onPress={() => {}} testID="a" />
      </ModalDialog>,
    );
    // react-native's Modal element: the animation prop is the reverted-line
    // check — an added fade/slide fails here.
    const modal = UNSAFE_getByType(Modal);
    expect(modal.props.animationType).toBe("none");
  });

  test("the actions are buttons announcing their labels", () => {
    const pressed: string[] = [];
    render(
      <ModalDialog onRequestClose={() => {}} testID="dialog">
        <ModalDialogAccept label="Завершыць" onPress={() => pressed.push("accept")} testID="a" />
        <ModalDialogCancel label="Скасаваць" onPress={() => pressed.push("cancel")} testID="c" />
      </ModalDialog>,
    );
    expect(screen.getByTestId("a").props.accessibilityRole).toBe("button");
    expect(screen.getByTestId("a").props.accessibilityLabel).toBe("Завершыць");
    expect(screen.getByTestId("c").props.accessibilityRole).toBe("button");
    fireEvent.press(screen.getByTestId("c"));
    expect(pressed).toEqual(["cancel"]);
  });
});
