export const PERIOD_MIN_MINUTES = 5;
export const PERIOD_MAX_MINUTES = 90 * 24 * 60;
export const DISPUTE_WINDOW_MIN_MINUTES = 5;
export const DISPUTE_WINDOW_MAX_MINUTES = 7 * 24 * 60;
export const DISPUTE_WINDOW_DEFAULT_MINUTES = 24 * 60;
export const MAX_PRACTICE_PARTNERS = 9;
export const MAX_POOL = 10;

export type SeatOutcome = "success" | "fail";
export type Ballot = Record<string, SeatOutcome>;

export function betLengthMinutes(input: {
  periodHours?: number;
  periodMinutes?: number;
}): { minutes: number } | { error: string } {
  const hasHours = input.periodHours !== undefined;
  const hasMinutes = input.periodMinutes !== undefined;
  if (hasHours === hasMinutes) {
    return { error: hasHours ? "Send the bet length once" : "Choose a bet length" };
  }
  const minutes = hasMinutes ? input.periodMinutes! : input.periodHours! * 60;
  if (!Number.isInteger(minutes) || minutes < PERIOD_MIN_MINUTES || minutes > PERIOD_MAX_MINUTES) {
    return { error: "Bet length must be between 5 minutes and 90 days" };
  }
  return { minutes };
}

export function disputeWindowSeconds(minutes: number | undefined): { seconds: number } | { error: string } {
  const value = minutes === undefined ? DISPUTE_WINDOW_DEFAULT_MINUTES : minutes;
  if (!Number.isInteger(value) || value < DISPUTE_WINDOW_MIN_MINUTES || value > DISPUTE_WINDOW_MAX_MINUTES) {
    return { error: "Dispute window must be between 5 minutes and 7 days" };
  }
  return { seconds: value * 60 };
}

export function eligibleVoterIds(participantIds: string[], judgeIds: string[], memberIds: string[]): string[] {
  if (judgeIds.length > 0) return [...judgeIds];
  const inBet = new Set(participantIds);
  return memberIds.filter((id) => !inBet.has(id));
}

export function parseBallot(participantIds: string[], submitted: { userId: string; outcome: string }[]): Ballot | null {
  if (submitted.length !== participantIds.length) return null;
  const allowed = new Set(participantIds);
  const ballot: Ballot = {};
  for (const row of submitted) {
    if (!allowed.has(row.userId) || ballot[row.userId]) return null;
    if (row.outcome !== "success" && row.outcome !== "fail") return null;
    ballot[row.userId] = row.outcome;
  }
  if (Object.keys(ballot).length !== participantIds.length) return null;
  return ballot;
}

export function ballotFromJson(value: unknown): Ballot {
  const ballot: Ballot = {};
  if (!Array.isArray(value)) return ballot;
  for (const row of value) {
    if (!row || typeof row !== "object") continue;
    const userId = "userId" in row && typeof row.userId === "string" ? row.userId : "";
    const outcome = "outcome" in row ? row.outcome : null;
    if (userId && (outcome === "success" || outcome === "fail")) ballot[userId] = outcome;
  }
  return ballot;
}

/// Strict majority of the eligible seats, matching the program: ties and
/// missing ballots are not a decision.
export function strictMajority(eligibleCount: number, ballots: Ballot[], participantIds: string[]): Ballot | null {
  if (eligibleCount <= 0) return null;
  const need = Math.floor(eligibleCount / 2) + 1;
  for (const ballot of ballots) {
    let tally = 0;
    for (const other of ballots) {
      if (participantIds.every((id) => ballot[id] === other[id])) tally += 1;
    }
    if (tally >= need) return ballot;
  }
  return null;
}

export type SettleResult =
  | { action: "none" }
  | { action: "final"; resolution: "unchallenged" | "upheld"; replace: null }
  | { action: "final"; resolution: "overturned"; replace: Ballot }
  | { action: "final"; resolution: "void" };

export function settleDecision(input: {
  status: string;
  deadline: Date | null;
  now: Date;
  forceClose: boolean;
  participantIds: string[];
  reporter: Ballot;
  eligibleCount: number;
  ballots: Ballot[];
}): SettleResult {
  if (input.status !== "resolved" && input.status !== "disputed") return { action: "none" };
  const windowClosed =
    input.forceClose || (input.deadline !== null && input.deadline.getTime() <= input.now.getTime());
  if (input.status === "resolved") {
    if (!windowClosed) return { action: "none" };
    return { action: "final", resolution: "unchallenged", replace: null };
  }
  const majority = strictMajority(input.eligibleCount, input.ballots, input.participantIds);
  if (majority) {
    const upheld = input.participantIds.every((id) => majority[id] === input.reporter[id]);
    if (upheld) return { action: "final", resolution: "upheld", replace: null };
    return { action: "final", resolution: "overturned", replace: majority };
  }
  if (!windowClosed) return { action: "none" };
  return { action: "final", resolution: "void" };
}
