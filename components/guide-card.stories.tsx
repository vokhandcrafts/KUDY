// DQ-02 (issue #911) — the single source of the guide card's component states
// (spec §4.4, §8.1): CSF stories as plain objects with args, written once.
// No Storybook packages — the story type is declared locally; the real
// @storybook packages belong to DQ-13, which imports this same file. The
// dev-only specimen screen (app/dev-specimen.tsx) renders the stories
// without any Storybook UI. Args carry synthetic fixtures only — the route
// id exists nowhere in the published catalog, nothing real is addressed.
import type { ComponentProps } from "react";

import type { CatalogGuideCard } from "../controllers/catalog/catalogController.ts";
import { GuideCard } from "./guide-card";

// The CSF meta (the default export): the component the stories attach to.
const meta = { title: "components/guide-card", component: GuideCard } as const;
export default meta;

// The story shape Storybook (DQ-13) and the specimen screen both read —
// declared locally, the file has no runtime Storybook dependency.
export type GuideCardStory = {
  name: string;
  args: ComponentProps<typeof GuideCard>;
};

// One synthetic card per story: the access changes, the publication facts
// stay fixed and honest (localesKnown: true is the offer-backed shape, the
// synthetic offer id renders nowhere). estimatedDuration stays null —
// nothing synthetic is invented for a fact the card shows.
function syntheticCard(
  access: CatalogGuideCard["access"],
  title: string,
): CatalogGuideCard {
  return {
    routeId: "synthetic-guide",
    version: "1",
    offerId: "synthetic-offer",
    title,
    summary: "Сінтэтычнае апісанне гіда для праверкі стану карткі.",
    textLocales: ["be", "en"],
    audioLocales: ["be"],
    localesKnown: true,
    access,
    editorialOrder: 1,
    estimatedDuration: null,
  };
}

const CARD_TITLE = "Сінтэтычны гід: Каралеўскі шлях";

export const free: GuideCardStory = {
  name: "free",
  args: { card: syntheticCard("free", CARD_TITLE) },
};

export const paid: GuideCardStory = {
  name: "paid",
  args: { card: syntheticCard("paid", CARD_TITLE) },
};

export const mixed: GuideCardStory = {
  name: "mixed",
  args: { card: syntheticCard("mixed", CARD_TITLE) },
};

// The long synthetic title of the V1 matrix (spec §8.1): transfer, not the
// badge, is the state under observation — the access stays paid.
export const longTitle: GuideCardStory = {
  name: "long-title",
  args: {
    card: syntheticCard(
      "paid",
      "Сінтэтычная доўгая назва гіда для праверкі пераносу радкоў на вузкім экране без абразання",
    ),
  },
};

// The render source of the specimen screen: every new named story joins
// this list in the same change — the dev-specimen single-source test fails
// on a named export missing from it.
export const stories: readonly GuideCardStory[] = [free, paid, mixed, longTitle];
