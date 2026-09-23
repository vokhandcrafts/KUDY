import { Link } from "expo-router";
import { PlaceholderScreen } from "../placeholder";

export default function Explore() {
  return (
    <PlaceholderScreen name="Explore">
      <Link href="/city/gdansk/guides" testID="link-guides">
        Guides
      </Link>
    </PlaceholderScreen>
  );
}
