import { useCallback, useState } from "react";
import { Pressable, Text } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { api, usdc } from "../../api";
import { colors, sans } from "../../theme";
import { Button, Card, ErrorText, Field, Muted, Screen, Title } from "../../ui";

export default function CircleScreen() {
  const { id } = useLocalSearchParams();
  const [circle, setCircle] = useState(null);
  const [me, setMe] = useState(null);
  const [title, setTitle] = useState("Gym before noon");
  const [stake, setStake] = useState("5");
  const [error, setError] = useState("");

  const load = useCallback(() => {
    api(`/v1/circles/${id}`)
      .then((data) => setCircle(data.circle))
      .catch((err) => setError(err.message));
    api("/v1/me")
      .then((data) => setMe(data.user))
      .catch((err) => setError(err.message));
  }, [id]);
  useFocusEffect(load);

  async function addPartner() {
    setError("");
    try {
      await api(`/v1/circles/${id}/practice-partner`, { method: "POST" });
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function createBet() {
    if (!circle) return;
    const partner = circle.members.find((member) => member.user.practice);
    if (!partner || !me) {
      setError("Add a practice partner, or join from a second device, before opening a bet.");
      return;
    }
    const stakeAmount = Math.round(Number(stake) * 1_000_000);
    if (!Number.isFinite(stakeAmount) || stakeAmount <= 0) {
      setError("Enter a stake in USDC.");
      return;
    }
    setError("");
    try {
      const { bet } = await api(`/v1/circles/${id}/bets`, {
        method: "POST",
        json: {
          title,
          betType: "head_to_head",
          stakeAmount,
          proofsRequired: 1,
          periodHours: 24 * 7,
          participantIds: [me.id, partner.user.id],
        },
      });
      router.push(`/bet/${bet.id}`);
    } catch (err) {
      setError(err.message);
    }
  }

  if (!circle) {
    return (
      <Screen>
        <Muted>Loading circle…</Muted>
        <ErrorText>{error}</ErrorText>
      </Screen>
    );
  }

  return (
    <Screen>
      <Title>{circle.name}</Title>
      <Muted>Invite code {circle.inviteCode}. Share it with the people who can dispute a result.</Muted>
      <Button label="Leaderboard" tone="ghost" onPress={() => router.push(`/leaderboard/${id}`)} />
      <Card>
        <Text style={{ color: colors.text, fontFamily: sans, fontSize: 18 }}>People</Text>
        {circle.members.map((member) => (
          <Muted key={member.user.id}>
            {member.user.displayName} · {member.roles.join(", ")}
          </Muted>
        ))}
        <Button label="Add a practice partner" tone="ghost" onPress={addPartner} />
      </Card>
      <Card>
        <Text style={{ color: colors.text, fontFamily: sans, fontSize: 18 }}>Habit bet</Text>
        <Muted>Head to head. One photo during the week counts. The first verified category is habits.</Muted>
        <Field value={title} onChangeText={setTitle} placeholder="Goal" />
        <Field value={stake} onChangeText={setStake} placeholder="Stake in USDC" keyboardType="decimal-pad" />
        <Button label="Open the bet" onPress={createBet} />
      </Card>
      {circle.bets.map((bet) => (
        <Pressable key={bet.id} onPress={() => router.push(`/bet/${bet.id}`)}>
          <Card>
            <Text style={{ color: colors.text, fontFamily: sans, fontSize: 18 }}>{bet.title}</Text>
            <Muted>
              {bet.status} · {usdc(bet.stakeAmount)} · {bet.participantCount} people
            </Muted>
          </Card>
        </Pressable>
      ))}
      <ErrorText>{error}</ErrorText>
    </Screen>
  );
}
