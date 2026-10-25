import { router, useTheme } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { API_URL } from "@/lib/checkout-client";

export default function Home() {
  const { colors } = useTheme();
  const [id, setId] = useState("");
  const trimmed = id.trim();
  return (
    <View style={styles.container}>
      <Text style={[styles.title, { color: colors.text }]}>Checkout</Text>
      <Text style={{ color: colors.text, textAlign: "center" }}>
        Scan the app QR code on a web checkout, or open
        continuity://checkout/ID, to continue it here.
      </Text>
      <TextInput
        value={id}
        onChangeText={setId}
        placeholder="Session id, e.g. cs_1234…"
        placeholderTextColor={colors.border}
        autoCapitalize="none"
        autoCorrect={false}
        style={[
          styles.input,
          { color: colors.text, borderColor: colors.border },
        ]}
      />
      <Pressable
        accessibilityRole="button"
        disabled={!trimmed}
        onPress={() => router.push(`/checkout/${trimmed}`)}
        style={[
          styles.button,
          { backgroundColor: colors.primary, opacity: trimmed ? 1 : 0.5 },
        ]}
      >
        <Text style={styles.buttonText}>Open checkout</Text>
      </Pressable>
      <Text style={{ color: colors.border, fontSize: 12 }}>
        Server: {API_URL}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: 24,
  },
  title: { fontSize: 24, fontWeight: "600" },
  input: { width: "100%", borderWidth: 1, borderRadius: 8, padding: 12 },
  button: { borderRadius: 8, paddingVertical: 12, paddingHorizontal: 20 },
  buttonText: { color: "#fff", fontWeight: "600" },
});
