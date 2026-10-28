// Created: 2026-03-19 16:00
// Token 유틸 — Refresh Token 생성, 해시
// Updated: 2026-04-06 — Web Crypto API (Edge 호환)
import { AUTH_CONFIG } from "../config";

export function generateRefreshToken(): string {
  const arr = new Uint8Array(AUTH_CONFIG.refreshTokenBytes);
  globalThis.crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, "0")).join("");
}

export async function hashToken(raw: string): Promise<string> {
  const enc = new TextEncoder();
  const hashBuf = await globalThis.crypto.subtle.digest("SHA-256", enc.encode(raw));
  return Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, "0")).join("");
}
