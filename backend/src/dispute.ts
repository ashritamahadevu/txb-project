import { prisma } from "./db.js";
import { ballotFromJson, type Ballot, eligibleVoterIds, settleDecision } from "./rules.js";

export async function settleBet(betId: string, opts: { forceClose?: boolean } = {}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const bet = await tx.bet.findUnique({
      where: { id: betId },
      include: {
        participants: { orderBy: { joinedAt: "asc" } },
        judges: true,
        ballots: true,
        circle: { include: { members: true } },
      },
    });
    if (!bet) return;
    const participantIds = bet.participants.map((participant) => participant.userId);
    const reporter: Ballot = {};
    for (const participant of bet.participants) {
      const value = participant.reporterOutcome ?? participant.outcome;
      if (value === "success" || value === "fail") reporter[participant.userId] = value;
    }
    const decision = settleDecision({
      status: bet.status,
      deadline: bet.disputeDeadline,
      now: new Date(),
      forceClose: opts.forceClose === true,
      participantIds,
      reporter,
      eligibleCount: eligibleVoterIds(
        participantIds,
        bet.judges.map((judge) => judge.userId),
        bet.circle.members.map((member) => member.userId),
      ).length,
      ballots: bet.ballots.map((ballot) => ballotFromJson(ballot.outcomes)),
    });
    if (decision.action === "none") return;
    if (decision.resolution === "overturned") {
      for (const userId of participantIds) {
        await tx.betParticipant.update({
          where: { betId_userId: { betId: bet.id, userId } },
          data: { outcome: decision.replace[userId] },
        });
      }
    } else if (decision.resolution === "void") {
      for (const userId of participantIds) {
        await tx.betParticipant.update({
          where: { betId_userId: { betId: bet.id, userId } },
          data: { outcome: "refunded" },
        });
      }
    }
    await tx.bet.update({
      where: { id: bet.id },
      data: {
        status: "final",
        disputeResolution: decision.resolution,
        disputeDeadline: opts.forceClose === true ? new Date() : bet.disputeDeadline,
      },
    });
  });
}
