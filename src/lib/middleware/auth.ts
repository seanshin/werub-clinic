// Created: 2026-02-08
// Updated: 2026-03-19 — Phase 2: Re-export 파사드 (실제 구현은 src/lib/auth/로 이동)
// 기존 import 경로 호환 — 279개 파일에서 `@/lib/middleware/auth` import 유지

// ─── Core ──────────────────────────────────────────────────────────────
export {
  signToken,
  verifyToken,
  sign2FAToken,
  verify2FAToken,
  generateRefreshToken,
  hashToken,
  setAuthCookies,
  setRefreshTokenCookie,
  clearAuthCookies,
} from "@/lib/auth/core";

export type { JwtPayload, TwoFactorPayload } from "@/lib/auth/core";

// ─── Config ────────────────────────────────────────────────────────────
export { ACCESS_TOKEN_MAX_AGE, REFRESH_TOKEN_MAX_AGE } from "@/lib/auth/config";

// ─── Middleware ─────────────────────────────────────────────────────────
export {
  requireAuth,
  requireAuthAsync,
  requireRole,
  requireServiceRole,
  invalidateTokenVersionCache,
  invalidateRoleCache,
} from "@/lib/auth/middleware/require-auth";

export { requireAdminPermission } from "@/lib/auth/middleware/require-admin-permission";
