import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
  note: {
    color: "#555",
    marginTop: 8,
  },
  param: {
    color: "#555",
    fontSize: 13,
  },
  row: {
    alignItems: "flex-start",
  },
  title: {
    fontSize: 20,
    fontWeight: "600",
  },
});

function formatParams(params?: Record<string, string | string[]>) {
  if (!params) return [];
  return Object.entries(params).map(([key, value]) => ({
    key,
    value: Array.isArray(value) ? value.join(", ") : value,
  }));
}

/**
 * Navigation-skeleton chrome shared by every route of 19 §2.5 (G06.09.a).
 * No product visuals: screen appearance is gated by G06.06–G06.08.
 */
export function PlaceholderScreen({
  name,
  params,
  children,
}: {
  name: string;
  params?: Record<string, string | string[]>;
  children?: ReactNode;
}) {
  return (
    <View style={styles.container} testID={`screen-${name}`}>
      <Text style={styles.title}>{name}</Text>
      {formatParams(params).map(({ key, value }) => (
        <Text key={key} style={styles.param}>{`${key}: ${value}`}</Text>
      ))}
      <View style={styles.row}>{children}</View>
      <Text style={styles.note}>Placeholder screen — no product visuals yet.</Text>
    </View>
  );
}
