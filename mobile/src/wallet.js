import bs58 from "bs58";
import nacl from "tweetnacl";
import { api } from "./api";
import { getSecret, setSecret, setToken } from "./session";

export async function deviceKeypair() {
  let secret = await getSecret();
  if (!secret) {
    secret = bs58.encode(nacl.sign.keyPair().secretKey);
    await setSecret(secret);
  }
  const secretKey = bs58.decode(secret);
  const pair = nacl.sign.keyPair.fromSecretKey(secretKey);
  return { publicKey: bs58.encode(pair.publicKey), secretKey: pair.secretKey };
}

export async function signInWithDeviceKey() {
  const { publicKey, secretKey } = await deviceKeypair();
  const { nonce } = await api("/v1/auth/nonce", { method: "POST" });
  const message = `TxB wants you to sign in\nWallet: ${publicKey}\nNonce: ${nonce}`;
  const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(message), secretKey));
  const result = await api("/v1/auth/verify", {
    method: "POST",
    json: { walletPubkey: publicKey, signature, nonce },
  });
  await setToken(result.token);
  return result.user;
}
