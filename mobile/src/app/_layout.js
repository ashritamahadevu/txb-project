import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { colors } from "../theme";

export default function Layout() {
  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.text,
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.bg },
          headerTitleStyle: { fontWeight: "600" },
          title: "TxB",
        }}
      >
        <Stack.Screen name="circles" options={{ title: "Circles" }} />
        <Stack.Screen name="circle/[id]" options={{ title: "Circle" }} />
        <Stack.Screen name="bet/[id]" options={{ title: "Bet" }} />
        <Stack.Screen name="leaderboard/[id]" options={{ title: "Leaderboard" }} />
      </Stack>
    </>
  );
}
