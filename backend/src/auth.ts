import { randomBytes } from "node:crypto";
import bs58 from "bs58";
import nacl from "tweetnacl";

export function newToken(): string {
  return randomBytes(32).toString("hex");
}

export function newNonce(): string {
  return randomBytes(16).toString("hex");
}

export function signInMessage(wallet: string, nonce: string): string {
  return `TxB wants you to sign in\nWallet: ${wallet}\nNonce: ${nonce}`;
}

export function verifyWalletSignature(wallet: string, message: string, signature: string): boolean {
  try {
    const key = bs58.decode(wallet);
    const sig = bs58.decode(signature);
    if (key.length !== nacl.sign.publicKeyLength || sig.length !== nacl.sign.signatureLength) {
      return false;
    }
    return nacl.sign.detached.verify(new TextEncoder().encode(message), sig, key);
  } catch {
    return false;
  }
}
