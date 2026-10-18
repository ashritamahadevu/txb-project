import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { api } from "../api";
import { colors, sans } from "../theme";
import { Button, ErrorText, Muted, Screen, Title } from "../ui";
import { signInWithDeviceKey } from "../wallet";

export default function SignIn() {
  const [adult, setAdult] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function enter() {
    if (!adult) {
      setError("TxB is for people 18 and older.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const user = await signInWithDeviceKey();
      if (!user.ageConfirmed) {
        await api("/v1/me/age", { method: "POST", json: { confirmed: true } });
      }
      router.replace("/circles");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Text style={{ color: colors.lime, fontFamily: sans, letterSpacing: 2, fontSize: 13 }}>DEVNET</Text>
      <Title>Stake on the habit. Show the photo.</Title>
      <Muted>
        Friends lock USDC on a goal. A Solana program holds the stake. The app checks the photo, and a
        dispute window lets the circle overrule it.
      </Muted>
      <Pressable onPress={() => setAdult((value) => !value)} style={{ flexDirection: "row", gap: 10 }}>
        <View
          style={{
            width: 22,
            height: 22,
            borderRadius: 6,
            borderWidth: 1,
            borderColor: colors.lime,
            backgroundColor: adult ? colors.lime : "transparent",
          }}
        />
        <Text style={{ color: colors.text, fontFamily: sans, flex: 1 }}>
          I am 18 or older. This is a commitment between friends, not a house game.
        </Text>
      </Pressable>
      <Button label={busy ? "Signing…" : "Continue with a key on this device"} onPress={enter} disabled={busy} />
      <ErrorText>{error}</ErrorText>
      <Muted>
        Phantom, Solflare, and Backpack are the wallets for a phone build through the Solana Wallet
        Adapter and Mobile Wallet Adapter. This browser preview keeps an ed25519 key on the device so
        you can sign in. You pay your own network fee. TxB does not sponsor SOL.
      </Muted>
    </Screen>
  );
}
