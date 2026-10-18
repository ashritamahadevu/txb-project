const memory = new Map();

export async function getToken() {
  if (typeof localStorage !== "undefined") return localStorage.getItem("txb-token");
  return memory.get("txb-token") ?? null;
}

export async function setToken(token) {
  if (typeof localStorage !== "undefined") {
    if (token) localStorage.setItem("txb-token", token);
    else localStorage.removeItem("txb-token");
    return;
  }
  if (token) memory.set("txb-token", token);
  else memory.delete("txb-token");
}

export async function getSecret() {
  if (typeof localStorage !== "undefined") return localStorage.getItem("txb-secret");
  return memory.get("txb-secret") ?? null;
}

export async function setSecret(secret) {
  if (typeof localStorage !== "undefined") localStorage.setItem("txb-secret", secret);
  else memory.set("txb-secret", secret);
}
