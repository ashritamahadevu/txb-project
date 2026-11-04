import { Pressable, Text } from "react-native";
import { Stack, router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { colors, sans } from "../theme";

function WalletLink() {
  return (
    <Pressable onPress={() => router.push("/wallet")} style={{ paddingRight: 12 }}>
      <Text style={{ color: colors.lime, fontFamily: sans, fontSize: 16 }}>Wallet</Text>
    </Pressable>
  );
}

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
        <Stack.Screen name="circles" options={{ title: "Circles", headerRight: () => <WalletLink /> }} />
        <Stack.Screen name="circle/[id]" options={{ title: "Circle", headerRight: () => <WalletLink /> }} />
        <Stack.Screen name="bet/[id]" options={{ title: "Bet", headerRight: () => <WalletLink /> }} />
        <Stack.Screen name="leaderboard/[id]" options={{ title: "Leaderboard", headerRight: () => <WalletLink /> }} />
        <Stack.Screen name="wallet" options={{ title: "Wallet" }} />
      </Stack>
    </>
  );
}
