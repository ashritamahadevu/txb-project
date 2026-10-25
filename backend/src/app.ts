import { createHash, randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { z } from "zod";
import { newNonce, newToken, signInMessage, verifyWalletSignature } from "./auth.js";
import { prisma, seedTemplates } from "./db.js";
import { hammingHex, looksReused, preparePhoto } from "./photo.js";
import { decideOutcomes, evidenceDigest } from "./resolve.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
});

const uploadsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "uploads");

type Authed = Request & { userId?: string };

function inviteCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(6);
  return [...bytes].map((byte) => alphabet[byte % alphabet.length]).join("");
}

function goalHash(title: string, category: string, proofsRequired: number): string {
  return createHash("sha256")
    .update(JSON.stringify({ title, category, proofsRequired, version: 1 }))
    .digest("hex");
}

async function requireUser(req: Authed, res: Response, next: NextFunction) {
  const header = req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) {
    res.status(401).json({ error: "Sign in first" });
    return;
  }
  const session = await prisma.session.findUnique({ where: { token } });
  if (!session || session.expiresAt.getTime() < Date.now()) {
    res.status(401).json({ error: "Session expired" });
    return;
  }
  req.userId = session.userId;
  next();
}

function publicUser(user: { id: string; walletPubkey: string; displayName: string | null; ageConfirmed: boolean; practice: boolean }) {
  return {
    id: user.id,
    walletPubkey: user.walletPubkey,
    displayName: user.displayName ?? `${user.walletPubkey.slice(0, 4)}…${user.walletPubkey.slice(-4)}`,
    ageConfirmed: user.ageConfirmed,
    practice: user.practice,
  };
}

