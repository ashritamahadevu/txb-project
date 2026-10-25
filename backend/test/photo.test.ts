import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { differenceHash, hammingHex, looksReused, preparePhoto } from "../src/photo.ts";
import { decideOutcomes, evidenceDigest } from "../src/resolve.ts";

test("re-encoding strips a metadata payload and keeps a stable hash", async () => {
  const raw = await sharp({
    create: { width: 40, height: 30, channels: 3, background: { r: 10, g: 20, b: 30 } },
  })
    .withMetadata({ exif: { IFD0: { ImageDescription: "gps-should-not-survive" } } })
    .jpeg()
    .toBuffer();
  const prepared = await preparePhoto(raw);
  const meta = await sharp(prepared.bytes).metadata();
  assert.equal(meta.exif, undefined);
  assert.equal(prepared.sha256.length, 64);
});

async function pattern(kind: "split" | "bars") {
  const width = 64;
  const height = 48;
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const on = kind === "split" ? x > width / 2 : y % 8 < 4;
      const value = on ? 240 : 20;
      const index = (y * width + x) * 3;
      raw[index] = value;
      raw[index + 1] = value;
      raw[index + 2] = value;
    }
  }
  return sharp(raw, { raw: { width, height, channels: 3 } }).jpeg().toBuffer();
}

test("a reused photo is close in perceptual hash and a different one is not", async () => {
  const first = await pattern("split");
  const again = await pattern("split");
  const other = await pattern("bars");
  const same = hammingHex(await differenceHash(first), await differenceHash(again));
  const different = hammingHex(await differenceHash(first), await differenceHash(other));
  assert.equal(looksReused(same), true);
  assert.equal(looksReused(different), false);
});

test("habit outcomes count only unflagged photos inside the window", () => {
  const start = new Date("2026-10-01T00:00:00Z");
  const end = new Date("2026-10-08T00:00:00Z");
  const decisions = decideOutcomes(
    { proofsRequired: 2, periodStart: start, periodEnd: end },
    [
      { userId: "a", joinedAt: new Date("2026-10-01T00:00:00Z") },
      { userId: "b", joinedAt: new Date("2026-10-01T00:01:00Z") },
    ],
    [
      { userId: "a", flagged: false, capturedAt: new Date("2026-10-02T00:00:00Z"), photoHash: "1" },
      { userId: "a", flagged: false, capturedAt: new Date("2026-10-03T00:00:00Z"), photoHash: "2" },
      { userId: "b", flagged: true, capturedAt: new Date("2026-10-02T00:00:00Z"), photoHash: "3" },
      { userId: "b", flagged: false, capturedAt: new Date("2026-09-01T00:00:00Z"), photoHash: "4" },
    ],
  );
  assert.deepEqual(decisions, [
    { userId: "a", outcome: "success" },
    { userId: "b", outcome: "fail" },
  ]);
  const digest = evidenceDigest([
    { photoHash: "b", capturedAt: new Date("2026-10-02T00:00:00Z") },
    { photoHash: "a", capturedAt: new Date("2026-10-01T00:00:00Z") },
  ]);
  assert.equal(digest.length, 64);
});
