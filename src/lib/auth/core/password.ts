// Created: 2026-03-19 18:00
// 비밀번호 해싱 — bcrypt 래퍼 (Node.js 전용, Edge에서 미사용)
// Updated: 2026-04-06 — dynamic import (Edge 번들에서 native addon 제외)

const BCRYPT_ROUNDS = 12; // Auth Server와 동일 (보안 강화)

export async function hashPassword(password: string, rounds = BCRYPT_ROUNDS): Promise<string> {
  const bcrypt = await import("bcrypt");
  return bcrypt.default.hash(password, rounds);
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
  const bcrypt = await import("bcrypt");
  return bcrypt.default.compare(password, hash);
}
