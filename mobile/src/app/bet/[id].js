import { useCallback, useState } from "react";
import { Image, Platform, Text } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { api, photoUrl, usdc } from "../../api";
import { colors, sans } from "../../theme";
import { Button, Card, ErrorText, Field, Muted, Screen, Title } from "../../ui";

function countReactions(reactions, kind) {
  return (reactions ?? []).filter((reaction) => reaction.kind === kind).length;
}

export default function BetScreen() {
  const { id } = useLocalSearchParams();
  const [bet, setBet] = useState(null);
  const [caption, setCaption] = useState("");
  const [comment, setComment] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(() => {
    api(`/v1/bets/${id}`)
      .then((data) => setBet(data.bet))
      .catch((err) => setError(err.message));
  }, [id]);
  useFocusEffect(load);

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
      const token = (await import("../../session")).getToken();
      const response = await fetch(`${(await import("../../api")).API_URL}/v1/bets/${id}/proofs`, {
        method: "POST",
        headers: { authorization: `Bearer ${await token}` },
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
      await fetch(`${(await import("../../api")).API_URL}/v1/bets/${id}/resolve`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-reporter-key": "dev-reporter",
        },
        body: JSON.stringify({ early: true }),
      }).then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Resolve failed");
      });
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

  return (
    <Screen>
      <Title>{bet.title}</Title>
      <Muted>
        {bet.status} · {usdc(bet.stakeAmount)} each · {bet.proofsRequired} photo
        {bet.proofsRequired === 1 ? "" : "s"} required · habit
      </Muted>
      <Muted>{bet.feePayer}</Muted>
      <Card>
        {bet.participants.map((participant) => (
          <Text key={participant.user.id} style={{ color: colors.text, fontFamily: sans }}>
            {participant.user.displayName} · {participant.outcome}
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