export function createApp() {
  const app = express();
  app.use((req, res, next) => {
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-headers", "content-type, authorization, x-reporter-key");
    res.setHeader("access-control-allow-methods", "GET, POST, PATCH, OPTIONS");
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  });
  app.use(express.json());
  app.use("/uploads", express.static(uploadsDir));

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/v1/templates", async (_req, res) => {
    await seedTemplates();
    const templates = await prisma.goalTemplate.findMany();
    res.json({ templates });
  });

  app.post("/v1/auth/nonce", async (_req, res) => {
    const value = newNonce();
    await prisma.nonce.create({
      data: { value, expiresAt: new Date(Date.now() + 10 * 60 * 1000) },
    });
    res.json({ nonce: value });
  });

  app.post("/v1/auth/verify", async (req, res) => {
    const body = z
      .object({
        walletPubkey: z.string().min(32).max(64),
        signature: z.string().min(64),
        nonce: z.string().min(8),
      })
      .safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "Wallet, signature, and nonce are required" });
      return;
    }
    const nonce = await prisma.nonce.findUnique({ where: { value: body.data.nonce } });
    if (!nonce || nonce.expiresAt.getTime() < Date.now()) {
      res.status(401).json({ error: "Nonce expired" });
      return;
    }
    const message = signInMessage(body.data.walletPubkey, body.data.nonce);
    if (!verifyWalletSignature(body.data.walletPubkey, message, body.data.signature)) {
      res.status(401).json({ error: "Signature did not match" });
      return;
    }
    await prisma.nonce.delete({ where: { id: nonce.id } });
    const user = await prisma.user.upsert({
      where: { walletPubkey: body.data.walletPubkey },
      update: {},
      create: { walletPubkey: body.data.walletPubkey },
    });
    const token = newToken();
    await prisma.session.create({
      data: {
        token,
        userId: user.id,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });
    res.json({ token, user: publicUser(user) });
  });

  app.get("/v1/me", requireUser, async (req: Authed, res) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.userId } });
    res.json({ user: publicUser(user) });
  });

  app.post("/v1/me/age", requireUser, async (req: Authed, res) => {
    const body = z.object({ confirmed: z.literal(true) }).safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "Confirm you are 18 or older" });
      return;
    }
    const user = await prisma.user.update({
      where: { id: req.userId },
      data: { ageConfirmed: true },
    });
    res.json({ user: publicUser(user) });
  });

  app.get("/v1/circles", requireUser, async (req: Authed, res) => {
    const memberships = await prisma.circleMember.findMany({
      where: { userId: req.userId },
      include: { circle: true },
    });
    res.json({
      circles: memberships.map((membership) => ({
        ...membership.circle,
        roles: membership.roles,
      })),
    });
  });

  app.post("/v1/circles", requireUser, async (req: Authed, res) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.userId } });
    if (!user.ageConfirmed) {
      res.status(403).json({ error: "Confirm you are 18 or older first" });
      return;
    }
    const body = z
      .object({
        name: z.string().min(2).max(40),
        defaultStake: z.number().int().positive().max(1_000_000_000).optional(),
      })
      .safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "Circle name is required" });
      return;
    }
    const circle = await prisma.circle.create({
      data: {
        name: body.data.name,
        inviteCode: inviteCode(),
        defaultStake: body.data.defaultStake ?? 1_000_000,
        members: {
          create: { userId: user.id, roles: ["owner", "member"] },
        },
      },
    });
    res.status(201).json({ circle });
  });

  app.post("/v1/circles/join", requireUser, async (req: Authed, res) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.userId } });
    if (!user.ageConfirmed) {
      res.status(403).json({ error: "Confirm you are 18 or older first" });
      return;
    }
    const body = z.object({ code: z.string().min(4).max(12) }).safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "Invite code is required" });
      return;
    }
    const circle = await prisma.circle.findUnique({
      where: { inviteCode: body.data.code.trim().toUpperCase() },
    });
    if (!circle) {
      res.status(404).json({ error: "No circle uses that code" });
      return;
    }
    await prisma.circleMember.upsert({
      where: { circleId_userId: { circleId: circle.id, userId: user.id } },
      update: {},
      create: { circleId: circle.id, userId: user.id, roles: ["member"] },
    });
    res.json({ circle });
  });

  app.get("/v1/circles/:id", requireUser, async (req: Authed, res) => {
    const circle = await prisma.circle.findUnique({
      where: { id: req.params.id },
      include: {
        members: { include: { user: true } },
        bets: { orderBy: { createdAt: "desc" }, include: { participants: true } },
      },
    });
    if (!circle) {
      res.status(404).json({ error: "Circle not found" });
      return;
    }
    const mine = circle.members.find((member) => member.userId === req.userId);
    if (!mine) {
      res.status(403).json({ error: "You are not in this circle" });
      return;
    }
    res.json({
      circle: {
        id: circle.id,
        name: circle.name,
        inviteCode: circle.inviteCode,
        defaultStake: circle.defaultStake,
        roles: mine.roles,
        members: circle.members.map((member) => ({
          roles: member.roles,
          user: publicUser(member.user),
        })),
        bets: circle.bets.map((bet) => ({
          id: bet.id,
          title: bet.title,
          betType: bet.betType,
          status: bet.status,
          stakeAmount: bet.stakeAmount,
          participantCount: bet.participants.length,
          requiredCount: bet.requiredCount,
        })),
      },
    });
  });

  app.post("/v1/circles/:id/practice-partner", requireUser, async (req: Authed, res) => {
    const membership = await prisma.circleMember.findUnique({
      where: { circleId_userId: { circleId: req.params.id, userId: req.userId! } },
    });
    if (!membership?.roles.includes("owner")) {
      res.status(403).json({ error: "Only the circle owner can add a practice partner" });
      return;
    }
    const existing = await prisma.circleMember.findFirst({
      where: { circleId: req.params.id, user: { practice: true } },
      include: { user: true },
    });
    if (existing) {
      res.json({ user: publicUser(existing.user) });
      return;
    }
    const user = await prisma.user.create({
      data: {
        walletPubkey: `practice-${randomBytes(16).toString("hex")}`,
        displayName: "Practice partner",
        ageConfirmed: true,
        practice: true,
        memberships: { create: { circleId: req.params.id, roles: ["member"] } },
      },
    });
    res.status(201).json({ user: publicUser(user) });
  });

  app.post("/v1/circles/:id/bets", requireUser, async (req: Authed, res) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.userId } });
    if (!user.ageConfirmed) {
      res.status(403).json({ error: "Confirm you are 18 or older first" });
      return;
    }
    const membership = await prisma.circleMember.findUnique({
      where: { circleId_userId: { circleId: req.params.id, userId: user.id } },
    });
    if (!membership) {
      res.status(403).json({ error: "You are not in this circle" });
      return;
    }
    const body = z
      .object({
        title: z.string().min(3).max(80),
        betType: z.enum(["head_to_head", "pool"]),
        stakeAmount: z.number().int().positive().max(1_000_000_000),
        proofsRequired: z.number().int().min(1).max(30),
        periodHours: z.number().int().min(1).max(24 * 90),
        participantIds: z.array(z.string()).min(1).max(10),
        judgeIds: z.array(z.string()).max(3).optional(),
      })
      .safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "Bet details are incomplete" });
      return;
    }
    const participantIds = [...new Set(body.data.participantIds)];
    if (!participantIds.includes(user.id)) {
      res.status(400).json({ error: "The creator joins their own bet" });
      return;
    }
    const required = body.data.betType === "head_to_head" ? 2 : participantIds.length;
    if (body.data.betType === "head_to_head" && participantIds.length !== 2) {
      res.status(400).json({ error: "A head-to-head bet needs exactly two people" });
      return;
    }
    if (participantIds.length < 2) {
      res.status(400).json({ error: "A bet needs at least two people" });
      return;
    }
    const members = await prisma.circleMember.findMany({ where: { circleId: req.params.id } });
    const memberIds = new Set(members.map((member) => member.userId));
    if (participantIds.some((id) => !memberIds.has(id))) {
      res.status(400).json({ error: "Every participant must be in the circle" });
      return;
    }
    const judgeIds = body.data.judgeIds ?? [];
    if (judgeIds.some((id) => participantIds.includes(id) || !memberIds.has(id))) {
      res.status(400).json({ error: "Judges must be circle members who are not in the bet" });
      return;
    }
    const now = new Date();
    const bet = await prisma.bet.create({
      data: {
        circleId: req.params.id,
        creatorId: user.id,
        betType: body.data.betType,
        title: body.data.title,
        category: "habit",
        stakeAmount: body.data.stakeAmount,
        goalHash: goalHash(body.data.title, "habit", body.data.proofsRequired),
        status: "active",
        requiredCount: required,
        proofsRequired: body.data.proofsRequired,
        periodStart: now,
        periodEnd: new Date(now.getTime() + body.data.periodHours * 60 * 60 * 1000),
        participants: {
          create: participantIds.map((userId) => ({ userId })),
        },
        judges: {
          create: judgeIds.map((userId) => ({ userId })),
        },
      },
      include: { participants: { include: { user: true }, orderBy: { joinedAt: "asc" } } },
    });
    res.status(201).json({ bet: serializeBet(bet) });
  });

  app.get("/v1/bets/:id", requireUser, async (req: Authed, res) => {
    const bet = await loadVisibleBet(req.params.id, req.userId!);
    if (!bet) {
      res.status(404).json({ error: "Bet not found" });
      return;
    }
    res.json({ bet: serializeBet(bet) });
  });

  app.post("/v1/bets/:id/proofs", requireUser, upload.single("photo"), async (req: Authed, res) => {
    const bet = await prisma.bet.findUnique({
      where: { id: req.params.id },
      include: { participants: true, circle: { include: { members: true } } },
    });
    if (!bet) {
      res.status(404).json({ error: "Bet not found" });
      return;
    }
    if (!bet.circle.members.some((member) => member.userId === req.userId)) {
      res.status(403).json({ error: "You are not in this circle" });
      return;
    }
    if (!bet.participants.some((participant) => participant.userId === req.userId)) {
      res.status(403).json({ error: "Only participants post proof" });
      return;
    }
    if (bet.status !== "active") {
      res.status(409).json({ error: "This bet is no longer taking proof" });
      return;
    }
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "Attach a photo" });
      return;
    }
    let prepared;
    try {
      prepared = await preparePhoto(file.buffer);
    } catch {
      res.status(400).json({ error: "That file is not a readable image" });
      return;
    }
    const caption = typeof req.body.caption === "string" ? req.body.caption.slice(0, 280) : "";
    const capturedAt = new Date();
    const prior = await prisma.proofPost.findMany({
      where: { userId: req.userId, bet: { circleId: bet.circleId } },
      select: { id: true, dHash: true },
    });
    const duplicate = prior.find((proof) => looksReused(hammingHex(proof.dHash, prepared.dHash)));
    await mkdir(uploadsDir, { recursive: true });
    const filename = `${randomBytes(16).toString("hex")}.jpg`;
    await writeFile(path.join(uploadsDir, filename), prepared.bytes);
    const proof = await prisma.proofPost.create({
      data: {
        betId: bet.id,
        userId: req.userId!,
        caption,
        photoPath: `/uploads/${filename}`,
        photoHash: prepared.sha256,
        dHash: prepared.dHash,
        capturedAt,
        flagged: Boolean(duplicate),
        flagReason: duplicate ? "Looks like a photo already posted in this circle" : null,
      },
      include: { user: true, comments: true, reactions: true },
    });
    res.status(201).json({ proof: serializeProof(proof) });
  });

  app.post("/v1/proofs/:id/comments", requireUser, async (req: Authed, res) => {
    const proof = await prisma.proofPost.findUnique({
      where: { id: req.params.id },
      include: { bet: { include: { circle: { include: { members: true } } } } },
    });
    if (!proof || !proof.bet.circle.members.some((member) => member.userId === req.userId)) {
      res.status(404).json({ error: "Proof not found" });
      return;
    }
    const body = z.object({ body: z.string().min(1).max(500) }).safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "Write a comment" });
      return;
    }
    const comment = await prisma.comment.create({
      data: { proofId: proof.id, userId: req.userId!, body: body.data.body },
      include: { user: true },
    });
    res.status(201).json({
      comment: {
        id: comment.id,
        body: comment.body,
        createdAt: comment.createdAt,
        user: publicUser(comment.user),
      },
    });
  });

  app.post("/v1/proofs/:id/reactions", requireUser, async (req: Authed, res) => {
    const proof = await prisma.proofPost.findUnique({
      where: { id: req.params.id },
      include: { bet: { include: { circle: { include: { members: true } } } } },
    });
    if (!proof || !proof.bet.circle.members.some((member) => member.userId === req.userId)) {
      res.status(404).json({ error: "Proof not found" });
      return;
    }
    const body = z.object({ kind: z.enum(["respect", "doubt", "fire"]) }).safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "Unknown reaction" });
      return;
    }
    const reaction = await prisma.reaction.upsert({
      where: {
        proofId_userId_kind: {
          proofId: proof.id,
          userId: req.userId!,
          kind: body.data.kind,
        },
      },
      update: {},
      create: { proofId: proof.id, userId: req.userId!, kind: body.data.kind },
    });
    res.status(201).json({ reaction });
  });

  app.post("/v1/proofs/:id/report", requireUser, async (req: Authed, res) => {
    const proof = await prisma.proofPost.findUnique({ where: { id: req.params.id } });
    if (!proof) {
      res.status(404).json({ error: "Proof not found" });
      return;
    }
    await prisma.proofPost.update({ where: { id: proof.id }, data: { reported: true } });
    res.json({ reported: true });
  });

  app.post("/v1/bets/:id/resolve", async (req, res) => {
    if (req.header("x-reporter-key") !== (process.env.REPORTER_API_KEY || "dev-reporter")) {
      res.status(401).json({ error: "Reporter key required" });
      return;
    }
    const body = z.object({ early: z.boolean().optional() }).safeParse(req.body ?? {});
    const bet = await prisma.bet.findUnique({
      where: { id: req.params.id },
      include: {
        participants: true,
        proofs: true,
      },
    });
    if (!bet) {
      res.status(404).json({ error: "Bet not found" });
      return;
    }
    if (bet.status === "resolved") {
      res.status(409).json({ error: "Already resolved" });
      return;
    }
    const early = body.success && body.data.early === true;
    const effective = early ? { ...bet, periodEnd: new Date() } : bet;
    if (!early && bet.periodEnd.getTime() > Date.now()) {
      res.status(409).json({ error: "The goal period is still open" });
      return;
    }
    const decisions = decideOutcomes(effective, bet.participants, bet.proofs);
    const digest = evidenceDigest(bet.proofs.filter((proof) => !proof.flagged));
    await prisma.$transaction([
      ...decisions.map((decision) =>
        prisma.betParticipant.update({
          where: { betId_userId: { betId: bet.id, userId: decision.userId } },
          data: { outcome: decision.outcome },
        }),
      ),
      prisma.bet.update({
        where: { id: bet.id },
        data: { status: "resolved", evidenceHash: digest },
      }),
    ]);
    res.json({
      evidenceHash: digest,
      outcomes: decisions,
      note: "Submit these outcomes with the evidence hash from the reporter key. The app does not pay the network fee.",
    });
  });

  app.get("/v1/circles/:id/leaderboard", requireUser, async (req: Authed, res) => {
    const membership = await prisma.circleMember.findUnique({
      where: { circleId_userId: { circleId: req.params.id, userId: req.userId! } },
    });
    if (!membership) {
      res.status(403).json({ error: "You are not in this circle" });
      return;
    }
    const bets = await prisma.bet.findMany({
      where: { circleId: req.params.id, status: "resolved" },
      include: { participants: { include: { user: true } } },
      orderBy: { periodEnd: "desc" },
    });
    const rows = new Map<
      string,
      { user: ReturnType<typeof publicUser>; successes: number; resolved: number; streak: number; streakBroken: boolean }
    >();
    for (const bet of bets) {
      for (const participant of bet.participants) {
        if (participant.outcome !== "success" && participant.outcome !== "fail") continue;
        const row = rows.get(participant.userId) ?? {
          user: publicUser(participant.user),
          successes: 0,
          resolved: 0,
          streak: 0,
          streakBroken: false,
        };
        row.resolved += 1;
        if (participant.outcome === "success") {
          row.successes += 1;
          if (!row.streakBroken) row.streak += 1;
        } else {
          row.streakBroken = true;
        }
        rows.set(participant.userId, row);
      }
    }
    const leaderboard = [...rows.values()]
      .map((row) => ({
        user: row.user,
        successes: row.successes,
        resolved: row.resolved,
        streak: row.streak,
        successRate: row.resolved === 0 ? 0 : row.successes / row.resolved,
      }))
      .sort((a, b) => b.successRate - a.successRate || b.streak - a.streak || b.successes - a.successes);
    res.json({ leaderboard });
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error && typeof error === "object" && "code" in error && error.code === "LIMIT_FILE_SIZE") {
      res.status(400).json({ error: "Photo must be under 8MB" });
      return;
    }
    console.error(error);
    res.status(500).json({ error: "Something went wrong" });
  });

  return app;
}

