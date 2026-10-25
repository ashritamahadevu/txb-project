import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { colors, sans, serif } from "./theme";

export function Screen({ children }) {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {children}
    </ScrollView>
  );
}

export function Title({ children }) {
  return <Text style={styles.title}>{children}</Text>;
}

export function Muted({ children }) {
  return <Text style={styles.muted}>{children}</Text>;
}

export function Card({ children }) {
  return <View style={styles.card}>{children}</View>;
}

export function Field({ value, onChangeText, placeholder, ...rest }) {
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={colors.muted}
      style={styles.input}
      {...rest}
    />
  );
}

export function Button({ label, onPress, tone = "lime", disabled }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.button, tone === "ghost" && styles.ghost, disabled && styles.disabled]}
    >
      <Text style={[styles.buttonText, tone === "ghost" && styles.ghostText]}>{label}</Text>
    </Pressable>
  );
}

export function ErrorText({ children }) {
  if (!children) return null;
  return <Text style={styles.error}>{children}</Text>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 22, paddingBottom: 64, gap: 14, maxWidth: 720, width: "100%", alignSelf: "center" },
  title: { color: colors.text, fontFamily: serif, fontSize: 40, lineHeight: 44 },
  muted: { color: colors.muted, fontFamily: sans, fontSize: 15, lineHeight: 22 },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 18,
    padding: 16,
    gap: 10,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    color: colors.text,
    fontFamily: sans,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
  },
  button: {
    backgroundColor: colors.lime,
    borderRadius: 999,
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: "center",
  },
  ghost: { backgroundColor: "transparent", borderWidth: 1, borderColor: colors.line },
  disabled: { opacity: 0.5 },
  buttonText: { color: colors.ink, fontFamily: sans, fontWeight: "700", fontSize: 15 },
  ghostText: { color: colors.text },
  error: { color: colors.coral, fontFamily: sans },
});
