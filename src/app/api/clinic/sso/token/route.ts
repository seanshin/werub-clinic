// Created: 2026-05-06
// POST /api/clinic/sso/token — SSO 토큰 발급 (Clinic → HIS)
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/middleware/auth";
import { handleError, BadRequestError } from "@/lib/errors";
import { generateSsoToken } from "@/lib/his/auth";

export async function POST(request: NextRequest) {
  try {
    // skipCsrf: clinic.example.org → example.org 프록시 시 도메인 불일치로 CSRF 쿠키 미전달
    const user = await requireAuth(request, { skipCsrf: true });
    const body = await request.json();
    // M7: target_service 화이트리스트 — 사용자 임의 값이 DB에 저장돼 sso-login 흐름을 우회하지 못하게
    const VALID_TARGETS = ["his"];
    const targetService = body.targetService ?? "his";
    if (!VALID_TARGETS.includes(targetService)) throw new BadRequestError(`유효하지 않은 targetService: ${targetService}`);

    // 병원 소속 확인
    const cafes = await prisma.$queryRaw<Array<{
      cafe_id: string; enterprise_code: string; cafe_status: string;
    }>>`SELECT cm.cafe_id, c.enterprise_code, c.cafe_status
       FROM cafe_members cm JOIN cafes c ON c.id = cm.cafe_id
       WHERE cm.user_id = ${user.userId} AND cm.status = 'ACTIVE' AND c.cafe_type IN ('hospital', 'clinic') AND c.cafe_status = 'active'
       LIMIT 1`;
    if (cafes.length === 0) throw new BadRequestError("활성 병원 소속이 없습니다");
    const cafe = cafes[0];

    const { token, tokenHash } = generateSsoToken();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5분 TTL (HIS 팀 합의)

    await prisma.$executeRaw`INSERT INTO his_sso_tokens (id, token_hash, user_id, cafe_id, target_service, expires_at)
       VALUES (gen_random_uuid()::text, ${tokenHash}, ${user.userId}, ${cafe.cafe_id}, ${targetService}, ${expiresAt})`;

    const hisUrl = process.env.HIS_URL ?? "https://his.example.org";
    const redirectUrl = `${hisUrl}/sso?token=${encodeURIComponent(token)}`;

    // [H-1] raw token 제거 — redirectUrl만 반환
    // [M-1] 감사 로그
    try {
      const { logger } = await import("@/lib/logger");
      logger.audit("HIS_SSO_TOKEN_CREATE", { userId: user.userId, cafeId: cafe.cafe_id, targetService });
    } catch {}

    return NextResponse.json({
      redirectUrl,
      expiresAt,
      targetService,
    });
  } catch (err) { return handleError(err); }
}
