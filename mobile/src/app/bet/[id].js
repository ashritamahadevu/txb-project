import { useCallback, useState } from "react";
import { Image, Platform, Text, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { API_URL, api, photoUrl, usdc } from "../../api";
import { getToken } from "../../session";
import { colors, sans } from "../../theme";
import { Button, Card, Choice, ErrorText, Field, Muted, Screen, Title } from "../../ui";

function countReactions(reactions, kind) {
  return (reactions ?? []).filter((reaction) => reaction.kind === kind).length;
}

function formatWhen(value) {
  if (!value) return "the deadline";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "the deadline";
  return date.toLocaleString();
}

function outcomeColor(outcome) {
  if (outcome === "success") return colors.good;
  if (outcome === "fail") return colors.coral;
  return colors.text;
}

function statusLine(bet) {
  const label =
    {
      active: "In progress",
      resolved: "Dispute window open",
      disputed: "Dispute in progress",
      final: "Final",
    }[bet.status] ?? bet.status;
  if (bet.status === "active") return `${label} until ${formatWhen(bet.periodEnd)}`;
  if (bet.status === "resolved" || bet.status === "disputed") {
    return `${label} until ${formatWhen(bet.dispute?.deadline)}`;
  }
  return label;
}

const RESOLUTION = {
  unchallenged: "The dispute window closed with no challenge. The reporter's result stands.",
  upheld: "A strict majority upheld the reporter's result.",
  overturned: "A strict majority overturned the reporter's result.",
  void: "No strict majority before the window closed. Everyone is refunded.",
};

export default function BetScreen() {
  const { id } = useLocalSearchParams();
  const [bet, setBet] = useState(null);
  const [caption, setCaption] = useState("");
  const [comment, setComment] = useState("");
  const [choices, setChoices] = useState({});
  const [error, setError] = useState("");

  const load = useCallback(() => {
    api(`/v1/bets/${id}`)
      .then((data) => setBet(data.bet))
      .catch((err) => setError(err.message));
  }, [id]);
  useFocusEffect(load);

  async function reporterPost(path, body) {
    const response = await fetch(`${API_URL}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-reporter-key": "dev-reporter" },
      body: JSON.stringify(body ?? {}),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Request failed");
  }

  async function addProof() {
    setError("");
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8 });
    if (picked.canceled || !picked.assets?.[0]) return;
    const asset = picked.assets[0];
    const form = new FormData();
    if (Platform.OS === "web") {
      const blob = await (await fetch(asset.uri)).blob();
      form.append("photo", blob, "proof.jpg");
    } else {
      form.append("photo", { uri: asset.uri, name: "proof.jpg", type: asset.mimeType || "image/jpeg" });
    }
    form.append("caption", caption);
    try {
      const response = await fetch(`${API_URL}/v1/bets/${id}/proofs`, {
        method: "POST",
        headers: { authorization: `Bearer ${await getToken()}` },
        body: form,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Upload failed");
      setCaption("");
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function sendComment(proofId) {
    setError("");
    try {
      await api(`/v1/proofs/${proofId}/comments`, { method: "POST", json: { body: comment } });
      setComment("");
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function react(proofId, kind) {
    try {
      await api(`/v1/proofs/${proofId}/reactions`, { method: "POST", json: { kind } });
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function report(proofId) {
    try {
      await api(`/v1/proofs/${proofId}/report`, { method: "POST" });
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function resolveEarly() {
    setError("");
    try {
      await reporterPost(`/v1/bets/${id}/resolve`, { early: true });
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function openDispute() {
    setError("");
    try {
      await api(`/v1/bets/${id}/dispute`, { method: "POST" });
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function closeDispute() {
    setError("");
    try {
      await reporterPost(`/v1/bets/${id}/dispute/close`);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function castVote(asUserId) {
    if (!bet) return;
    setError("");
    const outcomes = bet.participants.map((participant) => ({
      userId: participant.user.id,
      outcome: choices[participant.user.id],
    }));
    if (outcomes.some((row) => row.outcome !== "success" && row.outcome !== "fail")) {
      setError("Choose success or fail for every person.");
      return;
    }
    try {
      await api(`/v1/bets/${id}/votes`, {
        method: "POST",
        json: asUserId ? { outcomes, asUserId } : { outcomes },
      });
      setChoices({});
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  if (!bet) {
    return (
      <Screen>
        <Muted>Loading bet…</Muted>
        <ErrorText>{error}</ErrorText>
      </Screen>
    );
  }

  const nameFor = (userId) => bet.participants.find((participant) => participant.user.id === userId)?.user.displayName ?? "Someone";
  const eligible = bet.dispute?.eligibleVoters ?? [];
  const ballots = bet.dispute?.ballots ?? [];
  const voted = new Set(ballots.map((ballot) => ballot.voter.id));
  const roles = bet.viewer?.roles ?? [];
  const canVoteSelf = eligible.some((person) => person.id === bet.viewer?.userId) && !voted.has(bet.viewer?.userId);
  const demoVoters = roles.includes("owner")
    ? eligible.filter((person) => person.practice && person.id !== bet.viewer?.userId && !voted.has(person.id))
    : [];
  const showBallot = canVoteSelf || demoVoters.length > 0;

  return (
    <Screen>
      <Title>{bet.title}</Title>
      <Muted>
        {statusLine(bet)} · {usdc(bet.stakeAmount)} each · {bet.proofsRequired} photo
        {bet.proofsRequired === 1 ? "" : "s"} required · habit
      </Muted>
      <Muted>{bet.feePayer}</Muted>
      {bet.status === "final" ? (
        <Card>
          <Text style={{ color: colors.lime, fontFamily: sans, fontSize: 18 }}>Final result</Text>
          <Muted>{RESOLUTION[bet.dispute?.resolution] ?? "The circle has a final result."}</Muted>
          {ballots.map((ballot) => (
            <Muted key={ballot.voter.id}>
              {ballot.voter.displayName}
              {ballot.demo ? ` · demo vote by ${ballot.castBy?.displayName ?? "the owner"}` : ""}:{" "}
              {(Array.isArray(ballot.outcomes) ? ballot.outcomes : [])
                .map((row) => `${nameFor(row.userId)} ${row.outcome}`)
                .join(", ")}
            </Muted>
          ))}
        </Card>
      ) : null}
      <Card>
        {bet.participants.map((participant) => (
          <Text key={participant.user.id} style={{ color: outcomeColor(participant.outcome), fontFamily: sans }}>
            {participant.user.displayName} · {participant.outcome}
            {participant.reporterOutcome && participant.reporterOutcome !== participant.outcome
              ? ` · reporter said ${participant.reporterOutcome}`
              : ""}
          </Text>
        ))}
      </Card>
      {bet.status === "active" ? (
        <Card>
          <Field value={caption} onChangeText={setCaption} placeholder="Caption, optional" />
          <Button label="Add a photo from this device" onPress={addProof} />
          <Button label="Close the period (devnet demo)" tone="ghost" onPress={resolveEarly} />
        </Card>
      ) : null}
      {bet.status === "resolved" ? (
        <Card>
          <Text style={{ color: colors.text, fontFamily: sans, fontSize: 18 }}>Dispute window</Text>
          <Muted>
            Open until {formatWhen(bet.dispute?.deadline)}. A circle member can challenge the reporter. On devnet the
            disputer posts a deposit. This preview records the challenge in the circle.
          </Muted>
          <Button label="Open a dispute" onPress={openDispute} />
          <Button label="Close dispute window (demo)" tone="ghost" onPress={closeDispute} />
        </Card>
      ) : null}
      {bet.status === "disputed" ? (
        <Card>
          <Text style={{ color: colors.text, fontFamily: sans, fontSize: 18 }}>Dispute</Text>
          <Muted>
            {bet.dispute?.disputer ? `${bet.dispute.disputer.displayName} opened this dispute. ` : ""}A strict majority
            of the voters decides each person's success or fail. Until then the list above is the reporter's result.
          </Muted>
          <Muted>Voters: {eligible.map((person) => person.displayName).join(", ") || "none yet"}</Muted>
          {eligible.length === 0 ? (
            <Muted>Nobody can vote. Add a practice partner who is not in the bet, or assign judges when you open the bet.</Muted>
          ) : null}
          {ballots.map((ballot) => (
            <Muted key={ballot.voter.id}>
              {ballot.voter.displayName}
              {ballot.demo ? ` · demo vote by ${ballot.castBy?.displayName ?? "the owner"}` : ""}:{" "}
              {(Array.isArray(ballot.outcomes) ? ballot.outcomes : [])
                .map((row) => `${nameFor(row.userId)} ${row.outcome}`)
                .join(", ")}
            </Muted>
          ))}
          {showBallot ? (
            <>
              <Muted>Vote success or fail for each person.</Muted>
              {bet.participants.map((participant) => (
                <View key={participant.user.id} style={{ gap: 8 }}>
                  <Text style={{ color: colors.text, fontFamily: sans }}>{participant.user.displayName}</Text>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                    <Choice
                      label="Success"
                      selected={choices[participant.user.id] === "success"}
                      onPress={() => setChoices((current) => ({ ...current, [participant.user.id]: "success" }))}
                    />
                    <Choice
                      label="Fail"
                      selected={choices[participant.user.id] === "fail"}
                      onPress={() => setChoices((current) => ({ ...current, [participant.user.id]: "fail" }))}
                    />
                  </View>
                </View>
              ))}
              {canVoteSelf ? <Button label="Cast your vote" onPress={() => castVote()} /> : null}
              {demoVoters.map((person) => (
                <Button
                  key={person.id}
                  label={`Demo: vote as ${person.displayName}`}
                  tone="ghost"
                  onPress={() => castVote(person.id)}
                />
              ))}
              {demoVoters.length > 0 ? (
                <Muted>A demo vote is you casting that ballot for a practice partner, on this one device.</Muted>
              ) : null}
            </>
          ) : (
            <Muted>Waiting on the other voters.</Muted>
          )}
          <Button label="Close dispute window (demo)" tone="ghost" onPress={closeDispute} />
        </Card>
      ) : null}
      {bet.proofs.map((proof) => (
        <Card key={proof.id}>
          <Image source={{ uri: photoUrl(proof.photoPath) }} style={{ width: "100%", height: 220, borderRadius: 12 }} />
          <Text style={{ color: colors.text, fontFamily: sans }}>
            {proof.user.displayName}
            {proof.caption ? ` — ${proof.caption}` : ""}
          </Text>
          {proof.flagged ? <Text style={{ color: colors.coral, fontFamily: sans }}>{proof.flagReason}</Text> : null}
          <Muted>
            Hash {proof.photoHash.slice(0, 12)}…
            {proof.reported ? " · reported" : ""}
            {` · ${countReactions(proof.reactions, "respect")} respect · ${countReactions(proof.reactions, "doubt")} doubt`}
          </Muted>
          {proof.comments.map((entry) => (
            <Muted key={entry.id}>
              {entry.user.displayName}: {entry.body}
            </Muted>
          ))}
          <Field value={comment} onChangeText={setComment} placeholder="Comment" />
          <Button label="Comment" tone="ghost" onPress={() => sendComment(proof.id)} />
          <Button label="Respect" tone="ghost" onPress={() => react(proof.id, "respect")} />
          <Button label="Doubt" tone="ghost" onPress={() => react(proof.id, "doubt")} />
          <Button label="Report" tone="ghost" onPress={() => report(proof.id)} />
        </Card>
      ))}
      <ErrorText>{error}</ErrorText>
    </Screen>
  );
}
