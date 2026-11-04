import assert from "node:assert/strict";
import type { Server } from "node:http";
import { after, before, describe, test } from "node:test";
import nacl from "tweetnacl";
import bs58 from "bs58";
import sharp from "sharp";

process.env.DATABASE_URL ??= "postgresql://txb:txb@localhost:5432/txb_test";
process.env.REPORTER_API_KEY = "dev-reporter";

const { createApp } = await import("../src/app.ts");
const { prisma } = await import("../src/db.ts");
const { signInMessage } = await import("../src/auth.ts");

async function reset() {
  await prisma.disputeBallot.deleteMany();
  await prisma.reaction.deleteMany();
  await prisma.comment.deleteMany();
  await prisma.proofPost.deleteMany();
  await prisma.judgeAssignment.deleteMany();
  await prisma.betParticipant.deleteMany();
  await prisma.bet.deleteMany();
  await prisma.circleMember.deleteMany();
  await prisma.circle.deleteMany();
  await prisma.session.deleteMany();
  await prisma.nonce.deleteMany();
  await prisma.goalTemplate.deleteMany();
  await prisma.user.deleteMany();
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("no port");
      resolve(address.port);
    });
  });
}

async function signIn(base: string) {
  const pair = nacl.sign.keyPair();
  const wallet = bs58.encode(pair.publicKey);
  const nonceRes = await fetch(`${base}/v1/auth/nonce`, { method: "POST" });
  const { nonce } = (await nonceRes.json()) as { nonce: string };
  const message = signInMessage(wallet, nonce);
  const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(message), pair.secretKey));
  const verified = await fetch(`${base}/v1/auth/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ walletPubkey: wallet, signature, nonce }),
  });
  assert.equal(verified.status, 200);
  const body = (await verified.json()) as { token: string; user: { id: string } };
  return { token: body.token, userId: body.user.id, wallet };
}

const reporter = { "content-type": "application/json", "x-reporter-key": "dev-reporter" };

async function ageIn(base: string) {
  const session = await signIn(base);
  const auth = { authorization: `Bearer ${session.token}`, "content-type": "application/json" };
  const aged = await fetch(`${base}/v1/me/age`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ confirmed: true }),
  });
  assert.equal(aged.status, 200);
  return { ...session, auth };
}

async function createCircle(base: string, auth: Record<string, string>, name = "Room 4") {
  const created = await fetch(`${base}/v1/circles`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ name }),
  });
  assert.equal(created.status, 201);
  const { circle } = (await created.json()) as { circle: { id: string; inviteCode: string } };
  return circle;
}

async function addPartner(base: string, auth: Record<string, string>, circleId: string) {
  const partnerRes = await fetch(`${base}/v1/circles/${circleId}/practice-partner`, {
    method: "POST",
    headers: auth,
  });
  assert.equal(partnerRes.status, 201);
  const { user } = (await partnerRes.json()) as { user: { id: string; displayName: string } };
  return user;
}

describe("api", { concurrency: 1 }, () => {
  let server: Server;
  let base: string;

  before(async () => {
    await reset();
    server = createApp().listen(0, "127.0.0.1");
    const port = await listen(server);
    base = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    await prisma.$disconnect();
  });

  test("circle, photo proof, comment, resolve, and leaderboard", async () => {
    await reset();
    const session = await signIn(base);
    const auth = { authorization: `Bearer ${session.token}`, "content-type": "application/json" };
    const tooYoung = await fetch(`${base}/v1/circles`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ name: "Room 4" }),
    });
    assert.equal(tooYoung.status, 403);

    const aged = await fetch(`${base}/v1/me/age`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ confirmed: true }),
    });
    assert.equal(aged.status, 200);

    const created = await fetch(`${base}/v1/circles`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ name: "Room 4" }),
    });
    assert.equal(created.status, 201);
    const { circle } = (await created.json()) as { circle: { id: string; inviteCode: string } };

    const partnerRes = await fetch(`${base}/v1/circles/${circle.id}/practice-partner`, {
      method: "POST",
      headers: auth,
    });
    assert.equal(partnerRes.status, 201);
    const { user: partner } = (await partnerRes.json()) as { user: { id: string } };

    const betRes = await fetch(`${base}/v1/circles/${circle.id}/bets`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        title: "Gym before noon",
        betType: "head_to_head",
        stakeAmount: 5_000_000,
        proofsRequired: 1,
        periodHours: 24 * 7,
        participantIds: [session.userId, partner.id],
      }),
    });
    assert.equal(betRes.status, 201);
    const { bet } = (await betRes.json()) as { bet: { id: string; category: string } };
    assert.equal(bet.category, "habit");

    const jpeg = await sharp({
      create: { width: 64, height: 48, channels: 3, background: { r: 30, g: 90, b: 200 } },
    })
      .jpeg()
      .toBuffer();
    const form = new FormData();
    form.set("caption", "Set done");
    form.set("photo", new Blob([jpeg], { type: "image/jpeg" }), "proof.jpg");
    const proofRes = await fetch(`${base}/v1/bets/${bet.id}/proofs`, {
      method: "POST",
      headers: { authorization: `Bearer ${session.token}` },
      body: form,
    });
    assert.equal(proofRes.status, 201);
    const { proof } = (await proofRes.json()) as { proof: { id: string; photoHash: string; flagged: boolean } };
    assert.equal(proof.flagged, false);
    assert.equal(proof.photoHash.length, 64);

    const duplicate = await fetch(`${base}/v1/bets/${bet.id}/proofs`, {
      method: "POST",
      headers: { authorization: `Bearer ${session.token}` },
      body: (() => {
        const again = new FormData();
        again.set("caption", "same shot");
        again.set("photo", new Blob([jpeg], { type: "image/jpeg" }), "again.jpg");
        return again;
      })(),
    });
    assert.equal(duplicate.status, 201);
    const second = (await duplicate.json()) as { proof: { flagged: boolean } };
    assert.equal(second.proof.flagged, true);

    const comment = await fetch(`${base}/v1/proofs/${proof.id}/comments`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ body: "Counted." }),
    });
    assert.equal(comment.status, 201);
    const reaction = await fetch(`${base}/v1/proofs/${proof.id}/reactions`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ kind: "respect" }),
    });
    assert.equal(reaction.status, 201);

    const earlyDenied = await fetch(`${base}/v1/bets/${bet.id}/resolve`, { method: "POST" });
    assert.equal(earlyDenied.status, 401);
    const resolved = await fetch(`${base}/v1/bets/${bet.id}/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-reporter-key": "dev-reporter" },
      body: JSON.stringify({ early: true }),
    });
    assert.equal(resolved.status, 200);
    const resolution = (await resolved.json()) as {
      outcomes: { userId: string; outcome: string }[];
      evidenceHash: string;
    };
    assert.equal(resolution.outcomes.find((row) => row.userId === session.userId)?.outcome, "success");
    assert.equal(resolution.outcomes.find((row) => row.userId === partner.id)?.outcome, "fail");
    assert.equal(resolution.evidenceHash.length, 64);

    const board = await fetch(`${base}/v1/circles/${circle.id}/leaderboard`, { headers: auth });
    const { leaderboard } = (await board.json()) as {
      leaderboard: { user: { id: string }; successRate: number; streak: number }[];
    };
    assert.equal(leaderboard[0]?.user.id, session.userId);
    assert.equal(leaderboard[0]?.successRate, 1);
    assert.equal(leaderboard[0]?.streak, 1);

    const viewed = await fetch(`${base}/v1/bets/${bet.id}`, { headers: auth });
    assert.equal(viewed.status, 200);
    const full = (await viewed.json()) as {
      bet: {
        status: string;
        disputeWindowSeconds: number;
        dispute: { deadline: string };
        participants: { reporterOutcome: string; user: { id: string } }[];
      };
    };
    assert.equal(full.bet.status, "resolved");
    assert.equal(full.bet.disputeWindowSeconds, 86400);
    assert.ok(new Date(full.bet.dispute.deadline).getTime() > Date.now());
    assert.equal(full.bet.participants.find((row) => row.user.id === session.userId)?.reporterOutcome, "success");
  });

  test("several practice partners, bet length, and who is in the pool", async () => {
    await reset();
    const session = await ageIn(base);
    const circle = await createCircle(base, session.auth, "Pool");
    const partners: { id: string; displayName: string }[] = [];
    for (let index = 0; index < 9; index += 1) partners.push(await addPartner(base, session.auth, circle.id));
    assert.equal(partners[0]?.displayName, "Practice partner");
    assert.equal(partners[1]?.displayName, "Practice partner 2");
    assert.equal(new Set(partners.map((partner) => partner.id)).size, 9);
    const capped = await fetch(`${base}/v1/circles/${circle.id}/practice-partner`, {
      method: "POST",
      headers: session.auth,
    });
    assert.equal(capped.status, 409);

    const betBody = {
      title: "Show up",
      stakeAmount: 1_000_000,
      proofsRequired: 1,
      betType: "pool" as const,
      participantIds: [session.userId, partners[0]!.id, partners[1]!.id, partners[2]!.id],
    };
    const tooShort = await fetch(`${base}/v1/circles/${circle.id}/bets`, {
      method: "POST",
      headers: session.auth,
      body: JSON.stringify({ ...betBody, periodMinutes: 4 }),
    });
    assert.equal(tooShort.status, 400);
    assert.match(((await tooShort.json()) as { error: string }).error, /5 minutes/);

    const both = await fetch(`${base}/v1/circles/${circle.id}/bets`, {
      method: "POST",
      headers: session.auth,
      body: JSON.stringify({ ...betBody, periodHours: 24, periodMinutes: 60, betType: "head_to_head", participantIds: [session.userId, partners[0]!.id] }),
    });
    assert.equal(both.status, 400);

    const opened = await fetch(`${base}/v1/circles/${circle.id}/bets`, {
      method: "POST",
      headers: session.auth,
      body: JSON.stringify({ ...betBody, periodMinutes: 5, disputeWindowMinutes: 5 }),
    });
    assert.equal(opened.status, 201);
    const { bet } = (await opened.json()) as {
      bet: { betType: string; disputeWindowSeconds: number; periodStart: string; periodEnd: string; participants: { user: { id: string } }[] };
    };
    assert.equal(bet.betType, "pool");
    assert.equal(bet.participants.length, 4);
    assert.equal(bet.disputeWindowSeconds, 300);
    const span = new Date(bet.periodEnd).getTime() - new Date(bet.periodStart).getTime();
    assert.ok(Math.abs(span - 5 * 60 * 1000) < 2000);

    const tooLong = await fetch(`${base}/v1/circles/${circle.id}/bets`, {
      method: "POST",
      headers: session.auth,
      body: JSON.stringify({ ...betBody, periodMinutes: 90 * 24 * 60 + 1 }),
    });
    assert.equal(tooLong.status, 400);
    const longWindow = await fetch(`${base}/v1/circles/${circle.id}/bets`, {
      method: "POST",
      headers: session.auth,
      body: JSON.stringify({ ...betBody, periodMinutes: 60, disputeWindowMinutes: 8 * 24 * 60 }),
    });
    assert.equal(longWindow.status, 400);

    const three = await fetch(`${base}/v1/circles/${circle.id}/bets`, {
      method: "POST",
      headers: session.auth,
      body: JSON.stringify({
        ...betBody,
        betType: "head_to_head",
        periodMinutes: 60,
        participantIds: [session.userId, partners[0]!.id, partners[1]!.id],
      }),
    });
    assert.equal(three.status, 400);
    const twoJudges = await fetch(`${base}/v1/circles/${circle.id}/bets`, {
      method: "POST",
      headers: session.auth,
      body: JSON.stringify({
        ...betBody,
        betType: "head_to_head",
        periodHours: 24,
        participantIds: [session.userId, partners[0]!.id],
        judgeIds: [partners[1]!.id, partners[2]!.id],
      }),
    });
    assert.equal(twoJudges.status, 400);
    const oneJudge = await fetch(`${base}/v1/circles/${circle.id}/bets`, {
      method: "POST",
      headers: session.auth,
      body: JSON.stringify({
        title: "Judged",
        betType: "head_to_head",
        stakeAmount: 1_000_000,
        proofsRequired: 1,
        periodHours: 24,
        participantIds: [session.userId, partners[0]!.id],
        judgeIds: [partners[1]!.id],
      }),
    });
    assert.equal(oneJudge.status, 201);
  });

  test("a demo vote overturns or upholds, and no majority refunds", async () => {
    await reset();
    const session = await ageIn(base);
    const circle = await createCircle(base, session.auth, "Disputes");
    const partner = await addPartner(base, session.auth, circle.id);
    const voter = await addPartner(base, session.auth, circle.id);
    assert.equal(voter.displayName, "Practice partner 2");

    async function openResolved() {
      const created = await fetch(`${base}/v1/circles/${circle.id}/bets`, {
        method: "POST",
        headers: session.auth,
        body: JSON.stringify({
          title: "Read a chapter",
          betType: "head_to_head",
          stakeAmount: 1_000_000,
          proofsRequired: 1,
          periodMinutes: 60,
          disputeWindowMinutes: 60,
          participantIds: [session.userId, partner.id],
        }),
      });
      assert.equal(created.status, 201);
      const { bet } = (await created.json()) as { bet: { id: string } };
      const resolved = await fetch(`${base}/v1/bets/${bet.id}/resolve`, {
        method: "POST",
        headers: reporter,
        body: JSON.stringify({ early: true }),
      });
      assert.equal(resolved.status, 200);
      return bet.id;
    }

    const overturnId = await openResolved();
    const stranger = await fetch(`${base}/v1/bets/${overturnId}/dispute`, { method: "POST", headers: { authorization: "Bearer nope", "content-type": "application/json" } });
    assert.equal(stranger.status, 401);
    const opened = await fetch(`${base}/v1/bets/${overturnId}/dispute`, { method: "POST", headers: session.auth });
    assert.equal(opened.status, 201);
    const self = await fetch(`${base}/v1/bets/${overturnId}/votes`, {
      method: "POST",
      headers: session.auth,
      body: JSON.stringify({
        asUserId: partner.id,
        outcomes: [
          { userId: session.userId, outcome: "success" },
          { userId: partner.id, outcome: "success" },
        ],
      }),
    });
    assert.equal(self.status, 403);
    const voted = await fetch(`${base}/v1/bets/${overturnId}/votes`, {
      method: "POST",
      headers: session.auth,
      body: JSON.stringify({
        asUserId: voter.id,
        outcomes: [
          { userId: session.userId, outcome: "success" },
          { userId: partner.id, outcome: "success" },
        ],
      }),
    });
    assert.equal(voted.status, 201);
    const overturned = (await voted.json()) as {
      bet: {
        status: string;
        dispute: { resolution: string; ballots: { demo: boolean; voter: { id: string }; castBy: { id: string } | null }[] };
        participants: { outcome: string; reporterOutcome: string; user: { id: string } }[];
      };
    };
    assert.equal(overturned.bet.status, "final");
    assert.equal(overturned.bet.dispute.resolution, "overturned");
    assert.equal(overturned.bet.dispute.ballots[0]?.demo, true);
    assert.equal(overturned.bet.dispute.ballots[0]?.voter.id, voter.id);
    assert.equal(overturned.bet.dispute.ballots[0]?.castBy?.id, session.userId);
    assert.equal(overturned.bet.participants.find((row) => row.user.id === partner.id)?.outcome, "success");
    assert.equal(overturned.bet.participants.find((row) => row.user.id === partner.id)?.reporterOutcome, "fail");
    const board = await fetch(`${base}/v1/circles/${circle.id}/leaderboard`, { headers: session.auth });
    const { leaderboard } = (await board.json()) as { leaderboard: { user: { id: string }; successes: number }[] };
    assert.equal(leaderboard.find((row) => row.user.id === partner.id)?.successes, 1);

    const upholdId = await openResolved();
    const challenge = await fetch(`${base}/v1/bets/${upholdId}/dispute`, { method: "POST", headers: session.auth });
    assert.equal(challenge.status, 201);
    const upheldVote = await fetch(`${base}/v1/bets/${upholdId}/votes`, {
      method: "POST",
      headers: session.auth,
      body: JSON.stringify({
        asUserId: voter.id,
        outcomes: [
          { userId: session.userId, outcome: "fail" },
          { userId: partner.id, outcome: "fail" },
        ],
      }),
    });
    assert.equal(upheldVote.status, 201);
    const upheld = (await upheldVote.json()) as { bet: { status: string; dispute: { resolution: string } } };
    assert.equal(upheld.bet.status, "final");
    assert.equal(upheld.bet.dispute.resolution, "upheld");

    const outsider = await ageIn(base);
    const joined = await fetch(`${base}/v1/circles/join`, {
      method: "POST",
      headers: outsider.auth,
      body: JSON.stringify({ code: circle.inviteCode }),
    });
    assert.equal(joined.status, 200);
    const guardedId = await openResolved();
    const guardedOpen = await fetch(`${base}/v1/bets/${guardedId}/dispute`, { method: "POST", headers: outsider.auth });
    assert.equal(guardedOpen.status, 201);
    const denied = await fetch(`${base}/v1/bets/${guardedId}/votes`, {
      method: "POST",
      headers: outsider.auth,
      body: JSON.stringify({
        asUserId: voter.id,
        outcomes: [
          { userId: session.userId, outcome: "success" },
          { userId: partner.id, outcome: "fail" },
        ],
      }),
    });
    assert.equal(denied.status, 403);

    const judges = [await addPartner(base, session.auth, circle.id), await addPartner(base, session.auth, circle.id), await addPartner(base, session.auth, circle.id)];
    const judged = await fetch(`${base}/v1/circles/${circle.id}/bets`, {
      method: "POST",
      headers: session.auth,
      body: JSON.stringify({
        title: "Three judges",
        betType: "head_to_head",
        stakeAmount: 1_000_000,
        proofsRequired: 1,
        periodMinutes: 60,
        participantIds: [session.userId, partner.id],
        judgeIds: judges.map((judge) => judge.id),
      }),
    });
    assert.equal(judged.status, 201);
    const { bet: judgedBet } = (await judged.json()) as { bet: { id: string } };
    const judgedResolve = await fetch(`${base}/v1/bets/${judgedBet.id}/resolve`, {
      method: "POST",
      headers: reporter,
      body: JSON.stringify({ early: true }),
    });
    assert.equal(judgedResolve.status, 200);
    const judgedDispute = await fetch(`${base}/v1/bets/${judgedBet.id}/dispute`, { method: "POST", headers: session.auth });
    assert.equal(judgedDispute.status, 201);
    const oneBallot = await fetch(`${base}/v1/bets/${judgedBet.id}/votes`, {
      method: "POST",
      headers: session.auth,
      body: JSON.stringify({
        asUserId: judges[0]!.id,
        outcomes: [
          { userId: session.userId, outcome: "success" },
          { userId: partner.id, outcome: "success" },
        ],
      }),
    });
    assert.equal(oneBallot.status, 201);
    const pending = (await oneBallot.json()) as { bet: { status: string } };
    assert.equal(pending.bet.status, "disputed");
    const again = await fetch(`${base}/v1/bets/${judgedBet.id}/votes`, {
      method: "POST",
      headers: session.auth,
      body: JSON.stringify({
        asUserId: judges[0]!.id,
        outcomes: [
          { userId: session.userId, outcome: "fail" },
          { userId: partner.id, outcome: "fail" },
        ],
      }),
    });
    assert.equal(again.status, 409);
    const closed = await fetch(`${base}/v1/bets/${judgedBet.id}/dispute/close`, { method: "POST", headers: reporter });
    assert.equal(closed.status, 200);
    const voided = (await closed.json()) as { status: string; disputeResolution: string; outcomes: { outcome: string }[] };
    assert.equal(voided.status, "final");
    assert.equal(voided.disputeResolution, "void");
    assert.ok(voided.outcomes.every((row) => row.outcome === "refunded"));

    const quietId = await openResolved();
    const earlyClose = await fetch(`${base}/v1/bets/${quietId}/dispute/close`, { method: "POST" });
    assert.equal(earlyClose.status, 401);
    const unchallenged = await fetch(`${base}/v1/bets/${quietId}/dispute/close`, { method: "POST", headers: reporter });
    assert.equal(unchallenged.status, 200);
    const stood = (await unchallenged.json()) as { disputeResolution: string; outcomes: { userId: string; outcome: string }[] };
    assert.equal(stood.disputeResolution, "unchallenged");
    assert.equal(stood.outcomes.find((row) => row.userId === session.userId)?.outcome, "fail");

    const expiredId = await openResolved();
    await prisma.bet.update({
      where: { id: expiredId },
      data: { disputeDeadline: new Date(Date.now() - 1000) },
    });
    const late = await fetch(`${base}/v1/bets/${expiredId}/dispute`, { method: "POST", headers: session.auth });
    assert.equal(late.status, 409);
    const settled = await fetch(`${base}/v1/bets/${expiredId}`, { headers: session.auth });
    const settledBody = (await settled.json()) as { bet: { status: string; dispute: { resolution: string } } };
    assert.equal(settledBody.bet.status, "final");
    assert.equal(settledBody.bet.dispute.resolution, "unchallenged");
  });

  test("display name and wallet changes keep a session", async () => {
    await reset();
    const session = await ageIn(base);
    const renamed = await fetch(`${base}/v1/me`, {
      method: "PATCH",
      headers: session.auth,
      body: JSON.stringify({ displayName: "Ada" }),
    });
    assert.equal(renamed.status, 200);
    const named = (await renamed.json()) as { user: { displayName: string; hasName: boolean } };
    assert.equal(named.user.displayName, "Ada");
    assert.equal(named.user.hasName, true);
    const blank = await fetch(`${base}/v1/me`, {
      method: "PATCH",
      headers: session.auth,
      body: JSON.stringify({ displayName: " " }),
    });
    assert.equal(blank.status, 400);

    const circle = await createCircle(base, session.auth, "Names");
    const loaded = await fetch(`${base}/v1/circles/${circle.id}`, { headers: session.auth });
    const { circle: full } = (await loaded.json()) as { circle: { members: { user: { displayName: string } }[] } };
    assert.ok(full.members.some((member) => member.user.displayName === "Ada"));

    const pair = nacl.sign.keyPair();
    const wallet = bs58.encode(pair.publicKey);
    const nonceRes = await fetch(`${base}/v1/auth/nonce`, { method: "POST" });
    const { nonce } = (await nonceRes.json()) as { nonce: string };
    const message = signInMessage(wallet, nonce);
    const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(message), pair.secretKey));
    const rotated = await fetch(`${base}/v1/me/wallet`, {
      method: "POST",
      headers: session.auth,
      body: JSON.stringify({ walletPubkey: wallet, signature, nonce }),
    });
    assert.equal(rotated.status, 200);
    const rotatedBody = (await rotated.json()) as { token: string; user: { id: string; walletPubkey: string; displayName: string } };
    assert.equal(rotatedBody.user.id, session.userId);
    assert.equal(rotatedBody.user.walletPubkey, wallet);
    assert.equal(rotatedBody.user.displayName, "Ada");
    const stale = await fetch(`${base}/v1/me`, { headers: session.auth });
    assert.equal(stale.status, 401);
    const freshAuth = { authorization: `Bearer ${rotatedBody.token}`, "content-type": "application/json" };
    const me = await fetch(`${base}/v1/me`, { headers: freshAuth });
    assert.equal(me.status, 200);

    const other = nacl.sign.keyPair();
    const otherWallet = bs58.encode(other.publicKey);
    const pasted = await fetch(`${base}/v1/me/wallet`, {
      method: "POST",
      headers: freshAuth,
      body: JSON.stringify({ walletPubkey: otherWallet }),
    });
    assert.equal(pasted.status, 200);
    const pastedBody = (await pasted.json()) as { token: string; user: { id: string; walletPubkey: string } };
    assert.equal(pastedBody.user.id, session.userId);
    assert.equal(pastedBody.user.walletPubkey, otherWallet);
    const afterPaste = await fetch(`${base}/v1/me`, { headers: { authorization: `Bearer ${pastedBody.token}` } });
    assert.equal(afterPaste.status, 200);

    const taken = await signIn(base);
    const clash = await fetch(`${base}/v1/me/wallet`, {
      method: "POST",
      headers: { authorization: `Bearer ${pastedBody.token}`, "content-type": "application/json" },
      body: JSON.stringify({ walletPubkey: taken.wallet }),
    });
    assert.equal(clash.status, 409);
    const garbage = await fetch(`${base}/v1/me/wallet`, {
      method: "POST",
      headers: { authorization: `Bearer ${pastedBody.token}`, "content-type": "application/json" },
      body: JSON.stringify({ walletPubkey: "a".repeat(40) }),
    });
    assert.equal(garbage.status, 400);
  });
});
