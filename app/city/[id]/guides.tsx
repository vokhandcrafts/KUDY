import { Link, useLocalSearchParams } from "expo-router";
import { PlaceholderScreen } from "../../placeholder";

export default function Guides() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <PlaceholderScreen name="Guides" params={{ id }}>
      <Link href="/route/r1" testID="link-preview">
        Route preview
      </Link>
    </PlaceholderScreen>
  );
}
