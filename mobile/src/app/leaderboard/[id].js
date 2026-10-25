import { useCallback, useState } from "react";
import { Text } from "react-native";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { api } from "../../api";
import { colors, sans } from "../../theme";
import { Card, ErrorText, Muted, Screen, Title } from "../../ui";

export default function Leaderboard() {
  const { id } = useLocalSearchParams();
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    api(`/v1/circles/${id}/leaderboard`)
      .then((data) => setRows(data.leaderboard))
      .catch((err) => setError(err.message));
  }, [id]);
  useFocusEffect(load);

  return (
    <Screen>
      <Title>Leaderboard</Title>
      <Muted>Success rate, then streak, across resolved habit bets in this circle.</Muted>
      {rows.length === 0 ? <Muted>No resolved bets yet.</Muted> : null}
      {rows.map((row, index) => (
        <Card key={row.user.id}>
          <Text style={{ color: colors.lime, fontFamily: sans, fontSize: 18 }}>
            {index + 1}. {row.user.displayName}
          </Text>
          <Muted>
            {Math.round(row.successRate * 100)}% · streak {row.streak} · {row.successes} completed
          </Muted>
        </Card>
      ))}
      <ErrorText>{error}</ErrorText>
    </Screen>
  );
}
