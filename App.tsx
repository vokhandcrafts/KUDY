import { StatusBar } from "expo-status-bar";
import { StyleSheet, Text, View } from "react-native";

export default function App() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>KUDY — каркас</Text>
      <Text style={styles.note}>Мінімальны інтэграцыйны шаблон; прадуктовых экранаў яшчэ няма.</Text>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    backgroundColor: "#fff",
    flex: 1,
    justifyContent: "center",
  },
  note: {
    color: "#555",
    fontSize: 13,
    marginTop: 8,
  },
  title: {
    fontSize: 20,
    fontWeight: "600",
  },
});
