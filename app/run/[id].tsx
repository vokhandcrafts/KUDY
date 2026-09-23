import { useLocalSearchParams, useRouter } from "expo-router";
import { PlaceholderScreen } from "../placeholder";
import { StyleSheet, Text } from "react-native";

const styles = StyleSheet.create({
  back: {
    color: "#0066cc",
    marginTop: 8,
  },
});

export default function Run() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  return (
    <PlaceholderScreen name="Run" params={{ id }}>
      <Text>No session yet — there is nothing to end.</Text>
      <Text onPress={() => router.back()} style={styles.back} testID="btn-back">
        Back
      </Text>
    </PlaceholderScreen>
  );
}
