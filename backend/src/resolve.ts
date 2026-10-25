import { createHash } from "node:crypto";
import type { Bet, BetParticipant, ProofPost } from "@prisma/client";

export type Outcome = "success" | "fail";

export function decideOutcomes(
  bet: Pick<Bet, "proofsRequired" | "periodStart" | "periodEnd">,
  participants: Pick<BetParticipant, "userId" | "joinedAt">[],
  proofs: Pick<ProofPost, "userId" | "flagged" | "capturedAt" | "photoHash">[],
): { userId: string; outcome: Outcome }[] {
  const ordered = [...participants].sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime());
  return ordered.map((participant) => {
    const counted = proofs.filter((proof) => {
      const at = proof.capturedAt.getTime();
      return (
        proof.userId === participant.userId &&
        !proof.flagged &&
        at >= bet.periodStart.getTime() &&
        at <= bet.periodEnd.getTime()
      );
    });
    return {
      userId: participant.userId,
      outcome: counted.length >= bet.proofsRequired ? "success" : "fail",
    };
  });
}

export function evidenceDigest(proofs: Pick<ProofPost, "photoHash" | "capturedAt">[]): string {
  const canonical = JSON.stringify(
    [...proofs]
      .sort((a, b) => a.photoHash.localeCompare(b.photoHash))
      .map((proof) => ({ hash: proof.photoHash, at: proof.capturedAt.toISOString() })),
  );
  return createHash("sha256").update(canonical).digest("hex");
}
