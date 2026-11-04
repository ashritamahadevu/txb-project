import { useCallback, useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { api, usdc } from "../../api";
import { colors, sans } from "../../theme";
import { Button, Card, Choice, ErrorText, Field, Muted, Screen, Title } from "../../ui";

const PERIODS = [
  { id: "5m", label: "5 minutes", minutes: 5 },
  { id: "1d", label: "1 day", minutes: 24 * 60 },
  { id: "3d", label: "3 days", minutes: 3 * 24 * 60 },
  { id: "1w", label: "1 week", minutes: 7 * 24 * 60 },
  { id: "2w", label: "2 weeks", minutes: 14 * 24 * 60 },
  { id: "custom", label: "Custom days", minutes: null },
];

const DISPUTE_WINDOWS = [
  { id: "5m", label: "5 minutes (demo)", minutes: 5 },
  { id: "1d", label: "1 day", minutes: 24 * 60 },
  { id: "3d", label: "3 days", minutes: 3 * 24 * 60 },
];

function betLabel(status) {
  if (status === "resolved") return "dispute window";
  if (status === "disputed") return "disputed";
  if (status === "final") return "final";
  return status;
}

export default function CircleScreen() {
  const { id } = useLocalSearchParams();
  const [circle, setCircle] = useState(null);
  const [me, setMe] = useState(null);
  const [title, setTitle] = useState("Gym before noon");
  const [stake, setStake] = useState("5");
  const [periodId, setPeriodId] = useState("1w");
  const [customDays, setCustomDays] = useState("10");
  const [windowId, setWindowId] = useState("1d");
  const [picked, setPicked] = useState(null);
  const [kind, setKind] = useState("head_to_head");
  const [judgeIds, setJudgeIds] = useState([]);
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

  useEffect(() => {
    if (!circle || !me || picked) return;
    const partner = circle.members.find((member) => member.user.practice);
    setPicked(partner ? [me.id, partner.user.id] : [me.id]);
  }, [circle, me, picked]);

  const selected = picked ?? (me ? [me.id] : []);
  const practiceCount = circle?.members.filter((member) => member.user.practice).length ?? 0;

  async function addPartner() {
    setError("");
    try {
      await api(`/v1/circles/${id}/practice-partner`, { method: "POST" });
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  function togglePerson(userId) {
    if (!me || userId === me.id) return;
    const base = me && !selected.includes(me.id) ? [me.id, ...selected] : selected;
    if (!base.includes(userId) && base.length >= 10) {
      setError("A pool can include at most 10 people.");
      return;
    }
    setError("");
    setPicked(base.includes(userId) ? base.filter((item) => item !== userId) : [...base, userId]);
    setJudgeIds((current) => current.filter((item) => item !== userId));
  }

  function toggleJudge(userId) {
    setError("");
    setJudgeIds((current) => (current.includes(userId) ? current.filter((item) => item !== userId) : [...current, userId]));
  }

  async function createBet() {
    if (!circle || !me) return;
    const participantIds = [...new Set([me.id, ...selected])];
    if (participantIds.length < 2) {
      setError("Pick at least two people. Add a practice partner if you are demoing from one device.");
      return;
    }
    if (participantIds.length > 10) {
      setError("A pool can include at most 10 people.");
      return;
    }
    const judges = judgeIds.filter((userId) => !participantIds.includes(userId));
    if (judges.length === 2 || judges.length > 3) {
      setError("Assign one or three judges, or leave judges unset.");
      return;
    }
    let periodMinutes = PERIODS.find((period) => period.id === periodId)?.minutes;
    if (periodId === "custom") {
      const days = Number(customDays);
      if (!Number.isInteger(days) || days < 1 || days > 90) {
        setError("Custom length is a whole number of days from 1 to 90.");
        return;
      }
      periodMinutes = days * 24 * 60;
    }
    const stakeAmount = Math.round(Number(stake) * 1_000_000);
    if (!Number.isFinite(stakeAmount) || stakeAmount <= 0) {
      setError("Enter a stake in USDC.");
      return;
    }
    const betType = participantIds.length === 2 ? kind : "pool";
    const disputeWindowMinutes = DISPUTE_WINDOWS.find((item) => item.id === windowId)?.minutes ?? 24 * 60;
    setError("");
    try {
      const { bet } = await api(`/v1/circles/${id}/bets`, {
        method: "POST",
        json: {
          title,
          betType,
          stakeAmount,
          proofsRequired: 1,
          periodMinutes,
          disputeWindowMinutes,
          participantIds,
          judgeIds: judges,
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

  const outsiders = circle.members.filter((member) => !selected.includes(member.user.id));

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
            {member.user.practice ? " · practice" : ""}
          </Muted>
        ))}
        <Button
          label={practiceCount === 0 ? "Add a practice partner" : "Add another practice partner"}
          tone="ghost"
          onPress={addPartner}
          disabled={practiceCount >= 9}
        />
        {practiceCount >= 9 ? <Muted>This circle has 9 practice partners, the cap for a 10-person pool.</Muted> : null}
      </Card>
      <Card>
        <Text style={{ color: colors.text, fontFamily: sans, fontSize: 18 }}>Habit bet</Text>
        <Muted>
          Pick who is in and how long the period lasts. Head to head is two people. A pool is two to ten. One photo
          counts.
        </Muted>
        <Field value={title} onChangeText={setTitle} placeholder="Goal" />
        <Field value={stake} onChangeText={setStake} placeholder="Stake in USDC" keyboardType="decimal-pad" />
        <Muted>Who is in</Muted>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {circle.members.map((member) => {
            const locked = member.user.id === me?.id;
            return (
              <Choice
                key={member.user.id}
                label={`${member.user.displayName}${member.user.practice ? " · practice" : ""}${locked ? " · you" : ""}`}
                selected={selected.includes(member.user.id)}
                onPress={() => togglePerson(member.user.id)}
              />
            );
          })}
        </View>
        {selected.length === 2 ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            <Choice label="Head to head" selected={kind === "head_to_head"} onPress={() => setKind("head_to_head")} />
            <Choice label="Pool" selected={kind === "pool"} onPress={() => setKind("pool")} />
          </View>
        ) : (
          <Muted>{selected.length > 2 ? "Pool bet, two to ten people." : "Pick one more person."}</Muted>
        )}
        <Muted>Period</Muted>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {PERIODS.map((period) => (
            <Choice
              key={period.id}
              label={period.label}
              selected={periodId === period.id}
              onPress={() => setPeriodId(period.id)}
            />
          ))}
        </View>
        {periodId === "custom" ? (
          <Field value={customDays} onChangeText={setCustomDays} placeholder="Days" keyboardType="number-pad" />
        ) : null}
        <Muted>Dispute window</Muted>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {DISPUTE_WINDOWS.map((item) => (
            <Choice
              key={item.id}
              label={item.label}
              selected={windowId === item.id}
              onPress={() => setWindowId(item.id)}
            />
          ))}
        </View>
        <Muted>
          Judges are optional. Pick one or three people who are not in the bet. Leave this unset and the other circle
          members vote. On one device, leave a practice partner out and cast their vote from the bet screen.
        </Muted>
        {outsiders.length === 0 ? (
          <Muted>Everyone is in the bet. Add a practice partner if you want a voter.</Muted>
        ) : (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {outsiders.map((member) => (
              <Choice
                key={member.user.id}
                label={`${member.user.displayName} · judge`}
                selected={judgeIds.includes(member.user.id)}
                onPress={() => toggleJudge(member.user.id)}
              />
            ))}
          </View>
        )}
        <Button label="Open the bet" onPress={createBet} />
      </Card>
      {circle.bets.map((bet) => (
        <Pressable key={bet.id} onPress={() => router.push(`/bet/${bet.id}`)}>
          <Card>
            <Text style={{ color: colors.text, fontFamily: sans, fontSize: 18 }}>{bet.title}</Text>
            <Muted>
              {betLabel(bet.status)} · {usdc(bet.stakeAmount)} · {bet.participantCount} people
            </Muted>
          </Card>
        </Pressable>
      ))}
      <ErrorText>{error}</ErrorText>
    </Screen>
  );
}
