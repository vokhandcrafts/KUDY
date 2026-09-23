import { Link, useLocalSearchParams } from "expo-router";
import { PlaceholderScreen } from "../placeholder";

export default function RoutePreview() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <PlaceholderScreen name="Route preview" params={{ id }}>
      <Link href="/run/r1" testID="link-run">
        Run
      </Link>
    </PlaceholderScreen>
  );
}
