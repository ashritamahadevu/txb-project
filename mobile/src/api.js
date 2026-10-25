import { getToken } from "./session";

export const API_URL = process.env.EXPO_PUBLIC_API_URL || "http://localhost:4000";

export async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  const token = await getToken();
  if (token) headers.authorization = `Bearer ${token}`;
  if (options.json) {
    headers["content-type"] = "application/json";
    options.body = JSON.stringify(options.json);
  }
  const response = await fetch(`${API_URL}${path}`, { ...options, headers });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }
  return data;
}

export function photoUrl(photoPath) {
  if (!photoPath) return "";
  if (photoPath.startsWith("http")) return photoPath;
  return `${API_URL}${photoPath}`;
}

export function usdc(baseUnits) {
  return `${(baseUnits / 1_000_000).toFixed(2)} USDC`;
}
