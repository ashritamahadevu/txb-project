import { useCallback, useState } from "react";
import { Text } from "react-native";
import { useFocusEffect } from "expo-router";
import { api } from "../api";
import { colors, sans } from "../theme";
import { Button, Card, ErrorText, Field, Muted, Screen, Title } from "../ui";
import { generateDeviceKey, saveDisplayName, usePublicKey } from "../wallet";

export default function WalletScreen() {
  const [user, setUser] = useState(null);
  const [name, setName] = useState("");
  const [pasted, setPasted] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api("/v1/me")
      .then((data) => {
        setUser(data.user);
        setName(data.user.hasName ? data.user.displayName : "");
      })
      .catch((err) => setError(err.message));
  }, []);
  useFocusEffect(load);

  async function saveName() {
    setError("");
    setNote("");
    setBusy(true);
    try {
      const next = await saveDisplayName(name.trim());
      setUser(next);
      setName(next.hasName ? next.displayName : "");
      setNote("Display name saved.");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function pasteKey() {
    setError("");
    setNote("");
    setBusy(true);
    try {
      const next = await usePublicKey(pasted);
      setUser(next);
      setPasted("");
      setNote("Wallet updated. This session was signed in again.");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function generate() {
    setError("");
    setNote("");
    setBusy(true);
    try {
      const next = await generateDeviceKey();
      setUser(next);
      setNote("New device key saved. This account is signed in as that key.");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Title>Wallet</Title>
      <Muted>The public key and name other people in your circles see.</Muted>
      {user ? (
        <Card>
          <Text style={{ color: colors.text, fontFamily: sans, fontSize: 16 }} selectable>
            {user.walletPubkey}
          </Text>
          <Muted>{user.hasName ? user.displayName : "No display name yet."}</Muted>
          <Field value={name} onChangeText={setName} placeholder="Display name" autoCapitalize="words" />
          <Button label="Save display name" onPress={saveName} disabled={busy || name.trim().length < 1} />
        </Card>
      ) : (
        <Muted>Loading wallet…</Muted>
      )}
      <Card>
        <Text style={{ color: colors.text, fontFamily: sans, fontSize: 18 }}>Change wallet</Text>
        <Field value={pasted} onChangeText={setPasted} placeholder="Paste a Solana public key" autoCapitalize="none" />
        <Button label="Use this public key" tone="ghost" onPress={pasteKey} disabled={busy || pasted.trim().length < 32} />
        <Button label="Generate a new device key" tone="ghost" onPress={generate} disabled={busy} />
        <Muted>
          Phantom, Solflare, and Backpack are the wallets on a phone build (Wallet Adapter in the browser, Mobile
          Wallet Adapter on Android). This web preview keeps an ed25519 key on the device instead of an extension.
          Generating a new key signs this account in again. Pasting a public key switches the address and refreshes
          your session.
        </Muted>
      </Card>
      {note ? <Muted>{note}</Muted> : null}
      <ErrorText>{error}</ErrorText>
    </Screen>
  );
}
