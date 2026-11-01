// DQ-02 (issue #911) — the dev-only specimen screen (spec §4.4, §8.1): it
// renders a component's stories from components/*.stories.tsx without any
// Storybook UI — the stable screenshot target the design-QA chain captures
// (DQ-03 owns visual:check, the baselines stay out of scope here). Deep
// link: kudy:///dev-specimen?component=guide-card, with an optional
// &story=<name> (DQ-03): one story renders alone — the stable per-story
// target the visual:check baselines capture; without the param every story
// renders as before. The gate follows the
// han-probe idiom (G21.47): renders nothing outside __DEV__ — it sits
// before any hook call, so the release build never mounts the surface (a
// hook after an early return is a lint error, the rules-of-hooks order).
import { ScrollView, StyleSheet, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { tokens } from "../components/design-tokens";
import { screenStyles } from "../components/screen-styles";
import { ScaledText } from "../components/scaled-text";
import guideCardMeta, { stories as guideCardStories } from "../components/guide-card.stories";
import type { GuideCardStory } from "../components/guide-card.stories";

// The components the deep link can open — the V1 single component (spec
// §8.1). G26.11 adds entries here, never a second screen.
const REGISTRY: Record<string, { meta: typeof guideCardMeta; stories: typeof guideCardStories }> = {
  "guide-card": { meta: guideCardMeta, stories: guideCardStories },
};

export default function DevSpecimen() {
  if (!__DEV__) return null;
  return <DevSpecimenSurface />;
}

// The hooks live on the inner component: the __DEV__ gate above must sit
// before any hook call so the release build never mounts the surface (the
// rules-of-hooks order — a hook after an early return is a lint error).
function DevSpecimenSurface() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ component?: string | string[]; story?: string | string[] }>();
  const requested = Array.isArray(params.component) ? params.component[0] : params.component;
  const requestedStory = Array.isArray(params.story) ? params.story[0] : params.story;
  const entry = requested ? REGISTRY[requested] : undefined;
  // The DQ-03 story filter: one named story alone, or every story when no
  // name is given. An unknown name falls through to the honest notice below.
  const visibleStories = entry
    ? requestedStory
      ? entry.stories.filter((story) => story.name === requestedStory)
      : entry.stories
    : [];
  return (
    <ScrollView
      style={screenStyles.screen}
      contentContainerStyle={{
        paddingTop: insets.top + tokens.spaceL,
        paddingBottom: insets.bottom + tokens.spaceL,
      }}
      testID="screen-Dev specimen"
    >
      <ScaledText style={screenStyles.title} testID="dev-specimen/title">
        Dev specimen
      </ScaledText>
      {entry && visibleStories.length > 0 ? (
        renderStories(entry, visibleStories)
      ) : (
        // The honest state for a missing or unknown component or story name —
        // never a fake surface (the design-QA report reads what is actually
        // rendered).
        <View testID="dev-specimen/unknown">
          <ScaledText style={styles.unknownText}>
            {entry
              ? `No story named: ${requestedStory} for component: ${requested}`
              : requested
                ? `No stories for component: ${requested}`
                : "No component in the deep link"}
          </ScaledText>
          <ScaledText style={styles.unknownText}>
            {entry ? `Available stories: ${entry.stories.map((story) => story.name).join(", ")}` : `Available: ${Object.keys(REGISTRY).join(", ")}`}
          </ScaledText>
        </View>
      )}
    </ScrollView>
  );
}

// The story blocks: a module-level helper so `entry` is a non-optional
// parameter here — the JSX conditional above narrows it, but a narrowing
// does not survive into an inline map callback (the TS18048 the helper
// avoids).
function renderStories(
  entry: { meta: typeof guideCardMeta; stories: typeof guideCardStories },
  stories: readonly GuideCardStory[],
) {
  return stories.map((story) => (
    <View key={story.name} style={styles.storyBlock} testID={`dev-specimen/story-${story.name}`}>
      <ScaledText style={styles.storyLabel} testID={`dev-specimen/label-${story.name}`}>
        {story.name}
      </ScaledText>
      <entry.meta.component {...story.args} />
    </View>
  ));
}

const styles = StyleSheet.create({
  storyBlock: { marginBottom: tokens.spaceL },
  storyLabel: {
    color: tokens.colorMuted,
    fontFamily: tokens.fontFamilyUi,
    fontSize: 12,
    marginBottom: tokens.spaceS,
  },
  unknownText: {
    color: tokens.colorInk,
    fontFamily: tokens.fontFamilyUi,
    fontSize: tokens.fontBaseSize,
    marginTop: tokens.spaceS,
  },
});
