// G16.03 (issue #74) — the rating form route's render suite over the real
// composition root (rule 15): the production feedback controller over the
// real node:sqlite driver and the scripted G16.02 transport. The guards: no
// preselected star, the Send disabled without one, the facts line names the
// bound target (version/locale, no catalog), the kind-closed reason chips,
// the disclosure block, and the honest delivery words (the offline round
// stays «захавана на прыладзе», the acknowledged one «адпраўлена»).
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { fireEvent, renderRouter, screen } from "expo-router/testing-library";

import FeedbackForm from "./feedback";
import { createServices } from "../controllers/createServices";
import { layoutWith } from "../test/render-helpers";
import { feedbackStrings } from "../controllers/useFeedbackController";
import { createFeedbackSync } from "../services/feedbackSync";
import { okPut, openIdentifiedStore, scriptedTransport, secretBox } from "../tests/feedback/queue-fixture";

jest.mock("react-native-safe-area-context", () => ({
  ...(jest.requireActual("react-native-safe-area-context") as Record<string, unknown>),
  useSafeAreaInsets: () => ({ top: 50, bottom: 34, left: 0, right: 0 }),
}));

const strings = feedbackStrings("be");

const withRoutes = (services: ReturnType<typeof createServices>) => ({
  _layout: layoutWith(services),
  feedback: FeedbackForm,
});

afterEach(() => {
  jest.clearAllMocks();
});

// The production world: the real feedback controller over node:sqlite and a
// scripted transport (the acked put answers revision 1).
function feedbackServices(answer = () => okPut(1)) {
  const driver = openIdentifiedStore();
  const transport = scriptedTransport(answer);
  const sync = createFeedbackSync({
    driver,
    secretStore: secretBox("secret-a"),
    baseUrl: "https://functions.example.co/functions/v1",
    transport,
  });
  const services = createServices({ feedback: { driver, sync } });
  return { services, transport };
}

describe("G16.03: the rating form route (issue #74)", () => {
  test("the guide question opens without a preselected star and a disabled Send", async () => {
    const { services } = feedbackServices();
    renderRouter(withRoutes(services), {
      initialUrl: "/feedback?kind=guide&id=guide-route-a1&version=1&locale=be",
    });
    expect(await screen.findByTestId("feedback-title")).toBeTruthy();
    expect(screen.getByText(strings.formTitleGuide)).toBeTruthy();
    // The facts line names the bound target, not a catalog fact.
    expect(screen.getByTestId("feedback-target-line").props.children).toBe(strings.targetLine("1", "be"));
    // No star is preselected: every chip renders its unselected state and
    // the Send stays disabled until one is chosen.
    for (const value of [1, 2, 3, 4, 5]) {
      expect(screen.getByTestId(`feedback-star-${value}`).props.accessibilityState.selected).toBe(false);
    }
    expect(screen.getByTestId("btn-feedback-send").props.accessibilityState.disabled).toBe(true);
    // The versioned purpose disclosure rides the form.
    expect(screen.getByTestId("feedback-disclosure-body")).toBeTruthy();
    expect(screen.getByTestId("feedback-disclosure-analytics")).toBeTruthy();
  });

  test("choosing a star enables the Send; the acked round renders «адпраўлена»", async () => {
    const { services } = feedbackServices();
    renderRouter(withRoutes(services), {
      initialUrl: "/feedback?kind=guide&id=guide-route-a1&version=1&locale=be",
    });
    await screen.findByTestId("feedback-title");
    fireEvent.press(screen.getByTestId("feedback-star-4"));
    expect(screen.getByTestId("btn-feedback-send").props.accessibilityState.disabled).toBe(false);
    fireEvent.press(screen.getByTestId("btn-feedback-send"));
    expect(await screen.findByTestId("feedback-delivery")).toBeTruthy();
    expect(screen.getByTestId("feedback-delivery").props.children).toBe(strings.stateSent);
  });

  test("the offline round keeps the honest pending word (saved on the device is not sent)", async () => {
    const { services } = feedbackServices(() => {
      throw new TypeError("network unreachable");
    });
    renderRouter(withRoutes(services), {
      initialUrl: "/feedback?kind=guide&id=guide-route-a1&version=1&locale=be",
    });
    await screen.findByTestId("feedback-title");
    fireEvent.press(screen.getByTestId("feedback-star-3"));
    fireEvent.press(screen.getByTestId("btn-feedback-send"));
    expect(await screen.findByTestId("feedback-delivery")).toBeTruthy();
    expect(screen.getByTestId("feedback-delivery").props.children).toBe(strings.statePending);
  });

  test("the place question offers the place reasons only — no audio chip", async () => {
    const { services } = feedbackServices();
    renderRouter(withRoutes(services), {
      initialUrl: "/feedback?kind=place&id=place-a1&version=1&locale=be",
    });
    expect(await screen.findByTestId("feedback-title")).toBeTruthy();
    expect(screen.getByText(strings.formTitlePlace)).toBeTruthy();
    expect(screen.queryByTestId("feedback-reason-audio_problem")).toBeNull();
    expect(screen.getByTestId("feedback-reason-worth_visiting")).toBeTruthy();
  });

  test("a corrupt route target renders the honest incomplete-link state", async () => {
    const { services } = feedbackServices();
    renderRouter(withRoutes(services), { initialUrl: "/feedback?kind=collection&id=x&version=1&locale=be" });
    expect(await screen.findByTestId("feedback-invalid")).toBeTruthy();
    expect(screen.queryByTestId("feedback-title")).toBeNull();
  });

  test("without the feedback member the surface renders its honest unavailable state", async () => {
    renderRouter(withRoutes(createServices({})), {
      initialUrl: "/feedback?kind=guide&id=guide-route-a1&version=1&locale=be",
    });
    expect(await screen.findByTestId("feedback-unavailable")).toBeTruthy();
  });
});
