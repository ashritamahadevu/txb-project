import { useCallback, useState } from "react";
import { Pressable, Text } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { api, usdc } from "../api";
import { colors, sans } from "../theme";
import { Button, Card, ErrorText, Field, Muted, Screen, Title } from "../ui";

export default function Circles() {
  const [circles, setCircles] = useState([]);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(() => {
    api("/v1/circles")
      .then((data) => setCircles(data.circles))
      .catch((err) => setError(err.message));
  }, []);

  useFocusEffect(load);

  async function create() {
    setError("");
    try {
      const { circle } = await api("/v1/circles", { method: "POST", json: { name } });
      setName("");
      router.push(`/circle/${circle.id}`);
    } catch (err) {
      setError(err.message);
    }
  }

  async function join() {
    setError("");
    try {
      const { circle } = await api("/v1/circles/join", {
        method: "POST",
        json: { code: code.trim().toUpperCase() },
      });
      setCode("");
      router.push(`/circle/${circle.id}`);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <Screen>
      <Title>Circles</Title>
      <Muted>A circle is the group that can see the proofs and argue about the result.</Muted>
      {circles.map((circle) => (
        <Pressable key={circle.id} onPress={() => router.push(`/circle/${circle.id}`)}>
          <Card>
            <Text style={{ color: colors.text, fontFamily: sans, fontSize: 20 }}>{circle.name}</Text>
            <Muted>
              Code {circle.inviteCode} · default {usdc(circle.defaultStake)}
            </Muted>
          </Card>
        </Pressable>
      ))}
      <Card>
        <Field value={name} onChangeText={setName} placeholder="New circle name" />
        <Button label="Create circle" onPress={create} disabled={name.trim().length < 2} />
      </Card>
      <Card>
        <Field value={code} onChangeText={setCode} placeholder="Invite code" autoCapitalize="characters" />
        <Button label="Join with code" onPress={join} tone="ghost" />
      </Card>
      <ErrorText>{error}</ErrorText>
    </Screen>
  );
}
