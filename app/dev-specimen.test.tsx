// DQ-02 (issue #911) — the specimen's own guards: the release gate (outside
// __DEV__ the surface renders nothing — removing the gate turns this red),
// the story-render pass (every story of guide-card.stories.tsx renders
// through the specimen screen, each labelled by its name), and the
// single-source tie between the named story exports and the `stories` array
// the specimen reads.
import { afterEach, describe, expect, test } from "@jest/globals";
import { render, screen, within } from "@testing-library/react-native";
import { renderRouter } from "expo-router/testing-library";

import { createServices } from "../controllers/createServices";
import { layoutWith } from "../test/render-helpers";
import * as guideCardStoriesModule from "../components/guide-card.stories";
import type { GuideCardStory } from "../components/guide-card.stories";
import DevSpecimen from "./dev-specimen";

const g = globalThis as { __DEV__?: boolean };

function specimenRouter() {
  return {
    _layout: layoutWith(createServices({})),
    "dev-specimen": DevSpecimen,
  };
}

// Every named story export of the module — the values with the story shape
// (the meta default export carries title/component, the stories array
// carries neither name nor args). The render loop walks this list, not the
// array: a story the array misses still has to render, and the
// single-source test fails until the array catches up.
function namedGuideCardStories(): GuideCardStory[] {
  return Object.values(guideCardStoriesModule).filter(
    (value): value is GuideCardStory =>
      typeof value === "object" && value !== null && "name" in value && "args" in value,
  );
}

describe("DQ-02 (issue #911): the dev-only specimen screen", () => {
  afterEach(() => {
    g.__DEV__ = true;
  });

  test("outside __DEV__ the surface renders nothing — removing the gate turns this red", () => {
    g.__DEV__ = false;
    render(<DevSpecimen />);
    expect(screen.queryByTestId("screen-Dev specimen")).toBeNull();
    expect(screen.queryByTestId("dev-specimen/story-free")).toBeNull();
  });

  test("the deep link renders every story through the specimen, each labelled by its name", async () => {
    renderRouter(specimenRouter(), { initialUrl: "/dev-specimen?component=guide-card" });
    for (const story of namedGuideCardStories()) {
      const block = await screen.findByTestId(`dev-specimen/story-${story.name}`);
      expect(
        within(block).getByTestId(`dev-specimen/label-${story.name}`).props.children,
      ).toBe(story.name);
    }
  });

  test("each rendered story shows the card's access badge", async () => {
    renderRouter(specimenRouter(), { initialUrl: "/dev-specimen?component=guide-card" });
    for (const story of namedGuideCardStories()) {
      const block = await screen.findByTestId(`dev-specimen/story-${story.name}`);
      expect(within(block).getByTestId(`badge-access-${story.args.card.access}`)).toBeTruthy();
    }
  });

  test("an unknown component name renders the honest notice, never a story", async () => {
    renderRouter(specimenRouter(), { initialUrl: "/dev-specimen?component=nowhere" });
    expect(await screen.findByTestId("dev-specimen/unknown")).toBeTruthy();
    expect(screen.queryByTestId("dev-specimen/story-free")).toBeNull();
  });

  test("single source: every named story export sits in the stories array the specimen reads", () => {
    const named = namedGuideCardStories().map((story) => story.name).sort();
    const listed = guideCardStoriesModule.stories.map((story) => story.name).sort();
    expect(named.length).toBeGreaterThan(0);
    expect(named).toEqual(listed);
  });
});
