// Created: 2026-03-19 16:00
// 인증 미들웨어 — requireAuth, requireAuthAsync, requireRole, requireServiceRole
import { NextRequest } from "next/server";
import { UnauthorizedError, ForbiddenError } from "@/lib/errors";
import { verifyToken, verifyCsrf } from "../core";
import type { JwtPayload } from "../core";
import { AUTH_CONFIG } from "../config";
import { publishAuthCacheInvalidation, registerAuthCacheInvalidationHandler } from "../cache-invalidation";

// ─── tokenVersion 캐시 ──────────────────────────────────────────────
const tokenVersionCache = new Map<string, { version: number; expiry: number }>();

export function invalidateTokenVersionCache(userId: string) {
  tokenVersionCache.delete(userId);
  publishAuthCacheInvalidation("tokenVersion", userId); // [N17] 타 인스턴스 전파
}

// Edge Runtime에서는 백그라운드 타이머 스킵 (요청별 수명주기)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _isEdgeRuntime = typeof (globalThis as any).EdgeRuntime === "string";
if (!_isEdgeRuntime) {
  const _tvCacheCleanup = setInterval(() => {
    const now = Date.now();
    tokenVersionCache.forEach((v, k) => {
      if (v.expiry < now) tokenVersionCache.delete(k);
    });
    if (tokenVersionCache.size > AUTH_CONFIG.tokenVersionCacheMax) {
      const excess = tokenVersionCache.size - AUTH_CONFIG.tokenVersionCacheMax;
      let i = 0;
      for (const key of tokenVersionCache.keys()) {
        if (i++ >= excess) break;
        tokenVersionCache.delete(key);
      }
    }
  }, 5 * 60 * 1000);
  _tvCacheCleanup.unref?.();
}

async function checkTokenVersion(payload: JwtPayload): Promise<void> {
  const now = Date.now();
  const cached = tokenVersionCache.get(payload.userId);

  let dbVersion: number;
  if (cached && cached.expiry > now) {
    dbVersion = cached.version;
  } else {
    // Prisma 직접 사용 — repositories를 import하면 pg-pool이 Edge 번들에 포함됨
    const { prisma } = await import("@/lib/prisma");
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { tokenVersion: true },
    });
    if (user === null) throw new UnauthorizedError("사용자를 찾을 수 없습니다");
    dbVersion = user.tokenVersion;
    tokenVersionCache.set(payload.userId, { version: dbVersion, expiry: now + AUTH_CONFIG.tokenVersionCacheTtl });
  }

  if (payload.tokenVersion !== dbVersion) {
    throw new UnauthorizedError("세션이 만료되었습니다. 다시 로그인하세요");
  }
}

// ─── 서비스 역할 캐시 ────────────────────────────────────────────────
const roleCache = new Map<string, { roles: string[]; expiry: number }>();

export function invalidateRoleCache(userId: string) {
  roleCache.delete(userId);
  publishAuthCacheInvalidation("role", userId); // [N17] 타 인스턴스 전파
}

// [N17] 타 인스턴스가 발행한 무효화 수신 → 로컬 캐시 삭제 (Node 런타임만; Edge는 요청별 수명이라 캐시 없음)
if (!_isEdgeRuntime) {
  registerAuthCacheInvalidationHandler((type, userId) => {
    if (type === "tokenVersion") tokenVersionCache.delete(userId);
    else roleCache.delete(userId);
  });
}

if (!_isEdgeRuntime) {
  const _roleCacheCleanup = setInterval(() => {
    const now = Date.now();
    roleCache.forEach((v, k) => {
      if (v.expiry < now) roleCache.delete(k);
    });
    if (roleCache.size > AUTH_CONFIG.roleCacheMax) {
      const excess = roleCache.size - AUTH_CONFIG.roleCacheMax;
      let i = 0;
      for (const key of roleCache.keys()) {
        if (i++ >= excess) break;
        roleCache.delete(key);
      }
    }
  }, 5 * 60 * 1000);
  _roleCacheCleanup.unref?.();
}

// ─── 미들웨어 함수 ─────────────────────────────────────────────────

// Updated: 2026-04-06 — async 전환 (jose 기반 verifyToken — Edge Runtime 호환)
export async function requireAuth(request: NextRequest, opts?: { skipCsrf?: boolean }): Promise<JwtPayload> {
  const cookieToken = request.cookies.get(AUTH_CONFIG.cookieNames.authToken)?.value;
  const bearerToken = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "").trim() || undefined;
  const token = cookieToken ?? bearerToken;
  if (!token) {
    throw new UnauthorizedError();
  }

  const isBearerAuth = !!bearerToken && (!cookieToken || cookieToken === bearerToken);
  const method = request.method.toUpperCase();
  if (!["GET", "HEAD", "OPTIONS"].includes(method) && !isBearerAuth && !opts?.skipCsrf) {
    verifyCsrf(request);
  }

  return verifyToken(token);
}

export async function requireAuthAsync(request: NextRequest): Promise<JwtPayload> {
  const payload = await requireAuth(request);
  await checkTokenVersion(payload);
  return payload;
}

export async function requireRole(request: NextRequest, ...roles: string[]): Promise<JwtPayload> {
  // [S-2] 역할 기반 라우트(admin 등)는 민감 — token_version 검증(requireAuthAsync)으로
  // 로그아웃/차단/권한회수가 access 만료(≤1h) 전에 즉시 반영되도록 함.
  const user = await requireAuthAsync(request);
  // SUPER_ADMIN은 ADMIN 권한을 항상 포함 (역할 계층)
  if (!roles.includes(user.role) && !(user.role === "SUPER_ADMIN" && roles.includes("ADMIN"))) {
    throw new ForbiddenError();
  }
  return user;
}

export async function requireServiceRole(
  request: NextRequest,
  ...roles: string[]
): Promise<JwtPayload> {
  // [S-2] 서비스 역할 게이팅도 민감 — token_version 검증으로 즉시 무효화 반영.
  const user = await requireAuthAsync(request);

  const now = Date.now();
  const cached = roleCache.get(user.userId);
  let userRoles: string[];

  if (cached && cached.expiry > now) {
    userRoles = cached.roles;
  } else {
    // prisma 의존 제거 — 향후 Repository로 전환 예정
    // 현재는 직접 import (requireServiceRole은 auth 서비스 외부에서만 사용)
    const { prisma } = await import("@/lib/prisma");
    const activeRoles = await prisma.userServiceRole.findMany({
      where: { userId: user.userId },
      select: { role: true },
    });
    userRoles = activeRoles.map((r) => r.role);
    roleCache.set(user.userId, { roles: userRoles, expiry: now + AUTH_CONFIG.roleCacheTtl });
  }

  if (!roles.some((r) => userRoles.includes(r))) {
    throw new ForbiddenError("해당 역할이 활성화되지 않았습니다");
  }
  return user;
}
