// Created: 2026-03-19 18:00
// 2FA TOTP 유틸 — 시크릿 생성, QR 코드, 백업 코드
// Updated: 2026-04-06 — Web Crypto API (Edge 호환)

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, "0")).join("");
}

export function generateBackupCodes(count = 10): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    codes.push(randomHex(5).slice(0, 8).toUpperCase());
  }
  return codes;
}

export async function hashBackupCodes(codes: string[]): Promise<string[]> {
  const bcrypt = await import("bcrypt");
  return Promise.all(codes.map((code) => bcrypt.default.hash(code, 10)));
}

export async function matchBackupCode(code: string, hash: string): Promise<boolean> {
  const bcrypt = await import("bcrypt");
  return bcrypt.default.compare(code.toUpperCase(), hash);
}
