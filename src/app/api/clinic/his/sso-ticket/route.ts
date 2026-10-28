// Created: 2026-07-17 16:10
// HIS → Clinic 열람 SSO 티켓 발급 (viewUrl 재로그인 없는 열람 — C-3 B-2⑤ 후속)
// 흐름: HIS 백엔드가 본 API로 티켓 발급 → 브라우저를 ssoUrl(GET /api/clinic/his/sso-login?ticket=)로 열기
//       → 세션 쿠키(.example.org) 발급 후 redirect로 302 → 결재 문서 즉시 열람.
// 보안: 단회용·60초 TTL·해시 저장(his_sso_tokens, target_service='clinic-view') · 대상=병원(또는 연결 채널 워크스페이스) 멤버 한정 ·
//       플랫폼 관리자(ADMIN/SUPER_ADMIN) 세션 발급 금지 · redirect는 상대경로만(티켓에 바인딩, 교환 시 쿼리 무시).
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireHisAuth, generateSsoToken } from "@/lib/his/auth";
import { getActiveChannelLink } from "@/lib/his/org-sync";
import { handleError, BadRequestError, ForbiddenError } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { z } from "zod";

const MAIN_HOST = process.env.NEXT_PUBLIC_APP_URL || "https://example.org";
const TTL_SEC = 60;

const ticketSchema = z.object({
  userId: z.string().nullish(),
  email: z.string().email().nullish(),
  redirect: z.string().max(500).nullish(), // 상대경로만 (예: /cafes/{slug}/wsign?doc=...)
});

function sanitizeRedirect(r: string | null | undefined, fallback: string): string {
  if (!r) return fallback;
  // 상대경로만 허용: "/"로 시작, "//"(프로토콜 상대)·백슬래시 차단
  if (!r.startsWith("/") || r.startsWith("//") || r.includes("\\")) return fallback;
  return r;
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireHisAuth(request, "staff");
    await rateLimit(request, "write");
    const data = ticketSchema.parse(await request.json());
    if (!data.userId && !data.email) throw new BadRequestError("userId 또는 email이 필요합니다");

    // 대상 유저 해석
    const users = data.userId
      ? await prisma.$queryRaw<{ id: string; role: string; status: string }[]>`SELECT id, role, status FROM users WHERE id = ${data.userId} LIMIT 1`
      : await prisma.$queryRaw<{ id: string; role: string; status: string }[]>`SELECT id, role, status FROM users WHERE email = ${data.email!.toLowerCase()} LIMIT 1`;
    const target = users[0];
    if (!target) throw new BadRequestError("대상 직원을 찾을 수 없습니다");
    if (target.status !== "ACTIVE") throw new ForbiddenError("비활성 계정입니다");
    if (target.role === "ADMIN" || target.role === "SUPER_ADMIN") {
      throw new ForbiddenError("플랫폼 관리자 계정으로는 SSO 티켓을 발급할 수 없습니다");
    }

    // 멤버십: 병원 카페 또는 연결된 채널 워크스페이스
    const link = await getActiveChannelLink(ctx.cafeId);
    const allowedCafeIds = [ctx.cafeId, ...(link ? [link.channelCafeId] : [])];
    const member = await prisma.$queryRaw<{ user_id: string }[]>`
      SELECT user_id FROM cafe_members WHERE user_id = ${target.id} AND cafe_id = ANY(${allowedCafeIds}) LIMIT 1`;
    if (member.length === 0) throw new ForbiddenError("병원(또는 연결 워크스페이스) 소속 직원이 아닙니다");

    // 기본 redirect = 병원 워크스페이스 전자결재
    const slugRow = await prisma.cafe.findUnique({ where: { id: ctx.cafeId }, select: { slug: true } });
    const redirect = sanitizeRedirect(data.redirect, `/cafes/${slugRow?.slug ?? ""}/wsign`);

    const { token, tokenHash } = generateSsoToken();
    const expiresAt = new Date(Date.now() + TTL_SEC * 1000);
    await prisma.$executeRaw`INSERT INTO his_sso_tokens (id, token_hash, user_id, cafe_id, target_service, expires_at, redirect)
       VALUES (gen_random_uuid()::text, ${tokenHash}, ${target.id}, ${ctx.cafeId}, 'clinic-view', ${expiresAt}, ${redirect})`;

    try {
      const { logger } = await import("@/lib/logger");
      logger.audit("HIS_SSO_TICKET", { cafeId: ctx.cafeId, targetUserId: target.id, redirect, apiKeyId: ctx.apiKeyId });
    } catch {}

    return NextResponse.json({
      ok: true,
      ssoUrl: `${MAIN_HOST}/api/clinic/his/sso-login?ticket=${token}`,
      expiresIn: TTL_SEC,
      redirect,
    });
  } catch (err) { return handleError(err); }
}