async function loadVisibleBet(id: string, userId: string) {
  const bet = await prisma.bet.findUnique({
    where: { id },
    include: {
      circle: { include: { members: true } },
      participants: { include: { user: true }, orderBy: { joinedAt: "asc" } },
      judges: { include: { user: true } },
      proofs: {
        include: {
          user: true,
          comments: { include: { user: true }, orderBy: { createdAt: "asc" } },
          reactions: true,
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!bet || !bet.circle.members.some((member) => member.userId === userId)) return null;
  return bet;
}

function serializeBet(bet: {
  id: string;
  title: string;
  betType: string;
  category: string;
  status: string;
  stakeAmount: number;
  goalHash: string;
  onChainAddress: string | null;
  requiredCount: number;
  proofsRequired: number;
  periodStart: Date;
  periodEnd: Date;
  evidenceHash: string | null;
  participants: { outcome: string; user: { id: string; walletPubkey: string; displayName: string | null; ageConfirmed: boolean; practice: boolean } }[];
  judges?: { vote: string | null; user: { id: string; walletPubkey: string; displayName: string | null; ageConfirmed: boolean; practice: boolean } }[];
  proofs?: {
    id: string;
    caption: string | null;
    photoPath: string;
    photoHash: string;
    capturedAt: Date;
    flagged: boolean;
    flagReason: string | null;
    reported: boolean;
    user: { id: string; walletPubkey: string; displayName: string | null; ageConfirmed: boolean; practice: boolean };
    comments: { id: string; body: string; createdAt: Date; user: { id: string; walletPubkey: string; displayName: string | null; ageConfirmed: boolean; practice: boolean } }[];
    reactions: { kind: string; userId: string }[];
  }[];
}) {
  return {
    id: bet.id,
    title: bet.title,
    betType: bet.betType,
    category: bet.category,
    status: bet.status,
    stakeAmount: bet.stakeAmount,
    goalHash: bet.goalHash,
    onChainAddress: bet.onChainAddress,
    requiredCount: bet.requiredCount,
    proofsRequired: bet.proofsRequired,
    periodStart: bet.periodStart,
    periodEnd: bet.periodEnd,
    evidenceHash: bet.evidenceHash,
    feePayer: "Each signer pays their own network fee. This app does not sponsor SOL.",
    participants: bet.participants.map((participant) => ({
      outcome: participant.outcome,
      user: publicUser(participant.user),
    })),
    judges: (bet.judges ?? []).map((judge) => ({
      vote: judge.vote,
      user: publicUser(judge.user),
    })),
    proofs: (bet.proofs ?? []).map(serializeProof),
  };
}

function serializeProof(proof: {
  id: string;
  caption: string | null;
  photoPath: string;
  photoHash: string;
  capturedAt: Date;
  flagged: boolean;
  flagReason: string | null;
  reported: boolean;
  user: { id: string; walletPubkey: string; displayName: string | null; ageConfirmed: boolean; practice: boolean };
  comments: { id: string; body: string; createdAt: Date; user: { id: string; walletPubkey: string; displayName: string | null; ageConfirmed: boolean; practice: boolean } }[];
  reactions: { kind: string; userId: string }[];
}) {
  return {
    id: proof.id,
    caption: proof.caption,
    photoPath: proof.photoPath,
    photoHash: proof.photoHash,
    capturedAt: proof.capturedAt,
    flagged: proof.flagged,
    flagReason: proof.flagReason,
    reported: proof.reported,
    user: publicUser(proof.user),
    comments: proof.comments.map((comment) => ({
      id: comment.id,
      body: comment.body,
      createdAt: comment.createdAt,
      user: publicUser(comment.user),
    })),
    reactions: proof.reactions,
  };
}
