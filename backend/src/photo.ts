import { createHash } from "node:crypto";
import sharp from "sharp";

const DUPLICATE_DISTANCE = 8;

export type PreparedPhoto = {
  bytes: Buffer;
  sha256: string;
  dHash: string;
};

/** Re-encode to JPEG so EXIF, including location, is not stored. */
export async function preparePhoto(input: Buffer): Promise<PreparedPhoto> {
  const bytes = await sharp(input)
    .rotate()
    .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer();
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const dHash = await differenceHash(bytes);
  return { bytes, sha256, dHash };
}

export async function differenceHash(input: Buffer): Promise<string> {
  const { data } = await sharp(input)
    .grayscale()
    .resize(9, 8, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  let bits = "";
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      const left = data[y * 9 + x] ?? 0;
      const right = data[y * 9 + x + 1] ?? 0;
      bits += left < right ? "1" : "0";
    }
  }
  let hex = "";
  for (let i = 0; i < bits.length; i += 4) {
    hex += Number.parseInt(bits.slice(i, i + 4), 2).toString(16);
  }
  return hex;
}

export function hammingHex(left: string, right: string): number {
  const size = Math.min(left.length, right.length);
  let distance = 0;
  for (let i = 0; i < size; i += 1) {
    const mixed = Number.parseInt(left[i] ?? "0", 16) ^ Number.parseInt(right[i] ?? "0", 16);
    distance += mixed.toString(2).replace(/0/g, "").length;
  }
  distance += Math.abs(left.length - right.length) * 4;
  return distance;
}

export function looksReused(distance: number): boolean {
  return distance <= DUPLICATE_DISTANCE;
}

/** Canonical evidence blob hashed into the on-chain evidence field. */
export function evidenceHash(photoHashes: string[]): string {
  const canonical = JSON.stringify([...photoHashes].sort());
  return createHash("sha256").update(canonical).digest("hex");
}
