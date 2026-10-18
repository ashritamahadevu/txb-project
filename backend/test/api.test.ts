import assert from "node:assert/strict";
import type { Server } from "node:http";
import test from "node:test";
import nacl from "tweetnacl";
import bs58 from "bs58";
import sharp from "sharp";

process.env.DATABASE_URL ??= "postgresql://txb:txb@localhost:5432/txb_test";
process.env.REPORTER_API_KEY = "dev-reporter";

const { createApp } = await import("../src/app.ts");
const { prisma } = await import("../src/db.ts");
const { signInMessage } = await import("../src/auth.ts");

async function reset() {
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

test("circle, photo proof, comment, resolve, and leaderboard", async () => {
  await reset();
  const server = createApp().listen(0, "127.0.0.1");
  const port = await listen(server);
  const base = `http://127.0.0.1:${port}`;
  try {
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
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await prisma.$disconnect();
  }
});
