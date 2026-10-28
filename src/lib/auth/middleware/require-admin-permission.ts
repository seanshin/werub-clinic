// Created: 2026-04-09
// 부관리자 권한 체크 헬퍼
// SUB_ADMIN은 subAdminPermissions에 해당 권한이 있어야 접근 가능
import { NextRequest } from "next/server";
import { requireAuthAsync } from "./require-auth";
import { ForbiddenError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { JwtPayload } from "@/lib/auth/core/jwt";

/**
 * Admin 권한 체크 + 부관리자 세부 권한 확인
 * @param request - Next.js 요청
 * @param permissionKey - 권한 키 (예: "users", "boards", "notices")
 *                        null이면 ADMIN/SUPER_ADMIN만 허용
 */
export async function requireAdminPermission(
  request: NextRequest,
  permissionKey?: string | null,
): Promise<JwtPayload> {
  // [S-2] 부관리자/관리자 권한 라우트도 token_version 검증(requireAuthAsync)으로 즉시 무효화 반영.
  const user = await requireAuthAsync(request);

  // ADMIN, SUPER_ADMIN은 모든 권한
  if (user.role === "ADMIN" || user.role === "SUPER_ADMIN") {
    return user;
  }

  // SUB_ADMIN은 세부 권한 체크
  if (user.role === "SUB_ADMIN") {
    if (!permissionKey) {
      throw new ForbiddenError("접근 권한이 없습니다");
    }

    const dbUser = await prisma.user.findUnique({
      where: { id: user.userId },
      select: { subAdminPermissions: true },
    });

    const perms = (dbUser?.subAdminPermissions as Record<string, boolean>) || {};
    if (!perms[permissionKey]) {
      throw new ForbiddenError("해당 기능에 대한 권한이 없습니다");
    }

    return user;
  }

  throw new ForbiddenError("관리자 권한이 필요합니다");
}
